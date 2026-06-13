import { db, chatMessagesTable, racesTable } from "@workspace/db";
import { and, eq, like } from "drizzle-orm";
import { buildRaceForecastCards } from "./race-insights";
import { CAT_TIME_ZONE, getTodayDateKey } from "./race-time";
import { logger } from "./logger";

type ForecastCard = Awaited<ReturnType<typeof buildRaceForecastCards>>[number];

const DAILY_BRIEFING_HOUR = 10;
const DAILY_BRIEFING_MINUTE = 30;

let lastDailyChatBriefingDate: string | null = null;

function getCatClockParts(reference: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CAT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(reference);

  return {
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0),
  };
}

function isDailyBriefingDue(reference: Date): boolean {
  const { hour, minute } = getCatClockParts(reference);
  if (hour > DAILY_BRIEFING_HOUR) return true;
  return hour === DAILY_BRIEFING_HOUR && minute >= DAILY_BRIEFING_MINUTE;
}

function sortCardsByRaceOrder(cards: ForecastCard[]): ForecastCard[] {
  return [...cards].sort((left, right) => {
    return (left.meetingDate ?? "").localeCompare(right.meetingDate ?? "")
      || left.raceTime.localeCompare(right.raceTime)
      || left.venue.localeCompare(right.venue)
      || left.raceNumber - right.raceNumber;
  });
}

function formatPercent(value?: number | null): string {
  return value == null ? "n/a" : `${Math.round(value * 100)}%`;
}

function formatPredictionPick(prediction: ForecastCard["topPredictions"][number]): string {
  const runnerLabel = prediction.runnerNumber == null ? "" : `#${prediction.runnerNumber} `;
  return `${runnerLabel}${prediction.horseName} ${formatPercent(prediction.confidence)}`;
}

function formatTopThree(card: ForecastCard): string {
  const topThree = card.topPredictions.slice(0, 3);
  if (topThree.length === 0) return "forecast pending";
  return topThree.map(formatPredictionPick).join(", ");
}

function formatJackpotLine(label: string, legs: ForecastCard[]): string {
  if (legs.length < 4) return `${label}: not enough loaded races yet.`;
  return `${label}: ${legs.map((card) => `R${card.raceNumber}`).join(" / ")}`;
}

async function buildDailyTopThreeChatBriefing(todayDateKey: string): Promise<string | null> {
  const allRaces = await db.select().from(racesTable).orderBy(racesTable.meetingDate, racesTable.raceTime);
  const cards = await buildRaceForecastCards(allRaces);
  const todayCards = sortCardsByRaceOrder(
    cards.filter((card) => card.isToday && (card.horseCount > 0 || card.topPredictions.length > 0 || !!card.result)),
  );

  if (todayCards.length === 0) return null;

  const forecastedCount = todayCards.filter((card) => card.topPredictions.length > 0).length;
  const marker = `Daily 10:30 top-three briefing for ${todayDateKey}`;
  const lines = [
    marker,
    `Today's current top-three forecasts (${todayCards.length} races loaded, ${forecastedCount} with predictions):`,
  ];

  for (const card of todayCards) {
    lines.push(
      `- Race ${card.raceNumber} ${card.name} | ${card.venue} ${card.raceTime} | status ${card.status} | top 3 ${formatTopThree(card)}`,
    );
  }

  lines.push("");
  lines.push(formatJackpotLine("Jackpot 1", todayCards.slice(0, 4)));
  lines.push(formatJackpotLine("Jackpot 2", todayCards.slice(4, 8)));

  return lines.join("\n");
}

export async function maybePostDailyTopThreeChatBriefing(reference: Date = new Date()): Promise<{ posted: boolean; reason: string }> {
  const todayDateKey = getTodayDateKey(reference);

  if (!isDailyBriefingDue(reference)) {
    return { posted: false, reason: "before_1030_cat" };
  }

  if (lastDailyChatBriefingDate === todayDateKey) {
    return { posted: false, reason: "already_posted_in_process" };
  }

  const marker = `Daily 10:30 top-three briefing for ${todayDateKey}`;
  const existing = await db
    .select({ id: chatMessagesTable.id })
    .from(chatMessagesTable)
    .where(and(eq(chatMessagesTable.role, "assistant"), like(chatMessagesTable.content, `%${marker}%`)))
    .limit(1);

  if (existing.length > 0) {
    lastDailyChatBriefingDate = todayDateKey;
    return { posted: false, reason: "already_posted_in_db" };
  }

  const content = await buildDailyTopThreeChatBriefing(todayDateKey);
  if (!content) {
    return { posted: false, reason: "no_today_races_loaded" };
  }

  await db.insert(chatMessagesTable).values({
    role: "assistant",
    content,
  });

  lastDailyChatBriefingDate = todayDateKey;
  logger.info({ todayDateKey }, "Daily top-three chat briefing posted");
  return { posted: true, reason: "posted" };
}
