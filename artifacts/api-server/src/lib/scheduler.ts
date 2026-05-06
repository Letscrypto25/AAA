import { db, racesTable } from "@workspace/db";
import { eq, and, lte } from "drizzle-orm";
import { logger } from "./logger";

const THIRTY_MIN_MS = 30 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const LAST_30_MIN_THRESHOLD_MS = 30 * 60 * 1000;

export function getNextUpdateTime(raceTime: string): Date {
  const now = new Date();
  const [hours, minutes] = raceTime.split(":").map(Number);
  const raceDate = new Date(now);
  raceDate.setHours(hours, minutes, 0, 0);

  if (raceDate < now) {
    raceDate.setDate(raceDate.getDate() + 1);
  }

  const msUntilRace = raceDate.getTime() - now.getTime();

  if (msUntilRace <= 0) {
    return new Date(now.getTime() + FIVE_MIN_MS);
  }

  if (msUntilRace <= LAST_30_MIN_THRESHOLD_MS) {
    return new Date(now.getTime() + FIVE_MIN_MS);
  }

  return new Date(now.getTime() + THIRTY_MIN_MS);
}

export function getUpdateIntervalLabel(raceTime: string): string {
  const now = new Date();
  const [hours, minutes] = raceTime.split(":").map(Number);
  const raceDate = new Date(now);
  raceDate.setHours(hours, minutes, 0, 0);

  if (raceDate < now) {
    return "5 minutes (race in progress or past)";
  }

  const msUntilRace = raceDate.getTime() - now.getTime();

  if (msUntilRace <= LAST_30_MIN_THRESHOLD_MS) {
    return "5 minutes (final stretch)";
  }

  return "30 minutes";
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let analyzeCallback: ((raceId: number) => Promise<void>) | null = null;

export function setAnalyzeCallback(cb: (raceId: number) => Promise<void>) {
  analyzeCallback = cb;
}

export function startScheduler() {
  if (schedulerInterval) return;

  schedulerInterval = setInterval(async () => {
    if (!analyzeCallback) return;

    try {
      const now = new Date();
      const races = await db
        .select()
        .from(racesTable)
        .where(and(eq(racesTable.status, "upcoming"), lte(racesTable.nextUpdateAt, now)));

      for (const race of races) {
        logger.info({ raceId: race.id, raceName: race.name }, "Scheduled analysis triggered");
        try {
          await analyzeCallback(race.id);
        } catch (err) {
          logger.error({ err, raceId: race.id }, "Scheduled analysis failed");
        }
      }
    } catch (err) {
      logger.error({ err }, "Scheduler tick error");
    }
  }, 60 * 1000);

  logger.info("Prediction scheduler started (1-minute tick)");
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
