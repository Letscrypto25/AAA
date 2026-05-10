const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const CAT_OFFSET_HOURS = 2;

export const CAT_TIME_ZONE = "Africa/Johannesburg";

function getDateParts(date: Date, timeZone: string = CAT_TIME_ZONE): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === "year")?.value ?? 0);
  const month = Number(parts.find((part) => part.type === "month")?.value ?? 0);
  const day = Number(parts.find((part) => part.type === "day")?.value ?? 0);
  return { year, month, day };
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } | null {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function toDayIndex(dateKey: string): number | null {
  const parts = parseDateKey(dateKey);
  if (!parts) return null;
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

export function formatDateKey(date: Date, timeZone: string = CAT_TIME_ZONE): string {
  const { year, month, day } = getDateParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getTodayDateKey(reference: Date = new Date()): string {
  return formatDateKey(reference, CAT_TIME_ZONE);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const parts = parseDateKey(dateKey);
  if (!parts) return dateKey;

  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return formatDateKey(shifted, CAT_TIME_ZONE);
}

export function getRaceDateTime(
  raceTime: string,
  meetingDate?: string | null,
  reference: Date = new Date(),
): Date {
  const [hours, minutes] = raceTime.split(":").map(Number);
  const dateKey = meetingDate && /^\d{4}-\d{2}-\d{2}$/.test(meetingDate) ? meetingDate : formatDateKey(reference, CAT_TIME_ZONE);
  const parts = parseDateKey(dateKey);

  if (!parts) {
    return reference;
  }

  return new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      (Number.isFinite(hours) ? hours : 0) - CAT_OFFSET_HOURS,
      Number.isFinite(minutes) ? minutes : 0,
      0,
      0,
    ),
  );
}

export function getMinutesToRace(
  raceTime: string,
  meetingDate?: string | null,
  reference: Date = new Date(),
): number | null {
  const raceDate = getRaceDateTime(raceTime, meetingDate, reference);
  const diffMs = raceDate.getTime() - reference.getTime();
  return Math.round(diffMs / MINUTE_MS);
}

export function isDateToday(dateKey?: string | null, reference: Date = new Date()): boolean {
  return !!dateKey && dateKey === formatDateKey(reference, CAT_TIME_ZONE);
}

export function isDateWithinDays(dateKey?: string | null, days: number = 7, reference: Date = new Date()): boolean {
  if (!dateKey) return false;
  const targetDay = toDayIndex(dateKey);
  const startDay = toDayIndex(formatDateKey(reference, CAT_TIME_ZONE));
  if (targetDay === null || startDay === null) return false;

  const diffDays = targetDay - startDay;
  return diffDays >= 0 && diffDays < days;
}

export function getRelativeDayLabel(dateKey?: string | null, reference: Date = new Date()): string {
  if (!dateKey) return "Unscheduled";

  const targetDay = toDayIndex(dateKey);
  const startDay = toDayIndex(formatDateKey(reference, CAT_TIME_ZONE));
  if (targetDay === null || startDay === null) return "Unscheduled";

  const diffDays = targetDay - startDay;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";

  const parts = parseDateKey(dateKey);
  if (!parts) return "Unscheduled";

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0)).toLocaleDateString("en-ZA", {
    timeZone: CAT_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export type RaceTimeProfile = {
  band: "early" | "building" | "tomorrow" | "today" | "late-market" | "jump" | "post-race";
  label: string;
  confidenceFactor: number;
  nextUpdateDelayMs: number;
  prominence: number;
};

export function getRaceTimeProfile(
  raceTime: string,
  meetingDate?: string | null,
  reference: Date = new Date(),
): RaceTimeProfile {
  const minutesToRace = getMinutesToRace(raceTime, meetingDate, reference);
  if (minutesToRace === null) {
    return {
      band: "early",
      label: "Awaiting card timing",
      confidenceFactor: 0.82,
      nextUpdateDelayMs: 12 * HOUR_MS,
      prominence: 0.2,
    };
  }

  if (minutesToRace <= 0) {
    return {
      band: "post-race",
      label: "Result pending",
      confidenceFactor: 1,
      nextUpdateDelayMs: 5 * MINUTE_MS,
      prominence: 1,
    };
  }

  if (minutesToRace <= 30) {
    return {
      band: "jump",
      label: "Final market",
      confidenceFactor: 1.12,
      nextUpdateDelayMs: 5 * MINUTE_MS,
      prominence: 1,
    };
  }

  if (minutesToRace <= 120) {
    return {
      band: "late-market",
      label: "Late market",
      confidenceFactor: 1.06,
      nextUpdateDelayMs: 10 * MINUTE_MS,
      prominence: 0.98,
    };
  }

  if (minutesToRace <= 12 * 60) {
    return {
      band: "today",
      label: "Today",
      confidenceFactor: 1,
      nextUpdateDelayMs: 30 * MINUTE_MS,
      prominence: 0.9,
    };
  }

  if (minutesToRace <= 24 * 60) {
    return {
      band: "tomorrow",
      label: "Tomorrow edge",
      confidenceFactor: 0.94,
      nextUpdateDelayMs: 90 * MINUTE_MS,
      prominence: 0.75,
    };
  }

  if (minutesToRace <= 3 * 24 * 60) {
    return {
      band: "building",
      label: "Building shape",
      confidenceFactor: 0.88,
      nextUpdateDelayMs: 4 * HOUR_MS,
      prominence: 0.55,
    };
  }

  return {
    band: "early",
    label: "Early read",
    confidenceFactor: 0.8,
    nextUpdateDelayMs: 12 * HOUR_MS,
    prominence: 0.35,
  };
}
