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
  "fieldStrength",
  "weightCarried",
  "surfaceFit",
  "paceProfile",
  "priceValue",
] as const;

type FactorKey = (typeof FACTOR_KEYS)[number];
type LearningEntryLike = Pick<typeof forecastEntriesTable.$inferSelect, "horseId" | "rank" | "confidence" | "factors"> | Pick<typeof predictionsTable.$inferSelect, "horseId" | "rank" | "confidence" | "factors">;

const DEFAULT_WEIGHTS: PredictionWeightConfig = {
  courseForm: 0.18,
  formDistance: 0.18,
  jockeyTrainer: 0.14,
  oddsMovement: 0.10,
  history: 0.10,
  fieldStrength: 0.08,
  weightCarried: 0.07,
  surfaceFit: 0.06,
  paceProfile: 0.05,
  priceValue: 0.04,
};

const DEFAULT_FACTOR_ADJUSTMENTS: LearningFactorAdjustments = {
  courseForm: 0,
  formDistance: 0,
  jockeyTrainer: 0,
  oddsMovement: 0,
  history: 0,
  fieldStrength: 0,
  weightCarried: 0,
  surfaceFit: 0,
  paceProfile: 0,
  priceValue: 0,
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
    fieldStrength: round(weights.fieldStrength / total),
    weightCarried: round(weights.weightCarried / total),
    surfaceFit: round(weights.surfaceFit / total),
    paceProfile: round(weights.paceProfile / total),
    priceValue: round(weights.priceValue / total),
  };
}

