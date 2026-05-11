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

function learningScale(sampleSize: number, saturation: number = 36): number {
  return clamp(sampleSize / saturation, 0, 1);
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
  sampleSize: number,
): PredictionWeightConfig {
  const adjustmentStrength = 0.08 + learningScale(sampleSize, 28) * 0.1;
  const adjusted: PredictionWeightConfig = {
    courseForm: baseWeights.courseForm + factorAdjustments.courseForm * adjustmentStrength,
    formDistance: baseWeights.formDistance + factorAdjustments.formDistance * adjustmentStrength,
    jockeyTrainer: baseWeights.jockeyTrainer + factorAdjustments.jockeyTrainer * adjustmentStrength,
    oddsMovement: baseWeights.oddsMovement + factorAdjustments.oddsMovement * adjustmentStrength,
    history: baseWeights.history + factorAdjustments.history * adjustmentStrength,
  };

  return normalizeWeightSum({
    courseForm: clamp(adjusted.courseForm, 0.05, 0.55),
    formDistance: clamp(adjusted.formDistance, 0.05, 0.55),
    jockeyTrainer: clamp(adjusted.jockeyTrainer, 0.05, 0.45),
    oddsMovement: clamp(adjusted.oddsMovement, 0.05, 0.4),
    history: clamp(adjusted.history, 0.05, 0.4),
  });
}

function parseFormScore(form: string): number {
  const values = form
    .split("-")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);

  if (values.length === 0) return 0.46;

  const weightedTotal = values.reduce((sum, value, index) => {
    const recencyWeight = values.length - index;
    const placingScore = Math.max(0, 6 - value) / 5;
    return sum + placingScore * recencyWeight;
  }, 0);
  const totalWeight = values.reduce((sum, _value, index) => sum + (values.length - index), 0);

  return clamp(weightedTotal / Math.max(totalWeight, 1), 0.16, 0.96);
}

function parseTrainerJockeyScore(record: string): number {
  if (!record.trim()) return 0.55;

  const winsFromStarts = record.match(/(\d+)\s+wins?\s+from\s+(\d+)/i);
  if (winsFromStarts) {
    const wins = Number(winsFromStarts[1]);
    const starts = Number(winsFromStarts[2]);
    if (Number.isFinite(wins) && Number.isFinite(starts) && starts > 0) {
      return clamp(0.44 + (wins / starts) * 0.5, 0.3, 0.9);
    }
  }

  const percentageMatch = record.match(/(\d{1,3})\s*%/);
  if (percentageMatch) {
    const percentage = Number(percentageMatch[1]);
    if (Number.isFinite(percentage)) {
      return clamp(0.4 + percentage / 200, 0.3, 0.88);
    }
  }

  return 0.61;
}

function buildMarketScores(
  horse: typeof horsesTable.$inferSelect,
  maxOdds: number,
): { marketStrength: number; movementStrength: number } {
  const impliedStrength = clamp(1 - (horse.currentOdds - 1.2) / Math.max(maxOdds, 1.2), 0.12, 0.94);
  const openingOdds = horse.openingOdds ?? horse.currentOdds;
  const moveRatio = openingOdds > 0 ? (openingOdds - horse.currentOdds) / openingOdds : 0;
  const movementStrength =
    horse.oddsMovement === "shortening"
      ? clamp(0.62 + moveRatio * 0.7, 0.54, 0.9)
      : horse.oddsMovement === "drifting"
        ? clamp(0.44 + moveRatio * 0.35, 0.18, 0.48)
        : clamp(0.52 + moveRatio * 0.4, 0.34, 0.74);

  return {
    marketStrength: impliedStrength,
    movementStrength,
  };
}

function sanitizeFactorBreakdown(
  factors: Partial<PredictionFactorBreakdown> | undefined,
  fallbackScore: number,
): PredictionFactorBreakdown {
  return {
    courseForm: clamp(Number(factors?.courseForm ?? fallbackScore), 0, 1),
    formDistance: clamp(Number(factors?.formDistance ?? fallbackScore), 0, 1),
    jockeyTrainer: clamp(Number(factors?.jockeyTrainer ?? fallbackScore), 0, 1),
    oddsMovement: clamp(Number(factors?.oddsMovement ?? fallbackScore), 0, 1),
    history: clamp(Number(factors?.history ?? fallbackScore), 0, 1),
    overall: clamp(Number(factors?.overall ?? fallbackScore), 0, 1),
  };
}

