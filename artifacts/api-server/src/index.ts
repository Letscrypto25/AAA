import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { db, predictionWeightsTable } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  const existing = await db.select().from(predictionWeightsTable).limit(1);
  if (existing.length === 0) {
    await db.insert(predictionWeightsTable).values({
      courseForm: 0.25,
      formDistance: 0.25,
      jockeyTrainer: 0.20,
      oddsMovement: 0.15,
      history: 0.15,
    });
    logger.info("Default prediction weights seeded");
  }

  startScheduler();
  logger.info("Prediction scheduler started");
});
