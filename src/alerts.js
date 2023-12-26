import hf from "human-format";
import { filter, take, tap } from "rxjs";
import { deleteAlert, getAlerts, insertAlert } from "./db.js";
import { connect, priceTracker } from "./kraken.js";
import {
  alertAcknowledgment,
  alertSet,
  unsupportedTarget,
} from "./messages.js";
import { logger } from "./logger.js";

const processAlert = (alert, price) => {
  if (
    (alert.target < price && "higher" === alert.alertOn) ||
    (alert.target > price && "lower" === alert.alertOn)
  ) {
    logger.info(
      `Alert ${alert.id} sent. ${alert.pair} price went ${alert.alertOn} than ${alert.target} (${price})`
    );
    deleteAlert(alert.id);
  }
};

const setAlert = async (chatId, amount, currency = "usd") => {
  try {
    const target = hf.parse(amount);
    const pair = "usd" === currency ? "XBT/USD" : "XBT/EUR";

    priceTracker
      .pipe(
        filter((price) => pair === price.pair),
        take(1)
      )
      .subscribe(async ({ price, pair }) => {
        const alertOn = price > target ? "lower" : "higher";

        await insertAlert({ chatId, target, pair, alertOn });
        await alertSet(chatId, {
          CURRENCY: currency.toUpperCase(),
          AMOUNT: String(target),
          ALERT_ON: "higher" === alertOn ? "rises above" : "drops below",
        });
      });
  } catch (e) {
    await unsupportedTarget(chatId);
  }
};

const alertFromResponse = (chatId, text) => {
  let [amount, currency = "usd"] = text
    .split(" ")
    .map((str) => str.toLowerCase());

  if ("usd" !== currency && "eur" !== currency) {
    return unsupportedCurrency(chatId);
  }

  if ("moon" === amount) {
    amount = "100k";
  }

  return setAlert(chatId, amount, currency);
};

export const priceChangeHandler = async ({ price, pair } = {}) => {
  logger.info(price + pair);
  const alerts = await getAlerts(pair);
  alerts.forEach((alert) => processAlert(alert, price));
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
  priceTracker.subscribe(priceChangeHandler);
};
