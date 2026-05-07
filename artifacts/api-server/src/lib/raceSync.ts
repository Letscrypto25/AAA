import { db, racesTable, horsesTable, syncStateTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { fetchMeetingsForDate, meetingToRaceSlots } from "./goldcircle";
import { generateHorseField, refreshOddsAndScratches } from "./groq";
import { getNextUpdateTime } from "./scheduler";

const FIELD_SIZE = 10;

function todayDateStr(): string {
  return new Date().toISOString().split("T")[0];
}

async function raceExistsForSlot(venue: string, raceNumber: number, meetingDate: string): Promise<boolean> {
  const rows = await db
    .select({ id: racesTable.id })
    .from(racesTable)
    .where(
      and(
        eq(racesTable.venue, venue),
        eq(racesTable.raceNumber, raceNumber),
        eq(racesTable.meetingDate, meetingDate),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function createRaceWithHorses(slot: {
  raceNumber: number;
  name: string;
  time: string;
  distance: number;
  surface: string;
  venue: string;
  meetingDate: string;
}): Promise<number> {
  const [race] = await db
    .insert(racesTable)
    .values({
      raceNumber: slot.raceNumber,
      name: slot.name,
      venue: slot.venue,
      distance: slot.distance,
      raceTime: slot.time,
      surface: slot.surface,
      status: "upcoming",
      meetingDate: slot.meetingDate,
      syncedFrom: "goldcircle",
      nextUpdateAt: new Date(),
    })
    .returning();

  logger.info({ raceId: race.id, name: slot.name }, "Race created from sync");

  try {
    const horses = await generateHorseField(
      {
        name: slot.name,
        venue: slot.venue,
        distance: slot.distance,
        surface: slot.surface,
        raceNumber: slot.raceNumber,
        meetingDate: slot.meetingDate,
      },
      FIELD_SIZE,
    );

    await db.insert(horsesTable).values(
      horses.map((h) => ({
        raceId: race.id,
        name: h.name,
        number: h.number,
        jockey: h.jockey,
        trainer: h.trainer,
        form: h.form,
        weight: h.weight,
        currentOdds: h.currentOdds,
        openingOdds: h.openingOdds,
        oddsMovement: h.currentOdds < h.openingOdds ? "shortening" : h.currentOdds > h.openingOdds ? "drifting" : "stable",
        courseRecord: h.courseRecord,
        distanceRecord: h.distanceRecord,
        trainerJockeyRecord: h.trainerJockeyRecord,
        scratched: false,
      })),
    );

    logger.info({ raceId: race.id, horsesAdded: horses.length }, "Horses generated and added");
  } catch (err) {
    logger.warn({ err, raceId: race.id }, "Failed to generate horse field — race created empty");
  }

  return race.id;
}

export async function syncMeetingsForDate(date: Date): Promise<{ racesCreated: number; meetingsFound: number }> {
  const meetings = await fetchMeetingsForDate(date);

  if (meetings.length === 0) {
    logger.info({ date: date.toISOString().split("T")[0] }, "No Gold Circle meetings found for date");
    return { racesCreated: 0, meetingsFound: 0 };
  }

  let racesCreated = 0;

  for (const meeting of meetings) {
    const slots = meetingToRaceSlots(meeting);

    for (const slot of slots) {
      const exists = await raceExistsForSlot(slot.venue, slot.raceNumber, slot.meetingDate);
      if (exists) continue;

      await createRaceWithHorses(slot);
      racesCreated++;
    }
  }

  return { racesCreated, meetingsFound: meetings.length };
}

export async function syncTodaysMeetings(): Promise<void> {
  const today = new Date();
  const dateStr = todayDateStr();

  logger.info({ date: dateStr }, "Starting daily race sync");

  try {
    const result = await syncMeetingsForDate(today);

    await db
      .insert(syncStateTable)
      .values({
        lastSyncDate: dateStr,
        meetingsFound: result.meetingsFound,
        racesCreated: result.racesCreated,
        status: "ok",
      });

    logger.info(result, "Daily race sync complete");
  } catch (err) {
    logger.error({ err }, "Daily race sync failed");
    await db
      .insert(syncStateTable)
      .values({
        lastSyncDate: dateStr,
        meetingsFound: 0,
        racesCreated: 0,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
  }
}

export async function refreshRaceOdds(raceId: number): Promise<void> {
  const [race] = await db.select().from(racesTable).where(eq(racesTable.id, raceId)).limit(1);
  if (!race) return;

  const horses = await db.select().from(horsesTable).where(eq(horsesTable.raceId, raceId));
  const activeHorses = horses.filter((h) => !h.scratched);
  if (activeHorses.length === 0) return;

  try {
    const updates = await refreshOddsAndScratches(
      {
        name: race.name,
        venue: race.venue,
        distance: race.distance,
        surface: race.surface,
        grade: race.grade,
        raceTime: race.raceTime,
      },
      activeHorses.map((h) => ({
        name: h.name,
        number: h.number,
        jockey: h.jockey,
        trainer: h.trainer,
        form: h.form,
        currentOdds: h.currentOdds,
        openingOdds: h.openingOdds,
        oddsMovement: h.oddsMovement,
        courseRecord: h.courseRecord,
        distanceRecord: h.distanceRecord,
        trainerJockeyRecord: h.trainerJockeyRecord,
        notes: h.notes,
        weight: h.weight,
        scratched: h.scratched,
      })),
    );

    for (const update of updates) {
      const horse = activeHorses[update.horseIndex];
      if (!horse) continue;

      const prevOdds = horse.openingOdds ?? horse.currentOdds;
      const newOdds = Math.round(update.newOdds * 10) / 10;
      let oddsMovement = "stable";
      if (newOdds < prevOdds) oddsMovement = "shortening";
      else if (newOdds > prevOdds) oddsMovement = "drifting";

      await db
        .update(horsesTable)
        .set({
          currentOdds: newOdds,
          oddsMovement,
          scratched: update.scratched,
          scratchReason: update.scratchReason ?? null,
        })
        .where(eq(horsesTable.id, horse.id));

      if (update.scratched) {
        logger.info({ horseId: horse.id, name: horse.name, reason: update.scratchReason }, "Horse scratched");
      }
    }

    const nextUpdateAt = getNextUpdateTime(race.raceTime);
    await db.update(racesTable).set({ nextUpdateAt }).where(eq(racesTable.id, raceId));

    logger.info({ raceId, updatesApplied: updates.length }, "Odds refreshed");
  } catch (err) {
    logger.warn({ err, raceId }, "Odds refresh failed");
  }
}

export async function getLastSyncStatus(): Promise<{
  lastSyncAt: Date | null;
  lastSyncDate: string | null;
  meetingsFound: number;
  racesCreated: number;
  status: string;
} | null> {
  const rows = await db
    .select()
    .from(syncStateTable)
    .orderBy(syncStateTable.lastSyncAt)
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    lastSyncAt: r.lastSyncAt,
    lastSyncDate: r.lastSyncDate,
    meetingsFound: r.meetingsFound,
    racesCreated: r.racesCreated,
    status: r.status,
  };
}
