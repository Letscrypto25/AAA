import { db, racesTable, horsesTable, syncStateTable, predictionsTable, raceResultsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  fetchGallopRacecardsByDate,
  resolveGallopTodayDateKey,
} from "./gallop-form";
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
import {
  fetchTheRacingApiRacecardsByDate,
  fetchTheRacingApiRaceDetail,
  fetchTheRacingApiResultDetail,
  fetchTheRacingApiResultsByDate,
  getTheRacingApiErrorStatus,
  isTheRacingApiConfigured,
  type NormalizedRaceCard,
  type NormalizedRaceResult,
  type NormalizedRunner,
  type RaceSyncSource,
} from "./theracingapi";
import { getNextUpdateTime } from "./scheduler";
import { rebuildLearningFeedbackFromHistory, recordRaceResult, runRaceForecast } from "./forecasting";
import { addDaysToDateKey } from "./race-time";

const MAX_SYNC_ERROR_LENGTH = 4000;

function stripPostgresNullBytes(value: string): string {
  return value.replace(/\u0000/g, "");
}

function dbText(value: string): string;
function dbText(value: string | null | undefined): string | null;
function dbText(value: string | null | undefined): string | null {
  return value == null ? null : stripPostgresNullBytes(value);
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

function normalizeVenueKey(value: string): string {
  return value
    .replace(/hollywoodbets\s+/gi, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isSyntheticToteVenue(venue: string): boolean {
  const normalized = normalizeVenueKey(venue);
  return normalized.includes("quickmix")
    || normalized.includes("mixed bi express")
    || normalized.includes("mixed pa p6 blitz");
}

function shouldIgnoreToteCard(card: NormalizedRaceCard): boolean {
  return card.source === "tote" && isSyntheticToteVenue(card.venue);
}

function mergeTextParts(...values: Array<string | null | undefined>): string | null {
  const items = values
    .flatMap((value) => (value || "").split("|").map((part) => part.trim()))
    .filter(Boolean);

  return items.length > 0 ? [...new Set(items)].join(" | ") : null;
}

function normalizeRunnerName(value: string): string {
  return normalizeVenueKey(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function findMatchingRunner(card: NormalizedRaceCard, runner: NormalizedRunner): NormalizedRunner | null {
  const byNumber = card.runners.find((candidate) => candidate.number === runner.number);
  if (byNumber) return byNumber;

  const runnerName = normalizeRunnerName(runner.name);
  if (!runnerName) return null;
  return card.runners.find((candidate) => normalizeRunnerName(candidate.name) === runnerName) ?? null;
}

function mergeRunnerDetail(primary: NormalizedRunner, detail: NormalizedRunner): NormalizedRunner {
  return {
    number: primary.number,
    name: detail.name || primary.name,
    jockey: detail.jockey || primary.jockey,
    trainer: detail.trainer || primary.trainer,
    form: detail.form || primary.form,
    weight: detail.weight ?? primary.weight,
    currentOdds: detail.currentOdds ?? primary.currentOdds,
    openingOdds: detail.openingOdds ?? primary.openingOdds,
    scratched: detail.scratched || primary.scratched,
    scratchReason: detail.scratchReason ?? primary.scratchReason,
    courseRecord: detail.courseRecord || primary.courseRecord,
    distanceRecord: detail.distanceRecord || primary.distanceRecord,
    trainerJockeyRecord: mergeTextParts(primary.trainerJockeyRecord, detail.trainerJockeyRecord) ?? "",
    notes: mergeTextParts(primary.notes, detail.notes),
  };
}

function mergeRaceCardDetail(primary: NormalizedRaceCard, detail: NormalizedRaceCard): NormalizedRaceCard {
  const mergedRunners: NormalizedRunner[] = [];
  const matchedNumbers = new Set<number>();

  for (const runner of primary.runners) {
    const match = findMatchingRunner(detail, runner);
    if (!match) {
      mergedRunners.push(runner);
      continue;
    }

    matchedNumbers.add(match.number);
    mergedRunners.push(mergeRunnerDetail(runner, match));
  }

  for (const runner of detail.runners) {
    if (matchedNumbers.has(runner.number)) continue;
    mergedRunners.push(runner);
  }

  return {
    source: primary.source,
    sourceRaceId: detail.sourceRaceId ?? primary.sourceRaceId,
    meetingDate: primary.meetingDate,
    venue: primary.venue,
    raceNumber: primary.raceNumber,
    name: primary.name || detail.name,
    distance: primary.distance > 0 ? primary.distance : detail.distance,
    raceTime: primary.raceTime !== "00:00" ? primary.raceTime : detail.raceTime,
    surface: primary.surface || detail.surface,
    grade: primary.grade ?? detail.grade,
    prize: primary.prize ?? detail.prize,
    status: primary.status === "cancelled" ? "cancelled" : detail.status === "completed" ? "completed" : primary.status,
    runners: mergedRunners.sort((left, right) => left.number - right.number),
    result: detail.result ?? primary.result,
  };
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

function mapToteRaceStatus(detail: ToteRace): "upcoming" | "completed" | "cancelled" {
  const status = `${detail.RaceStatus || ""} ${detail.RaceStatusCode || ""}`.toUpperCase();
  if (status.includes("CANCEL") || status.includes("ABANDON")) return "cancelled";
  if (hasOfficialResult(detail)) return "completed";
  return "upcoming";
}

function buildToteResult(detail: ToteRace): NormalizedRaceResult | null {
  if (!hasOfficialResult(detail)) return null;
  const placings = getOfficialPlacings(detail);
  return {
    winner: placings.winner,
    runnerUp: placings.runnerUp,
    third: placings.third,
    official: true,
    notes: "Official Tote/4Racing result sync",
  };
}

function normalizeToteRunner(runner: ToteRunner, scratchedNumbers: Set<number>): NormalizedRunner | null {
  const number = intFrom(runner.Saddle || runner.Runner);
  if (!number || !runner.Name?.trim()) return null;

  const scratched = isRunnerScratched(runner, scratchedNumbers);
  return {
    number,
    name: runner.Name.trim(),
    jockey: (runner.Jockey || "Unknown jockey").trim(),
    trainer: (runner.TrainerCurrent || "Unknown trainer").trim(),
    form: formatRunnerForm(runner.L3),
    weight: numberFrom(runner.Weight),
    currentOdds: getRunnerCurrentOdds(runner),
    openingOdds: getRunnerOpeningOdds(runner),
    scratched,
    scratchReason: scratched ? "Marked scratched by Tote feed" : null,
    courseRecord: (intFrom(runner.Crse_Wins) ?? 0) > 0 || (intFrom(runner.Crse_Places) ?? 0) > 0,
    distanceRecord: (intFrom(runner.Dist_Wins) ?? 0) > 0 || (intFrom(runner.Dist_Places) ?? 0) > 0,
    trainerJockeyRecord: buildTrainerJockeyRecord(runner),
    notes: runner.RunnerComment?.trim() || null,
  };
}

function normalizeToteRace(program: ToteProgram, detail: ToteRace): NormalizedRaceCard {
  const scratchedNumbers = getScratchedRunnerNumbers(detail);
  const venue = toDisplayVenue(program, detail);
  const meetingDate = getProgramDateKey(detail.ProgramDate || program.ProgramDate);
  const raceNumber = parseRaceNumber(detail);
  return {
    source: "tote",
    sourceRaceId: null,
    meetingDate,
    venue,
    raceNumber,
    name: (detail.RaceTitle || `${venue} Race ${raceNumber}`).trim(),
    distance: parseDistanceMeters(detail.Distance),
    raceTime: parseRaceTime(detail.AdvertisedStartTime || program.AdvertisedStartTime),
    surface: parseSurface(detail.Surface),
    grade: detail.Description?.trim() || null,
    prize: detail.Stakegross?.trim() || null,
    status: mapToteRaceStatus(detail),
    runners: (detail.Runners ?? [])
      .map((runner) => normalizeToteRunner(runner, scratchedNumbers))
      .filter((runner): runner is NormalizedRunner => runner !== null),
    result: buildToteResult(detail),
  };
}

function mergeResultIntoRacecard(card: NormalizedRaceCard, result: NormalizedRaceResult | null | undefined): NormalizedRaceCard {
  if (!result?.official) return card;
  return {
    ...card,
    status: card.status === "cancelled" ? "cancelled" : "completed",
    result,
  };
}

function hasNormalizedOfficialResult(card: NormalizedRaceCard): boolean {
  return !!card.result?.official && card.result.winner !== null;
}

function hasLiveCard(card: NormalizedRaceCard): boolean {
  return card.runners.some((runner) => !!runner.name.trim()) || hasNormalizedOfficialResult(card);
}

type OfficialResultSyncOutcome = "none" | "recorded" | "already-recorded" | "pending";

function getSyncedRaceStatus(
  race: typeof racesTable.$inferSelect,
  card: NormalizedRaceCard,
  resultOutcome: OfficialResultSyncOutcome,
): { status: string; nextUpdateAt: Date | null } {
  if (card.status === "cancelled") {
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

  if (hasNormalizedOfficialResult(card)) {
    return {
      status: "analyzing",
      nextUpdateAt: getNextUpdateTime(race.raceTime, race.meetingDate),
    };
  }

  return {
    status: race.status === "completed" ? "analyzing" : card.status,
    nextUpdateAt: getNextUpdateTime(race.raceTime, race.meetingDate),
  };
}

async function findRace(card: NormalizedRaceCard): Promise<typeof racesTable.$inferSelect | null> {
  const rows = await db
    .select()
    .from(racesTable)
    .where(
      and(
        eq(racesTable.venue, card.venue),
        eq(racesTable.raceNumber, card.raceNumber),
        eq(racesTable.meetingDate, card.meetingDate),
      ),
    )
    .limit(1);

  if (rows[0]) return rows[0];

  const fallbackRows = await db
    .select()
    .from(racesTable)
    .where(
      and(
        eq(racesTable.raceNumber, card.raceNumber),
        eq(racesTable.meetingDate, card.meetingDate),
      ),
    );

  if (fallbackRows.length === 1) return fallbackRows[0] ?? null;
  if (card.raceTime && card.raceTime !== "00:00") {
    const timeMatched = fallbackRows.filter((race) => race.raceTime === card.raceTime);
    if (timeMatched.length === 1) return timeMatched[0] ?? null;
  }

  return null;
}

async function loadRaceById(raceId: number): Promise<typeof racesTable.$inferSelect | null> {
  const rows = await db.select().from(racesTable).where(eq(racesTable.id, raceId)).limit(1);
  return rows[0] ?? null;
}

async function upsertRace(
  card: NormalizedRaceCard,
  existingRaceId?: number,
): Promise<{ race: typeof racesTable.$inferSelect; created: boolean }> {
  const existingRace = existingRaceId ? await loadRaceById(existingRaceId) : await findRace(card);
  const raceTime = card.raceTime !== "00:00" ? card.raceTime : existingRace?.raceTime ?? "00:00";
  const status = hasNormalizedOfficialResult(card) ? "completed" : card.status;

  const values = {
    raceNumber: card.raceNumber,
    name: dbText(card.name || `${card.venue} Race ${card.raceNumber}`).trim(),
    venue: dbText(card.venue),
    distance: card.distance > 0 ? card.distance : existingRace?.distance ?? 0,
    raceTime: dbText(raceTime),
    surface: dbText(card.surface || existingRace?.surface || "turf"),
    grade: dbText(card.grade ?? existingRace?.grade ?? null),
    prize: dbText(card.prize ?? existingRace?.prize ?? null),
    meetingDate: dbText(card.meetingDate),
    status,
    syncedFrom: dbText(card.source),
    nextUpdateAt: status === "completed" || status === "cancelled" ? null : getNextUpdateTime(raceTime, card.meetingDate),
  };

  if (!existingRace) {
    const [race] = await db.insert(racesTable).values(values).returning();
    logger.info(
      { raceId: race.id, venue: card.venue, raceNumber: card.raceNumber, meetingDate: card.meetingDate, source: card.source },
      "Race created from sync",
    );
    return { race, created: true };
  }

  const [race] = await db
    .update(racesTable)
    .set(values)
    .where(eq(racesTable.id, existingRace.id))
    .returning();

  return { race, created: false };
}

async function syncRaceHorses(raceId: number, card: NormalizedRaceCard): Promise<void> {
  const existingHorses = await db.select().from(horsesTable).where(eq(horsesTable.raceId, raceId));
  const horseByNumber = new Map(existingHorses.map((horse) => [horse.number, horse]));
  const liveNumbers = new Set<number>();

  for (const runner of card.runners) {
    if (!runner.number || !runner.name.trim()) continue;
    liveNumbers.add(runner.number);

    const existing = horseByNumber.get(runner.number);
    const currentOdds = runner.currentOdds ?? existing?.currentOdds ?? runner.openingOdds ?? 0;
    const openingOdds = existing?.openingOdds ?? runner.openingOdds ?? null;
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
      name: dbText(runner.name),
      number: runner.number,
      jockey: dbText(runner.jockey || existing?.jockey || "Unknown jockey"),
      trainer: dbText(runner.trainer || existing?.trainer || "Unknown trainer"),
      form: dbText(runner.form || existing?.form || ""),
      weight: runner.weight ?? existing?.weight ?? null,
      currentOdds,
      openingOdds,
      oddsMovement,
      scratched: runner.scratched,
      scratchReason: runner.scratched ? dbText(runner.scratchReason ?? existing?.scratchReason ?? null) : null,
      courseRecord: runner.courseRecord || existing?.courseRecord || false,
      distanceRecord: runner.distanceRecord || existing?.distanceRecord || false,
      trainerJockeyRecord: dbText(runner.trainerJockeyRecord || existing?.trainerJockeyRecord || ""),
      notes: dbText(runner.notes ?? existing?.notes ?? null),
    };

    if (existing) {
      const { raceId: _raceId, ...updateValues } = values;
      await db.update(horsesTable).set(updateValues).where(eq(horsesTable.id, existing.id));
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
        scratchReason: `Missing from latest ${card.source === "theracingapi" ? "The Racing API" : card.source === "gallop" ? "Gallop" : "Tote"} card`,
      })
      .where(eq(horsesTable.id, horse.id));
  }
}

async function syncOfficialResult(raceId: number, card: NormalizedRaceCard): Promise<OfficialResultSyncOutcome> {
  if (!hasNormalizedOfficialResult(card) || !card.result) return "none";

  const existingResult = await db.select().from(raceResultsTable).where(eq(raceResultsTable.raceId, raceId)).limit(1);
  if (existingResult.length > 0) return "already-recorded";

  const resultRows = await db.select().from(horsesTable).where(eq(horsesTable.raceId, raceId));
  const horseByNumber = new Map(resultRows.map((horse) => [horse.number, horse]));
  const winner = card.result.winner ? horseByNumber.get(card.result.winner) : null;
  if (!winner) {
    logger.warn(
      { raceId, result: card.result, availableRunnerNumbers: [...horseByNumber.keys()], source: card.source },
      "Official result detected but runner mapping is incomplete; keeping race retryable",
    );
    return "pending";
  }

  try {
    await recordRaceResult(raceId, {
      winnerHorseId: winner.id,
      runnerUpHorseId: card.result.runnerUp ? horseByNumber.get(card.result.runnerUp)?.id ?? null : null,
      thirdHorseId: card.result.third ? horseByNumber.get(card.result.third)?.id ?? null : null,
      notes: dbText(card.result.notes ?? `Official ${card.source} result sync`),
    });
    return "recorded";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Result already recorded") return "already-recorded";
    logger.warn({ err, raceId, source: card.source }, "Official result sync failed");
    return "pending";
  }
}

async function syncRaceCard(card: NormalizedRaceCard, existingRaceId?: number): Promise<{ created: boolean }> {
  const { race, created } = await upsertRace(card, existingRaceId);

  if (!hasLiveCard(card)) {
    await db
      .update(racesTable)
      .set({
        status: card.status === "cancelled" ? "cancelled" : race.status,
        nextUpdateAt: card.status === "cancelled" ? null : getNextUpdateTime(race.raceTime, race.meetingDate),
        syncedFrom: card.source,
      })
      .where(eq(racesTable.id, race.id));

    logger.info(
      { raceId: race.id, venue: race.venue, raceNumber: race.raceNumber, source: card.source },
      "Stored shell racecard schedule while waiting for detailed runner data",
    );
    return { created };
  }

  await syncRaceHorses(race.id, card);
  const resultOutcome = await syncOfficialResult(race.id, card);
  const syncedState = getSyncedRaceStatus(race, card, resultOutcome);
  await db
    .update(racesTable)
    .set({
      status: syncedState.status,
      nextUpdateAt: syncedState.nextUpdateAt,
      syncedFrom: card.source,
    })
    .where(eq(racesTable.id, race.id));

  if (hasNormalizedOfficialResult(card) || syncedState.status === "cancelled") {
    return { created };
  }

  const predictions = await db.select({ id: predictionsTable.id }).from(predictionsTable).where(eq(predictionsTable.raceId, race.id)).limit(1);
  if (created || predictions.length === 0) {
    try {
      await runRaceForecast(race.id, "sync");
    } catch (err) {
      logger.warn({ err, raceId: race.id, source: card.source }, "Initial forecast generation failed after sync");
    }
  }

  return { created };
}

function countMeetings(cards: NormalizedRaceCard[]): number {
  return new Set(cards.map((card) => `${card.meetingDate}|${normalizeVenueKey(card.venue)}`)).size;
}

type RaceCardSourceResult = {
  source: RaceSyncSource;
  cards: NormalizedRaceCard[];
  meetingsFound: number;
};

function useGallopTvFallback(dateKey: string, reason: string): RaceCardSourceResult {
  logger.warn({ dateKey, reason }, "Using Gallop TV fallback after structured racecard fallback failed");
  return { source: "gallop", cards: [], meetingsFound: 0 };
}

async function fetchTheRacingApiSourceCards(dateKey: string): Promise<RaceCardSourceResult> {
  const cards = await fetchTheRacingApiRacecardsByDate(dateKey);
  let resultMap = new Map<string, NormalizedRaceResult>();
  try {
    resultMap = await fetchTheRacingApiResultsByDate(dateKey);
  } catch (err) {
    logger.warn({ err, dateKey }, "The Racing API results fetch failed; keeping racecards without result overlay");
  }

  const mergedCards = cards.map((card) => {
    if (!card.sourceRaceId) return card;
    return mergeResultIntoRacecard(card, resultMap.get(card.sourceRaceId));
  });

  return {
    source: "theracingapi",
    cards: mergedCards,
    meetingsFound: countMeetings(mergedCards),
  };
}

async function fetchStructuredDataFallback(dateKey: string, reason: string): Promise<RaceCardSourceResult | null> {
  if (isTheRacingApiConfigured()) {
    try {
      const apiResult = await fetchTheRacingApiSourceCards(dateKey);
      if (apiResult.cards.some((card) => hasLiveCard(card))) {
        logger.info({ dateKey, reason, source: apiResult.source }, "Using structured racecard fallback before Gallop TV fallback");
        return apiResult;
      }
      logger.warn({ dateKey, reason, source: apiResult.source, cardCount: apiResult.cards.length }, "Structured racecard fallback had no runner detail");
    } catch (err) {
      logger.warn({ err, dateKey, reason, source: "theracingapi" }, "Structured racecard fallback failed");
    }
  }

  try {
    const toteResult = await fetchToteRaceCardsForDate(dateKey);
    if (toteResult.cards.some((card) => hasLiveCard(card))) {
      logger.info({ dateKey, reason, source: toteResult.source }, "Using structured racecard fallback before Gallop TV fallback");
      return toteResult;
    }
    logger.warn({ dateKey, reason, source: toteResult.source, cardCount: toteResult.cards.length }, "Structured racecard fallback had no runner detail");
  } catch (err) {
    logger.warn({ err, dateKey, reason, source: "tote" }, "Structured racecard fallback failed");
  }

  return null;
}

async function fetchToteRaceCardsForDate(dateKey: string): Promise<RaceCardSourceResult> {
  const programs = await fetchProgramsByDate(dateKey);
  if (programs.length === 0) {
    return { source: "tote", cards: [], meetingsFound: 0 };
  }

  const cards: NormalizedRaceCard[] = [];
  for (const program of programs) {
    const programDate = getProgramDateKey(program.ProgramDate);
    const races = await fetchProgramRaces(program.ProgramCode, programDate);
    for (const detail of races) {
      if (!Number.isFinite(parseRaceNumber(detail))) continue;
      cards.push(normalizeToteRace(program, detail));
    }
  }

  const filteredCards = cards.filter((card) => !shouldIgnoreToteCard(card));
  if (filteredCards.length !== cards.length) {
    logger.warn(
      { dateKey, ignoredSyntheticCardCount: cards.length - filteredCards.length },
      "Ignoring synthetic Tote pool cards during race sync",
    );
  }

  return { source: "tote", cards: filteredCards, meetingsFound: countMeetings(filteredCards) };
}

async function fetchPreferredRaceCardsForDate(dateKey: string): Promise<RaceCardSourceResult> {
  try {
    const gallopResult = await fetchGallopRacecardsByDate(dateKey);
    const gallopCards = gallopResult.cards;
    if (gallopCards.length > 0) {
      let mergedCards = gallopCards;

      if (isTheRacingApiConfigured()) {
        try {
          const cards = await fetchTheRacingApiRacecardsByDate(dateKey);
          let resultMap = new Map<string, NormalizedRaceResult>();
          try {
            resultMap = await fetchTheRacingApiResultsByDate(dateKey);
          } catch (err) {
            logger.warn({ err, dateKey }, "The Racing API results fetch failed during Gallop merge");
          }

          const detailedCards = cards.map((card) => {
            if (!card.sourceRaceId) return card;
            return mergeResultIntoRacecard(card, resultMap.get(card.sourceRaceId));
          });

          mergedCards = gallopCards.map((card) => {
            const detailMatch = findMatchingRaceCard(detailedCards, card);
            return detailMatch ? mergeRaceCardDetail(card, detailMatch) : card;
          });
        } catch (err) {
          const status = getTheRacingApiErrorStatus(err);
          if (status === 401 || status === 403) {
            logger.warn({ dateKey, status }, "The Racing API merge skipped due to credential or plan access; keeping Gallop racecards");
          } else if (status === 404) {
            logger.info({ dateKey, status }, "The Racing API merge skipped because no matching racecards were available; keeping Gallop racecards");
          } else {
            logger.warn({ err, dateKey, status }, "The Racing API merge failed; keeping Gallop racecards");
          }
        }
      }

      if (mergedCards.some((card) => hasLiveCard(card))) {
        return {
          source: "gallop",
          cards: mergedCards,
          meetingsFound: countMeetings(mergedCards),
        };
      }

      logger.warn({ dateKey, gallopCardCount: mergedCards.length }, "Gallop returned shell racecards only; trying structured data fallback before Gallop TV fallback");
      const structuredFallback = await fetchStructuredDataFallback(dateKey, "gallop_shell_cards");
      if (structuredFallback) return structuredFallback;

      return {
        source: "gallop",
        cards: mergedCards,
        meetingsFound: countMeetings(mergedCards),
      };
    } else if (gallopResult.listedMeetings === 0) {
      return { source: "gallop", cards: [], meetingsFound: 0 };
    }
  } catch (err) {
    logger.warn({ err, dateKey }, "Gallop racecard sync failed; trying The Racing API before Gallop TV fallback");
  }

  const structuredFallback = await fetchStructuredDataFallback(dateKey, "gallop_failed");
  return structuredFallback ?? useGallopTvFallback(dateKey, "structured_data_failed");
}

function cardMatchesRace(card: NormalizedRaceCard, race: typeof racesTable.$inferSelect): boolean {
  if (card.meetingDate !== race.meetingDate) return false;
  if (card.raceNumber !== race.raceNumber) return false;

  const venueMatches = normalizeVenueKey(card.venue) === normalizeVenueKey(race.venue);
  if (venueMatches) return true;

  const raceHasTime = !!race.raceTime && race.raceTime !== "00:00";
  const cardHasTime = !!card.raceTime && card.raceTime !== "00:00";
  return raceHasTime && cardHasTime && card.raceTime === race.raceTime;
}

function findMatchingCard(cards: NormalizedRaceCard[], race: typeof racesTable.$inferSelect): NormalizedRaceCard | null {
  const exactVenueMatch = cards.find((card) => (
    card.meetingDate === race.meetingDate
    && card.raceNumber === race.raceNumber
    && normalizeVenueKey(card.venue) === normalizeVenueKey(race.venue)
  ));
  if (exactVenueMatch) return exactVenueMatch;

  return cards.find((card) => cardMatchesRace(card, race)) ?? null;
}

function findMatchingRaceCard(cards: NormalizedRaceCard[], race: Pick<NormalizedRaceCard, "meetingDate" | "raceNumber" | "venue" | "raceTime">): NormalizedRaceCard | null {
  const exactVenueMatch = cards.find((card) => (
    card.meetingDate === race.meetingDate
    && card.raceNumber === race.raceNumber
    && normalizeVenueKey(card.venue) === normalizeVenueKey(race.venue)
  ));
  if (exactVenueMatch) return exactVenueMatch;

  return cards.find((card) => (
    card.meetingDate === race.meetingDate
    && card.raceNumber === race.raceNumber
    && card.raceTime === race.raceTime
  )) ?? null;
}

async function enrichTheracingRacecard(card: NormalizedRaceCard): Promise<NormalizedRaceCard> {
  if (card.source !== "theracingapi" || !card.sourceRaceId) return card;

  let enrichedCard = card;
  try {
    const detail = await fetchTheRacingApiRaceDetail(card.sourceRaceId);
    if (detail) {
      enrichedCard = mergeResultIntoRacecard(detail, detail.result);
    }
  } catch (err) {
    logger.warn({ err, raceId: card.sourceRaceId }, "The Racing API race detail refresh failed; using date card payload");
  }

  if (!hasNormalizedOfficialResult(enrichedCard)) {
    try {
      const result = await fetchTheRacingApiResultDetail(card.sourceRaceId);
      enrichedCard = mergeResultIntoRacecard(enrichedCard, result);
    } catch (err) {
      logger.warn({ err, raceId: card.sourceRaceId }, "The Racing API result detail refresh failed");
    }
  }

  return enrichedCard;
}

export async function syncMeetingsForDate(dateKey: string): Promise<{ racesCreated: number; meetingsFound: number }> {
  const sourceResult = await fetchPreferredRaceCardsForDate(dateKey);
  if (sourceResult.cards.length === 0) {
    logger.info({ date: dateKey, source: sourceResult.source }, "No meetings found for date");
    return { racesCreated: 0, meetingsFound: sourceResult.meetingsFound };
  }

  let racesCreated = 0;

  for (const card of sourceResult.cards) {
    const result = await syncRaceCard(card);
    if (result.created) racesCreated++;
  }

  return { racesCreated, meetingsFound: sourceResult.meetingsFound };
}

export async function syncUpcomingMeetings(days: number = 7): Promise<{ racesCreated: number; meetingsFound: number }> {
  let racesCreated = 0;
  let meetingsFound = 0;
  const startDateKey = await resolveGallopTodayDateKey();

  for (let offset = 0; offset < days; offset++) {
    const dateKey = addDaysToDateKey(startDateKey, offset);
    const result = await syncMeetingsForDate(dateKey);
    racesCreated += result.racesCreated;
    meetingsFound += result.meetingsFound;
  }

  return { racesCreated, meetingsFound };
}

async function purgeSyntheticToteRaces(): Promise<number> {
  const toteRaces = await db
    .select({ id: racesTable.id, venue: racesTable.venue })
    .from(racesTable)
    .where(eq(racesTable.syncedFrom, "tote"));

  const syntheticRaceIds = toteRaces.filter((race) => isSyntheticToteVenue(race.venue)).map((race) => race.id);
  for (const raceId of syntheticRaceIds) {
    await db.delete(racesTable).where(eq(racesTable.id, raceId));
  }

  if (syntheticRaceIds.length > 0) {
    logger.warn({ purgedSyntheticRaceCount: syntheticRaceIds.length }, "Purged synthetic Tote pool races from stored schedule");
  }

  return syntheticRaceIds.length;
}

async function purgeStalePendingRaces(cutoffDateKey: string): Promise<number> {
  const races = await db
    .select({ id: racesTable.id, meetingDate: racesTable.meetingDate, status: racesTable.status, venue: racesTable.venue, raceNumber: racesTable.raceNumber })
    .from(racesTable);

  let purged = 0;
  let restoredCompleted = 0;
  for (const race of races) {
    if (!race.meetingDate || race.meetingDate >= cutoffDateKey) continue;
    if (race.status !== "upcoming" && race.status !== "analyzing") continue;

    const [result] = await db.select({ id: raceResultsTable.id }).from(raceResultsTable).where(eq(raceResultsTable.raceId, race.id)).limit(1);
    if (result) {
      await db.update(racesTable).set({ status: "completed", nextUpdateAt: null }).where(eq(racesTable.id, race.id));
      restoredCompleted++;
      continue;
    }

    await db.delete(racesTable).where(eq(racesTable.id, race.id));
    purged++;
  }

  if (purged > 0 || restoredCompleted > 0) {
    logger.warn(
      { purgedStalePendingRaceCount: purged, restoredCompletedRaceCount: restoredCompleted, cutoffDateKey },
      "Purged stale past-dated races that were still marked upcoming/analyzing",
    );
  }

  return purged + restoredCompleted;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getErrorCause(error: unknown): unknown {
  return typeof error === "object" && error !== null && "cause" in error
    ? (error as { cause?: unknown }).cause
    : undefined;
}

function formatSyncError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current; depth++) {
    const message = getErrorMessage(current).trim();
    if (message && !parts.includes(message)) parts.push(message);
    current = getErrorCause(current);
  }

  const text = parts.join(" | caused by: ") || "Unknown sync error";
  const sanitizedText = stripPostgresNullBytes(text);
  return sanitizedText.length > MAX_SYNC_ERROR_LENGTH ? `${sanitizedText.slice(0, MAX_SYNC_ERROR_LENGTH - 3)}...` : sanitizedText;
}

async function recordSyncState(values: typeof syncStateTable.$inferInsert): Promise<void> {
  try {
    await db.insert(syncStateTable).values(values);
  } catch (err) {
    logger.error({ err, syncStatus: values.status }, "Failed to record race sync status");
  }
}

let syncTodaysMeetingsPromise: Promise<void> | null = null;

async function runTodaysMeetingsSync(): Promise<void> {
  const dateStr = await resolveGallopTodayDateKey();

  logger.info(
    { date: dateStr, primarySource: isTheRacingApiConfigured() ? "gallop+theracingapi+galloptv" : "gallop+galloptv" },
    "Starting weekly race sync",
  );

  try {
    const purgedSyntheticRaceCount = await purgeSyntheticToteRaces();
    const purgedStalePendingRaceCount = await purgeStalePendingRaces(dateStr);
    if (purgedSyntheticRaceCount > 0) {
      await rebuildLearningFeedbackFromHistory();
    }

    const result = await syncUpcomingMeetings(7);

    await recordSyncState({
      lastSyncDate: dateStr,
      meetingsFound: result.meetingsFound,
      racesCreated: result.racesCreated,
      status: "ok",
    });

    logger.info({ ...result, purgedSyntheticRaceCount, purgedStalePendingRaceCount }, "Weekly race sync complete");
  } catch (err) {
    logger.error({ err }, "Weekly race sync failed");
    await recordSyncState({
      lastSyncDate: dateStr,
      meetingsFound: 0,
      racesCreated: 0,
      status: "error",
      error: formatSyncError(err),
    });
  }
}

export async function syncTodaysMeetings(): Promise<void> {
  if (syncTodaysMeetingsPromise) {
    logger.info("Race sync already running; waiting for active sync");
    return syncTodaysMeetingsPromise;
  }

  syncTodaysMeetingsPromise = runTodaysMeetingsSync().finally(() => {
    syncTodaysMeetingsPromise = null;
  });

  return syncTodaysMeetingsPromise;
}

export async function refreshRaceOdds(raceId: number): Promise<void> {
  const [race] = await db.select().from(racesTable).where(eq(racesTable.id, raceId)).limit(1);
  if (!race || !race.meetingDate) return;

  let sourceResult = await fetchPreferredRaceCardsForDate(race.meetingDate);
  let matchedCard = findMatchingCard(sourceResult.cards, race);

  if (!matchedCard && sourceResult.source === "theracingapi") {
    try {
      const gallopFallback = await fetchGallopRacecardsByDate(race.meetingDate);
      const gallopSource: RaceCardSourceResult = {
        source: "gallop",
        cards: gallopFallback.cards,
        meetingsFound: countMeetings(gallopFallback.cards),
      };
      matchedCard = findMatchingCard(gallopSource.cards, race);
      if (matchedCard) sourceResult = gallopSource;
    } catch (err) {
      logger.warn({ err, raceId, venue: race.venue, raceNumber: race.raceNumber }, "Gallop refresh fallback failed; Gallop TV remains the fallback surface");
    }
  }

  if (!matchedCard) {
    const gallopToday = await resolveGallopTodayDateKey();
    const isPastRaceDay = !!race.meetingDate && race.meetingDate < gallopToday;
    const nextRetryAt = isPastRaceDay ? null : getNextUpdateTime(race.raceTime, race.meetingDate);

    await db
      .update(racesTable)
      .set({ nextUpdateAt: nextRetryAt })
      .where(eq(racesTable.id, raceId));

    logger.warn(
      { raceId, venue: race.venue, raceNumber: race.raceNumber, meetingDate: race.meetingDate, isPastRaceDay, nextRetryAt },
      "No synced race data matched during refresh",
    );
    return;
  }

  let cardToSync = matchedCard.source === "theracingapi" ? await enrichTheracingRacecard(matchedCard) : matchedCard;

  if (matchedCard.source === "gallop" && isTheRacingApiConfigured()) {
    try {
      const detailCards = await fetchTheRacingApiRacecardsByDate(race.meetingDate);
      const detailMatch = findMatchingCard(detailCards, race);
      if (detailMatch) {
        const enriched = await enrichTheracingRacecard(detailMatch);
        cardToSync = mergeRaceCardDetail(matchedCard, enriched);
      }
    } catch (err) {
      logger.warn({ err, raceId, venue: race.venue, raceNumber: race.raceNumber }, "The Racing API refresh merge failed for Gallop card");
    }
  }

  await syncRaceCard(cardToSync, raceId);
  logger.info(
    { raceId, venue: race.venue, raceNumber: race.raceNumber, source: cardToSync.source },
    "Race data refreshed",
  );
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
