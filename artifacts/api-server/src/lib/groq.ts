import Groq from "groq-sdk";
import { logger } from "./logger";

const MODEL = "llama-3.3-70b-versatile";

let _client: Groq | null = null;

export function getGroqClient(): Groq {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  if (!_client) _client = new Groq({ apiKey });
  return _client;
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
  "A. Marcus", "G. Lerena", "R. Fourie", "C. Zackey", "L. Hewitson",
  "S. Zungu", "W. Kennedy", "L. Ferraris", "M. Yeni", "R. Veira",
  "G. van Niekerk", "C. Orffer", "C. Murray", "S. Moodley", "A. Domeyer",
  "K. Nkosi", "S. Septoo", "B. Fayd'herbe", "P. Strydom",
];

const SA_TRAINERS = [
  "M. de Kock", "C. Bass-Robinson", "J. Snaith", "P. Peter", "S. Tarry",
  "D. Kannemeyer", "J. Ramsden", "W. Marwing", "A. Marcus", "G. Kotzen",
  "G. Woodruff", "D. Nieuwenhuizen", "C. Laird", "G. van Zyl", "N. Grove",
  "M. Gabb", "R. Budagh", "F. Robinson",
];

export async function generateHorseField(
  race: { name: string; venue: string; distance: number; surface: string; raceNumber: number; meetingDate?: string },
  fieldSize: number = 10,
): Promise<GeneratedHorse[]> {
  const client = getGroqClient();

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

  const response = await client.chat.completions.create({
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
  race: RaceData & { raceTime: string },
  horses: HorseData[],
): Promise<OddsUpdate[]> {
  const client = getGroqClient();

  const now = new Date();
  const [h, m] = race.raceTime.split(":").map(Number);
  const raceMs = new Date().setHours(h, m, 0, 0);
  const minsToRace = Math.round((raceMs - now.getTime()) / 60000);

  const horseList = horses
    .map((h, i) => `${i}: ${h.name} (${h.number}) - Jockey: ${h.jockey} - Current: ${h.currentOdds} - Scratched: ${h.scratched ?? false}`)
    .join("\n");

  const prompt = `You are a South African racing market analyst. Update the odds for this race.

Race: ${race.name} at ${race.venue}, ${race.distance}m, ${race.raceTime}
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

  const response = await client.chat.completions.create({
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
  const client = getGroqClient();

  const activeHorses = horses.filter((h) => !h.scratched);
  if (activeHorses.length === 0) return [];

  const horseDescriptions = activeHorses.map((h, i) =>
    `${i + 1}. ${h.name} (#${h.number})
   - Jockey: ${h.jockey}, Trainer: ${h.trainer}
   - Form: ${h.form || "Unknown"}
   - Odds: ${h.currentOdds} (Opening: ${h.openingOdds ?? "N/A"}, Movement: ${h.oddsMovement})
   - Course Record: ${h.courseRecord ? "Yes" : "No"}
   - Distance Record: ${h.distanceRecord ? "Yes" : "No"}
   - Trainer/Jockey Partnership: ${h.trainerJockeyRecord || "Unknown"}
   - Weight: ${h.weight ?? "Unknown"}
   ${h.notes ? `- Notes: ${h.notes}` : ""}`,
  ).join("\n\n");

  const prompt = `You are an expert horse racing analyst. Analyze this race and score each horse.

RACE: ${race.name}
Venue: ${race.venue}
Distance: ${race.distance}m
Surface: ${race.surface}
Grade: ${race.grade ?? "Open"}
Time: ${race.raceTime}

HORSES:
${horseDescriptions}

WEIGHTING FACTORS:
- Course Form (horse's record at this venue): ${(weights.courseForm * 100).toFixed(0)}%
- Form & Distance (recent form + suitability for this distance): ${(weights.formDistance * 100).toFixed(0)}%
- Jockey/Trainer (quality of booking, partnership record): ${(weights.jockeyTrainer * 100).toFixed(0)}%
- Odds Movement (market intelligence - shortening = confidence): ${(weights.oddsMovement * 100).toFixed(0)}%
- History (overall historical performance at this level): ${(weights.history * 100).toFixed(0)}%

For each horse provide factor scores (0.0-1.0), overall weighted score, confidence, and 1-sentence analysis.

Respond with ONLY valid JSON:
{
  "predictions": [
    {
      "horseIndex": 0,
      "factors": { "courseForm": 0.7, "formDistance": 0.8, "jockeyTrainer": 0.9, "oddsMovement": 0.6, "history": 0.75, "overall": 0.77 },
      "score": 0.77,
      "confidence": 0.72,
      "aiSummary": "Strong course performer with a top jockey booking."
    }
  ]
}`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content ?? "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in response");
  const parsed = JSON.parse(jsonMatch[0]) as { predictions: HorsePrediction[] };

  const allHorses = horses;
  return parsed.predictions.map((p) => {
    const activeHorse = activeHorses[p.horseIndex];
    const realIndex = activeHorse ? allHorses.findIndex((h) => h.name === activeHorse.name) : p.horseIndex;
    return { ...p, horseIndex: realIndex >= 0 ? realIndex : p.horseIndex };
  });
}

export interface ChatWeightSuggestion {
  courseForm?: number;
  formDistance?: number;
  jockeyTrainer?: number;
  oddsMovement?: number;
  history?: number;
}

export async function chatWithAI(
  message: string,
  currentWeights: WeightConfig,
  chatHistory: Array<{ role: "user" | "assistant"; content: string }>,
  raceContext?: string,
): Promise<{ reply: string; weightSuggestions?: ChatWeightSuggestion }> {
  const client = getGroqClient();

  const systemPrompt = `You are AAA Bets AI assistant, an expert South African horse racing analyst and betting advisor.
You help users understand race predictions and can adjust the prediction weighting factors when asked.

Current prediction weights:
- Course Form: ${(currentWeights.courseForm * 100).toFixed(0)}%
- Form & Distance: ${(currentWeights.formDistance * 100).toFixed(0)}%
- Jockey/Trainer: ${(currentWeights.jockeyTrainer * 100).toFixed(0)}%
- Odds Movement: ${(currentWeights.oddsMovement * 100).toFixed(0)}%
- History: ${(currentWeights.history * 100).toFixed(0)}%

${raceContext ? `Current race context:\n${raceContext}\n` : ""}

When users ask to change weights, respond with a JSON block at the end:
<weights>{"courseForm": 0.3, "formDistance": 0.2, "jockeyTrainer": 0.25, "oddsMovement": 0.15, "history": 0.1}</weights>

Make sure weights sum to 1.0. Only include the weights block if actually changing them.
Be conversational, insightful, and helpful. Keep responses concise but informative.`;

  const messages = [
    ...chatHistory.slice(-8).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: message },
  ];

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    temperature: 0.7,
    max_tokens: 1024,
  });

  const content = response.choices[0]?.message?.content ?? "I couldn't process that request.";
  const weightsMatch = content.match(/<weights>([\s\S]*?)<\/weights>/);
  let weightSuggestions: ChatWeightSuggestion | undefined;
  const reply = content.replace(/<weights>[\s\S]*?<\/weights>/g, "").trim();

  if (weightsMatch) {
    try {
      weightSuggestions = JSON.parse(weightsMatch[1]) as ChatWeightSuggestion;
    } catch {
      logger.warn("Failed to parse weight suggestions from AI");
    }
  }

  return { reply, weightSuggestions };
}
