import { logger } from "./logger";

const TOTE_INFO_SERVER = "https://totex-col.4racing.com/PRODUCTS/webservice/phumelelaV4/request/";
const TOTE_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "AAA-Bets/1.0",
};

const TOTE_BASE_PAYLOAD = {
  system: "4RACING",
  user: "appUser",
  password: "Appsdjnj!234",
  outlet: "Store01",
} as const;

type ToteResponse<T> = {
  error: number;
  result?: T;
  error_message?: string;
  title?: string;
};

export interface ToteProgram {
  ProgramDate: string;
  ProgramCode: string;
  ProgramName: string;
  CourseName?: string;
  Country?: string;
  Category?: string;
  HighestRace?: string;
  CurrentRace?: string;
  AdvertisedStartTime?: string;
  Status?: string;
  ProgramStatus?: string;
}

export interface ToteRunner {
  Runner?: string;
  Saddle?: string;
  Name?: string;
  Draw?: string;
  Weight?: string;
  Jockey?: string;
  TrainerCurrent?: string;
  RunnerComment?: string;
  Odds?: string;
  Tote_Odds?: string;
  BettingForecast?: string;
  Scratched?: string;
  Age?: string;
  SexLookup?: string;
  Sire?: string;
  Dam?: string;
  Damby?: string;
  L3?: string;
  Runs?: string;
  Wins?: string;
  Places?: string;
  Second?: string;
  Third?: string;
  Dist_Runs?: string;
  Dist_Wins?: string;
  Dist_Places?: string;
  Crse_Runs?: string;
  Crse_Wins?: string;
  Crse_Places?: string;
  TrainerStats?: string;
  JockeyStats?: string;
}

export interface ToteRaceResult {
  Position?: string;
  Saddle?: string;
  Runner?: string;
}

export interface ToteRaceResultInfo {
  ScratchedRunners?: string;
  ToteFavorite?: string;
}

export interface ToteRace {
  ProgramDate: string;
  ProgramCode: string;
  Race: string;
  RaceStatus?: string;
  RaceStatusCode?: string | null;
  AdvertisedStartTime?: string;
  Stakegross?: string;
  Title?: string;
  Description?: string;
  Surface?: string;
  Distance?: string;
  Venue?: string;
  RaceTitle?: string;
  ScratchedRunners?: string;
  Runners?: ToteRunner[];
  RaceResults?: ToteRaceResult[];
  RaceResultInfo?: ToteRaceResultInfo[];
}

async function toteRequest<T>(action: string, data: unknown): Promise<T> {
  const res = await fetch(TOTE_INFO_SERVER, {
    method: "POST",
    headers: {
      ...TOTE_HEADERS,
      timestamp: Date.now().toString(),
    },
    body: JSON.stringify({
      ...TOTE_BASE_PAYLOAD,
      action,
      data,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Tote request failed (${action}) with status ${res.status}`);
  }

  const payload = (await res.json()) as ToteResponse<T>;
  if (payload.error !== 0 || payload.result === undefined) {
    throw new Error(payload.error_message || payload.title || `Tote request failed for ${action}`);
  }

  return payload.result;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function getProgramDateKey(programDate: string): string {
  const match = programDate.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : programDate.slice(0, 10);
}

export function toDisplayVenue(program: ToteProgram, race?: ToteRace): string {
  return normalizeWhitespace(race?.Title || program.CourseName || program.ProgramName || race?.Venue || "Unknown venue");
}

export function parseRaceNumber(race: ToteRace): number {
  return Number.parseInt(race.Race, 10);
}

export function parseRaceTime(advertisedStartTime?: string | null): string {
  const match = advertisedStartTime?.match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "00:00";
}

export function parseDistanceMeters(distance?: string | null): number {
  const match = distance?.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function parseSurface(surface?: string | null): string {
  const value = (surface || "").trim().toUpperCase();
  if (value === "P") return "polytrack";
  if (value === "A") return "all-weather";
  return "turf";
}

export function parseDecimalOdds(value?: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "SCR") return null;

  const numeric = Number.parseFloat(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric * 10) / 10;

  const fractionMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*[-/]\s*(\d+(?:\.\d+)?)$/);
  if (fractionMatch) {
    const numerator = Number.parseFloat(fractionMatch[1]);
    const denominator = Number.parseFloat(fractionMatch[2]);
    if (denominator > 0) return Math.round(((numerator / denominator) + 1) * 10) / 10;
  }

  if (/^evens?$/i.test(trimmed)) return 2;
  return null;
}

export function formatRunnerForm(value?: string | null): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  if (raw.includes("-")) return raw;

  const chars = raw.replace(/\s+/g, "").split("").filter((char) => /[A-Za-z0-9]/.test(char));
  return chars.join("-");
}

export function getScratchedRunnerNumbers(race: ToteRace): Set<number> {
  const values = new Set<number>();
  const parts = [race.ScratchedRunners, race.RaceResultInfo?.[0]?.ScratchedRunners]
    .filter(Boolean)
    .flatMap((value) => (value || "").split(","));

  for (const part of parts) {
    const num = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(num)) values.add(num);
  }

  for (const runner of race.Runners ?? []) {
    const isScratched = runner.Scratched === "1";
    const number = Number.parseInt(runner.Saddle || runner.Runner || "", 10);
    if (isScratched && Number.isFinite(number)) values.add(number);
  }

  return values;
}

export function getOfficialPlacings(race: ToteRace): { winner: number | null; runnerUp: number | null; third: number | null } {
  const ordered = [...(race.RaceResults ?? [])]
    .map((result) => ({
      position: Number.parseInt(result.Position || "", 10),
      saddle: Number.parseInt(result.Saddle || result.Runner || "", 10),
    }))
    .filter((result) => Number.isFinite(result.position) && Number.isFinite(result.saddle))
    .sort((left, right) => left.position - right.position);

  return {
    winner: ordered.find((result) => result.position === 1)?.saddle ?? null,
    runnerUp: ordered.find((result) => result.position === 2)?.saddle ?? null,
    third: ordered.find((result) => result.position === 3)?.saddle ?? null,
  };
}

export function hasOfficialResult(race: ToteRace): boolean {
  return getOfficialPlacings(race).winner !== null;
}

export async function fetchProgramsByDate(dateKey: string): Promise<ToteProgram[]> {
  try {
    const programs = await toteRequest<ToteProgram[]>("getProgramsByDate", { start: dateKey, end: dateKey });
    return programs
      .filter((program) => {
        const country = (program.Country || "").toLowerCase();
        const category = (program.Category || "").toUpperCase();
        return category === "H" && country.includes("south africa");
      })
      .sort((left, right) => {
        const leftTime = left.AdvertisedStartTime || "";
        const rightTime = right.AdvertisedStartTime || "";
        return leftTime.localeCompare(rightTime) || left.ProgramCode.localeCompare(right.ProgramCode);
      });
  } catch (err) {
    logger.warn({ err, dateKey }, "Failed to fetch Tote programs for date");
    return [];
  }
}

export async function fetchProgramRaces(programCode: string, programDate: string): Promise<ToteRace[]> {
  try {
    return await toteRequest<ToteRace[]>("getDateRaceDetailedList", {
      ProgramCode: programCode,
      ProgramDate: programDate,
    });
  } catch (err) {
    logger.warn({ err, programCode, programDate }, "Failed to fetch Tote race details");
    return [];
  }
}
