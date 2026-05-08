import { pgTable, serial, text, integer, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type PredictionFactorBreakdown = {
  courseForm: number;
  formDistance: number;
  jockeyTrainer: number;
  oddsMovement: number;
  history: number;
  overall: number;
};

export type PredictionWeightConfig = {
  courseForm: number;
  formDistance: number;
  jockeyTrainer: number;
  oddsMovement: number;
  history: number;
};

export type LearningFactorAdjustments = {
  courseForm: number;
  formDistance: number;
  jockeyTrainer: number;
  oddsMovement: number;
  history: number;
};

export type LearningSummarySnapshot = {
  sampleSize: number;
  topPickWinRate: number;
  placedRate: number;
  averageConfidence: number;
  confidenceBias: number;
  factorAdjustments: LearningFactorAdjustments;
};

export const racesTable = pgTable("races", {
  id: serial("id").primaryKey(),
  raceNumber: integer("race_number").notNull(),
  name: text("name").notNull(),
  venue: text("venue").notNull(),
  distance: integer("distance").notNull(),
  raceTime: text("race_time").notNull(),
  status: text("status").notNull().default("upcoming"),
  surface: text("surface").notNull().default("turf"),
  grade: text("grade"),
  prize: text("prize"),
  meetingDate: text("meeting_date"),
  syncedFrom: text("synced_from"),
  nextUpdateAt: timestamp("next_update_at"),
  lastAnalyzedAt: timestamp("last_analyzed_at"),
  resultRecordedAt: timestamp("result_recorded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const horsesTable = pgTable("horses", {
  id: serial("id").primaryKey(),
  raceId: integer("race_id").notNull().references(() => racesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  number: integer("number").notNull(),
  jockey: text("jockey").notNull(),
  trainer: text("trainer").notNull(),
  form: text("form").notNull().default(""),
  weight: real("weight"),
  currentOdds: real("current_odds").notNull(),
  openingOdds: real("opening_odds"),
  oddsMovement: text("odds_movement").notNull().default("unknown"),
  scratched: boolean("scratched").notNull().default(false),
  scratchReason: text("scratch_reason"),
  courseRecord: boolean("course_record").notNull().default(false),
  distanceRecord: boolean("distance_record").notNull().default(false),
  trainerJockeyRecord: text("trainer_jockey_record").notNull().default(""),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const forecastSnapshotsTable = pgTable("forecast_snapshots", {
  id: serial("id").primaryKey(),
  raceId: integer("race_id").notNull().references(() => racesTable.id, { onDelete: "cascade" }),
  source: text("source").notNull().default("manual"),
  timeToRaceMinutes: integer("time_to_race_minutes"),
  confidenceBand: text("confidence_band").notNull().default("early"),
  timeConfidenceFactor: real("time_confidence_factor").notNull().default(1),
  confidenceBiasApplied: real("confidence_bias_applied").notNull().default(0),
  appliedWeights: jsonb("applied_weights").$type<PredictionWeightConfig>().notNull(),
  learningSnapshot: jsonb("learning_snapshot").$type<LearningSummarySnapshot>().notNull(),
  topPickHorseId: integer("top_pick_horse_id").references(() => horsesTable.id, { onDelete: "set null" }),
  topPickConfidence: real("top_pick_confidence"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const predictionsTable = pgTable("predictions", {
  id: serial("id").primaryKey(),
  raceId: integer("race_id").notNull().references(() => racesTable.id, { onDelete: "cascade" }),
  horseId: integer("horse_id").notNull().references(() => horsesTable.id, { onDelete: "cascade" }),
  snapshotId: integer("snapshot_id").references(() => forecastSnapshotsTable.id, { onDelete: "set null" }),
  rank: integer("rank").notNull(),
  score: real("score").notNull(),
  baseConfidence: real("base_confidence").notNull().default(0.4),
  confidence: real("confidence").notNull(),
  confidenceDelta: real("confidence_delta").notNull().default(0),
  confidenceBand: text("confidence_band").notNull().default("early"),
  timeToRaceMinutes: integer("time_to_race_minutes"),
  resultStatus: text("result_status").notNull().default("pending"),
  finishPosition: integer("finish_position"),
  gradedAt: timestamp("graded_at"),
  factors: jsonb("factors").$type<PredictionFactorBreakdown>().notNull(),
  aiSummary: text("ai_summary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const forecastEntriesTable = pgTable("forecast_entries", {
  id: serial("id").primaryKey(),
  snapshotId: integer("snapshot_id").notNull().references(() => forecastSnapshotsTable.id, { onDelete: "cascade" }),
  raceId: integer("race_id").notNull().references(() => racesTable.id, { onDelete: "cascade" }),
  horseId: integer("horse_id").notNull().references(() => horsesTable.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull(),
  score: real("score").notNull(),
  baseConfidence: real("base_confidence").notNull(),
  confidence: real("confidence").notNull(),
  confidenceDelta: real("confidence_delta").notNull().default(0),
  confidenceBand: text("confidence_band").notNull().default("early"),
  timeToRaceMinutes: integer("time_to_race_minutes"),
  resultStatus: text("result_status").notNull().default("pending"),
  finishPosition: integer("finish_position"),
  gradedAt: timestamp("graded_at"),
  factors: jsonb("factors").$type<PredictionFactorBreakdown>().notNull(),
  aiSummary: text("ai_summary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const predictionWeightsTable = pgTable("prediction_weights", {
  id: serial("id").primaryKey(),
  courseForm: real("course_form").notNull().default(0.25),
  formDistance: real("form_distance").notNull().default(0.25),
  jockeyTrainer: real("jockey_trainer").notNull().default(0.20),
  oddsMovement: real("odds_movement").notNull().default(0.15),
  history: real("history").notNull().default(0.15),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const raceResultsTable = pgTable("race_results", {
  id: serial("id").primaryKey(),
  raceId: integer("race_id").notNull().unique().references(() => racesTable.id, { onDelete: "cascade" }),
  winnerHorseId: integer("winner_horse_id").notNull().references(() => horsesTable.id, { onDelete: "cascade" }),
  runnerUpHorseId: integer("runner_up_horse_id").references(() => horsesTable.id, { onDelete: "set null" }),
  thirdHorseId: integer("third_horse_id").references(() => horsesTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  officialAt: timestamp("official_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const learningFeedbackTable = pgTable("learning_feedback", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("global"),
  sampleSize: integer("sample_size").notNull().default(0),
  topPickWinRate: real("top_pick_win_rate").notNull().default(0),
  placedRate: real("placed_rate").notNull().default(0),
  averageConfidence: real("average_confidence").notNull().default(0),
  confidenceBias: real("confidence_bias").notNull().default(0),
  factorAdjustments: jsonb("factor_adjustments").$type<LearningFactorAdjustments>().notNull().default({
    courseForm: 0,
    formDistance: 0,
    jockeyTrainer: 0,
    oddsMovement: 0,
    history: 0,
  }),
  lastResultRaceId: integer("last_result_race_id").references(() => racesTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  raceId: integer("race_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const syncStateTable = pgTable("sync_state", {
  id: serial("id").primaryKey(),
  lastSyncAt: timestamp("last_sync_at").notNull().defaultNow(),
  lastSyncDate: text("last_sync_date").notNull(),
  meetingsFound: integer("meetings_found").notNull().default(0),
  racesCreated: integer("races_created").notNull().default(0),
  status: text("status").notNull().default("ok"),
  error: text("error"),
});

export const insertRaceSchema = createInsertSchema(racesTable).omit({ id: true, createdAt: true });
export const insertHorseSchema = createInsertSchema(horsesTable).omit({ id: true, createdAt: true });
export const insertPredictionSchema = createInsertSchema(predictionsTable).omit({ id: true, createdAt: true });
export const insertChatMessageSchema = createInsertSchema(chatMessagesTable).omit({ id: true, createdAt: true });

export type InsertRace = z.infer<typeof insertRaceSchema>;
export type Race = typeof racesTable.$inferSelect;
export type InsertHorse = z.infer<typeof insertHorseSchema>;
export type Horse = typeof horsesTable.$inferSelect;
export type InsertPrediction = z.infer<typeof insertPredictionSchema>;
export type Prediction = typeof predictionsTable.$inferSelect;
export type ForecastSnapshot = typeof forecastSnapshotsTable.$inferSelect;
export type ForecastEntry = typeof forecastEntriesTable.$inferSelect;
export type PredictionWeights = typeof predictionWeightsTable.$inferSelect;
export type RaceResult = typeof raceResultsTable.$inferSelect;
export type LearningFeedback = typeof learningFeedbackTable.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
