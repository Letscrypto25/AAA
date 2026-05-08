import { db, racesTable } from "@workspace/db";
import { and, inArray, lte } from "drizzle-orm";
import { logger } from "./logger";
import { getMinutesToRace, getRaceTimeProfile } from "./race-time";

const FIVE_MIN_MS = 5 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function getNextUpdateTime(raceTime: string, meetingDate?: string | null): Date {
  const profile = getRaceTimeProfile(raceTime, meetingDate);
  return new Date(Date.now() + profile.nextUpdateDelayMs);
}

export function getUpdateIntervalLabel(raceTime: string, meetingDate?: string | null): string {
  const profile = getRaceTimeProfile(raceTime, meetingDate);
  if (profile.band === "post-race") return "5 minutes (result pending)";
  if (profile.band === "jump") return "5 minutes (final market)";
  if (profile.band === "late-market") return "10 minutes";
  if (profile.band === "today") return "30 minutes";
  if (profile.band === "tomorrow") return "90 minutes";
  if (profile.band === "building") return "4 hours";
  return "12 hours";
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;
let analyzeCallback: ((raceId: number) => Promise<void>) | null = null;
let refreshOddsCallback: ((raceId: number) => Promise<void>) | null = null;
let syncCallback: (() => Promise<void>) | null = null;

export function setAnalyzeCallback(cb: (raceId: number) => Promise<void>) {
  analyzeCallback = cb;
}

export function setRefreshOddsCallback(cb: (raceId: number) => Promise<void>) {
  refreshOddsCallback = cb;
}

export function setSyncCallback(cb: () => Promise<void>) {
  syncCallback = cb;
}

export function startScheduler() {
  if (schedulerInterval) return;

  schedulerInterval = setInterval(async () => {
    try {
      const now = new Date();
      const dueRaces = await db
        .select()
        .from(racesTable)
        .where(
          and(
            inArray(racesTable.status, ["upcoming", "analyzing"]),
            lte(racesTable.nextUpdateAt, now),
          ),
        );

      for (const race of dueRaces) {
        const minutesToRace = getMinutesToRace(race.raceTime, race.meetingDate);
        if (minutesToRace !== null && minutesToRace < -30) continue;

        if (refreshOddsCallback && minutesToRace !== null && minutesToRace > 0 && minutesToRace <= 6 * 60) {
          try {
            await refreshOddsCallback(race.id);
          } catch (err) {
            logger.error({ err, raceId: race.id }, "Odds refresh failed before scheduled analysis");
          }
        }

        if (analyzeCallback) {
          logger.info({ raceId: race.id, raceName: race.name }, "Scheduled analysis triggered");
          try {
            await analyzeCallback(race.id);
          } catch (err) {
            logger.error({ err, raceId: race.id }, "Scheduled analysis failed");
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Scheduler tick error");
    }
  }, 60 * 1000);

  logger.info("Prediction scheduler started (1-minute tick)");
}

export function startSyncScheduler() {
  if (syncInterval) return;

  syncInterval = setInterval(async () => {
    if (!syncCallback) return;
    try {
      await syncCallback();
    } catch (err) {
      logger.error({ err }, "Sync scheduler tick error");
    }
  }, TWO_HOURS_MS);

  logger.info("Sync scheduler started (2-hour tick)");
}

export function stopScheduler() {
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
}
