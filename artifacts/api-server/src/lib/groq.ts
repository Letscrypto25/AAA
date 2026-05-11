import Groq from "groq-sdk";
import { logger } from "./logger";
import { getMinutesToRace } from "./race-time";

const MODEL = "llama-3.3-70b-versatile";

let client: Groq | null = null;

export function getGroqClient(): Groq {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  if (!client) client = new Groq({ apiKey });
  return client;
}

export interface HorseData {
  name: string;
  number: number;
  jockey: string;
  trainer: string;
  form: string;
  currentOdds: number;
  openingOdds?: number | null;
  oddsMovement: string;
  courseRecord: boolean;
  distanceRecord: boolean;
  trainerJockeyRecord: string;
  notes?: string | null;
  weight?: number | null;
  scratched?: boolean;
}

export interface RaceData {
  name: string;
  venue: string;
  distance: number;
  surface: string;
  grade?: string | null;
  raceTime: string;
  meetingDate?: string | null;
}

export interface WeightConfig {
  courseForm: number;
  formDistance: number;
  jockeyTrainer: number;
  oddsMovement: number;
  history: number;
}

export interface HorsePrediction {
  horseIndex: number;
  runnerNumber?: number;
  score: number;
  confidence: number;
  factors: {
    courseForm: number;
    formDistance: number;
    jockeyTrainer: number;
    oddsMovement: number;
    history: number;
    overall: number;
  };
  aiSummary: string;
}

export interface GeneratedHorse {
  name: string;
  number: number;
  jockey: string;
  trainer: string;
  form: string;
  weight: number;
  currentOdds: number;
  openingOdds: number;
  barrierNumber: number;
  courseRecord: boolean;
  distanceRecord: boolean;
  trainerJockeyRecord: string;
  age: number;
}

export interface OddsUpdate {
  horseIndex: number;
  newOdds: number;
  scratched: boolean;
  scratchReason?: string;
}

const SA_JOCKEYS = [
  "A. Marcus",
  "G. Lerena",
  "R. Fourie",
  "C. Zackey",
  "L. Hewitson",
  "S. Zungu",
  "W. Kennedy",
  "L. Ferraris",
  "M. Yeni",
  "R. Veira",
  "G. van Niekerk",
  "C. Orffer",
  "C. Murray",
  "S. Moodley",
  "A. Domeyer",
  "K. Nkosi",
  "S. Septoo",
  "B. Fayd'herbe",
  "P. Strydom",
];

const SA_TRAINERS = [
  "M. de Kock",
  "C. Bass-Robinson",
  "J. Snaith",
  "P. Peter",
  "S. Tarry",
  "D. Kannemeyer",
  "J. Ramsden",
  "W. Marwing",
  "A. Marcus",
  "G. Kotzen",
  "G. Woodruff",
  "D. Nieuwenhuizen",
  "C. Laird",
  "G. van Zyl",
  "N. Grove",
  "M. Gabb",
  "R. Budagh",
  "F. Robinson",
];

export async function generateHorseField(
  race: {
    name: string;
    venue: string;
    distance: number;
    surface: string;
    raceNumber: number;
    meetingDate?: string;
  },
  fieldSize: number = 10,
): Promise<GeneratedHorse[]> {
  const prompt = `You are an expert South African horse racing analyst. Generate a realistic field of ${fieldSize} horses for this race.

Race: ${race.name}
Venue: ${race.venue}
Distance: ${race.distance}m
Surface: ${race.surface}
Date: ${race.meetingDate ?? "today"}

Use these real South African jockeys (pick from this list): ${SA_JOCKEYS.join(", ")}
Use these real South African trainers (pick from this list): ${SA_TRAINERS.join(", ")}

Generate realistic South African horse names (2-3 words, can be English, Afrikaans, or Zulu-inspired).
Make one horse a clear favourite (odds 2.0-3.5), 2-3 contenders (4.0-8.0), and the rest at 8.0-25.0.
Form strings: use recent results like "1-2-3-1" (1=win, 2=2nd, 3=3rd, 0=unplaced).
Weights: 52-62 kg range. Ages: 3-7 years.

Respond with ONLY valid JSON:
{
  "horses": [
    {
      "name": "Silvano Spirit",
      "number": 1,
      "jockey": "G. Lerena",
      "trainer": "M. de Kock",
      "form": "1-2-1-3",
      "weight": 58.5,
      "currentOdds": 2.8,
      "openingOdds": 3.2,
      "barrierNumber": 4,
      "courseRecord": true,
      "distanceRecord": true,
      "trainerJockeyRecord": "4 wins from 11 starts together",
      "age": 5
    }
  ]
}`;

  const response = await getGroqClient().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.8,
    max_tokens: 3000,
  });

  const content = response.choices[0]?.message?.content ?? "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in horse field response");
  const parsed = JSON.parse(jsonMatch[0]) as { horses: GeneratedHorse[] };
  return parsed.horses.slice(0, fieldSize);
}

