import { Router } from "express";
import { syncTodaysMeetings, getLastSyncStatus } from "../lib/raceSync";

const router = Router();

router.get("/sync/status", async (req, res): Promise<void> => {
  try {
    const status = await getLastSyncStatus();
    res.json(status ?? { lastSyncAt: null, lastSyncDate: null, meetingsFound: 0, racesCreated: 0, status: "never" });
  } catch (err) {
    req.log.error({ err }, "Failed to get sync status");
    res.status(500).json({ error: "Failed to get sync status" });
  }
});

router.post("/sync", async (req, res): Promise<void> => {
  req.log.info("Manual sync triggered");
  try {
    await syncTodaysMeetings();
    const status = await getLastSyncStatus();
    res.json({ ok: true, ...status });
  } catch (err) {
    req.log.error({ err }, "Manual sync failed");
    res.status(500).json({ error: "Sync failed" });
  }
});

export default router;
