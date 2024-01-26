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
  if (
    (alert.target < price && "higher" === alert.alertOn) ||
    (alert.target > price && "lower" === alert.alertOn)
  ) {
    logger.info(
      `Alert ${alert.id} sent. ${alert.pair} price went ${alert.alertOn} than ${alert.target} (${price})`
    );
    await alertTriggered(alert.chatId, {
      CURRENCY: getCurrency(alert.pair),
      AMOUNT: alert.target,
      PRICE: price,
      ACTION: "lower" === alert.alertOn ? "dropped below" : "risen above",
    });
    deleteAlert(alert.id);
  }
};

const setAlert = async (chatId, amount, currency = "usd") => {
  try {
    const target = hf.parse(amount);
    const pair = getPair(currency);

    const price = await lastPrice(pair);
    const alertOn = price > target ? "lower" : "higher";

    await insertAlert({ chatId, target, pair, alertOn });
    await alertSet(chatId, {
      CURRENCY: currency.toUpperCase(),
      AMOUNT: String(target),
      ALERT_ON: "higher" === alertOn ? "rises above" : "drops below",
    });
  } catch (e) {
    await unsupportedTarget(chatId);
  }
};

export const alertFromResponse = (chatId, text) => {
  let [amount, currency = "usd"] = text
    .split(" ")
    .map((str) => str.toLowerCase());

  if (!isSupportedCurrency(currency)) {
    return unsupportedCurrency(chatId);
  }

  if ("moon" === amount) {
    amount = "100k";
  }

  return setAlert(chatId, amount, currency);
};

export const priceChangeHandler = async (change) => {
  logger.info(
    Object.entries(change)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ")
  );

  Object.keys(change).forEach(async (pair) => {
    const alerts = await getAlerts(pair);
    alerts.forEach((alert) => processAlert(alert, change[pair]));
  });
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
