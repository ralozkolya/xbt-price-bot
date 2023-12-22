import Koa from "koa";
import Router from "@koa/router";
import { init } from "./src/kraken.js";
import { handle } from "./src/telegram.js";
import dotenv from "dotenv";

dotenv.config();

// Might need to add proxy: true here
const app = new Koa();
const router = new Router();

router.get("/:token", (ctx, next) => {
  handle(ctx.request.params.token);
  ctx.body = null;
  return next();
});

app.use(router.routes());

app.listen(process.env.PORT || 3000);

init();
