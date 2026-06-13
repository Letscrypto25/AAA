import https from "node:https";
import { logger } from "./logger";
import { getTodayDateKey } from "./race-time";
import { formatRunnerForm, parseDecimalOdds } from "./tote";
import type { NormalizedRaceCard, NormalizedRaceResult, NormalizedRunner, RaceSyncSource } from "./theracingapi";

const GALLOP_BASE_URL = "https://www.sahorseform.co.za";
const REQUEST_TIMEOUT_MS = 15000;
const LEGACY_TLS_AGENT = new https.Agent({
  ciphers: "DEFAULT@SECLEVEL=0",
  honorCipherOrder: true,
  minVersion: "TLSv1",
});

type GallopFixtureGroup = "Results" | "Racecards" | "Entries";

type GallopFixtureItem = {
  date?: string;
  day?: string;
  club?: number;
  clubName?: string;
  status?: string;
};

type GallopFixturesPayload = {
  today?: string;
  fixtures?: Partial<Record<GallopFixtureGroup, GallopFixtureItem[]>>;
};

type GallopMeetingSlot = {
  event?: number;
  race?: number;
  time?: string;
  status?: string;
  mstatus?: string;
  exotics?: string[];
};

type GallopLastRun = {
  date?: string;
  club?: number;
  race?: number;
  finished?: number;
  distance?: number;
  lengths?: string;
};

type GallopRunner = {
  saddleNo?: number;
  horseName?: string;
  horseSeq?: number;
  starRating?: number;
  horseWeightColour?: string;
  openBet?: string;
  odds?: string;
  equipment?: string;
  equipmentKey?: string;
  draw?: number;
  sex?: string;
  colour?: string;
  age?: number;
  weight?: number;
  overweight?: number;
  jockeySeq?: number;
  jockeyName?: string;
  trainerSeq?: number;
  trainerName?: string;
  finished?: number;
  MR?: number;
  sPoints?: number;
  cPoints?: number;
  favourite?: string;
  status?: string;
  owner?: string;
  stableChange?: string;
  exTrainer?: string;
  exDate?: string;
  justGelded?: string;
  gelded?: string;
  restDays?: number;
  lastRuns?: GallopLastRun[];
  price?: string | number;
  saleAbbr?: string | null;
};

type GallopRaceDetail = {
  date?: string;
  club?: number;
  clubName?: string;
  surfaceCode?: string;
  surfaceDescr?: string;
  event?: number;
  race?: number;
  time?: string;
  name?: string;
  description?: string;
  cGrade?: string;
  distance?: number;
  stake?: string;
  status?: string;
  mstatus?: string;
  runners?: GallopRunner[];
};

export type GallopFixtureSnapshot = {
  todayDateKey: string;
  results: GallopFixtureItem[];
  racecards: GallopFixtureItem[];
  entries: GallopFixtureItem[];
};

export type GallopRacecardFetchResult = {
  cards: NormalizedRaceCard[];
  listedMeetings: number;
};

const source: RaceSyncSource = "gallop";

function compactDateKey(dateKey: string): string {
  return dateKey.replace(/-/g, "");
}

function expandDateKey(dateKey?: string | null): string | null {
  if (!dateKey) return null;
  const trimmed = dateKey.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{8}$/.test(trimmed)) return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  return null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeVenue(value?: string | null): string {
  const normalized = normalizeWhitespace(value || "Unknown venue");
  if (!normalized) return "Unknown venue";
  if (/^greyville$/i.test(normalized)) return "Hollywoodbets Greyville";
  if (/^kenilworth$/i.test(normalized)) return "Hollywoodbets Kenilworth";
  if (/^scottsville$/i.test(normalized)) return "Hollywoodbets Scottsville";
  return normalized;
}

function parseSurface(detail: GallopRaceDetail, venue: string): string {
  const surfaceText = `${detail.surfaceDescr || ""} ${detail.surfaceCode || ""}`.toLowerCase();
  if (surfaceText.includes("poly") || surfaceText.includes(" all weather") || /\bp\b/.test(surfaceText)) return "polytrack";
  if (surfaceText.includes("all-weather") || surfaceText.includes("tapeta")) return "all-weather";
  if (/fairview polytrack/i.test(venue)) return "polytrack";
  return "turf";
}

function parseRaceTime(raw?: string | null): string {
  const match = raw?.match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "00:00";
}

