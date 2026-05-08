import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler, startSyncScheduler, setAnalyzeCallback, setRefreshOddsCallback, setSyncCallback } from "./lib/scheduler";
import { syncTodaysMeetings, refreshRaceOdds } from "./lib/raceSync";
import { db, predictionWeightsTable, learningFeedbackTable } from "@workspace/db";
import { runRaceForecast } from "./lib/forecasting";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  const existingWeights = await db.select().from(predictionWeightsTable).limit(1);
  if (existingWeights.length === 0) {
    await db.insert(predictionWeightsTable).values({
      courseForm: 0.25,
      formDistance: 0.25,
      jockeyTrainer: 0.2,
      oddsMovement: 0.15,
      history: 0.15,
    });
    logger.info("Default prediction weights seeded");
  }

  const existingLearning = await db.select().from(learningFeedbackTable).limit(1);
  if (existingLearning.length === 0) {
    await db.insert(learningFeedbackTable).values({
      scope: "global",
      factorAdjustments: {
        courseForm: 0,
        formDistance: 0,
        jockeyTrainer: 0,
        oddsMovement: 0,
        history: 0,
      },
    });
    logger.info("Learning feedback store seeded");
  }

  setAnalyzeCallback(async (raceId) => {
    try {
      await runRaceForecast(raceId, "scheduler");
    } catch (error) {
      logger.warn({ error, raceId }, "Scheduled forecast refresh skipped");
    }
  });
  setRefreshOddsCallback(refreshRaceOdds);
  setSyncCallback(syncTodaysMeetings);

  startScheduler();
  startSyncScheduler();
  logger.info("Prediction scheduler started");

  setTimeout(async () => {
    logger.info("Running initial weekly race sync...");
    await syncTodaysMeetings();
  }, 3000);
});
