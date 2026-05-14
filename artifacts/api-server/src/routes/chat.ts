import { Router } from "express";
import {
  db,
  chatMessagesTable,
  predictionWeightsTable,
  racesTable,
  horsesTable,
  predictionsTable,
} from "@workspace/db";
import { desc } from "drizzle-orm";
import { SendChatMessageBody } from "@workspace/api-zod";
import {
  chatWithAI,
  inferChatControlsFromMessage,
  type ChatActionSuggestion,
  type ChatWeightSuggestion,
} from "../lib/groq";
import { runRaceForecast } from "../lib/forecasting";
import { getLastSyncStatus, syncTodaysMeetings } from "../lib/raceSync";
import {
  buildRaceForecastCards,
  buildWeeklyOverview,
  getLearningPerformanceSummary,
  isRaceHistoryCard,
  isRaceLiveCard,
  sortRaceCardsByHistoryPriority,
  sortRaceCardsByLivePriority,
} from "../lib/race-insights";

const router = Router();

type WeightSnapshot = {
  courseForm: number;
  formDistance: number;
  jockeyTrainer: number;
  oddsMovement: number;
  history: number;
  fieldStrength: number;
  weightCarried: number;
  surfaceFit: number;
  paceProfile: number;
  priceValue: number;
};

type ChatActionResult = {
  type: "sync" | "analyze_focus" | "analyze_today";
  status: "executed" | "skipped" | "failed";
  label: string;
  detail: string;
};

type PersistedWeightSnapshot = WeightSnapshot & {
  updatedAt: string;
};

function oddsLabel(movement: string): string {
  if (movement === "shortening") return "SHORTENING";
  if (movement === "drifting") return "DRIFTING";
  return "STABLE";
}

function getWeightSnapshot(weights: WeightSnapshot): WeightSnapshot {
  return {
    courseForm: weights.courseForm,
    formDistance: weights.formDistance,
    jockeyTrainer: weights.jockeyTrainer,
    oddsMovement: weights.oddsMovement,
    history: weights.history,
    fieldStrength: weights.fieldStrength,
    weightCarried: weights.weightCarried,
    surfaceFit: weights.surfaceFit,
    paceProfile: weights.paceProfile,
    priceValue: weights.priceValue,
  };
}

function normalizeWeightMix(weights: WeightSnapshot): WeightSnapshot {
  const sanitized = {
    courseForm: Math.max(0.01, weights.courseForm),
    formDistance: Math.max(0.01, weights.formDistance),
    jockeyTrainer: Math.max(0.01, weights.jockeyTrainer),
    oddsMovement: Math.max(0.01, weights.oddsMovement),
    history: Math.max(0.01, weights.history),
    fieldStrength: Math.max(0.01, weights.fieldStrength),
    weightCarried: Math.max(0.01, weights.weightCarried),
    surfaceFit: Math.max(0.01, weights.surfaceFit),
    paceProfile: Math.max(0.01, weights.paceProfile),
    priceValue: Math.max(0.01, weights.priceValue),
  };
  const total = Object.values(sanitized).reduce((sum, value) => sum + value, 0);

  return {
    courseForm: sanitized.courseForm / total,
    formDistance: sanitized.formDistance / total,
    jockeyTrainer: sanitized.jockeyTrainer / total,
    oddsMovement: sanitized.oddsMovement / total,
    history: sanitized.history / total,
    fieldStrength: sanitized.fieldStrength / total,
    weightCarried: sanitized.weightCarried / total,
    surfaceFit: sanitized.surfaceFit / total,
    paceProfile: sanitized.paceProfile / total,
    priceValue: sanitized.priceValue / total,
  };
}

function formatWeightLine(weights: WeightSnapshot): string {
  return [
    `Course Form ${(weights.courseForm * 100).toFixed(0)}%`,
    `Form/Distance ${(weights.formDistance * 100).toFixed(0)}%`,
    `Jockey/Trainer ${(weights.jockeyTrainer * 100).toFixed(0)}%`,
    `Odds ${(weights.oddsMovement * 100).toFixed(0)}%`,
    `History ${(weights.history * 100).toFixed(0)}%`,
    `Field ${(weights.fieldStrength * 100).toFixed(0)}%`,
    `Weight ${(weights.weightCarried * 100).toFixed(0)}%`,
    `Surface ${(weights.surfaceFit * 100).toFixed(0)}%`,
    `Pace ${(weights.paceProfile * 100).toFixed(0)}%`,
    `Value ${(weights.priceValue * 100).toFixed(0)}%`,
  ].join(" | ");
}