function formatLastRunForm(lastRuns: GallopLastRun[] | undefined): string {
  if (!lastRuns?.length) return "";
  const values = lastRuns
    .map((run) => {
      const finished = Number(run.finished ?? 0);
      if (!Number.isFinite(finished) || finished <= 0) return null;
      return String(Math.round(finished));
    })
    .filter((value): value is string => value !== null);
  return formatRunnerForm(values.join(""));
}

function toClubCode(value: string | number | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function parseWeight(value: number | undefined, overweight: number | undefined): number | null {
  const base = Number(value);
  if (!Number.isFinite(base) || base <= 0) return null;
  const extra = Number(overweight);
  const total = base + (Number.isFinite(extra) ? extra : 0);
  return Math.round(total * 10) / 10;
}

function cleanNoteText(value?: string | number | null): string | null {
  const text = String(value ?? "")
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text : null;
}

function buildLastRunNotes(lastRuns?: GallopLastRun[]): string | null {
  const runs = (lastRuns ?? [])
    .slice(0, 6)
    .map((run) => {
      const parts = [
        run.date ? String(run.date) : null,
        Number.isFinite(Number(run.club)) ? `club ${run.club}` : null,
        Number.isFinite(Number(run.race)) ? `race ${run.race}` : null,
        Number.isFinite(Number(run.finished)) && Number(run.finished) > 0 ? `pos ${run.finished}` : null,
        Number.isFinite(Number(run.distance)) && Number(run.distance) > 0 ? `${run.distance}m` : null,
        cleanNoteText(run.lengths) ? `len ${cleanNoteText(run.lengths)}` : null,
      ].filter(Boolean);

      return parts.length > 0 ? parts.join(" ") : null;
    })
    .filter((run): run is string => run !== null);

  return runs.length > 0 ? `Last runs ${runs.join("; ")}` : null;
}

function buildRunnerNotes(runner: GallopRunner, race: GallopRaceDetail): string | null {
  const parts = [
    Number.isFinite(runner.starRating) ? `Gallop star ${runner.starRating}` : null,
    Number.isFinite(runner.draw) ? `Draw ${runner.draw}` : null,
    Number.isFinite(runner.age) ? `Age ${runner.age}` : null,
    cleanNoteText(runner.sex) ? `Sex ${cleanNoteText(runner.sex)}` : null,
    cleanNoteText(runner.colour) ? `Colour ${cleanNoteText(runner.colour)}` : null,
    Number.isFinite(runner.MR) && runner.MR! > 0 ? `MR ${runner.MR}` : null,
    Number.isFinite(runner.restDays) ? `Rest ${runner.restDays}d` : null,
    Number.isFinite(runner.overweight) && Number(runner.overweight) > 0 ? `Overweight ${runner.overweight}` : null,
    Number.isFinite(runner.cPoints) ? `Card points ${runner.cPoints}` : null,
    Number.isFinite(runner.sPoints) ? `Speed points ${runner.sPoints}` : null,
    cleanNoteText(runner.favourite) ? `Favourite ${cleanNoteText(runner.favourite)}` : null,
    cleanNoteText(runner.status) ? `Status ${cleanNoteText(runner.status)}` : null,
    cleanNoteText(runner.owner) ? `Owner ${cleanNoteText(runner.owner)}` : null,
    cleanNoteText(runner.equipment) ? `Gear ${cleanNoteText(runner.equipment)}` : null,
    cleanNoteText(runner.equipmentKey) ? `Gear key ${cleanNoteText(runner.equipmentKey)}` : null,
    cleanNoteText(runner.horseWeightColour) && runner.horseWeightColour !== "White" ? `PPW ${cleanNoteText(runner.horseWeightColour)}` : null,
    runner.price ? `Sale ${String(runner.price).replace(/,/g, "")} ${runner.saleAbbr ?? ""}`.trim() : null,
    cleanNoteText(runner.stableChange) ? `Stable change ${cleanNoteText(runner.stableChange)}` : null,
    cleanNoteText(runner.exTrainer) ? `Ex trainer ${cleanNoteText(runner.exTrainer)}` : null,
    cleanNoteText(runner.exDate) ? `Trainer change ${cleanNoteText(runner.exDate)}` : null,
    cleanNoteText(runner.justGelded) ? `Just gelded ${cleanNoteText(runner.justGelded)}` : null,
    cleanNoteText(runner.gelded) ? `Gelded ${cleanNoteText(runner.gelded)}` : null,
    buildLastRunNotes(runner.lastRuns),
    cleanNoteText(race.description) ? `Race ${cleanNoteText(race.description)}` : null,
    runner.horseSeq ? `horse_id=${runner.horseSeq}` : null,
    runner.jockeySeq ? `jockey_id=${runner.jockeySeq}` : null,
    runner.trainerSeq ? `trainer_id=${runner.trainerSeq}` : null,
  ].filter(Boolean) as string[];

  return parts.length > 0 ? parts.join(" | ") : null;
}

function buildTrainerJockeyRecord(runner: GallopRunner): string {
  const parts = [
    runner.jockeyName?.trim() ? `Jockey ${runner.jockeyName.trim()}` : null,
    runner.trainerName?.trim() ? `Trainer ${runner.trainerName.trim()}` : null,
    Number.isFinite(runner.starRating) ? `Stars ${runner.starRating}` : null,
    Number.isFinite(runner.draw) ? `Draw ${runner.draw}` : null,
    Number.isFinite(runner.restDays) ? `Rest ${runner.restDays}d` : null,
  ].filter(Boolean) as string[];
  return parts.join(" | ");
}

function buildGallopResult(detail: GallopRaceDetail): NormalizedRaceResult | null {
  const placings = (detail.runners ?? [])
    .map((runner) => ({
      number: Number(runner.saddleNo ?? 0),
      position: Number(runner.finished ?? 0),
    }))
    .filter((entry) => Number.isFinite(entry.number) && entry.number > 0 && Number.isFinite(entry.position) && entry.position > 0)
    .sort((left, right) => left.position - right.position);

  if (placings.length === 0) return null;

  return {
    winner: placings.find((entry) => entry.position === 1)?.number ?? null,
    runnerUp: placings.find((entry) => entry.position === 2)?.number ?? null,
    third: placings.find((entry) => entry.position === 3)?.number ?? null,
    official: true,
    notes: "Official Gallop result sync",
  };
}

function isRunnerScratched(runner: GallopRunner): boolean {
  const text = `${runner.status || ""} ${runner.owner || ""}`.toLowerCase();
  return /scratched|withdrawn|non[\s-]?runner/.test(text);
}

function normalizeRunner(runner: GallopRunner, race: GallopRaceDetail): NormalizedRunner | null {
  const number = Number(runner.saddleNo ?? 0);
  const horseName = runner.horseName?.trim();
  if (!Number.isFinite(number) || number <= 0 || !horseName) return null;

  const raceClub = toClubCode(race.club);
  const courseRecord = (runner.lastRuns ?? []).some((pastRun) => {
    const finished = Number(pastRun.finished ?? 0);
    return finished > 0 && toClubCode(pastRun.club) === raceClub;
  });
  const distanceRecord = (runner.lastRuns ?? []).some((pastRun) => {
    const finished = Number(pastRun.finished ?? 0);
    const distance = Number(pastRun.distance ?? 0);
    return finished > 0 && Number.isFinite(distance) && Math.abs(distance - Number(race.distance ?? 0)) <= 100;
  });
  const scratched = isRunnerScratched(runner);

  return {
    number: Math.round(number),
    name: horseName,
    jockey: runner.jockeyName?.trim() || "Unknown jockey",
    trainer: runner.trainerName?.trim() || "Unknown trainer",
    form: formatLastRunForm(runner.lastRuns),
    weight: parseWeight(runner.weight, runner.overweight),
    currentOdds: parseDecimalOdds(runner.odds),
    openingOdds: parseDecimalOdds(runner.openBet),
    scratched,
    scratchReason: scratched ? "Marked scratched by Gallop" : null,
    courseRecord,
    distanceRecord,
    trainerJockeyRecord: buildTrainerJockeyRecord(runner),
    notes: buildRunnerNotes(runner, race),
  };
}

function mapRaceStatus(detail: GallopRaceDetail, result: NormalizedRaceResult | null): "upcoming" | "completed" | "cancelled" {
  const statusText = `${detail.status || ""} ${detail.mstatus || ""}`.toUpperCase();
  if (statusText.includes("A") || statusText.includes("ABANDON") || statusText.includes("CANCEL")) return "cancelled";
  if (result?.official) return "completed";
  return "upcoming";
}

async function gallopJsonRequest<T>(path: string): Promise<T> {
  const url = new URL(path, GALLOP_BASE_URL);

  return await new Promise<T>((resolve, reject) => {
    const req = https.get(
      url,
      {
        agent: LEGACY_TLS_AGENT,
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent": "AAA-Bets/1.0",
        },
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Gallop request failed (${statusCode}) for ${path}`));
          res.resume();
          return;
        }

        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch (error) {
            reject(new Error(`Gallop response was not valid JSON for ${path}: ${error instanceof Error ? error.message : String(error)}`));
          }
        });
      },
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Gallop request timed out for ${path}`));
    });
    req.on("error", reject);
  });
}

