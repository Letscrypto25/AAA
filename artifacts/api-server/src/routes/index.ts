import { Router, type IRouter } from "express";
import healthRouter from "./health";
import racesRouter from "./races";
import weightsRouter from "./weights";
import chatRouter from "./chat";
import dashboardRouter from "./dashboard";
import gallopRouter from "./gallop";
import syncRouter from "./sync";

const router: IRouter = Router();

router.use(healthRouter);
router.use(racesRouter);
router.use(weightsRouter);
router.use(chatRouter);
router.use(dashboardRouter);
router.use(gallopRouter);
router.use(syncRouter);

export default router;