function getFactorProfile(factors: PredictionFactorBreakdown): {
  average: number;
  consistency: number;
} {
  const values = FACTOR_KEYS.map((key) => factors[key] ?? 0.5);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const spread = Math.max(...values) - Math.min(...values);

  return {
    average,
    consistency: clamp(1 - spread * 0.85, 0.2, 1),
  };
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
    const formScore = parseFormScore(horse.form);
    const courseScore = horse.courseRecord ? clamp(0.72 + formScore * 0.2, 0.4, 0.94) : clamp(0.4 + formScore * 0.12, 0.25, 0.72);
    const distanceScore = horse.distanceRecord ? clamp(0.7 + formScore * 0.22, 0.42, 0.94) : clamp(0.38 + formScore * 0.24, 0.24, 0.78);
    const jockeyTrainerScore = parseTrainerJockeyScore(horse.trainerJockeyRecord);
    const marketScores = buildMarketScores(horse, maxOdds);
    const historyScore = clamp(
      formScore * 0.42 + marketScores.marketStrength * 0.38 + (horse.distanceRecord ? 0.12 : 0) + (horse.courseRecord ? 0.08 : 0),
      0.18,
      0.9,
    );
    const factorBlend = {
      courseForm: round(courseScore),
      formDistance: round(Math.max(formScore, distanceScore)),
      jockeyTrainer: round(jockeyTrainerScore),
      oddsMovement: round(marketScores.movementStrength),
      history: round(historyScore),
    };
    const overall = clamp(
      factorBlend.courseForm * weights.courseForm +
        factorBlend.formDistance * weights.formDistance +
        factorBlend.jockeyTrainer * weights.jockeyTrainer +
        factorBlend.oddsMovement * weights.oddsMovement +
        factorBlend.history * weights.history,
      0.08,
      0.99,
    );
    const dataCoverage =
      (horse.courseRecord ? 1 : 0)
      + (horse.distanceRecord ? 1 : 0)
      + (horse.trainerJockeyRecord.trim() ? 1 : 0)
      + (horse.form.trim() ? 1 : 0)
      + (horse.openingOdds != null ? 1 : 0);
    const coverageScore = dataCoverage / 5;

    return {
      horseIndex: index,
      score: round(overall),
      confidence: round(clamp(0.2 + overall * 0.34 + coverageScore * 0.14 + marketScores.marketStrength * 0.1, 0.22, 0.72)),
      factors: {
        ...factorBlend,
        overall: round(overall),
      },
      aiSummary: "Fallback scoring blended recency-weighted form, market shape, and venue-distance fit.",
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
  const sampleScale = learningScale(learningSnapshot.sampleSize, 40);
  const sortedRaw = [...rawPredictions].sort((left, right) => clamp(right.score, 0, 1) - clamp(left.score, 0, 1));
  const topScore = clamp(sortedRaw[0]?.score ?? 0.5, 0, 1);
  const secondScore = clamp(sortedRaw[1]?.score ?? topScore - 0.03, 0, 1);
  const bottomScore = clamp(sortedRaw[sortedRaw.length - 1]?.score ?? 0.1, 0, 1);
  const fieldSizePenalty = clamp((sortedRaw.length - 6) * 0.022, 0, 0.18);
  const scoreRange = clamp(topScore - bottomScore, 0.04, 0.42);
  const timeAdjustment = 1 + (timeProfile.confidenceFactor - 1) * 0.45;
  const biasWeight = 0.1 + sampleScale * 0.1;
  const factorWeight = 0.08 + sampleScale * 0.04;
  const scoreWeight = 0.08 + sampleScale * 0.08;

  return rawPredictions.map((prediction) => {
    const rankIndex = sortedRaw.findIndex((candidate) => candidate.horseIndex === prediction.horseIndex);
    const nextScore = clamp(sortedRaw[rankIndex + 1]?.score ?? prediction.score - 0.02, 0, 1);
    const factors = sanitizeFactorBreakdown(prediction.factors as PredictionFactorBreakdown, prediction.score);
    const factorSignal = getFactorSignal(factors, learningSnapshot.factorAdjustments);
    const factorProfile = getFactorProfile(factors);
    const gapToNext = clamp(prediction.score - nextScore, 0, 0.25);
    const gapFromTop = clamp(topScore - prediction.score, 0, 0.35);
    const adjustedScore = clamp(prediction.score + factorSignal * scoreWeight, 0.04, 0.99);
    const rawConfidence = clamp(prediction.confidence, 0.12, 0.88);
    const structuralConfidence = clamp(
      0.18
        + prediction.score * 0.24
        + factorProfile.average * 0.18
        + factorProfile.consistency * 0.08
        + gapToNext * 0.62
        + scoreRange * 0.18
        - fieldSizePenalty
        - rankIndex * 0.042
        - gapFromTop * 0.14,
      0.12,
      0.8,
    );
    const baseConfidence = clamp(rawConfidence * 0.35 + structuralConfidence * 0.65, 0.12, 0.8);
    const conservativeCap = clamp(
      0.62
        + gapToNext * 0.38
        + scoreRange * 0.18
        + factorProfile.consistency * 0.05
        + sampleScale * 0.05
        - Math.max(0, -learningSnapshot.confidenceBias) * 0.16
        - fieldSizePenalty * 0.5
        - rankIndex * 0.03,
      0.52,
      0.86,
    );
    const adjustedConfidence = clamp(
      Math.min(
        baseConfidence * timeAdjustment + learningSnapshot.confidenceBias * biasWeight + factorSignal * factorWeight,
        conservativeCap,
      ),
      0.12,
      conservativeCap,
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
    learningSnapshot.sampleSize,
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

  const currentPredictionRows = ranked
    .filter((p) => horses[p.horseIndex] !== undefined)
    .map((prediction) => ({
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
