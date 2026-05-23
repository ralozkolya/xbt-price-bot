import hf from "human-format";
import { filter } from "rxjs";
import {
  listChangeAlerts,
  priceChangeHandler as changePriceHandler,
  resetChangeAlertState,
} from "./change-alerts.js";
import { deleteAlert, getAlerts, getAlertsByChatId, insertAlert } from "./db.js";
import {
  connect,
  getCurrency,
  getPair,
  isSupportedCurrency,
  lastPrice,
  onTrackerReset,
  priceTracker,
} from "./kraken.js";
import { logger } from "./logger.js";
import {
  alertAcknowledgment,
  alertDeleted,
  alertNotFound,
  alertSet,
  alertsEmpty,
  alertsList,
  alertTriggered,
  deleteAlertUsage,
  errorOccured,
  numberFormatter,
  unsupportedCurrency,
  unsupportedTarget,
} from "./messages.js";

const POSITIVE_INT_RE = /^[1-9]\d*$/;
const parsePositiveIntStrict = (raw) => {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!POSITIVE_INT_RE.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isInteger(n) && n > 0 && String(n) === trimmed ? n : null;
};

const processAlert = async (alert, price) => {
  const crossed =
    (alert.target <= price && "higher" === alert.alertOn) ||
    (alert.target >= price && "lower" === alert.alertOn);
  if (!crossed) return;

  const result = await deleteAlert(alert.id, alert.chatId);
  if (result?.changes !== 1) {
    return;
  }

  logger.info(
    `Alert ${alert.id} sent. ${alert.pair} price went ${alert.alertOn} than ${alert.target} (${price})`
  );

  try {
    await alertTriggered(alert.chatId, {
      CURRENCY: getCurrency(alert.pair),
      AMOUNT: alert.target,
      PRICE: price,
      ACTION: "lower" === alert.alertOn ? "dropped below" : "risen above",
    });
  } catch (e) {
    logger.error(`Failed to send alertTriggered for alert ${alert.id}: ${e.message}`);
  }
};

const setAlert = async (chatId, amount, currency = "usd") => {
  let target;
  try {
    target = hf.parse(amount);
  } catch {
    return unsupportedTarget(chatId);
  }
  if (!Number.isFinite(target) || target <= 0) {
    return unsupportedTarget(chatId);
  }

  try {
    const pair = getPair(currency);
    const price = await lastPrice(pair);
    if (target === price) {
      return unsupportedTarget(chatId);
    }
    const alertOn = price > target ? "lower" : "higher";
    const percentage = Math.round(((target - price) / price) * 10000) / 100;

    await insertAlert({ chatId, target, pair, alertOn });
    await alertSet(chatId, {
      CURRENCY: currency.toUpperCase(),
      AMOUNT: String(target),
      ALERT_ON: "higher" === alertOn ? "rises above" : "drops below",
      PERCENTAGE: percentage,
    });
  } catch (e) {
    logger.error(`setAlert failed for chat ${chatId}: ${e.message}`);
    await errorOccured(chatId);
  }
};

export const alertFromResponse = (chatId, text) => {
  if (typeof text !== "string" || !text.trim()) {
    return unsupportedTarget(chatId);
  }

  let [amount, currency = "usd"] = text
    .trim()
    .split(/\s+/)
    .map((str) => str.toLowerCase());

  if (!isSupportedCurrency(currency)) {
    return unsupportedCurrency(chatId);
  }

  if ("moon" === amount) {
    amount = "500k";
  }

  return setAlert(chatId, amount, currency);
};

export const priceChangeHandler = async (change) => {
  logger.info(
    Object.entries(change)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ")
  );

  await Promise.all(
    Object.keys(change).map(async (pair) => {
      const alerts = await getAlerts(pair);
      await Promise.all(alerts.map((alert) => processAlert(alert, change[pair])));
    })
  );
};

// Telegram caps sendMessage payloads at 4096 chars. Reserve headroom for the
// surrounding template (alerts-list.md) and its own escape overhead.
const ALERTS_BODY_BUDGET = 4000;
const MD_V2_SPECIALS_GLOBAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;
const escapedLength = (s) =>
  s.length + (s.match(MD_V2_SPECIALS_GLOBAL)?.length ?? 0);

export const listAlerts = async (chatId) => {
  try {
    const [rows, changeRows] = await Promise.all([
      getAlertsByChatId(chatId),
      listChangeAlerts(chatId),
    ]);
    if (rows.length === 0 && changeRows.length === 0) {
      return alertsEmpty(chatId);
    }
    const targetLines = rows.map((row) => {
      const direction = row.alertOn === "higher" ? "rises above" : "drops below";
      const amount = numberFormatter.format(row.target);
      const currency = getCurrency(row.pair);
      return `#${row.id} — ${direction} ${amount} ${currency}`;
    });
    const changeLines = changeRows.map((row) => {
      const currency = getCurrency(row.pair);
      return `Δ#${row.id} — moves ≥ ${row.threshold}% ${currency}`;
    });
    const lines = [...targetLines, ...changeLines];
    // Walk newest-first so older alerts get dropped when over budget.
    const kept = [];
    let used = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const cost = escapedLength(lines[i]) + (kept.length > 0 ? 1 : 0);
      if (used + cost > ALERTS_BODY_BUDGET) break;
      kept.push(lines[i]);
      used += cost;
    }
    kept.reverse();
    return alertsList(chatId, { ALERTS: kept.join("\n") });
  } catch (e) {
    logger.error(`listAlerts failed for chat ${chatId}: ${e.message}`);
    return errorOccured(chatId);
  }
};

export const alertFromCommand = (chatId, text) => {
  const targetRaw = text.replace(/^\s*\/alert(@\w+)?\s*/i, "").trim();

  if (!targetRaw) {
    return alertAcknowledgment(chatId);
  }

  return alertFromResponse(chatId, targetRaw);
};

export const deleteAlertFromCommand = async (chatId, text) => {
  const raw = text.replace(/^\s*\/deletealert(@\w+)?\s*/i, "");
  const id = parsePositiveIntStrict(raw);
  if (id === null) {
    return deleteAlertUsage(chatId);
  }
  try {
    const result = await deleteAlert(id, chatId);
    if (result?.changes !== 1) {
      return alertNotFound(chatId);
    }
    logger.info(`Alert ${id} deleted by chat ${chatId}`);
    return alertDeleted(chatId, { ID: id });
  } catch (e) {
    logger.error(`deleteAlertFromCommand failed for chat ${chatId}: ${e.message}`);
    return errorOccured(chatId);
  }
};

export const init = () => {
  onTrackerReset(resetChangeAlertState);
  connect();
  priceTracker.pipe(filter((_) => _)).subscribe((change) => {
    Promise.resolve(priceChangeHandler(change)).catch((e) =>
      logger.error(`priceChangeHandler failed: ${e.message}`)
    );
    Promise.resolve(changePriceHandler(change)).catch((e) =>
      logger.error(`change-alerts priceChangeHandler failed: ${e.message}`)
    );
  });
};
