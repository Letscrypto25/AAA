import { pgTable, serial, text, integer, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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

export const predictionsTable = pgTable("predictions", {
  id: serial("id").primaryKey(),
  raceId: integer("race_id").notNull().references(() => racesTable.id, { onDelete: "cascade" }),
  horseId: integer("horse_id").notNull().references(() => horsesTable.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull(),
  score: real("score").notNull(),
  confidence: real("confidence").notNull(),
  factors: jsonb("factors").notNull(),
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
export type PredictionWeights = typeof predictionWeightsTable.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