function normalizeWeightSum(weights: PredictionWeightConfig): PredictionWeightConfig {
  const normalized = normalizeWeights(weights);
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  const drift = round(1 - total, 6);
  if (Math.abs(drift) < 0.000001) return normalized;

  return {
    ...normalized,
    priceValue: round(normalized.priceValue + drift, 6),
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

async function loadLatestLearningFeedback(): Promise<typeof learningFeedbackTable.$inferSelect | null> {
  const rows = await db
    .select()
    .from(learningFeedbackTable)
    .where(eq(learningFeedbackTable.scope, "global"))
    .orderBy(desc(learningFeedbackTable.updatedAt), desc(learningFeedbackTable.id))
    .limit(1);

  return rows[0] ?? null;
}

async function ensureLearningFeedback(): Promise<typeof learningFeedbackTable.$inferSelect> {
  let learning = await loadLatestLearningFeedback();
  if (!learning) {
    const [created] = await db
      .insert(learningFeedbackTable)
      .values({
        scope: "global",
        factorAdjustments: { ...DEFAULT_FACTOR_ADJUSTMENTS },
      })
      .returning();
    learning = created;
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
    fieldStrength: baseWeights.fieldStrength + factorAdjustments.fieldStrength * adjustmentStrength,
    weightCarried: baseWeights.weightCarried + factorAdjustments.weightCarried * adjustmentStrength,
    surfaceFit: baseWeights.surfaceFit + factorAdjustments.surfaceFit * adjustmentStrength,
    paceProfile: baseWeights.paceProfile + factorAdjustments.paceProfile * adjustmentStrength,
    priceValue: baseWeights.priceValue + factorAdjustments.priceValue * adjustmentStrength,
  };

  return normalizeWeightSum({
    courseForm: clamp(adjusted.courseForm, 0.05, 0.55),
    formDistance: clamp(adjusted.formDistance, 0.05, 0.55),
    jockeyTrainer: clamp(adjusted.jockeyTrainer, 0.05, 0.45),
    oddsMovement: clamp(adjusted.oddsMovement, 0.05, 0.4),
    history: clamp(adjusted.history, 0.05, 0.4),
    fieldStrength: clamp(adjusted.fieldStrength, 0.03, 0.3),
    weightCarried: clamp(adjusted.weightCarried, 0.03, 0.25),
    surfaceFit: clamp(adjusted.surfaceFit, 0.03, 0.25),
    paceProfile: clamp(adjusted.paceProfile, 0.02, 0.22),
    priceValue: clamp(adjusted.priceValue, 0.02, 0.2),
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

type HorseSourceSignals = {
  starRating: number | null;
  draw: number | null;
  meritRating: number | null;
  officialRating: number | null;
  racingPostRating: number | null;
  topSpeedRating: number | null;
  restDays: number | null;
  cardPoints: number | null;
  speedPoints: number | null;
  salePrice: number | null;
  age: number | null;
  overweight: number | null;
  lastRunPositions: number[];
  lastRunLengths: number[];
  lastRunDistances: number[];
  favourite: boolean;
  gear: boolean;
  ppw: boolean;
  trainerChange: boolean;
  gelded: boolean;
  metadataCoverage: number;
};

function parseSignalNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const value = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function parseSignalNumbers(text: string, pattern: RegExp): number[] {
  return [...text.matchAll(pattern)]
    .map((match) => Number(match[1]?.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
}

function isAffirmativeSignal(text: string, pattern: RegExp): boolean {
  const match = text.match(pattern);
  if (!match) return false;
  const value = (match[1] ?? "").trim().toLowerCase();
  return !/^(?:n|no|false|0|none|unknown)$/i.test(value);
}

function parseHorseSourceSignals(horse: typeof horsesTable.$inferSelect): HorseSourceSignals {
  const text = `${horse.notes ?? ""} | ${horse.trainerJockeyRecord ?? ""}`;
  const metadataMatches = [
    /\bSex\s+[^|]+/i,
    /\bColour\s+[^|]+/i,
    /\bOwner\s+[^|]+/i,
    /\bhorse_id=/i,
    /\bjockey_id=/i,
    /\btrainer_id=/i,
    /\bRace\s+[^|]+/i,
    /\bStatus\s+[^|]+/i,
  ];

  const sourceFields = [
    parseSignalNumber(text, [/\bGallop star\s+(\d+(?:\.\d+)?)/i, /\bStars\s+(\d+(?:\.\d+)?)/i]),
    parseSignalNumber(text, [/\bDraw\s+(\d+(?:\.\d+)?)/i]),
    parseSignalNumber(text, [/\bMR\s+(\d+(?:\.\d+)?)/i]),
    parseSignalNumber(text, [/\bOR\s+(\d+(?:\.\d+)?)/i]),
    parseSignalNumber(text, [/\bRPR\s+(\d+(?:\.\d+)?)/i]),
    parseSignalNumber(text, [/\bTS\s+(\d+(?:\.\d+)?)/i]),
    parseSignalNumber(text, [/\bRest\s+(\d+(?:\.\d+)?)d/i]),
    parseSignalNumber(text, [/\bCard points\s+(-?\d+(?:\.\d+)?)/i]),
    parseSignalNumber(text, [/\bSpeed points\s+(-?\d+(?:\.\d+)?)/i]),
    parseSignalNumber(text, [/\bSale\s+(\d+(?:\.\d+)?)/i]),
    parseSignalNumber(text, [/\bAge\s+(\d+(?:\.\d+)?)/i]),
    parseSignalNumber(text, [/\bOverweight\s+(\d+(?:\.\d+)?)/i]),
  ];
  const metadataCoverage = (
    sourceFields.filter((value) => value != null).length
    + metadataMatches.filter((pattern) => pattern.test(text)).length
    + (/\bGear(?: key)?\s+[^|]+/i.test(text) ? 1 : 0)
    + (/\bPPW\s+[^|]+/i.test(text) ? 1 : 0)
    + (/\b(?:Ex trainer|Trainer change|Stable change)\s+[^|]+/i.test(text) ? 1 : 0)
    + (/\b(?:Just gelded|Gelded)\s+[^|]+/i.test(text) ? 1 : 0)
    + (/\bLast runs\s+/i.test(text) ? 2 : 0)
  ) / 22;

  return {
    starRating: sourceFields[0],
    draw: sourceFields[1],
    meritRating: sourceFields[2],
    officialRating: sourceFields[3],
    racingPostRating: sourceFields[4],
    topSpeedRating: sourceFields[5],
    restDays: sourceFields[6],
    cardPoints: sourceFields[7],
    speedPoints: sourceFields[8],
    salePrice: sourceFields[9],
    age: sourceFields[10],
    overweight: sourceFields[11],
    lastRunPositions: parseSignalNumbers(text, /\bpos\s+(\d+(?:\.\d+)?)/gi),
    lastRunLengths: parseSignalNumbers(text, /\blen\s+([0-9]+(?:\.[0-9]+)?)/gi),
    lastRunDistances: parseSignalNumbers(text, /\b(\d{3,4})m\b/gi),
    favourite: isAffirmativeSignal(text, /\bFavourite\s+([^|]+)/i),
    gear: /\bGear(?: key)?\s+[^|]+/i.test(text),
    ppw: /\bPPW\s+[^|]+/i.test(text),
    trainerChange: /\b(?:Ex trainer|Trainer change|Stable change)\s+[^|]+/i.test(text),
    gelded: /\b(?:Just gelded|Gelded)\s+[^|]+/i.test(text),
    metadataCoverage: clamp(metadataCoverage, 0, 1),
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scoreFromField(value: number | null, fieldValues: Array<number | null>, fallback: number = 0.5): number {
  if (value == null) return fallback;
  const values = fieldValues.filter((item): item is number => item != null && Number.isFinite(item));
  if (values.length < 2) return clamp(fallback + 0.04, 0.2, 0.86);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (Math.abs(max - min) < 0.001) return clamp(fallback + 0.04, 0.2, 0.86);
  return clamp(0.24 + ((value - min) / (max - min)) * 0.64, 0.2, 0.9);
}

function scoreStarRating(value: number | null): number {
  if (value == null) return 0.5;
  const scale = value > 5 ? 10 : 5;
  return clamp(0.24 + (value / scale) * 0.66, 0.22, 0.93);
}

function scoreMeritRating(value: number | null): number {
  if (value == null) return 0.5;
  return clamp(0.18 + ((value - 45) / 70) * 0.72, 0.18, 0.94);
}

function scoreRestDays(value: number | null): number {
  if (value == null) return 0.55;
  if (value < 7) return clamp(0.36 + value * 0.025, 0.36, 0.52);
  if (value <= 21) return clamp(0.58 + ((value - 7) / 14) * 0.14, 0.58, 0.72);
  if (value <= 60) return 0.78;
  if (value <= 100) return clamp(0.74 - ((value - 60) / 40) * 0.12, 0.62, 0.74);
  if (value <= 180) return clamp(0.58 - ((value - 100) / 80) * 0.16, 0.42, 0.58);
  return 0.36;
}

function scoreDraw(value: number | null, fieldSize: number): number {
  if (value == null || fieldSize <= 1) return 0.5;
  const insideBias = 1 - (value - 1) / Math.max(fieldSize - 1, 1);
  return clamp(0.34 + insideBias * 0.48, 0.3, 0.84);
}

function scoreAge(value: number | null): number {
  if (value == null) return 0.55;
  if (value < 3) return 0.46;
  if (value <= 5) return 0.72;
  if (value <= 7) return 0.64;
  if (value <= 9) return 0.52;
  return 0.42;
}

function scoreRecentLengths(lengths: number[]): number {
  const avg = average(lengths);
  if (avg == null) return 0.5;
  return clamp(0.84 - (avg / 10) * 0.46, 0.26, 0.86);
}

function scoreDistanceFitFromRuns(distances: number[], raceDistance: number): number {
  if (distances.length === 0 || raceDistance <= 0) return 0.5;
  const bestGap = Math.min(...distances.map((distance) => Math.abs(distance - raceDistance)));
  return clamp(0.86 - (bestGap / 700) * 0.42, 0.32, 0.88);
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
    fieldStrength: clamp(Number(factors?.fieldStrength ?? fallbackScore), 0, 1),
    weightCarried: clamp(Number(factors?.weightCarried ?? fallbackScore), 0, 1),
    surfaceFit: clamp(Number(factors?.surfaceFit ?? fallbackScore), 0, 1),
    paceProfile: clamp(Number(factors?.paceProfile ?? fallbackScore), 0, 1),
    priceValue: clamp(Number(factors?.priceValue ?? fallbackScore), 0, 1),
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
  race: Pick<typeof racesTable.$inferSelect, "distance" | "surface">,
): HorsePrediction[] {
  const activeHorses = horses
    .map((horse, index) => ({ horse, index }))
    .filter(({ horse }) => !horse.scratched);
  const maxOdds = Math.max(...activeHorses.map(({ horse }) => horse.currentOdds), 1);
  const averageWeight = activeHorses.reduce((sum, { horse }) => sum + (horse.weight ?? 57), 0) / Math.max(activeHorses.length, 1);
  const fieldAverageOdds = activeHorses.reduce((sum, { horse }) => sum + horse.currentOdds, 0) / Math.max(activeHorses.length, 1);
  const competitiveDensity = clamp(1 - (maxOdds - 1.2) / 25, 0.2, 0.95);
  const sourceSignals = activeHorses.map(({ horse, index }) => ({
    index,
    signals: parseHorseSourceSignals(horse),
  }));
  const signalByIndex = new Map(sourceSignals.map(({ index, signals }) => [index, signals]));
  const fieldSignalValues = {
    cardPoints: sourceSignals.map(({ signals }) => signals.cardPoints),
    speedPoints: sourceSignals.map(({ signals }) => signals.speedPoints),
    meritRating: sourceSignals.map(({ signals }) => signals.meritRating ?? signals.officialRating),
    racingPostRating: sourceSignals.map(({ signals }) => signals.racingPostRating),
    topSpeedRating: sourceSignals.map(({ signals }) => signals.topSpeedRating),
    salePrice: sourceSignals.map(({ signals }) => signals.salePrice),
  };

  return activeHorses.map(({ horse, index }) => {
    const signals = signalByIndex.get(index) ?? parseHorseSourceSignals(horse);
    const formScore = parseFormScore(horse.form);
    const lastRunScore = signals.lastRunPositions.length > 0 ? parseFormScore(signals.lastRunPositions.map((value) => String(Math.round(value))).join("-")) : formScore;
    const lastLengthScore = scoreRecentLengths(signals.lastRunLengths);
    const lastDistanceFitScore = scoreDistanceFitFromRuns(signals.lastRunDistances, race.distance);
    const starScore = scoreStarRating(signals.starRating);
    const restScore = scoreRestDays(signals.restDays);
    const drawScore = scoreDraw(signals.draw, activeHorses.length);
    const ageScore = scoreAge(signals.age);
    const cardPointScore = scoreFromField(signals.cardPoints, fieldSignalValues.cardPoints, 0.52);
    const speedPointScore = scoreFromField(signals.speedPoints, fieldSignalValues.speedPoints, 0.52);
    const meritScore = clamp(
      scoreMeritRating(signals.meritRating ?? signals.officialRating) * 0.62
        + scoreFromField(signals.meritRating ?? signals.officialRating, fieldSignalValues.meritRating, 0.5) * 0.38,
      0.18,
      0.94,
    );
    const racingPostScore = scoreFromField(signals.racingPostRating, fieldSignalValues.racingPostRating, 0.5);
    const topSpeedScore = scoreFromField(signals.topSpeedRating, fieldSignalValues.topSpeedRating, 0.5);
    const saleScore = scoreFromField(signals.salePrice, fieldSignalValues.salePrice, 0.5);
    const externalClassScore = clamp(
      meritScore * 0.36
        + speedPointScore * 0.18
        + cardPointScore * 0.16
        + racingPostScore * 0.12
        + topSpeedScore * 0.1
        + starScore * 0.08,
      0.18,
      0.94,
    );
    const gallopFormScore = clamp(
      formScore * 0.42
        + lastRunScore * 0.2
        + lastLengthScore * 0.1
        + cardPointScore * 0.11
        + speedPointScore * 0.09
        + starScore * 0.08,
      0.14,
      0.96,
    );
    const sourceAdjustment =
      (signals.gear ? 0.015 : 0)
      + (signals.gelded ? 0.012 : 0)
      + (signals.ppw ? 0.008 : 0)
      + (signals.trainerChange ? -0.035 : 0)
      + (signals.favourite ? 0.025 : 0);
    const courseScore = horse.courseRecord
      ? clamp(0.58 + gallopFormScore * 0.18 + cardPointScore * 0.08 + starScore * 0.04 + sourceAdjustment, 0.34, 0.94)
      : clamp(0.32 + gallopFormScore * 0.16 + cardPointScore * 0.08 + externalClassScore * 0.06 + sourceAdjustment * 0.5, 0.2, 0.78);
    const distanceScore = horse.distanceRecord
      ? clamp(0.56 + gallopFormScore * 0.16 + lastDistanceFitScore * 0.12 + speedPointScore * 0.08 + sourceAdjustment, 0.34, 0.94)
      : clamp(0.3 + gallopFormScore * 0.14 + lastDistanceFitScore * 0.14 + speedPointScore * 0.08 + sourceAdjustment * 0.5, 0.2, 0.82);
    const jockeyTrainerScore = clamp(
      parseTrainerJockeyScore(horse.trainerJockeyRecord) * 0.56
        + starScore * 0.14
        + restScore * 0.1
        + externalClassScore * 0.08
        + ageScore * 0.04
        + sourceAdjustment,
      0.18,
      0.92,
    );
    const marketScores = buildMarketScores(horse, maxOdds);
    const historyScore = clamp(
      gallopFormScore * 0.28
        + marketScores.marketStrength * 0.22
        + externalClassScore * 0.22
        + speedPointScore * 0.1
        + (horse.distanceRecord ? 0.1 : 0)
        + (horse.courseRecord ? 0.08 : 0),
      0.18,
      0.94,
    );
    const weightDelta = (averageWeight - (horse.weight ?? averageWeight)) / Math.max(averageWeight, 1);
    const overweightPenalty = signals.overweight == null ? 0 : clamp(signals.overweight / 5, 0, 1) * 0.1;
    const weightCarriedScore = clamp(0.48 + weightDelta * 2.9 + ageScore * 0.08 - overweightPenalty, 0.16, 0.88);
    const surfaceFitScore = clamp(
      0.28
        + (horse.courseRecord ? 0.14 : 0)
        + (horse.distanceRecord ? 0.1 : 0)
        + (/turf|grass|poly|sand|all.weather/i.test(`${race.surface} ${horse.notes ?? ""}`) ? 0.06 : 0)
        + gallopFormScore * 0.14
        + lastDistanceFitScore * 0.08
        + restScore * 0.06
        + sourceAdjustment * 0.7,
      0.22,
      0.92,
    );
    const paceProfileScore = clamp(
      0.24
        + gallopFormScore * 0.16
        + marketScores.movementStrength * 0.18
        + drawScore * 0.18
        + speedPointScore * 0.16
        + restScore * 0.06
        + sourceAdjustment * 0.6,
      0.18,
      0.86,
    );
    const fieldStrengthScore = clamp(
      0.18
        + marketScores.marketStrength * 0.26
        + competitiveDensity * 0.12
        + historyScore * 0.16
        + externalClassScore * 0.24
        + starScore * 0.08
        + saleScore * 0.04
        + (signals.favourite ? 0.02 : 0),
      0.18,
      0.9,
    );
    const priceValueScore = clamp(
      0.38
        + (historyScore + courseScore + distanceScore + externalClassScore) / 8
        + (saleScore - 0.5) * 0.06
        - horse.currentOdds / Math.max(fieldAverageOdds * 4, 1)
        - (signals.favourite ? 0.025 : 0),
      0.16,
      0.9,
    );
    const factorBlend = {
      courseForm: round(courseScore),
      formDistance: round(Math.max(formScore, distanceScore)),
      jockeyTrainer: round(jockeyTrainerScore),
      oddsMovement: round(marketScores.movementStrength),
      history: round(historyScore),
      fieldStrength: round(fieldStrengthScore),
      weightCarried: round(weightCarriedScore),
      surfaceFit: round(surfaceFitScore),
      paceProfile: round(paceProfileScore),
      priceValue: round(priceValueScore),
    };
    const overall = clamp(
      factorBlend.courseForm * weights.courseForm +
        factorBlend.formDistance * weights.formDistance +
        factorBlend.jockeyTrainer * weights.jockeyTrainer +
        factorBlend.oddsMovement * weights.oddsMovement +
        factorBlend.history * weights.history +
        factorBlend.fieldStrength * weights.fieldStrength +
        factorBlend.weightCarried * weights.weightCarried +
        factorBlend.surfaceFit * weights.surfaceFit +
        factorBlend.paceProfile * weights.paceProfile +
        factorBlend.priceValue * weights.priceValue,
      0.08,
      0.99,
    );
    const dataCoverage =
      (horse.courseRecord ? 1 : 0)
      + (horse.distanceRecord ? 1 : 0)
      + (horse.trainerJockeyRecord.trim() ? 1 : 0)
      + (horse.form.trim() ? 1 : 0)
      + (horse.openingOdds != null ? 1 : 0)
      + (horse.weight != null ? 1 : 0)
      + (horse.notes?.trim() ? 1 : 0)
      + signals.metadataCoverage * 5;
    const coverageScore = dataCoverage / 12;

    return {
      horseIndex: index,
      runnerNumber: horse.number,
      score: round(overall),
      confidence: round(clamp(0.2 + overall * 0.34 + coverageScore * 0.14 + marketScores.marketStrength * 0.1, 0.22, 0.72)),
      factors: {
        ...factorBlend,
        overall: round(overall),
      },
      aiSummary: signals.metadataCoverage > 0.2
        ? "Gallop-enhanced scoring blended form, draw, MR, rest, speed/card points, market, weight, and value shape."
        : "Fallback scoring blended form, market, field pressure, carried weight, and value shape.",
    };
  });
}

function blendFactorValue(aiValue: number, fallbackValue: number, aiWeight: number): number {
  return round(clamp(aiValue * aiWeight + fallbackValue * (1 - aiWeight), 0, 1));
}

function averageFactorGap(
  aiFactors: PredictionFactorBreakdown,
  fallbackFactors: PredictionFactorBreakdown,
): number {
  const totalGap = FACTOR_KEYS.reduce((sum, key) => {
    return sum + Math.abs((aiFactors[key] ?? 0.5) - (fallbackFactors[key] ?? 0.5));
  }, 0);

  return totalGap / FACTOR_KEYS.length;
}

function resolveAiBlendWeight(
  aiPrediction: HorsePrediction,
  fallbackPrediction: HorsePrediction,
  aiFactors: PredictionFactorBreakdown,
  fallbackFactors: PredictionFactorBreakdown,
): number {
  const scoreGap = Math.abs(clamp(aiPrediction.score, 0, 1) - clamp(fallbackPrediction.score, 0, 1));
  const confidenceGap = Math.abs(clamp(aiPrediction.confidence, 0.12, 0.88) - clamp(fallbackPrediction.confidence, 0.12, 0.88));
  const factorGap = averageFactorGap(aiFactors, fallbackFactors);
  const agreement = clamp(1 - scoreGap * 2.1 - confidenceGap * 1.2 - factorGap * 1.1, 0, 1);
  const summaryBonus = aiPrediction.aiSummary?.trim() ? 0.03 : 0;
  return clamp(0.42 + agreement * 0.2 + summaryBonus, 0.42, 0.65);
}

function mergeModelPredictions(
  aiPredictions: HorsePrediction[],
  fallbackPredictions: HorsePrediction[],
): HorsePrediction[] {
  const fallbackByHorseIndex = new Map(fallbackPredictions.map((prediction) => [prediction.horseIndex, prediction]));
  const aiByHorseIndex = new Map<number, HorsePrediction>();

  for (const prediction of aiPredictions) {
    const fallback = fallbackByHorseIndex.get(prediction.horseIndex);
    if (!fallback) continue;

    const existing = aiByHorseIndex.get(prediction.horseIndex);
    if (!existing || clamp(prediction.score, 0, 1) > clamp(existing.score, 0, 1)) {
      aiByHorseIndex.set(prediction.horseIndex, prediction);
    }
  }

  return fallbackPredictions.map((fallbackPrediction) => {
    const aiPrediction = aiByHorseIndex.get(fallbackPrediction.horseIndex);
    if (!aiPrediction) return fallbackPrediction;

    const aiFactors = sanitizeFactorBreakdown(aiPrediction.factors as PredictionFactorBreakdown, aiPrediction.score);
    const fallbackFactors = sanitizeFactorBreakdown(fallbackPrediction.factors as PredictionFactorBreakdown, fallbackPrediction.score);
    const aiWeight = resolveAiBlendWeight(aiPrediction, fallbackPrediction, aiFactors, fallbackFactors);
    const blendedScore = clamp(
      clamp(aiPrediction.score, 0, 1) * aiWeight + clamp(fallbackPrediction.score, 0, 1) * (1 - aiWeight),
      0.08,
      0.99,
    );
    const blendedConfidence = clamp(
      clamp(aiPrediction.confidence, 0.12, 0.88) * 0.45 + clamp(fallbackPrediction.confidence, 0.12, 0.88) * 0.55,
      0.18,
      0.78,
    );

    return {
      horseIndex: fallbackPrediction.horseIndex,
      runnerNumber: aiPrediction.runnerNumber ?? fallbackPrediction.runnerNumber,
      score: round(blendedScore),
      confidence: round(blendedConfidence),
      factors: {
        courseForm: blendFactorValue(aiFactors.courseForm, fallbackFactors.courseForm, aiWeight),
        formDistance: blendFactorValue(aiFactors.formDistance, fallbackFactors.formDistance, aiWeight),
        jockeyTrainer: blendFactorValue(aiFactors.jockeyTrainer, fallbackFactors.jockeyTrainer, aiWeight),
        oddsMovement: blendFactorValue(aiFactors.oddsMovement, fallbackFactors.oddsMovement, aiWeight),
        history: blendFactorValue(aiFactors.history, fallbackFactors.history, aiWeight),
        fieldStrength: blendFactorValue(aiFactors.fieldStrength, fallbackFactors.fieldStrength, aiWeight),
        weightCarried: blendFactorValue(aiFactors.weightCarried, fallbackFactors.weightCarried, aiWeight),
        surfaceFit: blendFactorValue(aiFactors.surfaceFit, fallbackFactors.surfaceFit, aiWeight),
        paceProfile: blendFactorValue(aiFactors.paceProfile, fallbackFactors.paceProfile, aiWeight),
        priceValue: blendFactorValue(aiFactors.priceValue, fallbackFactors.priceValue, aiWeight),
        overall: round(blendedScore),
      },
      aiSummary: aiPrediction.aiSummary?.trim() || fallbackPrediction.aiSummary,
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
    const modelScore = clamp(prediction.score, 0, 1);
    const rawConfidence = clamp(prediction.confidence, 0.12, 0.88);
    const structuralConfidence = clamp(
      0.18
        + modelScore * 0.24
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
    const adjustedScore = clamp(modelScore * 0.82 + structuralConfidence * 0.18 + factorSignal * scoreWeight, 0.04, 0.99);
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
      fieldStrength: baseWeights.fieldStrength,
      weightCarried: baseWeights.weightCarried,
      surfaceFit: baseWeights.surfaceFit,
      paceProfile: baseWeights.paceProfile,
      priceValue: baseWeights.priceValue,
    },
    learningSnapshot.factorAdjustments,
    learningSnapshot.sampleSize,
  );
  const fallbackPredictions = buildFallbackPredictions(horses, adaptiveWeights, race);

  let rawPredictions: HorsePrediction[];
  try {
    const aiPredictions = await analyzeRaceWithAI(
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
    rawPredictions = mergeModelPredictions(aiPredictions, fallbackPredictions);
  } catch (err) {
    logger.warn({ err, raceId }, "AI race analysis failed, using fallback model");
    rawPredictions = fallbackPredictions;
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

function computeUpdatedLearningSummary(
  learningSnapshot: LearningSummarySnapshot,
  learningEntries: LearningEntryLike[],
  finishMap: Map<number, number>,
): { snapshot: LearningSummarySnapshot; topPickCorrect: boolean } | null {
  const winnerHorseId = [...finishMap.entries()].find((entry) => entry[1] === 1)?.[0] ?? null;
  if (!winnerHorseId) return null;

  const topPick = learningEntries.find((entry) => entry.rank === 1) ?? null;
  if (!topPick) return null;

  const sampleSize = learningSnapshot.sampleSize;
  const topPickCorrect = topPick.horseId === winnerHorseId;
  const topPickPlaced = (finishMap.get(topPick.horseId) ?? 99) <= 3;
  const topPickConfidence = topPick.confidence ?? 0.5;
  const winnerEntry = learningEntries.find((entry) => entry.horseId === winnerHorseId);

  const nextAdjustments: LearningFactorAdjustments = { ...learningSnapshot.factorAdjustments };
  if (winnerEntry) {
    const averages = FACTOR_KEYS.reduce<Record<FactorKey, number>>((acc, key) => {
      const total = learningEntries.reduce((sum, entry) => sum + ((entry.factors as PredictionFactorBreakdown)[key] ?? 0.5), 0);
      acc[key] = learningEntries.length > 0 ? total / learningEntries.length : 0.5;
      return acc;
    }, {
      courseForm: 0.5,
      formDistance: 0.5,
      jockeyTrainer: 0.5,
      oddsMovement: 0.5,
      history: 0.5,
      fieldStrength: 0.5,
      weightCarried: 0.5,
      surfaceFit: 0.5,
      paceProfile: 0.5,
      priceValue: 0.5,
    });

    for (const key of FACTOR_KEYS) {
      const winnerValue = (winnerEntry.factors as PredictionFactorBreakdown)[key] ?? 0.5;
      const baselineValue = topPickCorrect
        ? averages[key]
        : (topPick.factors as PredictionFactorBreakdown | undefined)?.[key] ?? averages[key];
      const signal = clamp(winnerValue - baselineValue, -1, 1) * 0.08;
      nextAdjustments[key] = round(clamp(roundMovingAverage(learningSnapshot.factorAdjustments[key], sampleSize, signal), -0.18, 0.18));
    }
  }

  return {
    topPickCorrect,
    snapshot: {
      sampleSize: sampleSize + 1,
      topPickWinRate: roundMovingAverage(learningSnapshot.topPickWinRate, sampleSize, topPickCorrect ? 1 : 0),
      placedRate: roundMovingAverage(learningSnapshot.placedRate, sampleSize, topPickPlaced ? 1 : 0),
      averageConfidence: roundMovingAverage(learningSnapshot.averageConfidence, sampleSize, topPickConfidence),
      confidenceBias: roundMovingAverage(learningSnapshot.confidenceBias, sampleSize, (topPickCorrect ? 1 : 0) - topPickConfidence),
      factorAdjustments: nextAdjustments,
    },
  };
}

export async function rebuildLearningFeedbackFromHistory(): Promise<{ applied: number; skipped: number }> {
  const learning = await ensureLearningFeedback();
  const results = await db
    .select()
    .from(raceResultsTable)
    .orderBy(raceResultsTable.officialAt, raceResultsTable.id);

  let snapshot = buildLearningSnapshot({
    ...learning,
    sampleSize: 0,
    topPickWinRate: 0,
    placedRate: 0,
    averageConfidence: 0,
    confidenceBias: 0,
    factorAdjustments: { ...DEFAULT_FACTOR_ADJUSTMENTS },
  });
  let lastResultRaceId: number | null = null;
  let applied = 0;
  let skipped = 0;

  for (const result of results) {
    const finishMap = new Map<number, number>([[result.winnerHorseId, 1]]);
    if (result.runnerUpHorseId) finishMap.set(result.runnerUpHorseId, 2);
    if (result.thirdHorseId) finishMap.set(result.thirdHorseId, 3);

    const [latestSnapshot] = await db
      .select()
      .from(forecastSnapshotsTable)
      .where(eq(forecastSnapshotsTable.raceId, result.raceId))
      .orderBy(desc(forecastSnapshotsTable.createdAt))
      .limit(1);

    const snapshotEntries = latestSnapshot
      ? await db
          .select()
          .from(forecastEntriesTable)
          .where(eq(forecastEntriesTable.snapshotId, latestSnapshot.id))
          .orderBy(forecastEntriesTable.rank)
      : [];

    const learningEntries = snapshotEntries.length > 0
      ? snapshotEntries
      : await db
          .select()
          .from(predictionsTable)
          .where(eq(predictionsTable.raceId, result.raceId))
          .orderBy(predictionsTable.rank);

    const computed = computeUpdatedLearningSummary(snapshot, learningEntries, finishMap);
    if (!computed) {
      skipped++;
      continue;
    }

    snapshot = computed.snapshot;
    lastResultRaceId = result.raceId;
    applied++;
  }

  await db
    .update(learningFeedbackTable)
    .set({
      sampleSize: snapshot.sampleSize,
      topPickWinRate: snapshot.topPickWinRate,
      placedRate: snapshot.placedRate,
      averageConfidence: snapshot.averageConfidence,
      confidenceBias: snapshot.confidenceBias,
      factorAdjustments: snapshot.factorAdjustments,
      lastResultRaceId,
      updatedAt: new Date(),
    })
    .where(eq(learningFeedbackTable.id, learning.id));

  logger.info({ applied, skipped, lastResultRaceId }, "Rebuilt learning feedback summary from historical race results");
  return { applied, skipped };
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
  const learningEntries = snapshotEntries.length > 0 ? snapshotEntries : currentPredictions;

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

  const topPick = learningEntries.find((entry) => entry.rank === 1) ?? null;
  if (!topPick) {
    logger.info(
      { raceId, currentPredictionCount: currentPredictions.length, snapshotEntryCount: snapshotEntries.length },
      "Skipping learning feedback update because no forecast sample was available for the recorded result",
    );
    return { winnerHorseId: input.winnerHorseId, topPickCorrect: false };
  }

  const learning = await ensureLearningFeedback();
  const learningSnapshot = buildLearningSnapshot(learning);
  const computed = computeUpdatedLearningSummary(learningSnapshot, learningEntries, finishMap);
  if (!computed) {
    logger.info(
      { raceId, currentPredictionCount: currentPredictions.length, snapshotEntryCount: snapshotEntries.length },
      "Skipping learning feedback update because no forecast sample was available for the recorded result",
    );
    return { winnerHorseId: input.winnerHorseId, topPickCorrect: false };
  }

  await db
    .update(learningFeedbackTable)
    .set({
      sampleSize: computed.snapshot.sampleSize,
      topPickWinRate: computed.snapshot.topPickWinRate,
      placedRate: computed.snapshot.placedRate,
      averageConfidence: computed.snapshot.averageConfidence,
      confidenceBias: computed.snapshot.confidenceBias,
      factorAdjustments: computed.snapshot.factorAdjustments,
      lastResultRaceId: raceId,
      updatedAt: now,
    })
    .where(eq(learningFeedbackTable.id, learning.id));

  return { winnerHorseId: input.winnerHorseId, topPickCorrect: computed.topPickCorrect };
}