export async function refreshOddsAndScratches(
  race: RaceData,
  horses: HorseData[],
): Promise<OddsUpdate[]> {
  const minsToRace = getMinutesToRace(race.raceTime, race.meetingDate) ?? 0;
  const horseList = horses
    .map(
      (horse, index) =>
        `${index}: ${horse.name} (${horse.number}) - Jockey: ${horse.jockey} - Current: ${horse.currentOdds} - Scratched: ${horse.scratched ?? false}`,
    )
    .join("\n");

  const prompt = `You are a South African racing market analyst. Update the odds for this race.

Race: ${race.name} at ${race.venue}, ${race.distance}m, ${race.raceTime}
Date: ${race.meetingDate ?? "today"}
Time until race: ${minsToRace > 0 ? `${minsToRace} minutes` : "race has passed"}

Current runners:
${horseList}

Simulate realistic market movement (${minsToRace < 30 ? "late betting, more significant moves" : "early market, subtle moves"}).
- Shorten the favourite slightly, drift outsiders slightly
- Only scratch a horse if there's a plausible reason (injury, jockey change, etc.)
- Maximum 1 scratch per update
- Keep odds realistic (favourite no lower than 1.8, outsiders no higher than 35.0)

Respond with ONLY valid JSON:
{
  "updates": [
    { "horseIndex": 0, "newOdds": 2.6, "scratched": false },
    { "horseIndex": 1, "newOdds": 4.2, "scratched": false, "scratchReason": null }
  ]
}`;

  const response = await getGroqClient().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    max_tokens: 800,
  });

  const content = response.choices[0]?.message?.content ?? "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in odds refresh response");
  const parsed = JSON.parse(jsonMatch[0]) as { updates: OddsUpdate[] };
  return parsed.updates;
}

export async function analyzeRaceWithAI(
  race: RaceData,
  horses: HorseData[],
  weights: WeightConfig,
): Promise<HorsePrediction[]> {
  const activeHorses = horses.filter((horse) => !horse.scratched);
  if (activeHorses.length === 0) return [];

  const horseDescriptions = activeHorses
    .map(
      (horse, index) =>
        `${index + 1}. ${horse.name} (#${horse.number})
   - Jockey: ${horse.jockey}, Trainer: ${horse.trainer}
   - Form: ${horse.form || "Unknown"}
   - Odds: ${horse.currentOdds} (Opening: ${horse.openingOdds ?? "N/A"}, Movement: ${horse.oddsMovement})
   - Course Record: ${horse.courseRecord ? "Yes" : "No"}
   - Distance Record: ${horse.distanceRecord ? "Yes" : "No"}
   - Trainer/Jockey Partnership: ${horse.trainerJockeyRecord || "Unknown"}
   - Weight: ${horse.weight ?? "Unknown"}
   ${horse.notes ? `- Notes: ${horse.notes}` : ""}`,
    )
    .join("\n\n");

  const prompt = `You are an expert horse racing analyst. Analyze this race and score each horse.

RACE: ${race.name}
Venue: ${race.venue}
Distance: ${race.distance}m
Surface: ${race.surface}
Grade: ${race.grade ?? "Open"}
Time: ${race.raceTime}
Date: ${race.meetingDate ?? "today"}

HORSES:
${horseDescriptions}

WEIGHTING FACTORS:
- Course Form (horse's record at this venue): ${(weights.courseForm * 100).toFixed(0)}%
- Form & Distance (recent form + suitability for this distance): ${(weights.formDistance * 100).toFixed(0)}%
- Jockey/Trainer (quality of booking, partnership record): ${(weights.jockeyTrainer * 100).toFixed(0)}%
- Odds Movement (market intelligence - shortening = confidence): ${(weights.oddsMovement * 100).toFixed(0)}%
- History (overall historical performance at this level): ${(weights.history * 100).toFixed(0)}%

For each horse provide factor scores (0.0-1.0), overall weighted score, confidence, and 1-sentence analysis.
Use the official runner number shown as #N as the horse identity. Keep that runner number exact and return it in the JSON.

Respond with ONLY valid JSON:
{
  "predictions": [
    {
      "horseIndex": 0,
      "runnerNumber": 4,
      "factors": { "courseForm": 0.7, "formDistance": 0.8, "jockeyTrainer": 0.9, "oddsMovement": 0.6, "history": 0.75, "overall": 0.77 },
      "score": 0.77,
      "confidence": 0.72,
      "aiSummary": "Strong course performer with a top jockey booking."
    }
  ]
}`;

  const response = await getGroqClient().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content ?? "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in response");
  const parsed = JSON.parse(jsonMatch[0]) as { predictions: HorsePrediction[] };
  const seenHorseIndexes = new Set<number>();

  return parsed.predictions.flatMap((prediction) => {
    const runnerNumber = Number(prediction.runnerNumber);
    const activeHorse = Number.isFinite(runnerNumber)
      ? activeHorses.find((horse) => horse.number === runnerNumber)
      : prediction.horseIndex >= 0 && prediction.horseIndex < activeHorses.length
        ? activeHorses[prediction.horseIndex]
        : undefined;

    if (!activeHorse) return [];

    const realIndex = horses.findIndex((horse) => horse.number === activeHorse.number);
    if (realIndex < 0 || seenHorseIndexes.has(realIndex)) return [];

    seenHorseIndexes.add(realIndex);
    return [{ ...prediction, horseIndex: realIndex, runnerNumber: activeHorse.number }];
  });
}

