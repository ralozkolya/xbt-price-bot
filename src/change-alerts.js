import {
  deleteChangeAlert,
  deleteChangeAlertReturningPair,
  getChangeAlertsByChatId,
  getChangeAlertsByPair,
  insertChangeAlertIfUnderCap,
} from "./db.js";
import {
  CHANGE_BUCKET_MS,
  CHANGE_FLOOR_MS,
  CHANGE_WINDOW_MS,
} from "./config.js";
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

// How often the per-pair trailing delta is emitted to the log. This is purely
// observability — it does not gate alerts — so it throttles independently of
// COOLDOWN_MS. Overridable for tests (mirrors overrideCooldownMs) so the
// throttle can be exercised against the injected clock without waiting an hour.
export let DELTA_LOG_INTERVAL_MS = 60 * 60 * 1000;

export const overrideDeltaLogIntervalMs = (ms) => {
  DELTA_LOG_INTERVAL_MS = ms;
};

export const MAX_CHANGE_ALERTS_PER_CHAT = 20;
const PERCENT_RE = /^\d+(\.\d+)?%?$/;

const N_BUCKETS = Math.max(1, Math.ceil(CHANGE_WINDOW_MS / CHANGE_BUCKET_MS));

const ringBuffers = new Map();
const lastFiredAt = new Map();
// Per-pair wall-clock ts of the last delta log line. Throttles the hourly
// observability log independently of the alert cooldown.
const lastDeltaLogAt = new Map();

export const resetChangeAlertState = () => {
  ringBuffers.clear();
  lastFiredAt.clear();
  lastDeltaLogAt.clear();
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

// Per-pair time-bucketed trailing buffer. Samples within the same
// `CHANGE_BUCKET_MS` window are folded into a single slot (running sum +
// count); the average across the window is `runningSum / runningCount`.
// `headIdx` points at the most recent populated bucket; advancing the head
// past a stale slot subtracts its contribution from the running totals.
const newBucketState = () => ({
  sums: new Float64Array(N_BUCKETS),
  counts: new Uint32Array(N_BUCKETS),
  headIdx: 0,
  headBucketTs: null,
  runningSum: 0,
  runningCount: 0,
  // Raw wall-clock ts of the first push in the current observation streak.
  // A streak ends when the buffer fully empties (runningCount → 0) and a new
  // sample arrives; the floor warm-up is measured from this anchor.
  firstPushTs: 0,
});

const bucketStart = (now) =>
  Math.floor(now / CHANGE_BUCKET_MS) * CHANGE_BUCKET_MS;

// Returns true if the sample was accepted into the buffer, false if rejected
// (non-finite/non-positive price, or a clock-regressed `now`). Callers must
// not evaluate the alert against a rejected sample — `current` would not be
// represented in the buffer state used to compute the average.
const pushSample = (pair, price, now) => {
  if (!Number.isFinite(price) || price <= 0) return false;

  let s = ringBuffers.get(pair);
  if (!s) {
    s = newBucketState();
    ringBuffers.set(pair, s);
  }

  const bucketTs = bucketStart(now);

  if (s.headBucketTs === null) {
    s.headBucketTs = bucketTs;
    s.firstPushTs = now;
  } else if (bucketTs < s.headBucketTs) {
    // Clock regression — drop to keep eviction bookkeeping monotonic.
    return false;
  } else if (bucketTs > s.headBucketTs) {
    const step = (bucketTs - s.headBucketTs) / CHANGE_BUCKET_MS;
    if (step >= N_BUCKETS) {
      s.sums.fill(0);
      s.counts.fill(0);
      s.runningSum = 0;
      s.runningCount = 0;
      s.headIdx = 0;
    } else {
      for (let i = 0; i < step; i++) {
        s.headIdx = (s.headIdx + 1) % N_BUCKETS;
        s.runningSum -= s.sums[s.headIdx];
        s.runningCount -= s.counts[s.headIdx];
        s.sums[s.headIdx] = 0;
        s.counts[s.headIdx] = 0;
      }
    }
    s.headBucketTs = bucketTs;
    if (s.runningCount === 0) s.firstPushTs = now;
  }

  s.sums[s.headIdx] += price;
  s.counts[s.headIdx] += 1;
  s.runningSum += price;
  s.runningCount += 1;
  return true;
};

const trailingAverage = (pair, now) => {
  const s = ringBuffers.get(pair);
  if (!s || s.runningCount === 0) return null;
  if (now - s.firstPushTs < CHANGE_FLOOR_MS) return null;
  return s.runningSum / s.runningCount;
};

// Signed percent deviation of the latest price from the trailing average.
// Shared by alert evaluation and the hourly delta log so both report the
// same number.
const computeDelta = (current, average) => ((current - average) / average) * 100;

// Emit the current per-pair delta to the log at most once per
// DELTA_LOG_INTERVAL_MS. Pure observability — never gates an alert. Only
// reachable once `average` is non-null (i.e. past the warm-up floor), so the
// first line for a pair lands one interval-window after warm-up at the latest.
// Logged at `warn` deliberately: the prod Console transport is gated at "warn"
// (src/logger.js), and this hourly line is meant to be visible in production.
const maybeLogDelta = (pair, current, average, now) => {
  const last = lastDeltaLogAt.get(pair);
  if (last !== undefined && now - last < DELTA_LOG_INTERVAL_MS) return;
  lastDeltaLogAt.set(pair, now);
  const delta = computeDelta(current, average);
  logger.warn(
    `Change delta for ${pair}: ${delta.toFixed(2)}% (current ${current}, avg ${average.toFixed(2)})`
  );
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
  const delta = computeDelta(current, average);
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

export const priceChangeHandler = async (change, now = Date.now()) => {
  sweepCooldowns(now);

  await Promise.all(
    Object.keys(change).map(async (pair) => {
      const current = change[pair];
      // If the sample is rejected (non-finite price or clock-regressed now)
      // we must NOT evaluate the alert — `current` is not in the buffer and
      // firing on it would contradict the trailing average.
      if (!pushSample(pair, current, now)) return;

      const average = trailingAverage(pair, now);
      if (average === null) return;

      // Hourly observability log of the trailing delta. Throttled per pair and
      // independent of whether any alert exists for it.
      maybeLogDelta(pair, current, average, now);

      const alerts = await getChangeAlertsByPair(pair);
      await Promise.all(
        alerts.map((alert) => processChangeAlert(alert, current, average, now))
      );
    })
  );
};

export const __resetForTests = resetChangeAlertState;
