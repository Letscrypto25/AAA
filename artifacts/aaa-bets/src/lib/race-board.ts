type SearchContext = {
  text?: string;
  horseNames?: string[];
  jockeys?: string[];
  trainers?: string[];
  topPickHorseName?: string | null;
  winnerHorseName?: string | null;
};

export type SearchablePrediction = {
  id?: number;
  horseName?: string;
  confidence?: number;
  resultStatus?: string;
};

export type SearchableResult = {
  winnerHorseName?: string;
  runnerUpHorseName?: string | null;
  thirdHorseName?: string | null;
  recordedAt?: string;
  topPickCorrect?: boolean | null;
};

export type SearchableRaceCard = {
  id: number;
  raceNumber: number;
  name: string;
  venue: string;
  raceTime: string;
  meetingDate?: string | null;
  status: string;
  surface: string;
  distance?: number;
  horseCount?: number;
  grade?: string | null;
  forecastBand?: string;
  isToday: boolean;
  isThisWeek: boolean;
  dayLabel: string;
  minutesToRace?: number | null;
  prominence: number;
  topPrediction?: SearchablePrediction | null;
  topPredictions: SearchablePrediction[];
  result?: SearchableResult | null;
  searchContext?: SearchContext;
};

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return [...new Set(normalizeText(value).split(" ").filter(Boolean))];
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = new Array(right.length + 1).fill(0).map((_, index) => index);
  const current = new Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }

  return previous[right.length];
}

function isLooseSubsequence(query: string, candidate: string): boolean {
  let pointer = 0;
  for (const char of candidate) {
    if (char === query[pointer]) pointer += 1;
    if (pointer >= query.length) return true;
  }
  return false;
}

function scoreCandidate(queryToken: string, candidate: string): number {
  if (!candidate) return 0;
  if (candidate === queryToken) return 1;
  if (candidate.startsWith(queryToken)) return 0.94;
  if (candidate.includes(queryToken)) return 0.78;
  if (queryToken.length >= 4 && candidate.length >= 4) {
    const distance = levenshteinDistance(queryToken, candidate);
    const allowance = queryToken.length >= 7 ? 2 : 1;
    if (distance <= allowance) return distance === 1 ? 0.67 : 0.56;
  }
  if (queryToken.length >= 3 && isLooseSubsequence(queryToken, candidate)) return 0.48;
  return 0;
}

function scoreField(queryToken: string, value: string): number {
  const normalized = normalizeText(value);
  if (!normalized) return 0;

  let best = scoreCandidate(queryToken, normalized);
  for (const token of normalized.split(" ")) {
    best = Math.max(best, scoreCandidate(queryToken, token));
  }
  return best;
}

function buildDateVariants(dateKey?: string | null): string[] {
  if (!dateKey) return [];
  const variants = [dateKey, dateKey.replace(/-/g, "/"), dateKey.replace(/-/g, "")];
  const parsed = new Date(`${dateKey}T12:00:00Z`);
  if (!Number.isNaN(parsed.getTime())) {
    variants.push(
      parsed.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }),
      parsed.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" }),
    );
  }
  return variants;
}

function buildSearchFields(race: SearchableRaceCard): Array<{ weight: number; values: string[] }> {
  const context = race.searchContext;
  const raceNumberValues = [`${race.raceNumber}`, `race ${race.raceNumber}`, `r${race.raceNumber}`];
  const topHorseValues = [
    race.topPrediction?.horseName ?? "",
    ...(race.topPredictions ?? []).map((prediction) => prediction.horseName ?? ""),
    context?.topPickHorseName ?? "",
  ].filter(Boolean);
  const resultValues = [
    race.result?.winnerHorseName ?? "",
    race.result?.runnerUpHorseName ?? "",
    race.result?.thirdHorseName ?? "",
    context?.winnerHorseName ?? "",
  ].filter(Boolean);

  return [
    { weight: 3.3, values: [race.name] },
    { weight: 2.7, values: raceNumberValues },
    { weight: 2.4, values: topHorseValues as string[] },
    { weight: 2.2, values: resultValues as string[] },
    { weight: 1.9, values: context?.horseNames ?? [] },
    { weight: 1.7, values: [race.venue, race.dayLabel] },
    { weight: 1.5, values: context?.jockeys ?? [] },
    { weight: 1.35, values: context?.trainers ?? [] },
    { weight: 1.25, values: [race.grade ?? "", race.surface, race.status] },
    { weight: 1.1, values: buildDateVariants(race.meetingDate) },
    { weight: 0.85, values: [context?.text ?? ""] },
  ];
}