export interface ChatWeightSuggestion {
  courseForm?: number;
  formDistance?: number;
  jockeyTrainer?: number;
  oddsMovement?: number;
  history?: number;
}

export type ChatActionSuggestion =
  | { type: "sync" }
  | { type: "analyze"; scope: "focus" | "today" };

const WEIGHT_KEYS = ["courseForm", "formDistance", "jockeyTrainer", "oddsMovement", "history"] as const;
const WEIGHT_LABELS: Array<{ key: keyof WeightConfig; patterns: RegExp[] }> = [
  { key: "courseForm", patterns: [/course\s*form/i, /course/i] },
  { key: "formDistance", patterns: [/form\s*(?:and|&)?\s*distance/i, /distance/i, /form/i] },
  { key: "jockeyTrainer", patterns: [/jockey\s*(?:and|&)?\s*trainer/i, /trainer\s*\/\s*jockey/i, /jockey/i, /trainer/i] },
  { key: "oddsMovement", patterns: [/odds\s*movement/i, /market/i, /odds/i] },
  { key: "history", patterns: [/history/i, /historical/i, /class/i] },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeWeights(weights: WeightConfig): WeightConfig {
  const sanitized = {
    courseForm: clamp(Number(weights.courseForm) || 0, 0.01, 0.8),
    formDistance: clamp(Number(weights.formDistance) || 0, 0.01, 0.8),
    jockeyTrainer: clamp(Number(weights.jockeyTrainer) || 0, 0.01, 0.8),
    oddsMovement: clamp(Number(weights.oddsMovement) || 0, 0.01, 0.8),
    history: clamp(Number(weights.history) || 0, 0.01, 0.8),
  };
  const total = Object.values(sanitized).reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return weights;

  return {
    courseForm: sanitized.courseForm / total,
    formDistance: sanitized.formDistance / total,
    jockeyTrainer: sanitized.jockeyTrainer / total,
    oddsMovement: sanitized.oddsMovement / total,
    history: sanitized.history / total,
  };
}

function buildSingleFactorAdjustment(currentWeights: WeightConfig, key: keyof WeightConfig, delta: number): WeightConfig {
  const next = { ...currentWeights };
  next[key] = Math.min(0.6, Math.max(0.05, next[key] + delta));

  const others = WEIGHT_KEYS.filter((candidate) => candidate !== key);
  const otherTotal = others.reduce((sum, candidate) => sum + currentWeights[candidate], 0);
  const remaining = Math.max(0.05 * others.length, 1 - next[key]);

  for (const other of others) {
    const share = otherTotal > 0 ? currentWeights[other] / otherTotal : 1 / others.length;
    next[other] = remaining * share;
  }

  return normalizeWeights(next);
}

function tryParseWeightSuggestions(message: string, currentWeights: WeightConfig): ChatWeightSuggestion | undefined {
  const text = message.trim();
  if (!/weight/i.test(text) && !/course|distance|jockey|trainer|odds|history|market/i.test(text)) {
    return undefined;
  }

  const explicit: Partial<WeightConfig> = {};
  for (const { key, patterns } of WEIGHT_LABELS) {
    for (const pattern of patterns) {
      const match = text.match(new RegExp(`${pattern.source}[^\\d]{0,20}(\\d{1,3})(?:\\s*%?)`, "i"));
      if (match) {
        explicit[key] = Number(match[1]) / 100;
        break;
      }
    }
  }

  if (Object.keys(explicit).length >= 2) {
    return normalizeWeights({ ...currentWeights, ...explicit });
  }

  const orderedNumbers = [...text.matchAll(/(\d{1,3})(?:\s*%)/g)].map((match) => Number(match[1]) / 100);
  if (/weights?/i.test(text) && orderedNumbers.length === 5) {
    return normalizeWeights({
      courseForm: orderedNumbers[0],
      formDistance: orderedNumbers[1],
      jockeyTrainer: orderedNumbers[2],
      oddsMovement: orderedNumbers[3],
      history: orderedNumbers[4],
    });
  }

  const increase = /\b(increase|more|raise|boost|up|higher)\b/i.test(text);
  const decrease = /\b(decrease|less|lower|reduce|down)\b/i.test(text);
  const requestedFactor = WEIGHT_LABELS.find(({ patterns }) => patterns.some((pattern) => pattern.test(text)))?.key;

  if (requestedFactor && (increase || decrease || /important/i.test(text))) {
    const delta = decrease && !increase ? -0.05 : 0.05;
    return buildSingleFactorAdjustment(currentWeights, requestedFactor, delta);
  }

  return undefined;
}

function dedupeActionSuggestions(actions: ChatActionSuggestion[]): ChatActionSuggestion[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.type}:${"scope" in action ? action.scope : "none"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tryParseActionSuggestions(message: string, hasFocusRace: boolean): ChatActionSuggestion[] {
  const text = message.trim().toLowerCase();
  if (!text) return [];

  const suggestions: ChatActionSuggestion[] = [];

  if (/\b(sync|refresh)\b/.test(text) && /\b(card|board|feed|races?|meetings?|today|now)\b/.test(text)) {
    suggestions.push({ type: "sync" });
  }

  if (/\b(analy[sz]e|run|refresh)\b/.test(text) && /\b(today|live|card|board|all races|all live)\b/.test(text)) {
    suggestions.push({ type: "analyze", scope: "today" });
  } else if (hasFocusRace && /\b(analy[sz]e|run|refresh)\b/.test(text) && /\b(this race|focused race|focus|selected race)\b/.test(text)) {
    suggestions.push({ type: "analyze", scope: "focus" });
  } else if (hasFocusRace && /\b(analy[sz]e|run forecast|refresh forecast)\b/.test(text)) {
    suggestions.push({ type: "analyze", scope: "focus" });
  }

  return dedupeActionSuggestions(suggestions);
}

function parseActionBlock(raw: string): ChatActionSuggestion | null {
  try {
    const parsed = JSON.parse(raw) as { type?: string; scope?: string };
    if (parsed.type === "sync") return { type: "sync" };
    if (parsed.type === "analyze" && (parsed.scope === "focus" || parsed.scope === "today")) {
      return { type: "analyze", scope: parsed.scope };
    }
  } catch {
    logger.warn("Failed to parse action suggestion from AI");
  }
  return null;
}

function extractActionSuggestions(content: string): ChatActionSuggestion[] {
  const matches = [...content.matchAll(/<action>([\s\S]*?)<\/action>/g)];
  return dedupeActionSuggestions(
    matches
      .map((match) => parseActionBlock(match[1]))
      .filter((action): action is ChatActionSuggestion => Boolean(action)),
  );
}

export function inferChatControlsFromMessage(
  message: string,
  currentWeights: WeightConfig,
  hasFocusRace: boolean,
): {
  weightSuggestions?: ChatWeightSuggestion;
  actionSuggestions: ChatActionSuggestion[];
} {
  return {
    weightSuggestions: tryParseWeightSuggestions(message, currentWeights),
    actionSuggestions: tryParseActionSuggestions(message, hasFocusRace),
  };
}

export async function chatWithAI(
  message: string,
  currentWeights: WeightConfig,
  chatHistory: Array<{ role: "user" | "assistant"; content: string }>,
  raceDayBriefing?: string,
  hasFocusRace: boolean = false,
): Promise<{ reply: string; weightSuggestions?: ChatWeightSuggestion; actionSuggestions: ChatActionSuggestion[] }> {
  const inferredControls = inferChatControlsFromMessage(message, currentWeights, hasFocusRace);
  const systemPrompt = `You are AAA Bets - an expert South African horse racing analyst and AI betting advisor. You have full visibility of today's card, the coming week, recent graded results, live odds movement, and the model's current hit rate.

The live FORECAST CONTEXT below is the source of truth. If older chat history conflicts with it, trust the live FORECAST CONTEXT and say so plainly.

## YOUR CAPABILITIES
- Race analysis: Break down any race, compare the field, identify value bets and dangers
- Best bet selection: Give a confident single best bet or each-way selection with clear reasoning
- Jockey and trainer intelligence: Know which SA jockeys and trainers are in form and which partnerships fire
- Odds reading: Interpret market moves - shortening horses show market confidence, drifters suggest trouble
- Weight adjustment: Optimise the 5 prediction factors for the card conditions
- Scratch impact: Assess how a scratch affects the remaining field and revise selections
- Weekly planning: Compare today's card with the next 7 days and explain where confidence is strongest
- Model review: Mention recent hits or misses when that changes how aggressive the advice should be
- App control: When the user explicitly tells you to sync or analyze, request the action using the control tag below

## CURRENT PREDICTION WEIGHTS
- Course Form: ${(currentWeights.courseForm * 100).toFixed(0)}% - venue suitability
- Form & Distance: ${(currentWeights.formDistance * 100).toFixed(0)}% - recent runs plus trip suitability
- Jockey/Trainer: ${(currentWeights.jockeyTrainer * 100).toFixed(0)}% - booking strength and partnership
- Odds Movement: ${(currentWeights.oddsMovement * 100).toFixed(0)}% - market intelligence
- History: ${(currentWeights.history * 100).toFixed(0)}% - class and historical level

## FORECAST CONTEXT
${raceDayBriefing ?? "No race data loaded yet - tell the user to click Sync on the Dashboard."}

## HOW TO RESPOND
- Be direct, confident, and specific - name horses, quote odds, cite form figures
- When giving a best bet, format it clearly: **BEST BET: [Horse Name] @ [odds] in Race [N]**
- For multi-race or multi-day asks, rank the races by confidence and explain why one card is stronger than another
- Mention if the model was recently right or wrong when that matters
- When the user asks what is going on, summarise the current live races, standout horse, model edge, and recent result lessons from the FORECAST CONTEXT
- If the user asks to set, change, increase, decrease, or rebalance weights, either confirm the new mix or recommend one, and include the weights tag
- When suggesting weight changes, include the weights tag
- Runner numbers shown in the FORECAST CONTEXT are authoritative; preserve the exact #number when discussing a horse
- Never claim a sync or forecast refresh has already happened unless the app confirms it afterwards
- If the user explicitly asks you to run a sync or forecast refresh, keep the prose brief and append the control tag
- Keep responses focused - do not pad
- Use SA racing terminology: "the favourite", "each-way", "trifecta", "the rail", "outside draw"

## WEIGHT ADJUSTMENT
When you recommend changing weights, append this block (and ONLY when actually changing them):
<weights>{"courseForm": 0.30, "formDistance": 0.25, "jockeyTrainer": 0.20, "oddsMovement": 0.15, "history": 0.10}</weights>
Weights must sum to exactly 1.0.

## APP ACTION TAGS
Use these only when the user clearly asked for the action:
<action>{"type":"sync"}</action>
<action>{"type":"analyze","scope":"focus"}</action>
<action>{"type":"analyze","scope":"today"}</action>`;

  const messages = [
    ...chatHistory.slice(-8).map((entry) => ({ role: entry.role, content: entry.content })),
    { role: "user" as const, content: message },
  ];

  const response = await getGroqClient().chat.completions.create({
    model: MODEL,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    temperature: 0.5,
    max_tokens: 1024,
  });

  const content = response.choices[0]?.message?.content ?? "I couldn't process that request.";
  const weightsMatch = content.match(/<weights>([\s\S]*?)<\/weights>/);
  const actionSuggestions = extractActionSuggestions(content);
  const reply = content
    .replace(/<weights>[\s\S]*?<\/weights>/g, "")
    .replace(/<action>[\s\S]*?<\/action>/g, "")
    .trim();
  let weightSuggestions: ChatWeightSuggestion | undefined;

  if (weightsMatch) {
    try {
      weightSuggestions = normalizeWeights(JSON.parse(weightsMatch[1]) as WeightConfig);
    } catch {
      logger.warn("Failed to parse weight suggestions from AI");
    }
  }

  if (!weightSuggestions) {
    weightSuggestions = inferredControls.weightSuggestions;
  }

  return {
    reply,
    weightSuggestions,
    actionSuggestions: actionSuggestions.length > 0 ? actionSuggestions : inferredControls.actionSuggestions,
  };
}
