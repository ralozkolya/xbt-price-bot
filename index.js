import Koa from "koa";
import Router from "@koa/router";
import { init, priceTracker } from "./src/kraken.js";
import { handle } from "./src/telegram.js";
import { koaBody } from "koa-body";
import { priceChangeHandler } from "./src/alerts.js";

// Might need to add proxy: true here
const app = new Koa();
const router = new Router();

router.post("/:token", (ctx, next) => {
  handle(ctx.request.params.token, ctx.request.body);
  ctx.body = null;
  return next();
});

app.use(koaBody());
app.use(router.routes());

app.listen(process.env.PORT || 3000);

init();

priceTracker.subscribe(priceChangeHandler);
