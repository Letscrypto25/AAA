import { Router } from "express";
import { db, racesTable, horsesTable } from "@workspace/db";
import { buildRaceForecastCards, buildWeeklyOverview, getLearningPerformanceSummary } from "../lib/race-insights";

const router = Router();

router.get("/dashboard/summary", async (_req, res) => {
  const races = await db.select().from(racesTable).orderBy(racesTable.meetingDate, racesTable.raceTime);
  const horses = await db.select().from(horsesTable);
  const cards = await buildRaceForecastCards(races);
  const performance = await getLearningPerformanceSummary();

  const todayCards = cards
    .filter((card) => card.isToday)
    .sort((left, right) => {
      const leftMinutes = left.minutesToRace ?? Number.MAX_SAFE_INTEGER;
      const rightMinutes = right.minutesToRace ?? Number.MAX_SAFE_INTEGER;
      return leftMinutes - rightMinutes || right.prominence - left.prominence;
    });

  const weeklyCards = cards.filter((card) => card.isThisWeek);
  const upcoming = cards.filter((card) => card.status === "upcoming" || card.status === "analyzing");
  const analyzed = cards.filter((card) => !!card.topPrediction);
  const completed = cards.filter((card) => card.status === "completed");

  const featuredCard = [...todayCards, ...upcoming]
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
    nextRaceTime: todayCards[0]?.raceTime ?? upcoming[0]?.raceTime ?? null,
    nextRaceVenue: todayCards[0]?.venue ?? upcoming[0]?.venue ?? null,
    topPick: featuredCard?.topPrediction?.horseName ?? null,
    topPickRace: featuredCard?.name ?? null,
    venues: [...new Set(cards.map((card) => card.venue))],
    todayCards: todayCards.slice(0, 6),
    weeklyOverview: buildWeeklyOverview(cards),
    performance,
  });
});

export default router;
