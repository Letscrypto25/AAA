import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler, startSyncScheduler, setAnalyzeCallback, setRefreshOddsCallback, setSyncCallback } from "./lib/scheduler";
import { syncTodaysMeetings, refreshRaceOdds } from "./lib/raceSync";
import { db, predictionWeightsTable, racesTable, horsesTable, predictionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { analyzeRaceWithAI } from "./lib/groq";
import { getNextUpdateTime } from "./lib/scheduler";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

async function runAnalyze(raceId: number): Promise<void> {
  const [race] = await db.select().from(racesTable).where(eq(racesTable.id, raceId));
  if (!race) return;
  const horses = await db.select().from(horsesTable).where(eq(horsesTable.raceId, raceId));
  if (horses.length === 0) return;

  const [weightsRow] = await db.select().from(predictionWeightsTable).limit(1);
  const weights = weightsRow ?? { courseForm: 0.25, formDistance: 0.25, jockeyTrainer: 0.20, oddsMovement: 0.15, history: 0.15 };

  const aiPredictions = await analyzeRaceWithAI(
    { name: race.name, venue: race.venue, distance: race.distance, surface: race.surface, grade: race.grade, raceTime: race.raceTime },
    horses.map((h) => ({
      name: h.name, number: h.number, jockey: h.jockey, trainer: h.trainer, form: h.form,
      currentOdds: h.currentOdds, openingOdds: h.openingOdds, oddsMovement: h.oddsMovement,
      courseRecord: h.courseRecord, distanceRecord: h.distanceRecord, trainerJockeyRecord: h.trainerJockeyRecord,
      notes: h.notes, weight: h.weight, scratched: h.scratched,
    })),
    weights,
  );

  await db.delete(predictionsTable).where(eq(predictionsTable.raceId, raceId));
  const sorted = [...aiPredictions].sort((a, b) => b.score - a.score);
  const rankMap = new Map(sorted.map((p, i) => [p.horseIndex, i + 1]));

  await db.insert(predictionsTable).values(
    aiPredictions.map((p) => ({
      raceId,
      horseId: horses[p.horseIndex].id,
      rank: rankMap.get(p.horseIndex) ?? 99,
      score: p.score,
      confidence: p.confidence,
      factors: p.factors,
      aiSummary: p.aiSummary,
    })),
  );

  const nextUpdateAt = getNextUpdateTime(race.raceTime);
  await db.update(racesTable).set({ status: "analyzing", lastAnalyzedAt: new Date(), nextUpdateAt }).where(eq(racesTable.id, raceId));
}

app.listen(port, async (err) => {
  if (err) { logger.error({ err }, "Error listening on port"); process.exit(1); }

  logger.info({ port }, "Server listening");

  const existing = await db.select().from(predictionWeightsTable).limit(1);
  if (existing.length === 0) {
    await db.insert(predictionWeightsTable).values({ courseForm: 0.25, formDistance: 0.25, jockeyTrainer: 0.20, oddsMovement: 0.15, history: 0.15 });
    logger.info("Default prediction weights seeded");
  }

  setAnalyzeCallback(runAnalyze);
  setRefreshOddsCallback(refreshRaceOdds);
  setSyncCallback(syncTodaysMeetings);

  startScheduler();
  startSyncScheduler();
  logger.info("Prediction scheduler started");

  setTimeout(async () => {
    logger.info("Running initial race sync for today...");
    await syncTodaysMeetings();
  }, 3000);
});
