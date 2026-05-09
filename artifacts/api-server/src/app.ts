import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDistDir = path.resolve(runtimeDir, "../../aaa-bets/dist/public");
const frontendIndexPath = path.join(frontendDistDir, "index.html");
const hasBuiltFrontend = existsSync(frontendIndexPath);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin: process.env.APP_URL || "*",
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

if (hasBuiltFrontend) {
  app.use(express.static(frontendDistDir));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(frontendIndexPath);
  });
} else {
  logger.info({ frontendDistDir }, "Frontend bundle not found, API-only mode enabled");
}

export default app;
