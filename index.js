import Router from "@koa/router";
import Koa from "koa";
import { koaBody } from "koa-body";
import { handle } from "./src/telegram.js";
import { init } from "./src/alerts.js";
import { getChart } from "./src/chart.js";

const app = new Koa();
const router = new Router();

router.post("/:token", (ctx, next) => {
  handle(ctx.request.params.token, ctx.request.body);
  ctx.body = null;
  return next();
});

router.get("/chart", async (ctx, next) => {
  const { currency, chatId } = ctx.request.query;
  ctx.response.set("Content-Type", "image/png");
  ctx.response.set("Cache-Control", "no-store");
  ctx.body = await getChart(currency, chatId);
  return next();
});

app.use(koaBody());
app.use(router.routes());

app.listen(process.env.PORT || 3000);

init();