function buildLearningLine(adjustments: Record<string, number>): string {
  return Object.entries(adjustments)
    .map(([key, value]) => `${key} ${value >= 0 ? "+" : ""}${value.toFixed(2)}`)
    .join(" | ");
}

function isSkippableAnalysisError(message: string): boolean {
  return message === "Race already graded or closed" || message === "No horses in this race";
}

type ForecastCard = Awaited<ReturnType<typeof buildRaceForecastCards>>[number];

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function includesWholePhrase(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle || normalizedNeedle.length < 2) return false;
  return haystack.includes(normalizedNeedle);
}

function extractMentionedNumbers(message: string, pattern: RegExp): Set<number> {
  const values = new Set<number>();
  for (const match of message.matchAll(pattern)) {
    const value = Number.parseInt(match[1] ?? match[2] ?? "", 10);
    if (Number.isFinite(value)) values.add(value);
  }
  return values;
}

type FocusSignals = {
  normalizedMessage: string;
  raceNumbers: Set<number>;
  runnerNumbers: Set<number>;
  mentionsToday: boolean;
  mentionsTomorrow: boolean;
  mentionsYesterday: boolean;
};

function buildFocusSignals(message: string): FocusSignals {
  const normalizedMessage = normalizeText(message);
  return {
    normalizedMessage,
    raceNumbers: extractMentionedNumbers(message, /\brace\s*(\d{1,2})\b|\br(\d{1,2})\b/gi),
    runnerNumbers: extractMentionedNumbers(message, /#\s*(\d{1,2})\b|\b(?:runner|horse|number|no)\s*(\d{1,2})\b/gi),
    mentionsToday: /\btoday\b/.test(normalizedMessage),
    mentionsTomorrow: /\btomorrow\b/.test(normalizedMessage),
    mentionsYesterday: /\byesterday\b/.test(normalizedMessage),
  };
}

function scoreRaceFocus(signals: FocusSignals, card: ForecastCard): number {
  if (!signals.normalizedMessage) return 0;

  let score = 0;

  if (signals.raceNumbers.size > 0) {
    if (!signals.raceNumbers.has(card.raceNumber)) return -2;
    score += 8;
  }

  if (signals.runnerNumbers.size > 0) {
    const runnerNumbers = new Set(card.searchContext.runnerNumbers ?? []);
    const runnerMatches = [...signals.runnerNumbers].filter((runnerNumber) => runnerNumbers.has(runnerNumber)).length;
    if (runnerMatches > 0) {
      score += runnerMatches * 4;
    } else if (signals.raceNumbers.has(card.raceNumber)) {
      score -= 3;
    }
  }

  if (signals.mentionsToday) score += card.isToday ? 3 : -1;
  if (signals.mentionsTomorrow) score += card.dayLabel.toLowerCase() === "tomorrow" ? 3 : -1;
  if (signals.mentionsYesterday) score += card.dayLabel.toLowerCase() === "yesterday" ? 3 : -1;

  if (signals.normalizedMessage.includes(`race ${card.raceNumber}`)) score += 4;
  if (signals.normalizedMessage.includes(`r${card.raceNumber}`)) score += 1.5;
  if (includesWholePhrase(signals.normalizedMessage, card.name)) score += 6;
  if (includesWholePhrase(signals.normalizedMessage, card.venue)) score += 3;
  if (includesWholePhrase(signals.normalizedMessage, card.dayLabel)) score += 2;
  if (card.grade && includesWholePhrase(signals.normalizedMessage, card.grade)) score += 1.5;
  if (card.topPrediction?.horseName && includesWholePhrase(signals.normalizedMessage, card.topPrediction.horseName)) score += 3.5;
  if (card.result?.winnerHorseName && includesWholePhrase(signals.normalizedMessage, card.result.winnerHorseName)) score += 3.5;

  for (const runnerLabel of card.searchContext.runnerLabels ?? []) {
    if (includesWholePhrase(signals.normalizedMessage, runnerLabel)) score += 2.5;
  }

  for (const horseName of card.searchContext.horseNames) {
    if (includesWholePhrase(signals.normalizedMessage, horseName)) score += 2;
  }

  for (const jockey of card.searchContext.jockeys) {
    if (includesWholePhrase(signals.normalizedMessage, jockey)) score += 1;
  }

  for (const trainer of card.searchContext.trainers) {
    if (includesWholePhrase(signals.normalizedMessage, trainer)) score += 1;
  }

  return score;
}

function inferFocusRaceId(message: string, cards: ForecastCard[], explicitRaceId?: number): number | undefined {
  if (explicitRaceId) return explicitRaceId;
  const signals = buildFocusSignals(message);
  const candidateCards = signals.raceNumbers.size > 0
    ? cards.filter((card) => signals.raceNumbers.has(card.raceNumber))
    : cards;
  if (candidateCards.length === 1) return candidateCards[0]?.id;

  let bestScore = 0;
  let bestMatches: number[] = [];

  for (const card of candidateCards) {
    const score = scoreRaceFocus(signals, card);
    if (score <= 0) continue;

    if (score > bestScore) {
      bestScore = score;
      bestMatches = [card.id];
      continue;
    }

    if (score === bestScore) {
      bestMatches.push(card.id);
    }
  }

  const minimumScore = signals.raceNumbers.size > 0 || signals.runnerNumbers.size > 0 ? 5 : 4;
  return bestScore >= minimumScore && bestMatches.length === 1 ? bestMatches[0] : undefined;
}

async function buildForecastBriefing(currentWeights: WeightSnapshot, focusRaceId?: number): Promise<string> {
  const allRaces = await db.select().from(racesTable).orderBy(racesTable.meetingDate, racesTable.raceTime);
  const cards = (await buildRaceForecastCards(allRaces)).filter((card) => card.horseCount > 0 || !!card.result);
  const performance = await getLearningPerformanceSummary();
  const syncStatus = await getLastSyncStatus();
  const allHorses = await db.select().from(horsesTable);
  const allPredictions = await db.select().from(predictionsTable).orderBy(predictionsTable.rank);

  const horseMap = new Map<number, typeof allHorses>();
  const predictionMap = new Map<number, typeof allPredictions>();

  for (const horse of allHorses) {
    const list = horseMap.get(horse.raceId) ?? [];
    list.push(horse);
    horseMap.set(horse.raceId, list);
  }

  for (const prediction of allPredictions) {
    const list = predictionMap.get(prediction.raceId) ?? [];
    list.push(prediction);
    predictionMap.set(prediction.raceId, list);
  }

  const liveCards = sortRaceCardsByLivePriority(cards.filter(isRaceLiveCard));
  const todayCards = liveCards.filter((card) => card.isToday);
  const nonTodayLiveCards = liveCards.filter((card) => !card.isToday);
  const historyCards = sortRaceCardsByHistoryPriority(cards.filter(isRaceHistoryCard));
  const weeklyOverview = buildWeeklyOverview(cards);
  const focusCard = focusRaceId
    ? cards.find((card) => card.id === focusRaceId)
    : todayCards[0] ?? liveCards[0] ?? historyCards[0];

  const lines: string[] = [];
  lines.push("AAA BETS FORECAST CONTEXT");
  lines.push("SOURCE OF TRUTH: use this live briefing first and override stale earlier chat turns when they conflict.");
  lines.push(
    `APP STATE: ${liveCards.length} live races | ${todayCards.length} live today | ${historyCards.length} results/history | ${cards.filter((card) => card.isThisWeek).length} week cards`,
  );
  lines.push(
    `MODEL: ${Math.round(performance.topPickWinRate * 100)}% win | ${Math.round(performance.placedRate * 100)}% place | ${Math.round(performance.averageConfidence * 100)}% avg confidence | bias ${performance.confidenceBias >= 0 ? "+" : ""}${performance.confidenceBias.toFixed(2)}`,
  );
  lines.push(`CURRENT WEIGHTS: ${formatWeightLine(currentWeights)}`);
  lines.push(`ADAPTIVE SIGNALS: ${buildLearningLine(performance.factorAdjustments)}`);
  if (performance.strongestEdge) {
    lines.push(`LEARNED EDGE: ${performance.strongestEdge}`);
  }
  if (syncStatus) {
    lines.push(
      `SYNC STATUS: ${syncStatus.status} | date ${syncStatus.lastSyncDate ?? "unknown"} | meetings ${syncStatus.meetingsFound} | races ${syncStatus.racesCreated}`,
    );
  }
  if (performance.recentResults.length > 0) {
    lines.push(
      `RECENT RESULTS: ${performance.recentResults
        .map((result) => `${result.raceName} ${result.topPickCorrect ? "HIT" : "MISS"} (${result.topPickHorseName ?? "no pick"} -> ${result.winnerHorseName})`)
        .join(" | ")}`,
    );
  }
  lines.push("AVAILABLE ACTIONS: sync the live card, analyze the focused race, analyze today's live races, update weights.");
  lines.push("");

  if (todayCards.length === 0) {
    lines.push("LIVE CARD: no live today races are loaded right now.");
  } else {
    lines.push("LIVE CARD:");
    for (const card of todayCards) {
      lines.push(
        `- Race ${card.raceNumber} ${card.name} | ${card.venue} ${card.raceTime} | ${card.distance}m ${card.surface} | status ${card.status} | ${card.topPrediction ? `${card.topPrediction.horseName} ${Math.round(card.topPrediction.confidence * 100)}% ${card.topPrediction.confidenceBand}` : "forecast pending"}`,
      );
    }
  }

  if (nonTodayLiveCards.length > 0) {
    lines.push("");
    lines.push("UPCOMING THIS WEEK:");
    for (const card of nonTodayLiveCards.slice(0, 12)) {
      lines.push(
        `- Race ${card.raceNumber} ${card.name} | ${card.dayLabel} | ${card.venue} ${card.raceTime} | ${card.topPrediction ? `${card.topPrediction.horseName} ${Math.round(card.topPrediction.confidence * 100)}%` : "forecast pending"}`,
      );
    }
  }

  lines.push("");
  lines.push("RESULTS AND HISTORY:");
  if (historyCards.length === 0) {
    lines.push("- No completed or over races are stored yet.");
  } else {
    for (const card of historyCards.slice(0, 6)) {
      lines.push(
        `- Race ${card.raceNumber} ${card.name} | ${card.venue} ${card.raceTime} | ${card.result ? `winner ${card.result.winnerHorseName}` : "result pending"}${card.result?.topPickCorrect === true ? " | top pick hit" : card.result?.topPickCorrect === false ? " | top pick missed" : ""}`,
      );
    }
  }

  lines.push("");
  lines.push("WEEK AHEAD:");
  for (const day of weeklyOverview.slice(0, 7)) {
    lines.push(
      `- ${day.label}: ${day.raceCount} races at ${day.venues.join(", ")} | forecasted ${day.analyzedCount} | completed ${day.completedCount}${day.spotlightRaceName ? ` | spotlight ${day.spotlightRaceName}${day.spotlightHorseName ? ` -> ${day.spotlightHorseName}` : ""}${day.spotlightConfidence != null ? ` ${Math.round(day.spotlightConfidence * 100)}%` : ""}` : ""}`,
    );
  }

  if (focusCard) {
    const horses = (horseMap.get(focusCard.id) ?? []).sort((left, right) => left.number - right.number);
    const predictions = (predictionMap.get(focusCard.id) ?? []).sort((left, right) => left.rank - right.rank);

    lines.push("");
    lines.push(
      `FOCUS RACE: Race ${focusCard.raceNumber} ${focusCard.name} | ${focusCard.venue} ${focusCard.raceTime} | ${focusCard.distance}m ${focusCard.surface} | status ${focusCard.status}`,
    );
    lines.push("RUNNER NUMBERS: treat the #number beside each horse as the source of truth and do not renumber them.");

    for (const horse of horses) {
      const prediction = predictions.find((item) => item.horseId === horse.id);
      lines.push(
        `- #${horse.number} ${horse.name} | ${horse.jockey}/${horse.trainer} | form ${horse.form || "unknown"} | odds ${horse.currentOdds} ${oddsLabel(horse.oddsMovement)}${prediction ? ` | AI #${prediction.rank} ${Math.round(prediction.score * 100)}pts ${Math.round(prediction.confidence * 100)}%` : ""}${horse.scratched ? " | SCRATCHED" : ""}`,
      );
      if (prediction?.aiSummary) {
        lines.push(`  Note: ${prediction.aiSummary}`);
      }
    }
  }

  return lines.join("\n");
}

async function executeAnalyzeTodayAction(): Promise<ChatActionResult> {
  const allRaces = await db.select().from(racesTable).orderBy(racesTable.meetingDate, racesTable.raceTime);
  const cards = await buildRaceForecastCards(allRaces);
  const candidates = sortRaceCardsByLivePriority(
    cards.filter((card) => card.isToday && isRaceLiveCard(card) && card.horseCount > 0),
  );

  if (candidates.length === 0) {
    return {
      type: "analyze_today",
      status: "skipped",
      label: "Analyze live today",
      detail: "No live today races were ready to analyze.",
    };
  }

  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const card of candidates) {
    try {
      await runRaceForecast(card.id, "manual");
      successCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Race analysis failed";
      if (isSkippableAnalysisError(message)) skippedCount += 1;
      else failedCount += 1;
    }
  }

  if (successCount > 0) {
    return {
      type: "analyze_today",
      status: "executed",
      label: "Analyze live today",
      detail: `Analyzed ${successCount} live today race(s)${skippedCount > 0 ? `, skipped ${skippedCount}` : ""}${failedCount > 0 ? `, failed ${failedCount}` : ""}.`,
    };
  }

  return {
    type: "analyze_today",
    status: failedCount > 0 ? "failed" : "skipped",
    label: "Analyze live today",
    detail: failedCount > 0
      ? `No today forecasts were refreshed. ${failedCount} race(s) failed.`
      : "No today forecasts were refreshed because every race was already closed or missing runners.",
  };
}

