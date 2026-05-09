import { Router } from "express";
import { db, racesTable, horsesTable, predictionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  AddHorseBody,
  AddHorseParams,
  AnalyzeRaceParams,
  CreateRaceBody,
  GetRaceHorsesParams,
  GetRaceParams,
  GetRacesQueryParams,
  RecordRaceResultBody,
} from "@workspace/api-zod";
import { getNextUpdateTime } from "../lib/scheduler";
import { runRaceForecast, recordRaceResult } from "../lib/forecasting";
import { buildRaceForecastCards } from "../lib/race-insights";

const router = Router();

async function loadRacePredictions(raceId: number) {
  const horses = await db.select().from(horsesTable).where(eq(horsesTable.raceId, raceId));
  const predictions = await db
    .select()
    .from(predictionsTable)
    .where(eq(predictionsTable.raceId, raceId))
    .orderBy(predictionsTable.rank);

  const horseNameById = new Map(horses.map((horse) => [horse.id, horse.name]));

  return predictions.map((prediction) => ({
    ...prediction,
    horseName: horseNameById.get(prediction.horseId) ?? "",
    factors: prediction.factors,
    createdAt: prediction.createdAt.toISOString(),
    gradedAt: prediction.gradedAt?.toISOString() ?? null,
  }));
}

router.get("/races", async (req, res): Promise<void> => {
  const query = GetRacesQueryParams.safeParse(req.query);
  const filters = query.success ? query.data : {};

  let rows = await db.select().from(racesTable).orderBy(racesTable.meetingDate, racesTable.raceTime);

  if (filters.venue) {
    rows = rows.filter((race) => race.venue.toLowerCase().includes(filters.venue!.toLowerCase()));
  }
  if (filters.status) {
    rows = rows.filter((race) => race.status === filters.status);
  }

  const cards = await buildRaceForecastCards(rows);
  res.json(cards);
});

router.post("/races", async (req, res): Promise<void> => {
  const body = CreateRaceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const meetingDate =
    typeof body.data.meetingDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.data.meetingDate)
      ? body.data.meetingDate
      : null;

  const [race] = await db
    .insert(racesTable)
    .values({
      raceNumber: body.data.raceNumber,
      name: body.data.name,
      venue: body.data.venue,
      distance: body.data.distance,
      raceTime: body.data.raceTime,
      surface: body.data.surface,
      grade: body.data.grade ?? null,
      prize: body.data.prize ?? null,
      meetingDate,
      status: "upcoming",
      nextUpdateAt: getNextUpdateTime(body.data.raceTime, meetingDate),
    })
    .returning();

  const [card] = await buildRaceForecastCards([race]);
  res.status(201).json(card);
});

router.get("/races/:raceId", async (req, res): Promise<void> => {
  const params = GetRaceParams.safeParse({ raceId: Number(req.params.raceId) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid raceId" });
    return;
  }

  const [race] = await db.select().from(racesTable).where(eq(racesTable.id, params.data.raceId)).limit(1);
  if (!race) {
    res.status(404).json({ error: "Race not found" });
    return;
  }

  const horses = await db
    .select()
    .from(horsesTable)
    .where(eq(horsesTable.raceId, race.id))
    .orderBy(horsesTable.number);
  const predictions = await loadRacePredictions(race.id);
  const [card] = await buildRaceForecastCards([race]);

  res.json({
    ...card,
    horses: horses.map((horse) => ({ ...horse, createdAt: horse.createdAt.toISOString() })),
    predictions,
  });
});

router.get("/races/:raceId/predictions", async (req, res): Promise<void> => {
  const params = GetRaceParams.safeParse({ raceId: Number(req.params.raceId) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid raceId" });
    return;
  }

  const [race] = await db.select().from(racesTable).where(eq(racesTable.id, params.data.raceId)).limit(1);
  if (!race) {
    res.status(404).json({ error: "Race not found" });
    return;
  }

  const predictions = await loadRacePredictions(race.id);
  res.json(predictions);
});

router.get("/races/:raceId/horses", async (req, res): Promise<void> => {
  const params = GetRaceHorsesParams.safeParse({ raceId: Number(req.params.raceId) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid raceId" });
    return;
  }

  const horses = await db
    .select()
    .from(horsesTable)
    .where(eq(horsesTable.raceId, params.data.raceId))
    .orderBy(horsesTable.number);

  res.json(horses.map((horse) => ({ ...horse, createdAt: horse.createdAt.toISOString() })));
});

router.post("/races/:raceId/horses", async (req, res): Promise<void> => {
  const params = AddHorseParams.safeParse({ raceId: Number(req.params.raceId) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid raceId" });
    return;
  }

  const body = AddHorseBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [race] = await db.select().from(racesTable).where(eq(racesTable.id, params.data.raceId)).limit(1);
  if (!race) {
    res.status(404).json({ error: "Race not found" });
    return;
  }

  const openingOdds = body.data.openingOdds ?? null;
  const currentOdds = body.data.currentOdds;
  let oddsMovement = "unknown";
  if (openingOdds !== null) {
    if (currentOdds < openingOdds) oddsMovement = "shortening";
    else if (currentOdds > openingOdds) oddsMovement = "drifting";
    else oddsMovement = "stable";
  }

  const [horse] = await db
    .insert(horsesTable)
    .values({
      raceId: params.data.raceId,
      name: body.data.name,
      number: body.data.number,
      jockey: body.data.jockey,
      trainer: body.data.trainer,
      form: body.data.form ?? "",
      weight: body.data.weight ?? null,
      currentOdds,
      openingOdds,
      oddsMovement,
      courseRecord: body.data.courseRecord ?? false,
      distanceRecord: body.data.distanceRecord ?? false,
      trainerJockeyRecord: body.data.trainerJockeyRecord ?? "",
      notes: body.data.notes ?? null,
    })
    .returning();

  res.status(201).json({ ...horse, createdAt: horse.createdAt.toISOString() });
});

router.post("/races/:raceId/analyze", async (req, res): Promise<void> => {
  const params = AnalyzeRaceParams.safeParse({ raceId: Number(req.params.raceId) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid raceId" });
    return;
  }

  try {
    const result = await runRaceForecast(params.data.raceId, "manual");
    const predictions = await loadRacePredictions(params.data.raceId);

    res.json({
      raceId: params.data.raceId,
      predictions,
      analyzedAt: result.analyzedAt,
      nextUpdateAt: result.nextUpdateAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Race analysis failed";
    const status = message === "Race not found" ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

router.post("/races/:raceId/result", async (req, res): Promise<void> => {
  const params = GetRaceParams.safeParse({ raceId: Number(req.params.raceId) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid raceId" });
    return;
  }

  const body = RecordRaceResultBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    await recordRaceResult(params.data.raceId, {
      winnerHorseId: body.data.winnerHorseId,
      runnerUpHorseId: body.data.runnerUpHorseId ?? null,
      thirdHorseId: body.data.thirdHorseId ?? null,
      notes: body.data.notes ?? null,
    });
    const [race] = await db.select().from(racesTable).where(eq(racesTable.id, params.data.raceId)).limit(1);
    if (!race) {
      res.status(404).json({ error: "Race not found" });
      return;
    }

    const [card] = await buildRaceForecastCards([race]);
    res.status(201).json(card.result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Result recording failed";
    const status = message === "Race not found" ? 404 : message === "Result already recorded" ? 409 : 400;
    res.status(status).json({ error: message });
  }
});

export default router;
