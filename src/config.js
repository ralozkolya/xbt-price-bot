import dotenv from "dotenv";
dotenv.config();

export const TG_TOKEN = process.env.TG_TOKEN;
export const TG_WEBHOOK_SECRET = process.env.TG_WEBHOOK_SECRET;
export const TELEGRAM_URL = `https://api.telegram.org/bot${TG_TOKEN}`;
export const BITSTAMP_URL = "https://www.bitstamp.net/api/v2";
export const WEBHOOK = process.env.WEBHOOK;
export const NODE_ENV = process.env.NODE_ENV ?? "production";

export const isProd = () => "production" === NODE_ENV;
export const DEBOUNCE_TIME = Number.parseInt(process.env.DEBOUNCE_TIME) || 2000;
export const PORT = Number.parseInt(process.env.PORT) || 3000;
export const DB_PATH = process.env.DB_PATH ?? "./data/db.sqlite";
// Number of price samples held in the per-pair trailing window (NOT seconds).
export const CHANGE_WINDOW = Number.parseInt(process.env.CHANGE_WINDOW) || 60;

const missing = [];
if (!TG_TOKEN) missing.push("TG_TOKEN");
if (!WEBHOOK) missing.push("WEBHOOK");
if (missing.length) {
  throw new Error(`Missing required env vars: ${missing.join(", ")}`);
}

export const resolvedConfig = Object.freeze({
  PORT,
  NODE_ENV,
  WEBHOOK,
  DEBOUNCE_TIME,
  DB_PATH,
  CHANGE_WINDOW,
  TG_TOKEN: TG_TOKEN ? `<set:${TG_TOKEN.slice(0, 3)}***>` : "<missing>",
  TG_WEBHOOK_SECRET: TG_WEBHOOK_SECRET ? "<set>" : "<missing>",
});
