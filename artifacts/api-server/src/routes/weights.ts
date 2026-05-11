import { Router } from "express";
import { db, predictionWeightsTable } from "@workspace/db";

const router = Router();

const DEFAULT_WEIGHTS = {
  courseForm: 0.20,
  formDistance: 0.20,
  jockeyTrainer: 0.15,
  oddsMovement: 0.12,
  history: 0.12,
  fieldStrength: 0.10,
  weightCarried: 0.05,
  surfaceFit: 0.03,
  paceProfile: 0.02,
  priceValue: 0.01,
};

const ALL_FACTOR_KEYS = [
  "courseForm", "formDistance", "jockeyTrainer", "oddsMovement", "history",
  "fieldStrength", "weightCarried", "surfaceFit", "paceProfile", "priceValue",
] as const;

function parseWeightsRow(row: typeof predictionWeightsTable.$inferSelect) {
  return {
    id: row.id,
    courseForm: row.courseForm,
    formDistance: row.formDistance,
    jockeyTrainer: row.jockeyTrainer,
    oddsMovement: row.oddsMovement,
    history: row.history,
    // New factors — fall back to defaults if not yet in DB (old rows)
    fieldStrength: (row as any).fieldStrength ?? DEFAULT_WEIGHTS.fieldStrength,
    weightCarried: (row as any).weightCarried ?? DEFAULT_WEIGHTS.weightCarried,
    surfaceFit: (row as any).surfaceFit ?? DEFAULT_WEIGHTS.surfaceFit,
    paceProfile: (row as any).paceProfile ?? DEFAULT_WEIGHTS.paceProfile,
    priceValue: (row as any).priceValue ?? DEFAULT_WEIGHTS.priceValue,
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/weights", async (_req, res): Promise<void> => {
  let [weights] = await db.select().from(predictionWeightsTable).limit(1);

  if (!weights) {
    [weights] = await db
      .insert(predictionWeightsTable)
      .values(DEFAULT_WEIGHTS)
      .returning();
  }

  res.json(parseWeightsRow(weights));
});

router.put("/weights", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;

  // Collect all provided factor values
  const provided: Record<string, number> = {};
  for (const key of ALL_FACTOR_KEYS) {
    const val = body[key];
    if (val !== undefined) {
      const num = Number(val);
      if (!Number.isFinite(num) || num < 0 || num > 1) {
        res.status(400).json({ error: `Invalid value for ${key}: must be 0–1` });
        return;
      }
      provided[key] = num;
    }
  }

  if (Object.keys(provided).length === 0) {
    res.status(400).json({ error: "No valid weight fields provided" });
    return;
  }

  // Validate total
  const total = Object.values(provided).reduce((s, v) => s + v, 0);
  if (Math.abs(total - 1.0) > 0.02) {
    res.status(400).json({ error: `Weights must sum to 1.0, got ${total.toFixed(4)}` });
    return;
  }

  const [existing] = await db.select().from(predictionWeightsTable).limit(1);

  let weightsRow;
  const updatePayload = { ...provided, updatedAt: new Date() };

  if (existing) {
    [weightsRow] = await db
      .update(predictionWeightsTable)
      .set(updatePayload)
      .returning();
  } else {
    [weightsRow] = await db
      .insert(predictionWeightsTable)
      .values({ ...DEFAULT_WEIGHTS, ...provided })
      .returning();
  }

  res.json(parseWeightsRow(weightsRow!));
});

// GET /weights/factors — returns metadata about all 10 factors
router.get("/weights/factors", (_req, res): void => {
  res.json({
    factors: [
      {
        key: "courseForm",
        label: "Course Form",
        description: "Horse's historical record at this specific venue",
        category: "ai",
        defaultWeight: 0.20,
      },
      {
        key: "formDistance",
        label: "Form & Distance",
        description: "Recent form + suitability for this race distance",
        category: "ai",
        defaultWeight: 0.20,
      },
      {
        key: "jockeyTrainer",
        label: "Jockey/Trainer",
        description: "Quality of the jockey booking and trainer-jockey strike rate partnership",
        category: "ai",
        defaultWeight: 0.15,
      },
      {
        key: "oddsMovement",
        label: "Odds Movement",
        description: "Market intelligence — shortening horses show collective confidence",
        category: "ai",
        defaultWeight: 0.12,
      },
      {
        key: "history",
        label: "History",
        description: "Overall historical performance, class record, and career trajectory",
        category: "ai",
        defaultWeight: 0.12,
      },
      {
        key: "fieldStrength",
        label: "Field Strength",
        description: "How weak the opposition is relative to this horse — easy fields boost the score",
        category: "computed",
        defaultWeight: 0.10,
      },
      {
        key: "weightCarried",
        label: "Weight Carried",
        description: "Weight penalty vs rivals — horses carrying less than field average get an edge",
        category: "computed",
        defaultWeight: 0.05,
      },
      {
        key: "surfaceFit",
        label: "Surface Fit",
        description: "Turf vs all-weather preference match for the race surface declared",
        category: "computed",
        defaultWeight: 0.03,
      },
      {
        key: "paceProfile",
        label: "Pace Profile",
        description: "Racing style suitability — sprinters vs stayers aligned to race distance",
        category: "computed",
        defaultWeight: 0.02,
      },
      {
        key: "priceValue",
        label: "Price Value",
        description: "Value edge: model-estimated true probability vs market implied odds",
        category: "computed",
        defaultWeight: 0.01,
      },
    ],
    categories: {
      ai: "Scored by Groq LLaMA 3.3 AI analysis",
      computed: "Calculated from raw data (weights, odds, surface, form patterns)",
    },
  });
});

export default router;
