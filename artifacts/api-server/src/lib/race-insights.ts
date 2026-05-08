import {
  db,
  horsesTable,
  learningFeedbackTable,
  predictionsTable,
  raceResultsTable,
  racesTable,
  type PredictionFactorBreakdown,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getMinutesToRace, getRaceTimeProfile, getRelativeDayLabel, isDateToday, isDateWithinDays } from "./race-time";

type RaceRow = typeof racesTable.$inferSelect;
type HorseRow = typeof horsesTable.$inferSelect;
type PredictionRow = typeof predictionsTable.$inferSelect;
type ResultRow = typeof raceResultsTable.$inferSelect;
type LearningRow = typeof learningFeedbackTable.$inferSelect;

export type RacePredictionSummary = {
  id: number;
  horseId: number;
  horseName: string;
  rank: number;
  score: number;
  baseConfidence: number;
  confidence: number;
  confidenceDelta: number;
  confidenceBand: string;
  timeToRaceMinutes: number | null;
  resultStatus: string;
  finishPosition: number | null;
  aiSummary: string | null;
};

export type RaceResultSummary = {
  winnerHorseId: number;
  winnerHorseName: string;
  runnerUpHorseId: number | null;
  runnerUpHorseName: string | null;
  thirdHorseId: number | null;
  thirdHorseName: string | null;
  recordedAt: string;
  notes: string | null;
  topPickCorrect: boolean | null;
};

export type RaceForecastCard = {
  id: number;
  raceNumber: number;
  name: string;
  venue: string;
  distance: number;
  raceTime: string;
  meetingDate: string | null;
  status: string;
  surface: string;
  grade: string | null;
  prize: string | null;
  horseCount: number;
  nextUpdateAt: string | null;
  lastAnalyzedAt: string | null;
  createdAt: string;
  syncedFrom: string | null;
  isToday: boolean;
  isThisWeek: boolean;
  dayLabel: string;
  minutesToRace: number | null;
  forecastBand: string;
  prominence: number;
  topPrediction: RacePredictionSummary | null;
  topPredictions: RacePredictionSummary[];
  result: RaceResultSummary | null;
};

export type LearningPerformanceSummary = {
  sampleSize: number;
  topPickWinRate: number;
  placedRate: number;
  averageConfidence: number;
  confidenceBias: number;
  factorAdjustments: {
    courseForm: number;
    formDistance: number;
    jockeyTrainer: number;
    oddsMovement: number;
    history: number;
  };
  strongestEdge: string | null;
  recentResults: Array<{
    raceId: number;
    raceName: string;
    meetingDate: string | null;
    topPickHorseName: string | null;
    winnerHorseName: string;
    topPickCorrect: boolean;
  }>;
};

export type WeeklyOverviewDay = {
  date: string;
  label: string;
  raceCount: number;
  analyzedCount: number;
  completedCount: number;
  venues: string[];
  spotlightRaceId: number | null;
  spotlightRaceName: string | null;
  spotlightHorseName: string | null;
  spotlightConfidence: number | null;
};

function mapPredictionSummary(prediction: PredictionRow, horsesById: Map<number, HorseRow>): RacePredictionSummary {
  return {
    id: prediction.id,
    horseId: prediction.horseId,
    horseName: horsesById.get(prediction.horseId)?.name ?? "",
    rank: prediction.rank,
    score: prediction.score,
    baseConfidence: prediction.baseConfidence,
    confidence: prediction.confidence,
    confidenceDelta: prediction.confidenceDelta,
    confidenceBand: prediction.confidenceBand,
    timeToRaceMinutes: prediction.timeToRaceMinutes,
    resultStatus: prediction.resultStatus,
    finishPosition: prediction.finishPosition,
    aiSummary: prediction.aiSummary,
  };
}

