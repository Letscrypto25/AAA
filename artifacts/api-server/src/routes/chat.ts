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
  };
}

function normalizeWeightMix(weights: WeightSnapshot): WeightSnapshot {
  const sanitized = {
    courseForm: Math.max(0.01, weights.courseForm),
    formDistance: Math.max(0.01, weights.formDistance),
    jockeyTrainer: Math.max(0.01, weights.jockeyTrainer),
    oddsMovement: Math.max(0.01, weights.oddsMovement),
    history: Math.max(0.01, weights.history),
  };
  const total = Object.values(sanitized).reduce((sum, value) => sum + value, 0);

  return {
    courseForm: sanitized.courseForm / total,
    formDistance: sanitized.formDistance / total,
    jockeyTrainer: sanitized.jockeyTrainer / total,
    oddsMovement: sanitized.oddsMovement / total,
    history: sanitized.history / total,
  };
}

function formatWeightLine(weights: WeightSnapshot): string {
  return [
    `Course Form ${(weights.courseForm * 100).toFixed(0)}%`,
    `Form/Distance ${(weights.formDistance * 100).toFixed(0)}%`,
    `Jockey/Trainer ${(weights.jockeyTrainer * 100).toFixed(0)}%`,
    `Odds ${(weights.oddsMovement * 100).toFixed(0)}%`,
    `History ${(weights.history * 100).toFixed(0)}%`,
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
    for (const card of todayCards.slice(0, 8)) {
      lines.push(
        `- Race ${card.raceNumber} ${card.name} | ${card.venue} ${card.raceTime} | ${card.distance}m ${card.surface} | status ${card.status} | ${card.topPrediction ? `${card.topPrediction.horseName} ${Math.round(card.topPrediction.confidence * 100)}% ${card.topPrediction.confidenceBand}` : "forecast pending"}`,
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
      .values({ courseForm: 0.25, formDistance: 0.25, jockeyTrainer: 0.2, oddsMovement: 0.15, history: 0.15 })
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

  const raceDayBriefing = await buildForecastBriefing(currentWeights, raceId ?? undefined);

  await db.insert(chatMessagesTable).values({
    role: "user",
    content: message,
    raceId: raceId ?? null,
  });

  let aiResult: {
    reply: string;
    weightSuggestions?: ChatWeightSuggestion;
    actionSuggestions: ChatActionSuggestion[];
  };

  try {
    aiResult = await chatWithAI(message, currentWeights, history, raceDayBriefing, Boolean(raceId));
  } catch {
    const inferred = inferChatControlsFromMessage(message, currentWeights, Boolean(raceId));
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
    });
    const [updated] = await db
      .update(predictionWeightsTable)
      .set({ ...nextWeights, updatedAt: new Date() })
      .returning();
    updatedWeights = updated ? { ...updated, updatedAt: updated.updatedAt.toISOString() } : null;
  }

  const { actionResults, triggeredAnalysis } = await executeChatActions(aiResult.actionSuggestions, raceId ?? null);

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
    raceId: raceId ?? null,
  });

  res.json({
    message: finalReply,
    updatedWeights,
    triggeredAnalysis,
    actionResults,
  });
});

export default router;
