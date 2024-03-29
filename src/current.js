import { WEBHOOK } from "./config.js";
import { getPair, isSupportedCurrency, lastPrice } from "./kraken.js";
import { errorOccured, getCurrent, unsupportedCurrency } from "./messages.js";

export const current = async (chatId, text) => {
  const [, currency = "usd"] = text.split(" ").map((_) => _.toLowerCase());

  if (!isSupportedCurrency(currency)) {
    return unsupportedCurrency(chatId);
  }

  const pair = getPair(currency);
  let price;

  try {
    price = await lastPrice(pair);
  } catch (e) {
    return errorOccured(chatId, "Error retrieving the price data");
  }

  const params = {
    currency,
    chatId,
    // Needed to force TG to redownload, as it seems to ignore Cache-Control header
    v: Math.random().toString(36).substr(2),
  };

  return getCurrent(chatId, `${WEBHOOK}/chart?${new URLSearchParams(params)}`, {
    CURRENCY: currency.toUpperCase(),
    AMOUNT: String(price),
  });
};