function mapResultSummary(
  result: ResultRow,
  horsesById: Map<number, HorseRow>,
  topPrediction: RacePredictionSummary | null,
): RaceResultSummary {
  return {
    winnerHorseId: result.winnerHorseId,
    winnerHorseName: horsesById.get(result.winnerHorseId)?.name ?? "Winner",
    runnerUpHorseId: result.runnerUpHorseId ?? null,
    runnerUpHorseName: result.runnerUpHorseId ? horsesById.get(result.runnerUpHorseId)?.name ?? null : null,
    thirdHorseId: result.thirdHorseId ?? null,
    thirdHorseName: result.thirdHorseId ? horsesById.get(result.thirdHorseId)?.name ?? null : null,
    recordedAt: result.officialAt.toISOString(),
    notes: result.notes ?? null,
    topPickCorrect: topPrediction ? topPrediction.horseId === result.winnerHorseId : null,
  };
}

export async function buildRaceForecastCards(races?: RaceRow[]): Promise<RaceForecastCard[]> {
  const raceRows = races ?? (await db.select().from(racesTable).orderBy(racesTable.meetingDate, racesTable.raceTime));
  const raceIds = raceRows.map((race) => race.id);
  if (raceIds.length === 0) return [];

  const allHorses = await db.select().from(horsesTable);
  const allPredictions = await db.select().from(predictionsTable).orderBy(predictionsTable.rank);
  const allResults = await db.select().from(raceResultsTable);

  const horsesByRace = new Map<number, HorseRow[]>();
  const predictionsByRace = new Map<number, PredictionRow[]>();
  const resultsByRace = new Map<number, ResultRow>();
  const horsesById = new Map<number, HorseRow>();

  for (const horse of allHorses) {
    horsesById.set(horse.id, horse);
    const list = horsesByRace.get(horse.raceId) ?? [];
    list.push(horse);
    horsesByRace.set(horse.raceId, list);
  }

  for (const prediction of allPredictions) {
    const list = predictionsByRace.get(prediction.raceId) ?? [];
    list.push(prediction);
    predictionsByRace.set(prediction.raceId, list);
  }

  for (const result of allResults) {
    resultsByRace.set(result.raceId, result);
  }

  return raceRows.map((race) => {
    const racePredictions = (predictionsByRace.get(race.id) ?? []).sort((left, right) => left.rank - right.rank);
    const topPredictions = racePredictions.slice(0, 3).map((prediction) => mapPredictionSummary(prediction, horsesById));
    const topPrediction = topPredictions[0] ?? null;
    const resultRow = resultsByRace.get(race.id);
    const timeProfile = getRaceTimeProfile(race.raceTime, race.meetingDate);

    return {
      id: race.id,
      raceNumber: race.raceNumber,
      name: race.name,
      venue: race.venue,
      distance: race.distance,
      raceTime: race.raceTime,
      meetingDate: race.meetingDate ?? null,
      status: race.status,
      surface: race.surface,
      grade: race.grade ?? null,
      prize: race.prize ?? null,
      horseCount: (horsesByRace.get(race.id) ?? []).length,
      nextUpdateAt: race.nextUpdateAt?.toISOString() ?? null,
      lastAnalyzedAt: race.lastAnalyzedAt?.toISOString() ?? null,
      createdAt: race.createdAt.toISOString(),
      syncedFrom: race.syncedFrom ?? null,
      isToday: isDateToday(race.meetingDate),
      isThisWeek: isDateWithinDays(race.meetingDate, 7),
      dayLabel: getRelativeDayLabel(race.meetingDate),
      minutesToRace: getMinutesToRace(race.raceTime, race.meetingDate),
      forecastBand: topPrediction?.confidenceBand ?? timeProfile.band,
      prominence: timeProfile.prominence,
      topPrediction,
      topPredictions,
      result: resultRow ? mapResultSummary(resultRow, horsesById, topPrediction) : null,
    };
  });
}

function strongestEdge(row: LearningRow | undefined): string | null {
  if (!row) return null;
  const entries = Object.entries(row.factorAdjustments ?? {}) as Array<[keyof LearningRow["factorAdjustments"], number]>;
  const best = entries.sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))[0];
  if (!best || Math.abs(best[1]) < 0.005) return null;

  const labels: Record<string, string> = {
    courseForm: "Course form",
    formDistance: "Form and distance",
    jockeyTrainer: "Jockey and trainer",
    oddsMovement: "Odds movement",
    history: "History",
  };

  return `${labels[best[0]] ?? best[0]} ${best[1] > 0 ? "running hot" : "needs caution"}`;
}

