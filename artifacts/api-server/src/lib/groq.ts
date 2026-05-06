import Groq from "groq-sdk";
import { logger } from "./logger";

let _client: Groq | null = null;

export function getGroqClient(): Groq {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }
  if (!_client) {
    _client = new Groq({ apiKey });
  }
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

export async function analyzeRaceWithAI(
  race: RaceData,
  horses: HorseData[],
  weights: WeightConfig,
): Promise<HorsePrediction[]> {
  const client = getGroqClient();

  const horseDescriptions = horses.map((h, i) =>
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

WEIGHTING FACTORS (how much each factor contributes to the overall score):
- Course Form (horse's record at this venue): ${(weights.courseForm * 100).toFixed(0)}%
- Form & Distance (recent form + suitability for this distance): ${(weights.formDistance * 100).toFixed(0)}%
- Jockey/Trainer (quality of booking, partnership record): ${(weights.jockeyTrainer * 100).toFixed(0)}%
- Odds Movement (market intelligence - shortening = confidence): ${(weights.oddsMovement * 100).toFixed(0)}%
- History (overall historical performance at this level): ${(weights.history * 100).toFixed(0)}%

For each horse, provide:
1. A score for EACH factor (0.0 to 1.0 where 1.0 is best)
2. An overall weighted score (0.0 to 1.0)
3. A confidence level (0.0 to 1.0)
4. A brief 1-sentence analysis

Respond with ONLY valid JSON in this exact format:
{
  "predictions": [
    {
      "horseIndex": 0,
      "factors": {
        "courseForm": 0.7,
        "formDistance": 0.8,
        "jockeyTrainer": 0.9,
        "oddsMovement": 0.6,
        "history": 0.75,
        "overall": 0.77
      },
      "score": 0.77,
      "confidence": 0.72,
      "aiSummary": "Strong course performer with a top jockey booking and shortening odds suggest market confidence."
    }
  ]
}`;

  const response = await client.chat.completions.create({
    model: "llama3-70b-8192",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content ?? "";

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.predictions as HorsePrediction[];
  } catch (err) {
    logger.error({ err, content }, "Failed to parse AI response");
    return horses.map((_, i) => ({
      horseIndex: i,
      score: 0.5,
      confidence: 0.3,
      factors: {
        courseForm: 0.5,
        formDistance: 0.5,
        jockeyTrainer: 0.5,
        oddsMovement: 0.5,
        history: 0.5,
        overall: 0.5,
      },
      aiSummary: "Analysis unavailable - using default scoring.",
    }));
  }
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

  const systemPrompt = `You are AAA Bets AI assistant, an expert horse racing analyst and betting advisor. 
You help users understand race predictions and can adjust the prediction weighting factors when asked.

Current prediction weights:
- Course Form: ${(currentWeights.courseForm * 100).toFixed(0)}%
- Form & Distance: ${(currentWeights.formDistance * 100).toFixed(0)}%
- Jockey/Trainer: ${(currentWeights.jockeyTrainer * 100).toFixed(0)}%
- Odds Movement: ${(currentWeights.oddsMovement * 100).toFixed(0)}%
- History: ${(currentWeights.history * 100).toFixed(0)}%

${raceContext ? `Current race context:\n${raceContext}\n` : ""}

When users ask to change weights, respond with a JSON block at the end of your message like:
<weights>{"courseForm": 0.3, "formDistance": 0.2, "jockeyTrainer": 0.25, "oddsMovement": 0.15, "history": 0.1}</weights>

Make sure weights sum to 1.0. Only include the weights block if you're actually changing them.
Be conversational, insightful, and helpful. Keep responses concise but informative.`;

  const messages = [
    ...chatHistory.slice(-8).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: message },
  ];

  const response = await client.chat.completions.create({
    model: "llama3-70b-8192",
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    temperature: 0.7,
    max_tokens: 1024,
  });

  const content = response.choices[0]?.message?.content ?? "I couldn't process that request.";

  const weightsMatch = content.match(/<weights>([\s\S]*?)<\/weights>/);
  let weightSuggestions: ChatWeightSuggestion | undefined;

  let reply = content.replace(/<weights>[\s\S]*?<\/weights>/g, "").trim();

  if (weightsMatch) {
    try {
      weightSuggestions = JSON.parse(weightsMatch[1]);
    } catch {
      logger.warn("Failed to parse weight suggestions from AI");
    }
  }

  return { reply, weightSuggestions };
}
