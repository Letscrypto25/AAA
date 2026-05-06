import { Router } from "express";
import { db, racesTable, horsesTable, predictionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/dashboard/summary", async (_req, res) => {
  const races = await db.select().from(racesTable).orderBy(racesTable.raceTime);
  const allHorses = await db.select().from(horsesTable);

  const totalRaces = races.length;
  const analyzedRaces = races.filter((r) => r.status === "analyzing" || r.lastAnalyzedAt).length;
  const upcomingRaces = races.filter((r) => r.status === "upcoming").length;
  const totalHorses = allHorses.length;

  const upcoming = races.find((r) => r.status === "upcoming" || r.status === "analyzing");
  const nextRaceTime = upcoming?.raceTime ?? null;
  const nextRaceVenue = upcoming?.venue ?? null;

  const venues = [...new Set(races.map((r) => r.venue))];

  let topPick: string | null = null;
  let topPickRace: string | null = null;

  const analyzedRace = races.find((r) => r.lastAnalyzedAt);
  if (analyzedRace) {
    const topPred = await db
      .select()
      .from(predictionsTable)
      .where(eq(predictionsTable.raceId, analyzedRace.id))
      .orderBy(predictionsTable.rank)
      .limit(1);

    if (topPred[0]) {
      const horse = allHorses.find((h) => h.id === topPred[0].horseId);
      topPick = horse?.name ?? null;
      topPickRace = analyzedRace.name;
    }
  }

  res.json({
    totalRaces,
    analyzedRaces,
    upcomingRaces,
    totalHorses,
    nextRaceTime,
    nextRaceVenue,
    topPick,
    topPickRace,
    venues,
  });
});

export default router;
