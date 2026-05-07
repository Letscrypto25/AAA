import { Router } from "express";
import {
  db,
  chatMessagesTable,
  predictionWeightsTable,
  racesTable,
  horsesTable,
  predictionsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { SendChatMessageBody } from "@workspace/api-zod";
import { chatWithAI } from "../lib/groq";

const router = Router();

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function oddsArrow(movement: string): string {
  if (movement === "shortening") return "↓";
  if (movement === "drifting") return "↑";
  return "→";
}

async function buildRaceDayBriefing(focusRaceId?: number): Promise<string> {
  const today = todayStr();

  const allRaces = await db
    .select()
    .from(racesTable)
    .orderBy(racesTable.raceTime);

  const todaysRaces = allRaces.filter(
    (r) => r.meetingDate === today || r.status === "upcoming" || r.status === "analyzing",
  );

  if (todaysRaces.length === 0) return "No races loaded for today.";

  const allHorses = await db.select().from(horsesTable);
  const allPreds = await db
    .select()
    .from(predictionsTable)
    .orderBy(predictionsTable.rank);

  const horseMap = new Map<number, typeof allHorses>();
  const predMap = new Map<number, typeof allPreds>();

  for (const h of allHorses) {
    const list = horseMap.get(h.raceId) ?? [];
    list.push(h);
    horseMap.set(h.raceId, list);
  }
  for (const p of allPreds) {
    const list = predMap.get(p.raceId) ?? [];
    list.push(p);
    predMap.set(p.raceId, list);
  }

  const venues = [...new Set(todaysRaces.map((r) => r.venue))];
  const lines: string[] = [
    `TODAY'S RACE CARD — ${venues.join(" & ")} | ${new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`,
    `Total races: ${todaysRaces.length}`,
    "",
  ];

  for (const race of todaysRaces) {
    const isFocus = focusRaceId === race.id;
    const horses = (horseMap.get(race.id) ?? []).sort((a, b) => a.number - b.number);
    const preds = predMap.get(race.id) ?? [];
    const activeHorses = horses.filter((h) => !h.scratched);
    const scratchedHorses = horses.filter((h) => h.scratched);

    lines.push(`${isFocus ? ">>> " : ""}RACE ${race.raceNumber} — ${race.raceTime} | ${race.distance}m ${race.surface}${race.grade ? ` | Grade: ${race.grade}` : ""}${isFocus ? " [FOCUS]" : ""}`);
    lines.push(`  Venue: ${race.venue} | Status: ${race.status}${race.lastAnalyzedAt ? ` | Analyzed: ${new Date(race.lastAnalyzedAt).toLocaleTimeString("en-ZA")}` : " | Not yet analyzed"}`);

    if (activeHorses.length > 0) {
      lines.push(`  Runners (${activeHorses.length}):`);
      for (const h of activeHorses) {
        const pred = preds.find((p) => p.horseId === h.id);
        const scoreStr = pred ? ` | AI: #${pred.rank} ${(pred.score * 100).toFixed(0)}pts (${(pred.confidence * 100).toFixed(0)}% conf)` : "";
        const recordStr = [h.courseRecord && "course record", h.distanceRecord && "dist record"].filter(Boolean).join(", ");
        lines.push(
          `    #${h.number} ${h.name} — ${h.jockey} / ${h.trainer}` +
          ` | Form: ${h.form || "unknown"} | Odds: ${h.currentOdds}${oddsArrow(h.oddsMovement)}` +
          (h.openingOdds && h.openingOdds !== h.currentOdds ? ` (was ${h.openingOdds})` : "") +
          (h.weight ? ` | ${h.weight}kg` : "") +
          (recordStr ? ` | ${recordStr}` : "") +
          (h.trainerJockeyRecord ? ` | TJ: ${h.trainerJockeyRecord}` : "") +
          scoreStr,
        );
        if (pred?.aiSummary) {
          lines.push(`      → "${pred.aiSummary}"`);
        }
      }
    }

    if (scratchedHorses.length > 0) {
      lines.push(`  Scratched: ${scratchedHorses.map((h) => `${h.name}${h.scratchReason ? ` (${h.scratchReason})` : ""}`).join(", ")}`);
    }

    if (preds.length > 0) {
      const top3 = preds.slice(0, 3).map((p) => {
        const h = horses.find((x) => x.id === p.horseId);
        return h ? `${h.name} (${(p.score * 100).toFixed(0)}pts)` : "";
      }).filter(Boolean);
      lines.push(`  AI Top 3: ${top3.join(" | ")}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

router.get("/chat/history", async (_req, res): Promise<void> => {
  const messages = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(50);

  res.json(
    messages.reverse().map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
  );
});

router.post("/chat", async (req, res): Promise<void> => {
  const body = SendChatMessageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { message, raceId } = body.data;

  let [weights] = await db.select().from(predictionWeightsTable).limit(1);
  if (!weights) {
    [weights] = await db
      .insert(predictionWeightsTable)
      .values({ courseForm: 0.25, formDistance: 0.25, jockeyTrainer: 0.20, oddsMovement: 0.15, history: 0.15 })
      .returning();
  }

  const recentHistory = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(12);

  const history = recentHistory.reverse().map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const raceDayBriefing = await buildRaceDayBriefing(raceId);

  await db.insert(chatMessagesTable).values({
    role: "user",
    content: message,
    raceId: raceId ?? null,
  });

  let aiResult;
  try {
    aiResult = await chatWithAI(message, weights, history, raceDayBriefing);
  } catch (_err) {
    aiResult = {
      reply: "I'm unable to connect to the AI right now. Please check your GROQ_API_KEY and try again.",
      weightSuggestions: undefined,
    };
  }

  await db.insert(chatMessagesTable).values({
    role: "assistant",
    content: aiResult.reply,
    raceId: raceId ?? null,
  });

  let updatedWeights = null;
  if (aiResult.weightSuggestions) {
    const s = aiResult.weightSuggestions;
    const newWeights = {
      courseForm: s.courseForm ?? weights.courseForm,
      formDistance: s.formDistance ?? weights.formDistance,
      jockeyTrainer: s.jockeyTrainer ?? weights.jockeyTrainer,
      oddsMovement: s.oddsMovement ?? weights.oddsMovement,
      history: s.history ?? weights.history,
    };
    const total = Object.values(newWeights).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 1.0) < 0.05) {
      const [w] = await db
        .update(predictionWeightsTable)
        .set({ ...newWeights, updatedAt: new Date() })
        .returning();
      updatedWeights = w ? { ...w, updatedAt: w.updatedAt.toISOString() } : null;
    }
  }

  res.json({
    message: aiResult.reply,
    updatedWeights,
    triggeredAnalysis: false,
  });
});

export default router;
