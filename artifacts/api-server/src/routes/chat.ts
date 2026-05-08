import { Router } from "express";
import {
  db,
  chatMessagesTable,
  predictionWeightsTable,
  racesTable,
  horsesTable,
  predictionsTable,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { SendChatMessageBody } from "@workspace/api-zod";
import { chatWithAI } from "../lib/groq";
import { buildRaceForecastCards, buildWeeklyOverview, getLearningPerformanceSummary } from "../lib/race-insights";

const router = Router();

function oddsLabel(movement: string): string {
  if (movement === "shortening") return "SHORTENING";
  if (movement === "drifting") return "DRIFTING";
  return "STABLE";
}

async function buildForecastBriefing(focusRaceId?: number): Promise<string> {
  const allRaces = await db.select().from(racesTable).orderBy(racesTable.meetingDate, racesTable.raceTime);
  const cards = await buildRaceForecastCards(allRaces);
  const performance = await getLearningPerformanceSummary();
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

  const todayCards = cards.filter((card) => card.isToday).sort((left, right) => {
    const leftMinutes = left.minutesToRace ?? Number.MAX_SAFE_INTEGER;
    const rightMinutes = right.minutesToRace ?? Number.MAX_SAFE_INTEGER;
    return leftMinutes - rightMinutes;
  });
  const weeklyOverview = buildWeeklyOverview(cards);
  const focusCard = focusRaceId ? cards.find((card) => card.id === focusRaceId) : todayCards[0];

  const lines: string[] = [];
  lines.push("AAA BETS FORECAST CONTEXT");
  lines.push(
    `TODAY: ${todayCards.length} races loaded | WEEK: ${cards.filter((card) => card.isThisWeek).length} races across ${weeklyOverview.length} days`,
  );
  lines.push(
    `MODEL: ${Math.round(performance.topPickWinRate * 100)}% win | ${Math.round(performance.placedRate * 100)}% place | ${Math.round(performance.averageConfidence * 100)}% avg confidence | bias ${performance.confidenceBias >= 0 ? "+" : ""}${performance.confidenceBias.toFixed(2)}`,
  );
  if (performance.strongestEdge) {
    lines.push(`LEARNED EDGE: ${performance.strongestEdge}`);
  }
  if (performance.recentResults.length > 0) {
    lines.push(
      `RECENT RESULTS: ${performance.recentResults
        .map((result) => `${result.raceName} ${result.topPickCorrect ? "HIT" : "MISS"} (${result.topPickHorseName ?? "no pick"} -> ${result.winnerHorseName})`)
        .join(" | ")}`,
    );
  }
  lines.push("");

  if (todayCards.length === 0) {
    lines.push("TODAY CARD: no current-day races are loaded yet.");
  } else {
    lines.push("TODAY CARD:");
    for (const card of todayCards.slice(0, 8)) {
      lines.push(
        `- Race ${card.raceNumber} ${card.name} | ${card.venue} ${card.raceTime} | ${card.distance}m ${card.surface} | ${card.topPrediction ? `${card.topPrediction.horseName} ${Math.round(card.topPrediction.confidence * 100)}% ${card.topPrediction.confidenceBand}` : "forecast pending"}`,
      );
      if (card.result) {
        lines.push(
          `  Result: ${card.result.winnerHorseName}${card.result.topPickCorrect === true ? " (top pick hit)" : card.result.topPickCorrect === false ? " (top pick missed)" : ""}`,
        );
      }
    }
  }

  lines.push("");
  lines.push("WEEK AHEAD:");
  for (const day of weeklyOverview.slice(0, 7)) {
    lines.push(
      `- ${day.label}: ${day.raceCount} races at ${day.venues.join(", ")} | spotlight ${day.spotlightRaceName ?? "none"}${day.spotlightHorseName ? ` -> ${day.spotlightHorseName} ${Math.round((day.spotlightConfidence ?? 0) * 100)}%` : ""}`,
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

  const recentHistory = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(16);

  const history = recentHistory.reverse().map((chatMessage) => ({
    role: chatMessage.role as "user" | "assistant",
    content: chatMessage.content,
  }));

  const raceDayBriefing = await buildForecastBriefing(raceId ?? undefined);

  await db.insert(chatMessagesTable).values({
    role: "user",
    content: message,
    raceId: raceId ?? null,
  });

  let aiResult;
  try {
    aiResult = await chatWithAI(message, weights, history, raceDayBriefing);
  } catch (_err) {
    aiResult = {
      reply: "I'm unable to connect to the AI right now. Please check your GROQ_API_KEY and try again.",
      weightSuggestions: undefined,
    };
  }

  await db.insert(chatMessagesTable).values({
    role: "assistant",
    content: aiResult.reply,
    raceId: raceId ?? null,
  });

  let updatedWeights = null;
  if (aiResult.weightSuggestions) {
    const suggestions = aiResult.weightSuggestions;
    const nextWeights = {
      courseForm: suggestions.courseForm ?? weights.courseForm,
      formDistance: suggestions.formDistance ?? weights.formDistance,
      jockeyTrainer: suggestions.jockeyTrainer ?? weights.jockeyTrainer,
      oddsMovement: suggestions.oddsMovement ?? weights.oddsMovement,
      history: suggestions.history ?? weights.history,
    };
    const total = Object.values(nextWeights).reduce((sum, value) => sum + value, 0);
    if (Math.abs(total - 1.0) < 0.05) {
      const [updated] = await db
        .update(predictionWeightsTable)
        .set({ ...nextWeights, updatedAt: new Date() })
        .returning();
      updatedWeights = updated ? { ...updated, updatedAt: updated.updatedAt.toISOString() } : null;
    }
  }

  res.json({
    message: aiResult.reply,
    updatedWeights,
    triggeredAnalysis: false,
  });
});

export default router;
