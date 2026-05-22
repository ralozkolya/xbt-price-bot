import hf from "human-format";
import { filter } from "rxjs";
import { deleteAlert, getAlerts, insertAlert } from "./db.js";
import {
  connect,
  getCurrency,
  getPair,
  isSupportedCurrency,
  lastPrice,
  priceTracker,
} from "./kraken.js";
import { logger } from "./logger.js";
import {
  alertAcknowledgment,
  alertSet,
  alertTriggered,
  unsupportedCurrency,
  unsupportedTarget,
} from "./messages.js";

const processAlert = async (alert, price) => {
  const crossed =
    (alert.target < price && "higher" === alert.alertOn) ||
    (alert.target > price && "lower" === alert.alertOn);
  if (!crossed) return;

  const result = await deleteAlert(alert.id);
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
  try {
    const target = hf.parse(amount);
    const pair = getPair(currency);

    const price = await lastPrice(pair);
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
    await unsupportedTarget(chatId);
  }
};

export const alertFromResponse = (chatId, text) => {
  if (typeof text !== "string" || !text.trim()) {
    return unsupportedTarget(chatId);
  }

  let [amount, currency = "usd"] = text
    .split(" ")
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

export const alertFromCommand = (chatId, text) => {
  const targetRaw = text.replace(/\/alert(@XbtPriceBot)?\s?/, "");

  if (!targetRaw) {
    return alertAcknowledgment(chatId);
  }

  return alertFromResponse(chatId, targetRaw);
};

export const init = () => {
  connect();
  priceTracker.pipe(filter((_) => _)).subscribe(priceChangeHandler);
};
