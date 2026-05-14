import { addDaysToDateKey, getTodayDateKey } from "./race-time";
import { logger } from "./logger";
import { formatRunnerForm, parseDecimalOdds, parseDistanceMeters, parseRaceTime } from "./tote";

const DEFAULT_THERACING_API_BASE_URL = "https://api.theracingapi.com";
const REQUEST_TIMEOUT_MS = 15000;

export type RaceSyncSource = "theracingapi" | "tote" | "gallop";
export type NormalizedRaceStatus = "upcoming" | "completed" | "cancelled";
export type TheRacingApiPlan = "pro" | "standard";

export interface NormalizedRaceResult {
  winner: number | null;
  runnerUp: number | null;
  third: number | null;
  official: boolean;
  notes: string | null;
}

export interface NormalizedRunner {
  number: number;
  name: string;
  jockey: string;
  trainer: string;
  form: string;
  weight: number | null;
  currentOdds: number | null;
  openingOdds: number | null;
  scratched: boolean;
  scratchReason: string | null;
  courseRecord: boolean;
  distanceRecord: boolean;
  trainerJockeyRecord: string;
  notes: string | null;
}

export interface NormalizedRaceCard {
  source: RaceSyncSource;
  sourceRaceId: string | null;
  meetingDate: string;
  venue: string;
  raceNumber: number;
  name: string;
  distance: number;
  raceTime: string;
  surface: string;
  grade: string | null;
  prize: string | null;
  status: NormalizedRaceStatus;
  runners: NormalizedRunner[];
  result: NormalizedRaceResult | null;
}

type TheRacingApiConfig = {
  username: string;
  password: string;
  baseUrl: string;
  plan: TheRacingApiPlan;
  regionCodes: string[];
  courseIds: string[];
};

type QueryValue = string | number | Array<string | number> | null | undefined;
type JsonRecord = Record<string, unknown>;

class TheRacingApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function getByPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    const record = asRecord(current);
    if (!record || !(segment in record)) return undefined;
    current = record[segment];
  }
  return current;
}

function pickString(record: JsonRecord, ...paths: Array<readonly string[]>): string | null {
  for (const path of paths) {
    const value = getByPath(record, path);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(record: JsonRecord, ...paths: Array<readonly string[]>): number | null {
  for (const path of paths) {
    const value = getByPath(record, path);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const normalized = value.trim().replace(/,/g, "");
      const parsed = Number.parseFloat(normalized);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function pickBoolean(record: JsonRecord, ...paths: Array<readonly string[]>): boolean | null {
  for (const path of paths) {
    const value = getByPath(record, path);
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "y"].includes(normalized)) return true;
      if (["false", "0", "no", "n"].includes(normalized)) return false;
    }
  }
  return null;
}

function pickArray(record: JsonRecord, ...paths: Array<readonly string[]>): unknown[] {
  for (const path of paths) {
    const value = getByPath(record, path);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function parseCsvEnv(value?: string): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getTheRacingApiConfig(): TheRacingApiConfig | null {
  const username = process.env["THERACING_API_USERNAME"]?.trim();
  const password = process.env["THERACING_API_PASSWORD"]?.trim();
  if (!username || !password) return null;

  const planValue = (process.env["THERACING_API_PLAN"] || "pro").trim().toLowerCase();
  const plan: TheRacingApiPlan = planValue === "standard" ? "standard" : "pro";

  return {
    username,
    password,
    baseUrl: (process.env["THERACING_API_BASE_URL"] || DEFAULT_THERACING_API_BASE_URL).trim().replace(/\/+$/, ""),
    plan,
    regionCodes: parseCsvEnv(process.env["THERACING_API_REGION_CODES"]),
    courseIds: parseCsvEnv(process.env["THERACING_API_COURSE_IDS"]),
  };
}

export function isTheRacingApiConfigured(): boolean {
  return getTheRacingApiConfig() !== null;
}

export function getTheRacingApiPlan(): TheRacingApiPlan | null {
  return getTheRacingApiConfig()?.plan ?? null;
}

function buildRacecardsQuery(dateKey: string, config: TheRacingApiConfig): Record<string, QueryValue> {
  return {
    date: dateKey,
    region_codes: config.regionCodes.length > 0 ? config.regionCodes : undefined,
    course_ids: config.courseIds.length > 0 ? config.courseIds : undefined,
    limit: 500,
    skip: 0,
  };
}

function buildResultsQuery(dateKey: string, config: TheRacingApiConfig): Record<string, QueryValue> {
  return {
    start_date: dateKey,
    end_date: dateKey,
    region: config.regionCodes.length > 0 ? config.regionCodes : undefined,
    course: config.courseIds.length > 0 ? config.courseIds : undefined,
    limit: 100,
    skip: 0,
  };
}

function getStandardDayParam(dateKey: string): "today" | "tomorrow" | null {
  const today = getTodayDateKey();
  if (dateKey === today) return "today";
  if (dateKey === addDaysToDateKey(today, 1)) return "tomorrow";
  return null;
}

async function theracingApiRequest<T>(path: string, query: Record<string, QueryValue> = {}): Promise<T> {
  const config = getTheRacingApiConfig();
  if (!config) {
    throw new Error("The Racing API credentials are not configured");
  }

  const url = new URL(`${config.baseUrl}${path}`);
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue == null) continue;
    if (Array.isArray(rawValue)) {
      for (const entry of rawValue) {
        url.searchParams.append(key, String(entry));
      }
      continue;
    }
    url.searchParams.set(key, String(rawValue));
  }

  const authorization = Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64");
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${authorization}`,
      "User-Agent": "AAA-Bets/1.0",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new TheRacingApiRequestError(
      `The Racing API request failed (${response.status})${body ? `: ${body.slice(0, 160)}` : ""}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

function extractPageItems<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const record = asRecord(payload);
  if (!record) return [];

  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value as T[];
  }

  return [];
}

