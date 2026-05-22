import Router from "@koa/router";
import Koa from "koa";
import { koaBody } from "koa-body";
import { handle, COMMANDS } from "./src/telegram.js";
import { init } from "./src/alerts.js";
import { getChart } from "./src/chart.js";
import { PORT, resolvedConfig } from "./src/config.js";
import { logger } from "./src/logger.js";
import { setMyCommands } from "./src/api.js";

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason);
  logger.error(`unhandledRejection: ${msg}`);
});

process.on("uncaughtException", (err) => {
  logger.error(`uncaughtException: ${err.message}\n${err.stack}`);
});

export const app = new Koa();
const router = new Router();

router.post("/:token", async (ctx, next) => {
  try {
    await handle(
      ctx.request.params.token,
      ctx.request.body,
      ctx.request.headers["x-telegram-bot-api-secret-token"]
    );
  } catch (e) {
    if (e?.status === 401) {
      ctx.status = 401;
      return next();
    }
    logger.error(`telegram handler error: ${e.message}`);
  }
  ctx.status = 200;
  ctx.body = null;
  return next();
});

router.get("/chart", async (ctx, next) => {
  const { currency } = ctx.request.query;
  try {
    const buffer = await getChart(currency);
    ctx.response.set("Content-Type", "image/png");
    ctx.response.set("Cache-Control", "no-store");
    ctx.body = buffer;
  } catch (e) {
    if (e?.status === 400) {
      ctx.status = 400;
      ctx.body = e.message;
    } else {
      logger.error(`chart render failed: ${e.message}`);
      ctx.status = 500;
      ctx.body = "chart unavailable";
    }
  }
  return next();
});

router.get("/healthcheck", (ctx, next) => {
  ctx.body = "OK";
  return next();
});

app.use(koaBody());
app.use(router.routes());

const isEntryModule = import.meta.url === `file://${process.argv[1]}`;

if (isEntryModule) {
  logger.info(`Startup config: ${JSON.stringify(resolvedConfig)}`);
  app.listen(PORT);
  init();
  setMyCommands(COMMANDS).catch((e) => {
    logger.error(`setMyCommands at startup failed: ${e.message}`);
  });
}
