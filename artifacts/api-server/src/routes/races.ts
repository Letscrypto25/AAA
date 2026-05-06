import { Router } from "express";
import { db, racesTable, horsesTable, predictionsTable, predictionWeightsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import {
  GetRacesQueryParams,
  CreateRaceBody,
  GetRaceParams,
  GetRaceHorsesParams,
  AddHorseParams,
  AddHorseBody,
  AnalyzeRaceParams,
} from "@workspace/api-zod";
import { analyzeRaceWithAI } from "../lib/groq";
import { getNextUpdateTime } from "../lib/scheduler";

const router = Router();

router.get("/races", async (req, res): Promise<void> => {
  const query = GetRacesQueryParams.safeParse(req.query);
  const filters = query.success ? query.data : {};

  let rows = await db.select().from(racesTable).orderBy(racesTable.raceTime);

  if (filters.venue) {
    rows = rows.filter((r) => r.venue.toLowerCase().includes(filters.venue!.toLowerCase()));
  }
  if (filters.status) {
    rows = rows.filter((r) => r.status === filters.status);
  }

  const horseCounts = await db
    .select({ raceId: horsesTable.raceId, count: count() })
    .from(horsesTable)
    .groupBy(horsesTable.raceId);

  const countMap = new Map(horseCounts.map((h) => [h.raceId, Number(h.count)]));

  const result = rows.map((r) => ({
    ...r,
    horseCount: countMap.get(r.id) ?? 0,
    raceTime: r.raceTime,
    nextUpdateAt: r.nextUpdateAt?.toISOString() ?? null,
    lastAnalyzedAt: r.lastAnalyzedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  res.json(result);
});

router.post("/races", async (req, res): Promise<void> => {
  const body = CreateRaceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

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
      status: "upcoming",
      nextUpdateAt: new Date(),
    })
    .returning();

  res.status(201).json({
    ...race,
    horseCount: 0,
    nextUpdateAt: race.nextUpdateAt?.toISOString() ?? null,
    lastAnalyzedAt: null,
    createdAt: race.createdAt.toISOString(),
  });
});

router.get("/races/:raceId", async (req, res): Promise<void> => {
  const params = GetRaceParams.safeParse({ raceId: Number(req.params.raceId) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid raceId" });
    return;
  }

  const [race] = await db.select().from(racesTable).where(eq(racesTable.id, params.data.raceId));
  if (!race) {
    res.status(404).json({ error: "Race not found" });
    return;
  }

  const horses = await db.select().from(horsesTable).where(eq(horsesTable.raceId, race.id));

  const rawPreds = await db
    .select()
    .from(predictionsTable)
    .where(eq(predictionsTable.raceId, race.id))
    .orderBy(predictionsTable.rank);

  const predictions = rawPreds.map((p) => ({
    ...p,
    horseName: horses.find((h) => h.id === p.horseId)?.name ?? "",
    factors: p.factors as Record<string, number>,
    createdAt: p.createdAt.toISOString(),
  }));

  res.json({
    ...race,
    horses: horses.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })),
    predictions,
    nextUpdateAt: race.nextUpdateAt?.toISOString() ?? null,
    lastAnalyzedAt: race.lastAnalyzedAt?.toISOString() ?? null,
    createdAt: race.createdAt.toISOString(),
  });
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

  res.json(horses.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })));
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

  const [race] = await db.select().from(racesTable).where(eq(racesTable.id, params.data.raceId));
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

  const [race] = await db.select().from(racesTable).where(eq(racesTable.id, params.data.raceId));
  if (!race) {
    res.status(404).json({ error: "Race not found" });
    return;
  }

  const horses = await db.select().from(horsesTable).where(eq(horsesTable.raceId, race.id));
  if (horses.length === 0) {
    res.status(400).json({ error: "No horses in this race" });
    return;
  }

  const [weightsRow] = await db.select().from(predictionWeightsTable).limit(1);
  const weights = weightsRow ?? {
    courseForm: 0.25,
    formDistance: 0.25,
    jockeyTrainer: 0.20,
    oddsMovement: 0.15,
    history: 0.15,
  };

  let aiPredictions;
  try {
    aiPredictions = await analyzeRaceWithAI(
      {
        name: race.name,
        venue: race.venue,
        distance: race.distance,
        surface: race.surface,
        grade: race.grade,
        raceTime: race.raceTime,
      },
      horses.map((h) => ({
        name: h.name,
        number: h.number,
        jockey: h.jockey,
        trainer: h.trainer,
        form: h.form,
        currentOdds: h.currentOdds,
        openingOdds: h.openingOdds,
        oddsMovement: h.oddsMovement,
        courseRecord: h.courseRecord,
        distanceRecord: h.distanceRecord,
        trainerJockeyRecord: h.trainerJockeyRecord,
        notes: h.notes,
        weight: h.weight,
      })),
      weights,
    );
  } catch (err) {
    req.log.warn({ err }, "AI analysis failed, using fallback scoring");
    aiPredictions = horses.map((h, i) => ({
      horseIndex: i,
      score: Math.max(0.1, 1 / (h.currentOdds + 1)),
      confidence: 0.4,
      factors: {
        courseForm: 0.5,
        formDistance: 0.5,
        jockeyTrainer: 0.5,
        oddsMovement: 0.5,
        history: 0.5,
        overall: 0.5,
      },
      aiSummary: "AI analysis unavailable — scored by odds.",
    }));
  }

  await db.delete(predictionsTable).where(eq(predictionsTable.raceId, race.id));

  const sorted = [...aiPredictions].sort((a, b) => b.score - a.score);
  const rankMap = new Map(sorted.map((p, i) => [p.horseIndex, i + 1]));

  const inserted = await db
    .insert(predictionsTable)
    .values(
      aiPredictions.map((p) => ({
        raceId: race.id,
        horseId: horses[p.horseIndex].id,
        rank: rankMap.get(p.horseIndex) ?? 99,
        score: p.score,
        confidence: p.confidence,
        factors: p.factors,
        aiSummary: p.aiSummary,
      })),
    )
    .returning();

  const nextUpdateAt = getNextUpdateTime(race.raceTime);

  await db
    .update(racesTable)
    .set({ status: "analyzing", lastAnalyzedAt: new Date(), nextUpdateAt })
    .where(eq(racesTable.id, race.id));

  const predictions = inserted
    .map((p) => ({
      ...p,
      horseName: horses.find((h) => h.id === p.horseId)?.name ?? "",
      factors: p.factors as Record<string, number>,
      createdAt: p.createdAt.toISOString(),
    }))
    .sort((a, b) => a.rank - b.rank);

  res.json({
    raceId: race.id,
    predictions,
    analyzedAt: new Date().toISOString(),
    nextUpdateAt: nextUpdateAt.toISOString(),
  });
});

export default router;
