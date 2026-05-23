import {
  deleteChangeAlert,
  deleteChangeAlertReturningPair,
  getChangeAlertsByChatId,
  getChangeAlertsByPair,
  insertChangeAlertIfUnderCap,
} from "./db.js";
import { CHANGE_WINDOW } from "./config.js";
import {
  getCurrency,
  getPair,
  isSupportedCurrency,
} from "./kraken.js";
import { logger } from "./logger.js";
import {
  alertDeleted,
  alertNotFound,
  changeAlertAcknowledgment,
  changeAlertSet,
  changeAlertTriggered,
  deleteChangeAlertUsage,
  errorOccured,
  tooManyChangeAlerts,
  unsupportedChangeTarget,
  unsupportedCurrency,
} from "./messages.js";

const POSITIVE_INT_RE = /^[1-9]\d*$/;
const parsePositiveIntStrict = (raw) => {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!POSITIVE_INT_RE.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isInteger(n) && n > 0 && String(n) === trimmed ? n : null;
};

export let COOLDOWN_MS = 15 * 60 * 1000;

export const overrideCooldownMs = (ms) => {
  COOLDOWN_MS = ms;
};

export const MAX_CHANGE_ALERTS_PER_CHAT = 20;
const PERCENT_RE = /^\d+(\.\d+)?%?$/;

const ringBuffers = new Map();
const lastFiredAt = new Map();

export const resetChangeAlertState = () => {
  ringBuffers.clear();
  lastFiredAt.clear();
};

const sweepCooldowns = (now) => {
  for (const [key, ts] of lastFiredAt) {
    if (now - ts > COOLDOWN_MS) lastFiredAt.delete(key);
  }
};

const cooldownKey = (chatId, pair) => `${chatId}:${pair}`;

export const evictCooldown = (chatId, pair) => {
  lastFiredAt.delete(cooldownKey(chatId, pair));
};

const pushSample = (pair, price) => {
  let buf = ringBuffers.get(pair);
  if (!buf) {
    buf = [];
    ringBuffers.set(pair, buf);
  }
  buf.push(price);
  if (buf.length > CHANGE_WINDOW) {
    buf.shift();
  }
  return buf;
};

const trailingAverage = (buf) => {
  const sum = buf.reduce((acc, v) => acc + v, 0);
  return sum / buf.length;
};

export const setChangeAlert = async (chatId, percentRaw, currency = "usd") => {
  if (typeof percentRaw !== "string" || !PERCENT_RE.test(percentRaw)) {
    return unsupportedChangeTarget(chatId);
  }
  const threshold = Number.parseFloat(percentRaw);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1000) {
    return unsupportedChangeTarget(chatId);
  }

  try {
    const pair = getPair(currency);
    const result = await insertChangeAlertIfUnderCap(
      { chatId: String(chatId), pair, threshold },
      MAX_CHANGE_ALERTS_PER_CHAT
    );
    if (result?.changes !== 1) {
      return tooManyChangeAlerts(chatId);
    }
    await changeAlertSet(chatId, {
      CURRENCY: currency.toUpperCase(),
      THRESHOLD: threshold,
    });
  } catch (e) {
    logger.error(`setChangeAlert failed for chat ${chatId}: ${e.message}`);
    await errorOccured(chatId);
  }
};

export const changeAlertFromResponse = (chatId, text) => {
  if (typeof text !== "string" || !text.trim()) {
    return unsupportedChangeTarget(chatId);
  }

  const [percentRaw, currency = "usd"] = text
    .trim()
    .split(/\s+/)
    .map((str) => str.toLowerCase());

  if (!isSupportedCurrency(currency)) {
    return unsupportedCurrency(chatId);
  }

  return setChangeAlert(chatId, percentRaw, currency);
};

export const changeAlertFromCommand = (chatId, text) => {
  const raw = text.replace(/^\s*\/changealert(@\w+)?\s*/i, "").trim();

  if (!raw) {
    return changeAlertAcknowledgment(chatId);
  }

  return changeAlertFromResponse(chatId, raw);
};

export const listChangeAlerts = (chatId) => getChangeAlertsByChatId(chatId);

export const removeChangeAlert = async (id, chatId) => {
  const row = await deleteChangeAlertReturningPair(id, chatId);
  if (row) {
    evictCooldown(chatId, row.pair);
    return { changes: 1, pair: row.pair };
  }
  return { changes: 0 };
};

export const deleteChangeAlertFromCommand = async (chatId, text) => {
  const raw = text.replace(/^\s*\/deletechange(@\w+)?\s*/i, "");
  const id = parsePositiveIntStrict(raw);
  if (id === null) {
    return deleteChangeAlertUsage(chatId);
  }
  try {
    const result = await removeChangeAlert(id, chatId);
    if (result.changes !== 1) {
      return alertNotFound(chatId);
    }
    logger.info(`Change alert ${id} deleted by chat ${chatId}`);
    return alertDeleted(chatId, { ID: id });
  } catch (e) {
    logger.error(
      `deleteChangeAlertFromCommand failed for chat ${chatId}: ${e.message}`
    );
    return errorOccured(chatId);
  }
};

const processChangeAlert = async (alert, current, average, now) => {
  const delta = ((current - average) / average) * 100;
  if (Math.abs(delta) < alert.threshold) return;

  const key = cooldownKey(alert.chatId, alert.pair);
  const last = lastFiredAt.get(key);
  if (last && now - last < COOLDOWN_MS) return;

  // Set the cooldown BEFORE awaiting the Telegram send so concurrent ticks
  // observing the same buffer state cannot all pass the gate.
  lastFiredAt.set(key, now);

  logger.info(
    `Change alert ${alert.id} fired. ${alert.pair} delta ${delta.toFixed(2)}% (threshold ${alert.threshold}%)`
  );

  try {
    await changeAlertTriggered(alert.chatId, {
      CURRENCY: getCurrency(alert.pair),
      THRESHOLD: alert.threshold,
      CURRENT: Math.round(current * 100) / 100,
      AVERAGE: Math.round(average * 100) / 100,
      DELTA: Math.round(delta * 100) / 100,
    });
  } catch (e) {
    logger.error(`Failed to send changeAlertTriggered for ${alert.id}: ${e.message}`);
  }
};

export const priceChangeHandler = async (change) => {
  const now = Date.now();
  sweepCooldowns(now);

  await Promise.all(
    Object.keys(change).map(async (pair) => {
      const current = change[pair];
      const buf = pushSample(pair, current);
      if (buf.length < CHANGE_WINDOW) return;

      const average = trailingAverage(buf);
      if (!Number.isFinite(average) || average <= 0) return;

      const alerts = await getChangeAlertsByPair(pair);
      await Promise.all(
        alerts.map((alert) => processChangeAlert(alert, current, average, now))
      );
    })
  );
};

export const __resetForTests = resetChangeAlertState;