function normalizeFixtureGroup(items: GallopFixtureItem[] | undefined): GallopFixtureItem[] {
  return (items ?? []).filter((item) => !!expandDateKey(item.date) && Number.isFinite(Number(item.club ?? 0)) && !!item.clubName?.trim());
}

export async function fetchGallopFixtureSnapshot(): Promise<GallopFixtureSnapshot> {
  const payload = await gallopJsonRequest<GallopFixturesPayload>("/php/gallop.php?feed=fixtures&country=ALL");
  const todayDateKey = expandDateKey(payload.today) ?? getTodayDateKey();

  return {
    todayDateKey,
    results: normalizeFixtureGroup(payload.fixtures?.Results),
    racecards: normalizeFixtureGroup(payload.fixtures?.Racecards),
    entries: normalizeFixtureGroup(payload.fixtures?.Entries),
  };
}

export async function resolveGallopTodayDateKey(): Promise<string> {
  try {
    const snapshot = await fetchGallopFixtureSnapshot();
    return snapshot.todayDateKey;
  } catch (error) {
    logger.warn({ error }, "Gallop fixture day lookup failed, falling back to CAT day");
    return getTodayDateKey();
  }
}

export async function fetchGallopRacecardsByDate(dateKey: string): Promise<GallopRacecardFetchResult> {
  const snapshot = await fetchGallopFixtureSnapshot();
  const requestedDate = compactDateKey(dateKey);
  const meetingMap = new Map<string, GallopFixtureItem>();
  for (const item of [...snapshot.racecards, ...snapshot.results, ...snapshot.entries]) {
    if (item.date !== requestedDate) continue;
    const club = Number(item.club ?? 0);
    if (!Number.isFinite(club) || club <= 0) continue;
    const key = `${requestedDate}:${club}`;
    if (!meetingMap.has(key)) meetingMap.set(key, item);
  }

  const meetings = [...meetingMap.values()];
  if (meetings.length === 0) return { cards: [], listedMeetings: 0 };

  const cards: NormalizedRaceCard[] = [];

  for (const meeting of meetings) {
    const club = Number(meeting.club);
    const meetingDate = expandDateKey(meeting.date) ?? dateKey;
    const venue = normalizeVenue(meeting.clubName);

    let slots: GallopMeetingSlot[] = [];
    try {
      slots = await gallopJsonRequest<GallopMeetingSlot[]>(`/php/gallop.php?feed=meeting&club=${club}&date=${requestedDate}`);
    } catch (error) {
      logger.warn({ error, dateKey, club, venue }, "Gallop meeting fetch failed");
      continue;
    }

    for (const slot of slots) {
      const event = Number(slot.event ?? 0);
      const raceNumber = Number(slot.race ?? 0);
      if (!Number.isFinite(event) || event <= 0 || !Number.isFinite(raceNumber) || raceNumber <= 0) continue;

      let detail: GallopRaceDetail | null = null;
      try {
        detail = await gallopJsonRequest<GallopRaceDetail>(`/php/gallop.php?feed=event&date=${requestedDate}&club=${club}&event=${event}`);
      } catch (error) {
        logger.warn({ error, dateKey, club, event, raceNumber, venue }, "Gallop event fetch failed, keeping shell race");
      }

      const result = detail ? buildGallopResult(detail) : null;
      const runners = detail?.runners
        ?.map((runner) => normalizeRunner(runner, detail!))
        .filter((runner): runner is NormalizedRunner => runner !== null) ?? [];

      cards.push({
        source,
        sourceRaceId: detail ? `${requestedDate}:${club}:${event}` : `${requestedDate}:${club}:${raceNumber}`,
        meetingDate,
        venue,
        raceNumber,
        name: detail?.name?.trim() || `${venue} Race ${raceNumber}`,
        distance: Number(detail?.distance ?? 0) > 0 ? Math.round(Number(detail?.distance)) : 0,
        raceTime: parseRaceTime(detail?.time || slot.time),
        surface: parseSurface(detail ?? {}, venue),
        grade: detail?.cGrade?.trim() || null,
        prize: detail?.stake?.trim() || null,
        status: mapRaceStatus(detail ?? { status: slot.status, mstatus: slot.mstatus }, result),
        runners,
        result,
      });
    }
  }

  return {
    cards: cards.sort((left, right) => left.meetingDate.localeCompare(right.meetingDate) || left.raceTime.localeCompare(right.raceTime) || left.raceNumber - right.raceNumber),
    listedMeetings: meetings.length,
  };
}