export async function getLearningPerformanceSummary(): Promise<LearningPerformanceSummary> {
  const [learning] = await db.select().from(learningFeedbackTable).limit(1);
  const recentResults = await db
    .select()
    .from(raceResultsTable)
    .orderBy(desc(raceResultsTable.officialAt))
    .limit(5);

  const races = await db.select().from(racesTable);
  const horses = await db.select().from(horsesTable);
  const predictions = await db.select().from(predictionsTable).orderBy(predictionsTable.rank);

  const raceMap = new Map(races.map((race) => [race.id, race]));
  const horseMap = new Map(horses.map((horse) => [horse.id, horse]));
  const topPredictionsByRace = new Map<number, PredictionRow>();

  for (const prediction of predictions) {
    if (prediction.rank !== 1 || topPredictionsByRace.has(prediction.raceId)) continue;
    topPredictionsByRace.set(prediction.raceId, prediction);
  }

  return {
    sampleSize: learning?.sampleSize ?? 0,
    topPickWinRate: learning?.topPickWinRate ?? 0,
    placedRate: learning?.placedRate ?? 0,
    averageConfidence: learning?.averageConfidence ?? 0,
    confidenceBias: learning?.confidenceBias ?? 0,
    factorAdjustments: learning?.factorAdjustments ?? {
      courseForm: 0,
      formDistance: 0,
      jockeyTrainer: 0,
      oddsMovement: 0,
      history: 0,
    },
    strongestEdge: strongestEdge(learning),
    recentResults: recentResults.map((result) => {
      const topPrediction = topPredictionsByRace.get(result.raceId);
      return {
        raceId: result.raceId,
        raceName: raceMap.get(result.raceId)?.name ?? `Race ${result.raceId}`,
        meetingDate: raceMap.get(result.raceId)?.meetingDate ?? null,
        topPickHorseName: topPrediction ? horseMap.get(topPrediction.horseId)?.name ?? null : null,
        winnerHorseName: horseMap.get(result.winnerHorseId)?.name ?? "Winner",
        topPickCorrect: topPrediction?.horseId === result.winnerHorseId,
      };
    }),
  };
}

export function buildWeeklyOverview(cards: RaceForecastCard[]): WeeklyOverviewDay[] {
  const grouped = new Map<string, RaceForecastCard[]>();

  for (const card of cards.filter((card) => card.isThisWeek)) {
    const dateKey = card.meetingDate ?? "unscheduled";
    const list = grouped.get(dateKey) ?? [];
    list.push(card);
    grouped.set(dateKey, list);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dayCards]) => {
      const spotlight = [...dayCards].sort((left, right) => {
        const leftConfidence = left.topPrediction?.confidence ?? 0;
        const rightConfidence = right.topPrediction?.confidence ?? 0;
        return rightConfidence - leftConfidence || right.prominence - left.prominence;
      })[0];

      return {
        date,
        label: getRelativeDayLabel(date),
        raceCount: dayCards.length,
        analyzedCount: dayCards.filter((card) => card.topPrediction).length,
        completedCount: dayCards.filter((card) => card.status === "completed").length,
        venues: [...new Set(dayCards.map((card) => card.venue))],
        spotlightRaceId: spotlight?.id ?? null,
        spotlightRaceName: spotlight?.name ?? null,
        spotlightHorseName: spotlight?.topPrediction?.horseName ?? null,
        spotlightConfidence: spotlight?.topPrediction?.confidence ?? null,
      };
    });
}

export function summarizePredictionFactors(prediction: PredictionRow): string[] {
  const factors = prediction.factors as PredictionFactorBreakdown;
  return Object.entries(factors)
    .filter(([key]) => key !== "overall")
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, 2)
    .map(([key, value]) => `${key}:${Math.round(Number(value) * 100)}%`);
}
