import dotenv from "dotenv";
dotenv.config();

export const TG_TOKEN = process.env.TG_TOKEN;
export const TELEGRAM_URL = `https://api.telegram.org/bot${TG_TOKEN}`;
export const BITSTAMP_URL = "https://www.bitstamp.net/api/v2";
export const WEBHOOK = process.env.WEBHOOK;
export const NODE_ENV = process.env.NODE_ENV ?? "production";

export const isProd = () => "production" === NODE_ENV;
export const DEBOUNCE_TIME = Number.parseInt(process.env.DEBOUNCE_TIME) || 2000;
