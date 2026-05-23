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
// Wall-clock lookback for the per-pair trailing average. Samples are folded
// into fixed-width buckets of `CHANGE_BUCKET_MS`; the window holds
// ceil(CHANGE_WINDOW_MS / CHANGE_BUCKET_MS) bucket slots. Defaults: 24h window,
// 1h warm-up before any alert can fire, 1-minute buckets.
const parsePositiveMs = (name, raw, defaultMs) => {
  if (raw === undefined || raw === "") return defaultMs;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(
      `[config] ${name}=${JSON.stringify(raw)} is not a positive integer; using default ${defaultMs}`
    );
    return defaultMs;
  }
  return n;
};

export const CHANGE_WINDOW_MS = parsePositiveMs(
  "CHANGE_WINDOW_MS",
  process.env.CHANGE_WINDOW_MS,
  24 * 60 * 60 * 1000
);
export const CHANGE_FLOOR_MS = parsePositiveMs(
  "CHANGE_FLOOR_MS",
  process.env.CHANGE_FLOOR_MS,
  60 * 60 * 1000
);
export const CHANGE_BUCKET_MS = parsePositiveMs(
  "CHANGE_BUCKET_MS",
  process.env.CHANGE_BUCKET_MS,
  60 * 1000
);

if (process.env.CHANGE_WINDOW !== undefined) {
  console.warn(
    `[config] CHANGE_WINDOW is no longer used (got ${JSON.stringify(process.env.CHANGE_WINDOW)}). ` +
      `Use CHANGE_WINDOW_MS (ms), CHANGE_FLOOR_MS (ms), CHANGE_BUCKET_MS (ms) instead.`
  );
}

if (CHANGE_WINDOW_MS <= CHANGE_BUCKET_MS) {
  console.warn(
    `[config] CHANGE_WINDOW_MS=${CHANGE_WINDOW_MS} must exceed CHANGE_BUCKET_MS=${CHANGE_BUCKET_MS}; ` +
      `with only one bucket slot the trailing average collapses to the current bucket's mean and ` +
      `no alert will ever fire.`
  );
}

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
  CHANGE_WINDOW_MS,
  CHANGE_FLOOR_MS,
  CHANGE_BUCKET_MS,
  TG_TOKEN: TG_TOKEN ? `<set:${TG_TOKEN.slice(0, 3)}***>` : "<missing>",
  TG_WEBHOOK_SECRET: TG_WEBHOOK_SECRET ? "<set>" : "<missing>",
});
