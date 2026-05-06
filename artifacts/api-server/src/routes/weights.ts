import { Router } from "express";
import { db, predictionWeightsTable } from "@workspace/db";
import { UpdateWeightsBody } from "@workspace/api-zod";

const router = Router();

router.get("/weights", async (_req, res): Promise<void> => {
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

  res.json({ ...weights, updatedAt: weights.updatedAt.toISOString() });
});

router.put("/weights", async (req, res): Promise<void> => {
  const body = UpdateWeightsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { courseForm, formDistance, jockeyTrainer, oddsMovement, history } = body.data;
  const total = courseForm + formDistance + jockeyTrainer + oddsMovement + history;

  if (Math.abs(total - 1.0) > 0.01) {
    res.status(400).json({ error: `Weights must sum to 1.0, got ${total.toFixed(3)}` });
    return;
  }

  const [existing] = await db.select().from(predictionWeightsTable).limit(1);

  let weights;
  if (existing) {
    [weights] = await db
      .update(predictionWeightsTable)
      .set({ courseForm, formDistance, jockeyTrainer, oddsMovement, history, updatedAt: new Date() })
      .returning();
  } else {
    [weights] = await db
      .insert(predictionWeightsTable)
      .values({ courseForm, formDistance, jockeyTrainer, oddsMovement, history })
      .returning();
  }

  res.json({ ...weights!, updatedAt: weights!.updatedAt.toISOString() });
});

export default router;
