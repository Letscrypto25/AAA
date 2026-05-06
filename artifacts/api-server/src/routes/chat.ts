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
      .values({
        courseForm: 0.25,
        formDistance: 0.25,
        jockeyTrainer: 0.20,
        oddsMovement: 0.15,
        history: 0.15,
      })
      .returning();
  }

  const recentHistory = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(10);

  const history = recentHistory.reverse().map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  let raceContext: string | undefined;
  if (raceId) {
    const [race] = await db.select().from(racesTable).where(eq(racesTable.id, raceId));
    if (race) {
      const raceHorses = await db
        .select()
        .from(horsesTable)
        .where(eq(horsesTable.raceId, raceId));
      const preds = await db
        .select()
        .from(predictionsTable)
        .where(eq(predictionsTable.raceId, raceId))
        .orderBy(predictionsTable.rank);

      raceContext = `Race: ${race.name} at ${race.venue}, ${race.distance}m ${race.surface}
Horses: ${raceHorses.map((h) => `${h.name} (odds: ${h.currentOdds}, ${h.oddsMovement})`).join(", ")}
Current top prediction: ${raceHorses.find((h) => h.id === preds[0]?.horseId)?.name ?? "Not yet analyzed"}`;
    }
  }

  await db.insert(chatMessagesTable).values({
    role: "user",
    content: message,
    raceId: raceId ?? null,
  });

  let aiResult;
  try {
    aiResult = await chatWithAI(message, weights, history, raceContext);
  } catch (_err) {
    aiResult = {
      reply:
        "I'm unable to connect to the AI right now. Please check your GROQ_API_KEY and try again.",
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
