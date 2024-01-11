import QuickChart from "quickchart-js";

import { getPriceData } from "./api.js";
import { getPair, isSupportedCurrency, lastPrice } from "./kraken.js";
import { errorOccured, getCurrent, unsupportedCurrency } from "./messages.js";

export const current = async (chatId, text) => {
  const [, currency = "usd"] = text.split(" ").map((_) => _.toLowerCase());

  if (!isSupportedCurrency(currency)) {
    return unsupportedCurrency(chatId);
  }

  const pair = getPair(currency);
  let currentPrice;
  let priceData;

  try {
    ({ price: currentPrice } = await lastPrice(pair));
    priceData = await getPriceData(currency);
  } catch (e) {
    return errorOccured(chatId, "Error retrieving the price data");
  }

  const dateFormatter = Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });

  const parsedData = priceData.ohlc.map((item) => ({
    close: parseFloat(item.close),
    date: dateFormatter.format(parseInt(item.timestamp, 10) * 1000),
  }));

  parsedData.push({
    close: currentPrice,
    date: dateFormatter.format(Date.now()),
  });

  const chart = new QuickChart();
  chart.setConfig({
    type: "line",
    data: {
      labels: parsedData.map((item) => item.date),
      datasets: [
        { label: priceData.pair, data: parsedData.map((item) => item.close) },
      ],
    },
    options: {
      scales: {
        yAxes: [
          {
            ticks: {
              callback: (value) => Intl.NumberFormat().format(value),
            },
          },
        ],
      },
    },
  });
  chart.setWidth(800);
  chart.setHeight(300);

  return getCurrent(chatId, chart.getUrl(), {
    CURRENCY: currency.toUpperCase(),
    AMOUNT: String(currentPrice),
  });
};