function getSearchScore(race: SearchableRaceCard, query: string): number | null {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;

  const fields = buildSearchFields(race);
  let totalScore = 0;
  let matchedTokens = 0;
  let strongMatches = 0;

  for (const token of tokens) {
    let bestWeightedScore = 0;

    for (const field of fields) {
      let bestFieldScore = 0;
      for (const value of field.values) {
        bestFieldScore = Math.max(bestFieldScore, scoreField(token, value));
      }
      bestWeightedScore = Math.max(bestWeightedScore, bestFieldScore * field.weight);
    }

    if (bestWeightedScore > 0) {
      matchedTokens += 1;
      totalScore += bestWeightedScore;
      if (bestWeightedScore >= 1.1) strongMatches += 1;
    }
  }

  const coverage = matchedTokens / tokens.length;
  const requiredCoverage = tokens.length >= 4 ? 0.72 : tokens.length === 3 ? 0.67 : 0.5;
  if (coverage < requiredCoverage) return null;

  const phraseBoost = fields.reduce((best, field) => {
    return Math.max(best, ...field.values.map((value) => {
      const normalized = normalizeText(value);
      const normalizedQuery = normalizeText(query);
      if (!normalized || !normalizedQuery) return 0;
      if (normalized === normalizedQuery) return field.weight * 1.4;
      if (normalized.includes(normalizedQuery)) return field.weight * 0.9;
      return 0;
    }));
  }, 0);

  return totalScore + coverage * 3 + strongMatches * 0.4 + phraseBoost;
}

export function isHistoryRaceCard(race: Pick<SearchableRaceCard, "minutesToRace" | "result" | "status">): boolean {
  if (race.result) return true;
  if (race.status === "completed" || race.status === "cancelled") return true;
  return typeof race.minutesToRace === "number" && race.minutesToRace <= 0;
}

export function isLiveRaceCard(race: Pick<SearchableRaceCard, "minutesToRace" | "result" | "status">): boolean {
  return !isHistoryRaceCard(race);
}

export function sortLiveRaceCards<T extends SearchableRaceCard>(races: T[]): T[] {
  return [...races].sort((left, right) => {
    const leftMinutes = left.minutesToRace ?? Number.MAX_SAFE_INTEGER;
    const rightMinutes = right.minutesToRace ?? Number.MAX_SAFE_INTEGER;
    return (right.isToday ? 1 : 0) - (left.isToday ? 1 : 0)
      || leftMinutes - rightMinutes
      || (right.topPrediction?.confidence ?? 0) - (left.topPrediction?.confidence ?? 0)
      || right.prominence - left.prominence
      || left.raceNumber - right.raceNumber;
  });
}

export function sortHistoryRaceCards<T extends SearchableRaceCard>(races: T[]): T[] {
  return [...races].sort((left, right) => {
    const leftRecordedAt = left.result?.recordedAt ? Date.parse(left.result.recordedAt) : Number.NEGATIVE_INFINITY;
    const rightRecordedAt = right.result?.recordedAt ? Date.parse(right.result.recordedAt) : Number.NEGATIVE_INFINITY;
    return rightRecordedAt - leftRecordedAt
      || (right.meetingDate ?? "").localeCompare(left.meetingDate ?? "")
      || right.raceTime.localeCompare(left.raceTime)
      || right.raceNumber - left.raceNumber;
  });
}

export function filterAndRankRaceCards<T extends SearchableRaceCard>(races: T[], query: string): T[] {
  const trimmed = query.trim();
  if (!trimmed) return races;

  return races
    .map((race) => ({ race, score: getSearchScore(race, trimmed) }))
    .filter((entry): entry is { race: T; score: number } => entry.score != null)
    .sort((left, right) => right.score - left.score || right.race.prominence - left.race.prominence)
    .map((entry) => entry.race);
}
