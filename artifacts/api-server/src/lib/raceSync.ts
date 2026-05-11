import { db, racesTable, horsesTable, syncStateTable, predictionsTable, raceResultsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  fetchProgramRaces,
  fetchProgramsByDate,
  formatRunnerForm,
  getOfficialPlacings,
  getProgramDateKey,
  getScratchedRunnerNumbers,
  hasOfficialResult,
  parseDecimalOdds,
  parseDistanceMeters,
  parseRaceNumber,
  parseRaceTime,
  parseSurface,
  toDisplayVenue,
  type ToteProgram,
  type ToteRace,
  type ToteRunner,
} from "./tote";
import { getNextUpdateTime } from "./scheduler";
import { recordRaceResult, runRaceForecast } from "./forecasting";
import { addDaysToDateKey, getTodayDateKey } from "./race-time";

function todayDateStr(): string {
  return getTodayDateKey();
}

function numberFrom(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function intFrom(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildTrainerJockeyRecord(runner: ToteRunner): string {
  const parts = [runner.JockeyStats?.trim(), runner.TrainerStats?.trim()].filter(Boolean);
  return parts.join(" | ");
}

function isRunnerScratched(runner: ToteRunner, scratchedNumbers: Set<number>): boolean {
  const runnerNumber = intFrom(runner.Saddle || runner.Runner);
  return runner.Scratched === "1" || (!!runnerNumber && scratchedNumbers.has(runnerNumber));
}

function getRunnerCurrentOdds(runner: ToteRunner): number {
  return parseDecimalOdds(runner.Tote_Odds) ?? parseDecimalOdds(runner.BettingForecast) ?? parseDecimalOdds(runner.Odds) ?? 0;
}

function getRunnerOpeningOdds(runner: ToteRunner): number | null {
  return parseDecimalOdds(runner.BettingForecast) ?? parseDecimalOdds(runner.Odds) ?? parseDecimalOdds(runner.Tote_Odds);
}

function mapRaceStatus(detail: ToteRace): string {
  const status = `${detail.RaceStatus || ""} ${detail.RaceStatusCode || ""}`.toUpperCase();
  if (status.includes("CANCEL") || status.includes("ABANDON")) return "cancelled";
  if (hasOfficialResult(detail)) return "completed";
  return "upcoming";
}

type OfficialResultSyncOutcome = "none" | "recorded" | "already-recorded" | "pending";

function getSyncedRaceStatus(
  race: typeof racesTable.$inferSelect,
  detail: ToteRace,
  resultOutcome: OfficialResultSyncOutcome,
): { status: string; nextUpdateAt: Date | null } {
  const feedStatus = mapRaceStatus(detail);
  if (feedStatus === "cancelled") {
    return {
      status: "cancelled",
      nextUpdateAt: null,
    };
  }

  if (resultOutcome === "recorded" || resultOutcome === "already-recorded") {
    return {
      status: "completed",
      nextUpdateAt: null,
    };
  }

  if (hasOfficialResult(detail)) {
    return {
      status: "analyzing",
      nextUpdateAt: getNextUpdateTime(race.raceTime, race.meetingDate),
    };
  }

  return {
    status: race.status === "completed" ? "analyzing" : feedStatus,
    nextUpdateAt: getNextUpdateTime(race.raceTime, race.meetingDate),
  };
}

async function findRace(program: ToteProgram, detail: ToteRace): Promise<typeof racesTable.$inferSelect | null> {
  const venue = toDisplayVenue(program, detail);
  const raceNumber = parseRaceNumber(detail);
  const meetingDate = getProgramDateKey(detail.ProgramDate || program.ProgramDate);
  const rows = await db
    .select()
    .from(racesTable)
    .where(
      and(
        eq(racesTable.venue, venue),
        eq(racesTable.raceNumber, raceNumber),
        eq(racesTable.meetingDate, meetingDate),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function upsertRace(program: ToteProgram, detail: ToteRace): Promise<{ race: typeof racesTable.$inferSelect; created: boolean }> {
  const existingRace = await findRace(program, detail);
  const venue = toDisplayVenue(program, detail);
  const raceNumber = parseRaceNumber(detail);
  const meetingDate = getProgramDateKey(detail.ProgramDate || program.ProgramDate);
  const raceTime = parseRaceTime(detail.AdvertisedStartTime || program.AdvertisedStartTime);
  const status = mapRaceStatus(detail);

  const values = {
    raceNumber,
    name: (detail.RaceTitle || `${venue} Race ${raceNumber}`).trim(),
    venue,
    distance: parseDistanceMeters(detail.Distance),
    raceTime,
    surface: parseSurface(detail.Surface),
    grade: detail.Description?.trim() || null,
    prize: detail.Stakegross?.trim() || null,
    meetingDate,
    status,
    syncedFrom: "tote",
    nextUpdateAt: status === "completed" || status === "cancelled" ? null : getNextUpdateTime(raceTime, meetingDate),
  };

  if (!existingRace) {
    const [race] = await db.insert(racesTable).values(values).returning();
    logger.info({ raceId: race.id, venue, raceNumber, meetingDate }, "Race created from Tote sync");
    return { race, created: true };
  }

  const [race] = await db
    .update(racesTable)
    .set(values)
    .where(eq(racesTable.id, existingRace.id))
    .returning();

  return { race, created: false };
}

async function syncRaceHorses(raceId: number, detail: ToteRace): Promise<void> {
  const existingHorses = await db.select().from(horsesTable).where(eq(horsesTable.raceId, raceId));
  const horseByNumber = new Map(existingHorses.map((horse) => [horse.number, horse]));
  const liveNumbers = new Set<number>();
  const scratchedNumbers = getScratchedRunnerNumbers(detail);

  for (const runner of detail.Runners ?? []) {
    const number = intFrom(runner.Saddle || runner.Runner);
    if (!number || !runner.Name?.trim()) continue;
    liveNumbers.add(number);

    const existing = horseByNumber.get(number);
    const currentOdds = getRunnerCurrentOdds(runner);
    const openingOdds = existing?.openingOdds ?? getRunnerOpeningOdds(runner);
    const previousOdds = existing?.currentOdds ?? openingOdds ?? currentOdds;
    const oddsMovement =
      currentOdds > 0 && previousOdds > 0
        ? currentOdds < previousOdds
          ? "shortening"
          : currentOdds > previousOdds
            ? "drifting"
            : "stable"
        : existing?.oddsMovement ?? "stable";

    const values = {
      raceId,
      name: runner.Name.trim(),
      number,
      jockey: (runner.Jockey || "Unknown jockey").trim(),
      trainer: (runner.TrainerCurrent || "Unknown trainer").trim(),
      form: formatRunnerForm(runner.L3),
      weight: numberFrom(runner.Weight),
      currentOdds: currentOdds > 0 ? currentOdds : existing?.currentOdds ?? 0,
      openingOdds,
      oddsMovement,
      scratched: isRunnerScratched(runner, scratchedNumbers),
      scratchReason: isRunnerScratched(runner, scratchedNumbers) ? "Marked scratched by Tote feed" : null,
      courseRecord: (intFrom(runner.Crse_Wins) ?? 0) > 0 || (intFrom(runner.Crse_Places) ?? 0) > 0,
      distanceRecord: (intFrom(runner.Dist_Wins) ?? 0) > 0 || (intFrom(runner.Dist_Places) ?? 0) > 0,
      trainerJockeyRecord: buildTrainerJockeyRecord(runner),
      notes: runner.RunnerComment?.trim() || null,
    };

    if (existing) {
      await db.update(horsesTable).set(values).where(eq(horsesTable.id, existing.id));
    } else {
      await db.insert(horsesTable).values(values);
    }
  }

  for (const horse of existingHorses) {
    if (liveNumbers.has(horse.number)) continue;
    await db
      .update(horsesTable)
      .set({
        scratched: true,
        scratchReason: "Missing from latest Tote card",
      })
      .where(eq(horsesTable.id, horse.id));
  }
}

async function syncOfficialResult(raceId: number, detail: ToteRace): Promise<OfficialResultSyncOutcome> {
  if (!hasOfficialResult(detail)) return "none";

  const existingResult = await db.select().from(raceResultsTable).where(eq(raceResultsTable.raceId, raceId)).limit(1);
  if (existingResult.length > 0) return "already-recorded";

  const resultRows = await db.select().from(horsesTable).where(eq(horsesTable.raceId, raceId));
  const horseByNumber = new Map(resultRows.map((horse) => [horse.number, horse]));
  const placings = getOfficialPlacings(detail);
  const winner = placings.winner ? horseByNumber.get(placings.winner) : null;
  if (!winner) {
    logger.warn(
      { raceId, placings, availableRunnerNumbers: [...horseByNumber.keys()] },
      "Official result detected but runner mapping is incomplete; keeping race retryable",
    );
    return "pending";
  }

  try {
    await recordRaceResult(raceId, {
      winnerHorseId: winner.id,
      runnerUpHorseId: placings.runnerUp ? horseByNumber.get(placings.runnerUp)?.id ?? null : null,
      thirdHorseId: placings.third ? horseByNumber.get(placings.third)?.id ?? null : null,
      notes: "Official Tote/4Racing result sync",
    });
    return "recorded";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Result already recorded") return "already-recorded";
    logger.warn({ err, raceId }, "Official result sync failed");
    return "pending";
  }
}

async function syncRace(program: ToteProgram, detail: ToteRace): Promise<{ created: boolean }> {
  const hasLiveCard = (detail.Runners ?? []).some((runner) => !!runner.Name?.trim()) || hasOfficialResult(detail);
  if (!hasLiveCard) {
    const existingRace = await findRace(program, detail);
    if (existingRace) {
      const existingHorses = await db.select({ id: horsesTable.id }).from(horsesTable).where(eq(horsesTable.raceId, existingRace.id)).limit(1);
      if (existingHorses.length === 0) {
        await db.delete(racesTable).where(eq(racesTable.id, existingRace.id));
        logger.info({ raceId: existingRace.id, venue: existingRace.venue, raceNumber: existingRace.raceNumber }, "Removed empty Tote shell race");
      }
    }
    return { created: false };
  }

  const { race, created } = await upsertRace(program, detail);
  await syncRaceHorses(race.id, detail);
  const resultOutcome = await syncOfficialResult(race.id, detail);
  const syncedState = getSyncedRaceStatus(race, detail, resultOutcome);
  await db
    .update(racesTable)
    .set({
      status: syncedState.status,
      nextUpdateAt: syncedState.nextUpdateAt,
    })
    .where(eq(racesTable.id, race.id));

  if (hasOfficialResult(detail) || syncedState.status === "cancelled") {
    return { created };
  }

  const predictions = await db.select({ id: predictionsTable.id }).from(predictionsTable).where(eq(predictionsTable.raceId, race.id)).limit(1);
  if (created || predictions.length === 0) {
    try {
      await runRaceForecast(race.id, "sync");
    } catch (err) {
      logger.warn({ err, raceId: race.id }, "Initial forecast generation failed after Tote sync");
    }
  }

  return { created };
}

export async function syncMeetingsForDate(dateKey: string): Promise<{ racesCreated: number; meetingsFound: number }> {
  const programs = await fetchProgramsByDate(dateKey);
  if (programs.length === 0) {
    logger.info({ date: dateKey }, "No Tote meetings found for date");
    return { racesCreated: 0, meetingsFound: 0 };
  }

  let racesCreated = 0;

  for (const program of programs) {
    const programDate = getProgramDateKey(program.ProgramDate);
    const races = await fetchProgramRaces(program.ProgramCode, programDate);

    for (const detail of races) {
      if (!Number.isFinite(parseRaceNumber(detail))) continue;
      const result = await syncRace(program, detail);
      if (result.created) racesCreated++;
    }
  }

  return { racesCreated, meetingsFound: programs.length };
}

export async function syncUpcomingMeetings(days: number = 7): Promise<{ racesCreated: number; meetingsFound: number }> {
  let racesCreated = 0;
  let meetingsFound = 0;
  const startDateKey = getTodayDateKey();

  for (let offset = 0; offset < days; offset++) {
    const dateKey = addDaysToDateKey(startDateKey, offset);
    const result = await syncMeetingsForDate(dateKey);
    racesCreated += result.racesCreated;
    meetingsFound += result.meetingsFound;
  }

  return { racesCreated, meetingsFound };
}

export async function syncTodaysMeetings(): Promise<void> {
  const dateStr = todayDateStr();

  logger.info({ date: dateStr }, "Starting weekly Tote race sync");

  try {
    const result = await syncUpcomingMeetings(7);

    await db.insert(syncStateTable).values({
      lastSyncDate: dateStr,
      meetingsFound: result.meetingsFound,
      racesCreated: result.racesCreated,
      status: "ok",
    });

    logger.info(result, "Weekly Tote race sync complete");
  } catch (err) {
    logger.error({ err }, "Weekly Tote race sync failed");
    await db.insert(syncStateTable).values({
      lastSyncDate: dateStr,
      meetingsFound: 0,
      racesCreated: 0,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function refreshRaceOdds(raceId: number): Promise<void> {
  const [race] = await db.select().from(racesTable).where(eq(racesTable.id, raceId)).limit(1);
  if (!race || !race.meetingDate) return;

  const programs = await fetchProgramsByDate(race.meetingDate);
  const normalizedRaceTime = race.raceTime;

  for (const program of programs) {
    const programDate = getProgramDateKey(program.ProgramDate);
    const races = await fetchProgramRaces(program.ProgramCode, programDate);
    const detail = races.find((candidate) => {
      const candidateRaceNumber = parseRaceNumber(candidate);
      const candidateVenue = toDisplayVenue(program, candidate);
      const candidateTime = parseRaceTime(candidate.AdvertisedStartTime || program.AdvertisedStartTime);
      return candidateRaceNumber === race.raceNumber && candidateVenue === race.venue && candidateTime === normalizedRaceTime;
    });

    if (!detail) continue;

    await syncRaceHorses(raceId, detail);
    const resultOutcome = await syncOfficialResult(raceId, detail);
    const syncedState = getSyncedRaceStatus(race, detail, resultOutcome);
    await db
      .update(racesTable)
      .set({
        status: syncedState.status,
        nextUpdateAt: syncedState.nextUpdateAt,
      })
      .where(eq(racesTable.id, raceId));

    logger.info({ raceId, venue: race.venue, raceNumber: race.raceNumber }, "Race data refreshed from Tote");
    return;
  }

  logger.warn({ raceId, venue: race.venue, raceNumber: race.raceNumber }, "No Tote race data matched during refresh");
}

export async function getLastSyncStatus(): Promise<{
  lastSyncAt: Date | null;
  lastSyncDate: string | null;
  meetingsFound: number;
  racesCreated: number;
  status: string;
} | null> {
  const rows = await db
    .select()
    .from(syncStateTable)
    .orderBy(desc(syncStateTable.lastSyncAt))
    .limit(1);

  if (rows.length === 0) return null;
  const latest = rows[0];
  return {
    lastSyncAt: latest.lastSyncAt,
    lastSyncDate: latest.lastSyncDate,
    meetingsFound: latest.meetingsFound,
    racesCreated: latest.racesCreated,
    status: latest.status,
  };
}
