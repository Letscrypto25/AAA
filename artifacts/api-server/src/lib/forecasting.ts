import {
  db,
  racesTable,
  horsesTable,
  predictionsTable,
  predictionWeightsTable,
  forecastSnapshotsTable,
  forecastEntriesTable,
  raceResultsTable,
  learningFeedbackTable,
  type LearningFactorAdjustments,
  type LearningSummarySnapshot,
  type PredictionFactorBreakdown,
  type PredictionWeightConfig,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { analyzeRaceWithAI, type HorsePrediction } from "./groq";
import { logger } from "./logger";
import { getMinutesToRace, getRaceTimeProfile } from "./race-time";

const FACTOR_KEYS = [
  "courseForm",
  "formDistance",
  "jockeyTrainer",
  "oddsMovement",
  "history",
] as const;

type FactorKey = (typeof FACTOR_KEYS)[number];

const DEFAULT_WEIGHTS: PredictionWeightConfig = {
  courseForm: 0.25,
  formDistance: 0.25,
  jockeyTrainer: 0.2,
  oddsMovement: 0.15,
  history: 0.15,
};

const DEFAULT_FACTOR_ADJUSTMENTS: LearningFactorAdjustments = {
  courseForm: 0,
  formDistance: 0,
  jockeyTrainer: 0,
  oddsMovement: 0,
  history: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits: number = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeWeights(weights: PredictionWeightConfig): PredictionWeightConfig {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };

  return {
    courseForm: round(weights.courseForm / total),
    formDistance: round(weights.formDistance / total),
    jockeyTrainer: round(weights.jockeyTrainer / total),
    oddsMovement: round(weights.oddsMovement / total),
    history: round(weights.history / total),
  };
}

function normalizeWeightSum(weights: PredictionWeightConfig): PredictionWeightConfig {
  const normalized = normalizeWeights(weights);
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  const drift = round(1 - total, 6);
  if (Math.abs(drift) < 0.000001) return normalized;

  return {
    ...normalized,
    history: round(normalized.history + drift, 6),
  };
}

function buildLearningSnapshot(row?: typeof learningFeedbackTable.$inferSelect): LearningSummarySnapshot {
  return {
    sampleSize: row?.sampleSize ?? 0,
    topPickWinRate: row?.topPickWinRate ?? 0,
    placedRate: row?.placedRate ?? 0,
    averageConfidence: row?.averageConfidence ?? 0,
    confidenceBias: row?.confidenceBias ?? 0,
    factorAdjustments: row?.factorAdjustments ?? { ...DEFAULT_FACTOR_ADJUSTMENTS },
  };
}

async function ensureWeights(): Promise<typeof predictionWeightsTable.$inferSelect> {
  let [weights] = await db.select().from(predictionWeightsTable).limit(1);
  if (!weights) {
    [weights] = await db.insert(predictionWeightsTable).values(DEFAULT_WEIGHTS).returning();
  }
  return weights;
}

async function ensureLearningFeedback(): Promise<typeof learningFeedbackTable.$inferSelect> {
  let [learning] = await db.select().from(learningFeedbackTable).limit(1);
  if (!learning) {
    [learning] = await db
      .insert(learningFeedbackTable)
      .values({
        scope: "global",
        factorAdjustments: { ...DEFAULT_FACTOR_ADJUSTMENTS },
      })
      .returning();
  }
  return learning;
}

function buildAdaptiveWeights(
  baseWeights: PredictionWeightConfig,
  factorAdjustments: LearningFactorAdjustments,
): PredictionWeightConfig {
  const adjusted: PredictionWeightConfig = {
    courseForm: baseWeights.courseForm + factorAdjustments.courseForm * 0.18,
    formDistance: baseWeights.formDistance + factorAdjustments.formDistance * 0.18,
    jockeyTrainer: baseWeights.jockeyTrainer + factorAdjustments.jockeyTrainer * 0.18,
    oddsMovement: baseWeights.oddsMovement + factorAdjustments.oddsMovement * 0.18,
    history: baseWeights.history + factorAdjustments.history * 0.18,
  };

  return normalizeWeightSum({
    courseForm: clamp(adjusted.courseForm, 0.05, 0.55),
    formDistance: clamp(adjusted.formDistance, 0.05, 0.55),
    jockeyTrainer: clamp(adjusted.jockeyTrainer, 0.05, 0.45),
    oddsMovement: clamp(adjusted.oddsMovement, 0.05, 0.4),
    history: clamp(adjusted.history, 0.05, 0.4),
  });
}

function buildFallbackPredictions(
  horses: Array<typeof horsesTable.$inferSelect>,
  weights: PredictionWeightConfig,
): HorsePrediction[] {
  const activeHorses = horses
    .map((horse, index) => ({ horse, index }))
    .filter(({ horse }) => !horse.scratched);
  const maxOdds = Math.max(...activeHorses.map(({ horse }) => horse.currentOdds), 1);

  return activeHorses.map(({ horse, index }) => {
    const formValues = horse.form
      .split("-")
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const formScore = formValues.length > 0
      ? clamp(
          formValues.reduce((sum, value) => sum + Math.max(0, 6 - value), 0) / (formValues.length * 5),
          0,
          1,
        )
      : 0.45;
    const courseScore = horse.courseRecord ? 0.85 : 0.45;
    const distanceScore = horse.distanceRecord ? 0.82 : formScore;
    const jockeyTrainerScore = horse.trainerJockeyRecord ? 0.68 : 0.52;
    const oddsMovementScore =
      horse.oddsMovement === "shortening"
        ? 0.8
        : horse.oddsMovement === "drifting"
          ? 0.38
          : 0.56;
    const historyScore = clamp(1 - horse.currentOdds / (maxOdds + 2), 0.18, 0.86);
    const overall = clamp(
      courseScore * weights.courseForm +
        Math.max(formScore, distanceScore) * weights.formDistance +
        jockeyTrainerScore * weights.jockeyTrainer +
        oddsMovementScore * weights.oddsMovement +
        historyScore * weights.history,
      0.08,
      0.99,
    );

    return {
      horseIndex: index,
      score: round(overall),
      confidence: round(clamp(overall * 0.78 + 0.12, 0.28, 0.82)),
      factors: {
        courseForm: round(courseScore),
        formDistance: round(Math.max(formScore, distanceScore)),
        jockeyTrainer: round(jockeyTrainerScore),
        oddsMovement: round(oddsMovementScore),
        history: round(historyScore),
        overall: round(overall),
      },
      aiSummary: "Fallback scoring blended form, market movement, and course suitability.",
    };
  });
}

function getFactorSignal(
  factors: PredictionFactorBreakdown,
  adjustments: LearningFactorAdjustments,
): number {
  return FACTOR_KEYS.reduce((sum, key) => sum + adjustments[key] * ((factors[key] ?? 0.5) - 0.5), 0);
}

function decoratePredictions(
  rawPredictions: HorsePrediction[],
  learningSnapshot: LearningSummarySnapshot,
  raceTime: string,
  meetingDate?: string | null,
): Array<{
  horseIndex: number;
  score: number;
  baseConfidence: number;
  confidence: number;
  confidenceDelta: number;
  confidenceBand: string;
  timeToRaceMinutes: number | null;
  factors: PredictionFactorBreakdown;
  aiSummary: string;
}> {
  const timeProfile = getRaceTimeProfile(raceTime, meetingDate);
  const timeToRaceMinutes = getMinutesToRace(raceTime, meetingDate);

  return rawPredictions.map((prediction) => {
    const factors = prediction.factors as PredictionFactorBreakdown;
    const factorSignal = getFactorSignal(factors, learningSnapshot.factorAdjustments);
    const adjustedScore = clamp(prediction.score + factorSignal * 0.16, 0.04, 0.99);
    const baseConfidence = clamp(prediction.confidence, 0.05, 0.99);
    const adjustedConfidence = clamp(
      baseConfidence * timeProfile.confidenceFactor + learningSnapshot.confidenceBias * 0.25 + factorSignal * 0.18,
      0.06,
      0.99,
    );

    return {
      horseIndex: prediction.horseIndex,
      score: round(adjustedScore),
      baseConfidence: round(baseConfidence),
      confidence: round(adjustedConfidence),
      confidenceDelta: round(adjustedConfidence - baseConfidence),
      confidenceBand: timeProfile.band,
      timeToRaceMinutes,
      factors: {
        ...factors,
        overall: round(adjustedScore),
      },
      aiSummary: prediction.aiSummary,
    };
  });
}

export async function runRaceForecast(
  raceId: number,
  source: "manual" | "scheduler" | "sync" = "manual",
): Promise<{
  raceId: number;
  analyzedAt: string;
  nextUpdateAt: string;
}> {
  const [race] = await db.select().from(racesTable).where(eq(racesTable.id, raceId)).limit(1);
  if (!race) throw new Error("Race not found");

  const existingResult = await db.select().from(raceResultsTable).where(eq(raceResultsTable.raceId, raceId)).limit(1);
  if (existingResult.length > 0 || race.status === "completed" || race.status === "cancelled") {
    throw new Error("Race already graded or closed");
  }

  const horses = await db
    .select()
    .from(horsesTable)
    .where(eq(horsesTable.raceId, raceId))
    .orderBy(horsesTable.number);

  if (horses.length === 0) throw new Error("No horses in this race");

  const baseWeights = await ensureWeights();
  const learning = await ensureLearningFeedback();
  const learningSnapshot = buildLearningSnapshot(learning);
  const adaptiveWeights = buildAdaptiveWeights(
    {
      courseForm: baseWeights.courseForm,
      formDistance: baseWeights.formDistance,
      jockeyTrainer: baseWeights.jockeyTrainer,
      oddsMovement: baseWeights.oddsMovement,
      history: baseWeights.history,
    },
    learningSnapshot.factorAdjustments,
  );

  let rawPredictions: HorsePrediction[];
  try {
    rawPredictions = await analyzeRaceWithAI(
      {
        name: race.name,
        venue: race.venue,
        distance: race.distance,
        surface: race.surface,
        grade: race.grade,
        raceTime: race.raceTime,
        meetingDate: race.meetingDate,
      },
      horses.map((horse) => ({
        name: horse.name,
        number: horse.number,
        jockey: horse.jockey,
        trainer: horse.trainer,
        form: horse.form,
        currentOdds: horse.currentOdds,
        openingOdds: horse.openingOdds,
        oddsMovement: horse.oddsMovement,
        courseRecord: horse.courseRecord,
        distanceRecord: horse.distanceRecord,
        trainerJockeyRecord: horse.trainerJockeyRecord,
        notes: horse.notes,
        weight: horse.weight,
        scratched: horse.scratched,
      })),
      adaptiveWeights,
    );
  } catch (err) {
    logger.warn({ err, raceId }, "AI race analysis failed, using fallback model");
    rawPredictions = buildFallbackPredictions(horses, adaptiveWeights);
  }

  const decorated = decoratePredictions(rawPredictions, learningSnapshot, race.raceTime, race.meetingDate);
  if (decorated.length === 0) throw new Error("No active horses available for forecast");
  const sorted = [...decorated].sort((left, right) => right.score - left.score || right.confidence - left.confidence);
  const ranked = sorted.map((prediction, index) => ({
    ...prediction,
    rank: index + 1,
  }));

  const timeProfile = getRaceTimeProfile(race.raceTime, race.meetingDate);
  const nextUpdateAt = new Date(Date.now() + timeProfile.nextUpdateDelayMs);
  const topPick = ranked[0];

  const [snapshot] = await db
    .insert(forecastSnapshotsTable)
    .values({
      raceId,
      source,
      timeToRaceMinutes: topPick?.timeToRaceMinutes ?? null,
      confidenceBand: timeProfile.band,
      timeConfidenceFactor: timeProfile.confidenceFactor,
      confidenceBiasApplied: learningSnapshot.confidenceBias,
      appliedWeights: adaptiveWeights,
      learningSnapshot,
      topPickHorseId: topPick ? horses[topPick.horseIndex]?.id ?? null : null,
      topPickConfidence: topPick?.confidence ?? null,
    })
    .returning();

  await db.delete(predictionsTable).where(eq(predictionsTable.raceId, raceId));

  const currentPredictionRows = ranked.map((prediction) => ({
    raceId,
    horseId: horses[prediction.horseIndex].id,
    snapshotId: snapshot.id,
    rank: prediction.rank,
    score: prediction.score,
    baseConfidence: prediction.baseConfidence,
    confidence: prediction.confidence,
    confidenceDelta: prediction.confidenceDelta,
    confidenceBand: prediction.confidenceBand,
    timeToRaceMinutes: prediction.timeToRaceMinutes,
    resultStatus: "pending",
    finishPosition: null,
    gradedAt: null,
    factors: prediction.factors,
    aiSummary: prediction.aiSummary,
  }));

  await db.insert(predictionsTable).values(currentPredictionRows);
  await db.insert(forecastEntriesTable).values(currentPredictionRows);

  await db
    .update(racesTable)
    .set({
      status: "analyzing",
      lastAnalyzedAt: new Date(),
      nextUpdateAt,
    })
    .where(eq(racesTable.id, raceId));

  return {
    raceId,
    analyzedAt: new Date().toISOString(),
    nextUpdateAt: nextUpdateAt.toISOString(),
  };
}

type RaceResultInput = {
  winnerHorseId: number;
  runnerUpHorseId?: number | null;
  thirdHorseId?: number | null;
  notes?: string | null;
};

function getResultStatus(horseId: number, finishMap: Map<number, number>): { status: string; finishPosition: number | null } {
  const finishPosition = finishMap.get(horseId) ?? null;
  if (finishPosition === 1) return { status: "winner", finishPosition };
  if (finishPosition === 2 || finishPosition === 3) return { status: "placed", finishPosition };
  return { status: "unplaced", finishPosition: finishPosition ?? null };
}

function roundMovingAverage(previous: number, sampleSize: number, nextValue: number): number {
  return round((previous * sampleSize + nextValue) / (sampleSize + 1));
}

export async function recordRaceResult(
  raceId: number,
  input: RaceResultInput,
): Promise<{ winnerHorseId: number; topPickCorrect: boolean }> {
  const [race] = await db.select().from(racesTable).where(eq(racesTable.id, raceId)).limit(1);
  if (!race) throw new Error("Race not found");

  const existingResult = await db.select().from(raceResultsTable).where(eq(raceResultsTable.raceId, raceId)).limit(1);
  if (existingResult.length > 0) throw new Error("Result already recorded");

  const horses = await db.select().from(horsesTable).where(eq(horsesTable.raceId, raceId));
  const horseIds = new Set(horses.map((horse) => horse.id));

  if (!horseIds.has(input.winnerHorseId)) throw new Error("Winner does not belong to this race");
  if (input.runnerUpHorseId && !horseIds.has(input.runnerUpHorseId)) throw new Error("Runner-up does not belong to this race");
  if (input.thirdHorseId && !horseIds.has(input.thirdHorseId)) throw new Error("Third place horse does not belong to this race");

  const now = new Date();
  const finishMap = new Map<number, number>([[input.winnerHorseId, 1]]);
  if (input.runnerUpHorseId) finishMap.set(input.runnerUpHorseId, 2);
  if (input.thirdHorseId) finishMap.set(input.thirdHorseId, 3);

  await db.insert(raceResultsTable).values({
    raceId,
    winnerHorseId: input.winnerHorseId,
    runnerUpHorseId: input.runnerUpHorseId ?? null,
    thirdHorseId: input.thirdHorseId ?? null,
    notes: input.notes ?? null,
    officialAt: now,
  });

  const currentPredictions = await db
    .select()
    .from(predictionsTable)
    .where(eq(predictionsTable.raceId, raceId))
    .orderBy(predictionsTable.rank);

  const [latestSnapshot] = await db
    .select()
    .from(forecastSnapshotsTable)
    .where(eq(forecastSnapshotsTable.raceId, raceId))
    .orderBy(desc(forecastSnapshotsTable.createdAt))
    .limit(1);

  const snapshotEntries = latestSnapshot
    ? await db
        .select()
        .from(forecastEntriesTable)
        .where(eq(forecastEntriesTable.snapshotId, latestSnapshot.id))
        .orderBy(forecastEntriesTable.rank)
    : [];

  for (const prediction of currentPredictions) {
    const graded = getResultStatus(prediction.horseId, finishMap);
    await db
      .update(predictionsTable)
      .set({
        resultStatus: graded.status,
        finishPosition: graded.finishPosition,
        gradedAt: now,
      })
      .where(eq(predictionsTable.id, prediction.id));
  }

  for (const entry of snapshotEntries) {
    const graded = getResultStatus(entry.horseId, finishMap);
    await db
      .update(forecastEntriesTable)
      .set({
        resultStatus: graded.status,
        finishPosition: graded.finishPosition,
        gradedAt: now,
      })
      .where(eq(forecastEntriesTable.id, entry.id));
  }

  await db
    .update(racesTable)
    .set({
      status: "completed",
      resultRecordedAt: now,
      nextUpdateAt: null,
    })
    .where(eq(racesTable.id, raceId));

  const learning = await ensureLearningFeedback();
  const learningSnapshot = buildLearningSnapshot(learning);
  const sampleSize = learning.sampleSize;
  const topPick = snapshotEntries.find((entry) => entry.rank === 1) ?? currentPredictions.find((entry) => entry.rank === 1);
  const topPickCorrect = topPick?.horseId === input.winnerHorseId;
  const topPickPlaced = topPick ? (finishMap.get(topPick.horseId) ?? 99) <= 3 : false;
  const topPickConfidence = topPick?.confidence ?? 0.5;
  const winnerEntry = snapshotEntries.find((entry) => entry.horseId === input.winnerHorseId);

  const nextAdjustments: LearningFactorAdjustments = { ...learningSnapshot.factorAdjustments };
  if (winnerEntry) {
    const averages = FACTOR_KEYS.reduce<Record<FactorKey, number>>((acc, key) => {
      const total = snapshotEntries.reduce((sum, entry) => sum + ((entry.factors as PredictionFactorBreakdown)[key] ?? 0.5), 0);
      acc[key] = snapshotEntries.length > 0 ? total / snapshotEntries.length : 0.5;
      return acc;
    }, {
      courseForm: 0.5,
      formDistance: 0.5,
      jockeyTrainer: 0.5,
      oddsMovement: 0.5,
      history: 0.5,
    });

    for (const key of FACTOR_KEYS) {
      const winnerValue = (winnerEntry.factors as PredictionFactorBreakdown)[key] ?? 0.5;
      const baselineValue = topPickCorrect
        ? averages[key]
        : (topPick?.factors as PredictionFactorBreakdown | undefined)?.[key] ?? averages[key];
      const signal = clamp(winnerValue - baselineValue, -1, 1) * 0.08;
      nextAdjustments[key] = round(clamp(roundMovingAverage(learningSnapshot.factorAdjustments[key], sampleSize, signal), -0.18, 0.18));
    }
  }

  await db
    .update(learningFeedbackTable)
    .set({
      sampleSize: sampleSize + 1,
      topPickWinRate: roundMovingAverage(learning.topPickWinRate, sampleSize, topPickCorrect ? 1 : 0),
      placedRate: roundMovingAverage(learning.placedRate, sampleSize, topPickPlaced ? 1 : 0),
      averageConfidence: roundMovingAverage(learning.averageConfidence, sampleSize, topPickConfidence),
      confidenceBias: roundMovingAverage(learning.confidenceBias, sampleSize, (topPickCorrect ? 1 : 0) - topPickConfidence),
      factorAdjustments: nextAdjustments,
      lastResultRaceId: raceId,
      updatedAt: now,
    })
    .where(eq(learningFeedbackTable.id, learning.id));

  return { winnerHorseId: input.winnerHorseId, topPickCorrect };
}
