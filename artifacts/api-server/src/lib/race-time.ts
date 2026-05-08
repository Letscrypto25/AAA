const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function getTodayDateKey(reference: Date = new Date()): string {
  return formatDateKey(reference);
}

export function getRaceDateTime(
  raceTime: string,
  meetingDate?: string | null,
  reference: Date = new Date(),
): Date {
  const [hours, minutes] = raceTime.split(":").map(Number);
  const dateKey = meetingDate && /^\d{4}-\d{2}-\d{2}$/.test(meetingDate) ? meetingDate : formatDateKey(reference);
  const raceDate = new Date(`${dateKey}T00:00:00`);
  raceDate.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return raceDate;
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
  return !!dateKey && dateKey === formatDateKey(reference);
}

export function isDateWithinDays(dateKey?: string | null, days: number = 7, reference: Date = new Date()): boolean {
  if (!dateKey) return false;
  const target = new Date(`${dateKey}T00:00:00`);
  const start = new Date(`${formatDateKey(reference)}T00:00:00`);
  const diffDays = Math.floor((target.getTime() - start.getTime()) / (24 * HOUR_MS));
  return diffDays >= 0 && diffDays < days;
}

export function getRelativeDayLabel(dateKey?: string | null, reference: Date = new Date()): string {
  if (!dateKey) return "Unscheduled";

  const target = new Date(`${dateKey}T00:00:00`);
  const start = new Date(`${formatDateKey(reference)}T00:00:00`);
  const diffDays = Math.floor((target.getTime() - start.getTime()) / (24 * HOUR_MS));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";

  return target.toLocaleDateString("en-ZA", {
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