function parseDateKeyFromValue(value?: string | null): string | null {
  if (!value) return null;
  const match = value.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function extractMeetingDate(record: JsonRecord): string | null {
  return (
    parseDateKeyFromValue(
      pickString(
        record,
        ["date"],
        ["race_date"],
        ["off_dt"],
        ["off_time"],
        ["scheduled_time"],
        ["start_time"],
      ),
    )
  );
}

function extractRaceTime(record: JsonRecord): string {
  const raw = pickString(
    record,
    ["off"],
    ["off_time"],
    ["scheduled_time"],
    ["start_time"],
    ["time"],
  );
  return parseRaceTime(raw);
}

function extractDistanceMeters(record: JsonRecord): number {
  const meters = pickNumber(
    record,
    ["distance_m"],
    ["distance_metres"],
    ["distance_meters"],
  );
  if (meters && meters > 0) return Math.round(meters);

  const yards = pickNumber(record, ["distance_y"], ["yards"], ["distance_yards"]);
  if (yards && yards > 0) return Math.round(yards * 0.9144);

  const furlongs = pickNumber(record, ["distance_f"], ["furlongs"]);
  if (furlongs && furlongs > 0) return Math.round(furlongs * 201.168);

  const raw = pickString(
    record,
    ["distance"],
    ["distance_round"],
    ["distance_display"],
  );
  if (!raw) return 0;

  const metricMatch = raw.match(/(\d{3,4})\s*m\b/i);
  if (metricMatch) return Number.parseInt(metricMatch[1], 10);

  const imperialMatch = raw.match(/(?:(\d+)\s*m)?\s*(?:(\d+)\s*f)?\s*(?:(\d+)\s*y)?/i);
  if (imperialMatch && (imperialMatch[1] || imperialMatch[2] || imperialMatch[3])) {
    const miles = Number.parseInt(imperialMatch[1] || "0", 10);
    const fs = Number.parseInt(imperialMatch[2] || "0", 10);
    const ys = Number.parseInt(imperialMatch[3] || "0", 10);
    const totalMeters = miles * 1609.344 + fs * 201.168 + ys * 0.9144;
    if (totalMeters > 0) return Math.round(totalMeters);
  }

  const parsed = parseDistanceMeters(raw);
  return parsed > 100 ? parsed : 0;
}

function normalizeSurface(value?: string | null): string {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return "turf";
  if (normalized.includes("poly")) return "polytrack";
  if (normalized.includes("all weather") || normalized.includes("all-weather") || normalized.includes("tapeta") || normalized.includes("standard")) {
    return "all-weather";
  }
  return "turf";
}

function mapRaceStatus(record: JsonRecord, result: NormalizedRaceResult | null): NormalizedRaceStatus {
  const statusText = [
    pickString(record, ["status"], ["race_status"], ["status_text"], ["result_text"]),
    pickString(record, ["race_status_detail"]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (statusText.includes("cancel") || statusText.includes("abandon") || statusText.includes("void")) {
    return "cancelled";
  }
  if (result?.official || statusText.includes("official") || statusText.includes("result") || statusText.includes("complete") || statusText.includes("finished")) {
    return "completed";
  }
  return "upcoming";
}

function buildRatingsSummary(record: JsonRecord): string | null {
  const ratings = [
    ["OR", pickString(record, ["official_rating"], ["or"])],
    ["RPR", pickString(record, ["rpr"])],
    ["TS", pickString(record, ["topspeed"], ["ts"])],
  ].filter((entry): entry is [string, string] => !!entry[1]);

  if (ratings.length === 0) return null;
  return `Ratings: ${ratings.map(([label, value]) => `${label} ${value}`).join(", ")}`;
}

function buildRunnerNotes(record: JsonRecord): string | null {
  const lines = [
    pickString(record, ["verdict"]),
    pickString(record, ["spotlight"]),
    pickString(record, ["comment"]),
    buildRatingsSummary(record),
  ].filter(Boolean) as string[];

  const horseId = pickString(record, ["horse_id"], ["horse", "id"]);
  const jockeyId = pickString(record, ["jockey_id"], ["jockey", "id"]);
  const trainerId = pickString(record, ["trainer_id"], ["trainer", "id"]);

  const idParts = [
    horseId ? `horse_id=${horseId}` : null,
    jockeyId ? `jockey_id=${jockeyId}` : null,
    trainerId ? `trainer_id=${trainerId}` : null,
  ].filter(Boolean);

  if (idParts.length > 0) {
    lines.push(`IDs: ${idParts.join(", ")}`);
  }

  return lines.length > 0 ? lines.join(" | ") : null;
}

function buildTrainerJockeyRecord(record: JsonRecord): string {
  const parts = [
    (() => {
      const percent = pickNumber(record, ["jockey_14_days_win_pct"], ["jockey_7_days_win_pct"], ["jockey_win_pct"]);
      return percent != null ? `Jockey ${Math.round(percent)}%` : null;
    })(),
    (() => {
      const percent = pickNumber(record, ["trainer_14_days_win_pct"], ["trainer_7_days_win_pct"], ["trainer_win_pct"]);
      return percent != null ? `Trainer ${Math.round(percent)}%` : null;
    })(),
  ].filter(Boolean);

  if (parts.length > 0) return parts.join(" | ");

  const idParts = [
    pickString(record, ["jockey_id"], ["jockey", "id"]),
    pickString(record, ["trainer_id"], ["trainer", "id"]),
  ].filter(Boolean);
  return idParts.length > 0 ? `IDs ${idParts.join(" / ")}` : "";
}

function parseRunnerWeight(record: JsonRecord): number | null {
  const kilograms = pickNumber(record, ["weight_kg"]);
  if (kilograms != null) return kilograms;

  const direct = pickNumber(record, ["weight"]);
  if (direct != null && direct > 0 && direct < 100) return direct;

  const pounds = pickNumber(record, ["weight_lbs"]);
  if (pounds != null && pounds > 0) return Math.round((pounds * 0.45359237) * 10) / 10;

  return null;
}

function parseOdds(record: JsonRecord, ...paths: Array<readonly string[]>): number | null {
  const numeric = pickNumber(record, ...paths);
  if (numeric != null && numeric > 0) return Math.round(numeric * 10) / 10;

  const stringValue = pickString(record, ...paths);
  return parseDecimalOdds(stringValue);
}

function normalizeRunner(value: unknown): NormalizedRunner | null {
  const record = asRecord(value);
  if (!record) return null;

  const number = pickNumber(
    record,
    ["number"],
    ["runner_number"],
    ["cloth_number"],
    ["saddle"],
    ["draw_number"],
  );
  const name = pickString(
    record,
    ["horse"],
    ["horse_name"],
    ["name"],
    ["horse", "horse"],
    ["horse", "name"],
  );
  if (!number || !name) return null;

  const scratched =
    pickBoolean(record, ["non_runner"], ["scratched"]) === true
    || /\b(scratched|non[\s-]?runner)\b/i.test(pickString(record, ["status"], ["comment"]) || "");

  const courseWins = pickNumber(record, ["course_wins"], ["wins_course"]);
  const coursePlaces = pickNumber(record, ["course_places"], ["places_course"]);
  const distanceWins = pickNumber(record, ["distance_wins"], ["wins_distance"]);
  const distancePlaces = pickNumber(record, ["distance_places"], ["places_distance"]);

  return {
    number: Math.round(number),
    name,
    jockey: pickString(record, ["jockey"], ["jockey_name"], ["jockey", "name"]) || "Unknown jockey",
    trainer: pickString(record, ["trainer"], ["trainer_name"], ["trainer", "name"]) || "Unknown trainer",
    form: formatRunnerForm(pickString(record, ["form"], ["recent_form"]) || ""),
    weight: parseRunnerWeight(record),
    currentOdds: parseOdds(record, ["odds_decimal"], ["current_odds"], ["odds"], ["price"]),
    openingOdds: parseOdds(record, ["betting_forecast"], ["forecast_price"], ["opening_odds"], ["price_forecast"]),
    scratched,
    scratchReason: scratched ? "Marked scratched by The Racing API" : null,
    courseRecord: (courseWins ?? 0) > 0 || (coursePlaces ?? 0) > 0,
    distanceRecord: (distanceWins ?? 0) > 0 || (distancePlaces ?? 0) > 0,
    trainerJockeyRecord: buildTrainerJockeyRecord(record),
    notes: buildRunnerNotes(record),
  };
}

function buildNormalizedResult(record: JsonRecord): NormalizedRaceResult | null {
  const runners = pickArray(record, ["runners"], ["results"], ["placings"], ["placed_horses"]);
  const directWinner = pickNumber(record, ["winner_number"], ["winner_runner_number"]);
  const directRunnerUp = pickNumber(record, ["runner_up_number"], ["second_number"]);
  const directThird = pickNumber(record, ["third_number"]);

  const placings = runners
    .map((entry) => {
      const runner = asRecord(entry);
      if (!runner) return null;
      const position = pickNumber(runner, ["position"], ["finish_position"], ["place"], ["placing"]);
      const number = pickNumber(runner, ["number"], ["runner_number"], ["cloth_number"], ["saddle"]);
      if (!position || !number) return null;
      return { position: Math.round(position), number: Math.round(number) };
    })
    .filter((entry): entry is { position: number; number: number } => entry !== null)
    .sort((left, right) => left.position - right.position);

  const winner = directWinner != null ? Math.round(directWinner) : placings.find((entry) => entry.position === 1)?.number ?? null;
  const runnerUp = directRunnerUp != null ? Math.round(directRunnerUp) : placings.find((entry) => entry.position === 2)?.number ?? null;
  const third = directThird != null ? Math.round(directThird) : placings.find((entry) => entry.position === 3)?.number ?? null;

  if (winner == null && runnerUp == null && third == null) return null;

  return {
    winner,
    runnerUp,
    third,
    official: true,
    notes: "Official The Racing API result sync",
  };
}

function normalizeRacecard(value: unknown): NormalizedRaceCard | null {
  const record = asRecord(value);
  if (!record) return null;

  const meetingDate = extractMeetingDate(record);
  const raceNumber = pickNumber(record, ["race_number"], ["number"]);
  const venue = normalizeWhitespace(pickString(record, ["course"], ["course_name"], ["venue"]) || "");
  if (!meetingDate || !raceNumber || !venue) return null;

  const result = buildNormalizedResult(record);

  return {
    source: "theracingapi",
    sourceRaceId: pickString(record, ["race_id"], ["id"]),
    meetingDate,
    venue,
    raceNumber: Math.round(raceNumber),
    name: pickString(record, ["race_name"], ["race"], ["title"], ["name"]) || `${venue} Race ${Math.round(raceNumber)}`,
    distance: extractDistanceMeters(record),
    raceTime: extractRaceTime(record),
    surface: normalizeSurface(pickString(record, ["surface"], ["track_type"], ["course_surface"], ["going_description"])),
    grade: pickString(record, ["race_class"], ["class"], ["race_type"], ["pattern"]),
    prize: pickString(record, ["prize"], ["prize_money"]),
    status: mapRaceStatus(record, result),
    runners: pickArray(record, ["runners"]).map(normalizeRunner).filter((runner): runner is NormalizedRunner => runner !== null),
    result,
  };
}

function normalizeResult(value: unknown): { sourceRaceId: string | null; card: NormalizedRaceResult | null } | null {
  const record = asRecord(value);
  if (!record) return null;

  return {
    sourceRaceId: pickString(record, ["race_id"], ["id"]),
    card: buildNormalizedResult(record),
  };
}

export async function fetchTheRacingApiRacecardsByDate(dateKey: string): Promise<NormalizedRaceCard[]> {
  const config = getTheRacingApiConfig();
  if (!config) {
    logger.info({ dateKey }, "The Racing API not configured; skipping primary racecard sync");
    return [];
  }

  try {
    const payload = await theracingApiRequest<unknown>("/v1/racecards/pro", buildRacecardsQuery(dateKey, { ...config, plan: "pro" }));
    return extractPageItems<unknown>(payload, ["racecards", "races", "data"])
      .map(normalizeRacecard)
      .filter((race): race is NormalizedRaceCard => race !== null);
  } catch (err) {
    const standardDay = getStandardDayParam(dateKey);
    const canTryStandard = config.plan !== "pro" || (err instanceof TheRacingApiRequestError && err.status === 404);
    if (!standardDay || !canTryStandard) throw err;

    logger.warn({ err, dateKey }, "Pro racecards request failed; retrying with standard endpoint");
    const payload = await theracingApiRequest<unknown>("/v1/racecards/standard", {
      day: standardDay,
      region_codes: config.regionCodes.length > 0 ? config.regionCodes : undefined,
      course_ids: config.courseIds.length > 0 ? config.courseIds : undefined,
      limit: 500,
      skip: 0,
    });
    return extractPageItems<unknown>(payload, ["racecards", "races", "data"])
      .map(normalizeRacecard)
      .filter((race): race is NormalizedRaceCard => race !== null)
      .filter((race) => race.meetingDate === dateKey);
  }
}

export async function fetchTheRacingApiRaceDetail(raceId: string): Promise<NormalizedRaceCard | null> {
  const config = getTheRacingApiConfig();
  if (!config) return null;

  const path = config.plan === "pro" ? `/v1/racecards/${raceId}/pro` : `/v1/racecards/${raceId}/standard`;
  const payload = await theracingApiRequest<unknown>(path);
  return normalizeRacecard(payload);
}

export async function fetchTheRacingApiResultsByDate(dateKey: string): Promise<Map<string, NormalizedRaceResult>> {
  const config = getTheRacingApiConfig();
  if (!config) return new Map();

  const payload = await theracingApiRequest<unknown>("/v1/results", buildResultsQuery(dateKey, config));
  const items = extractPageItems<unknown>(payload, ["results", "races", "data"]);
  const resultMap = new Map<string, NormalizedRaceResult>();

  for (const item of items) {
    const normalized = normalizeResult(item);
    if (!normalized?.sourceRaceId || !normalized.card) continue;
    resultMap.set(normalized.sourceRaceId, normalized.card);
  }

  return resultMap;
}

export async function fetchTheRacingApiResultDetail(raceId: string): Promise<NormalizedRaceResult | null> {
  const payload = await theracingApiRequest<unknown>(`/v1/results/${raceId}`);
  const record = asRecord(payload);
  if (!record) return null;
  return buildNormalizedResult(record);
}