async function executeChatActions(actions: ChatActionSuggestion[], focusRaceId?: number | null): Promise<{
  actionResults: ChatActionResult[];
  triggeredAnalysis: boolean;
}> {
  const orderedActions = [...actions].sort((left, right) => {
    if (left.type === right.type) return 0;
    return left.type === "sync" ? -1 : 1;
  });

  const actionResults: ChatActionResult[] = [];

  for (const action of orderedActions) {
    if (action.type === "sync") {
      try {
        await syncTodaysMeetings();
        const status = await getLastSyncStatus();
        actionResults.push({
          type: "sync",
          status: "executed",
          label: "Sync live card",
          detail: status
            ? `Sync completed for ${status.lastSyncDate ?? "today"} with ${status.meetingsFound} meeting(s) and ${status.racesCreated} new race(s).`
            : "Sync completed.",
        });
      } catch {
        actionResults.push({
          type: "sync",
          status: "failed",
          label: "Sync live card",
          detail: "Sync failed.",
        });
      }
      continue;
    }

    if (action.scope === "focus") {
      if (!focusRaceId) {
        actionResults.push({
          type: "analyze_focus",
          status: "skipped",
          label: "Analyze focused race",
          detail: "No focused race was selected.",
        });
        continue;
      }

      try {
        await runRaceForecast(focusRaceId, "manual");
        actionResults.push({
          type: "analyze_focus",
          status: "executed",
          label: "Analyze focused race",
          detail: `Forecast refreshed for race ${focusRaceId}.`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Race analysis failed";
        actionResults.push({
          type: "analyze_focus",
          status: isSkippableAnalysisError(message) ? "skipped" : "failed",
          label: "Analyze focused race",
          detail: isSkippableAnalysisError(message)
            ? `Focused race was not refreshed: ${message}.`
            : `Focused race analysis failed: ${message}.`,
        });
      }
      continue;
    }

    actionResults.push(await executeAnalyzeTodayAction());
  }

  return {
    actionResults,
    triggeredAnalysis: actionResults.some((result) => result.status === "executed" && result.type !== "sync"),
  };
}

router.get("/chat/history", async (_req, res): Promise<void> => {
  const messages = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(60);

  res.json(
    messages.reverse().map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    })),
  );
});

