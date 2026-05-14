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

  const {
    courseForm,
    formDistance,
    jockeyTrainer,
    oddsMovement,
    history,
    fieldStrength,
    weightCarried,
    surfaceFit,
    paceProfile,
    priceValue,
  } = body.data;
  const total =
    courseForm +
    formDistance +
    jockeyTrainer +
    oddsMovement +
    history +
    fieldStrength +
    weightCarried +
    surfaceFit +
    paceProfile +
    priceValue;

  if (Math.abs(total - 1.0) > 0.01) {
    res.status(400).json({ error: `Weights must sum to 1.0, got ${total.toFixed(3)}` });
    return;
  }

  const [existing] = await db.select().from(predictionWeightsTable).limit(1);

  let weights;
  if (existing) {
    [weights] = await db
      .update(predictionWeightsTable)
      .set({
        courseForm,
        formDistance,
        jockeyTrainer,
        oddsMovement,
        history,
        fieldStrength,
        weightCarried,
        surfaceFit,
        paceProfile,
        priceValue,
        updatedAt: new Date(),
      })
      .returning();
  } else {
    [weights] = await db
      .insert(predictionWeightsTable)
      .values({
        courseForm,
        formDistance,
        jockeyTrainer,
        oddsMovement,
        history,
        fieldStrength,
        weightCarried,
        surfaceFit,
        paceProfile,
        priceValue,
      })
      .returning();
  }

  res.json({ ...weights!, updatedAt: weights!.updatedAt.toISOString() });
});

export default router;
