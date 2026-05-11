import { Router } from "express";
import { db, racesTable, horsesTable } from "@workspace/db";
import {
  buildRaceForecastCards,
  buildWeeklyOverview,
  getLearningPerformanceSummary,
  isRaceHistoryCard,
  isRaceLiveCard,
  sortRaceCardsByLivePriority,
} from "../lib/race-insights";

const router = Router();

router.get("/dashboard/summary", async (_req, res) => {
  const races = await db.select().from(racesTable).orderBy(racesTable.meetingDate, racesTable.raceTime);
  const horses = await db.select().from(horsesTable);
  const cards = await buildRaceForecastCards(races);
  const performance = await getLearningPerformanceSummary();

  const liveCards = sortRaceCardsByLivePriority(cards.filter(isRaceLiveCard));
  const historyCards = cards.filter(isRaceHistoryCard);
  const todayCards = liveCards.filter((card) => card.isToday);

  const weeklyCards = cards.filter((card) => card.isThisWeek);
  const upcoming = liveCards.filter((card) => card.status === "upcoming" || card.status === "analyzing");
  const analyzed = cards.filter((card) => !!card.topPrediction);
  const completed = historyCards.filter((card) => card.status === "completed");

  const featuredCard = [...todayCards, ...liveCards]
    .filter((card) => card.topPrediction)
    .sort((left, right) => {
      const leftScore = (left.isToday ? 1 : 0) * 2 + (left.topPrediction?.confidence ?? 0) + left.prominence;
      const rightScore = (right.isToday ? 1 : 0) * 2 + (right.topPrediction?.confidence ?? 0) + right.prominence;
      return rightScore - leftScore;
    })[0];

  res.json({
    totalRaces: cards.length,
    analyzedRaces: analyzed.length,
    upcomingRaces: upcoming.length,
    completedRaces: completed.length,
    totalHorses: horses.length,
    todayRaceCount: todayCards.length,
    weekRaceCount: weeklyCards.length,
    nextRaceTime: todayCards[0]?.raceTime ?? liveCards[0]?.raceTime ?? null,
    nextRaceVenue: todayCards[0]?.venue ?? liveCards[0]?.venue ?? null,
    topPick: featuredCard?.topPrediction?.horseName ?? null,
    topPickRace: featuredCard?.name ?? null,
    venues: [...new Set(cards.map((card) => card.venue))],
    todayCards: todayCards.slice(0, 6),
    weeklyOverview: buildWeeklyOverview(cards),
    performance,
  });
});

export default router;