router.post("/chat", async (req, res): Promise<void> => {
  const body = SendChatMessageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { message, raceId } = body.data;

  let [weights] = await db.select().from(predictionWeightsTable).limit(1);
  if (!weights) {
    [weights] = await db
      .insert(predictionWeightsTable)
      .values({
        courseForm: 0.18,
        formDistance: 0.18,
        jockeyTrainer: 0.14,
        oddsMovement: 0.10,
        history: 0.10,
        fieldStrength: 0.08,
        weightCarried: 0.07,
        surfaceFit: 0.06,
        paceProfile: 0.05,
        priceValue: 0.04,
      })
      .returning();
  }

  const currentWeights = getWeightSnapshot(weights);
  const recentHistory = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(16);

  const history = recentHistory.reverse().map((chatMessage) => ({
    role: chatMessage.role as "user" | "assistant",
    content: chatMessage.content,
  }));

  const focusCards = await buildRaceForecastCards(
    await db.select().from(racesTable).orderBy(racesTable.meetingDate, racesTable.raceTime),
  );
  const resolvedRaceId = inferFocusRaceId(message, focusCards, raceId ?? undefined);
  const raceDayBriefing = await buildForecastBriefing(currentWeights, resolvedRaceId);

  await db.insert(chatMessagesTable).values({
    role: "user",
    content: message,
    raceId: resolvedRaceId ?? null,
  });

  let aiResult: {
    reply: string;
    weightSuggestions?: ChatWeightSuggestion;
    actionSuggestions: ChatActionSuggestion[];
  };

  try {
    aiResult = await chatWithAI(message, currentWeights, history, raceDayBriefing, Boolean(resolvedRaceId));
  } catch {
    const inferred = inferChatControlsFromMessage(message, currentWeights, Boolean(resolvedRaceId));
    aiResult = {
      reply: inferred.actionSuggestions.length > 0 || inferred.weightSuggestions
        ? "The AI connection is unavailable, but I can still run the requested in-app control."
        : "I'm unable to connect to the AI right now. Please check your GROQ_API_KEY and try again.",
      weightSuggestions: inferred.weightSuggestions,
      actionSuggestions: inferred.actionSuggestions,
    };
  }

  let updatedWeights: PersistedWeightSnapshot | null = null;
  if (aiResult.weightSuggestions) {
    const nextWeights = normalizeWeightMix({
      courseForm: aiResult.weightSuggestions.courseForm ?? currentWeights.courseForm,
      formDistance: aiResult.weightSuggestions.formDistance ?? currentWeights.formDistance,
      jockeyTrainer: aiResult.weightSuggestions.jockeyTrainer ?? currentWeights.jockeyTrainer,
      oddsMovement: aiResult.weightSuggestions.oddsMovement ?? currentWeights.oddsMovement,
      history: aiResult.weightSuggestions.history ?? currentWeights.history,
      fieldStrength: aiResult.weightSuggestions.fieldStrength ?? currentWeights.fieldStrength,
      weightCarried: aiResult.weightSuggestions.weightCarried ?? currentWeights.weightCarried,
      surfaceFit: aiResult.weightSuggestions.surfaceFit ?? currentWeights.surfaceFit,
      paceProfile: aiResult.weightSuggestions.paceProfile ?? currentWeights.paceProfile,
      priceValue: aiResult.weightSuggestions.priceValue ?? currentWeights.priceValue,
    });
    const [updated] = await db
      .update(predictionWeightsTable)
      .set({ ...nextWeights, updatedAt: new Date() })
      .returning();
    updatedWeights = updated ? { ...updated, updatedAt: updated.updatedAt.toISOString() } : null;
  }

  const { actionResults, triggeredAnalysis } = await executeChatActions(aiResult.actionSuggestions, resolvedRaceId ?? null);

  const confirmationLines: string[] = [];
  if (updatedWeights) {
    confirmationLines.push(`- Saved weights in app: ${formatWeightLine(getWeightSnapshot(updatedWeights))}`);
  }
  for (const result of actionResults) {
    confirmationLines.push(`- ${result.detail}`);
  }

  const finalReply = confirmationLines.length > 0
    ? `${aiResult.reply}\n\nApp actions:\n${confirmationLines.join("\n")}`.trim()
    : aiResult.reply;

  await db.insert(chatMessagesTable).values({
    role: "assistant",
    content: finalReply,
    raceId: resolvedRaceId ?? null,
  });

  res.json({
    message: finalReply,
    updatedWeights,
    triggeredAnalysis,
    actionResults,
  });
});

export default router;
