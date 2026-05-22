import ChartJSNode from "chartjs-node-canvas";
import createError from "http-errors";

import { getPriceData } from "./api.js";
import { getPair, isSupportedCurrency, lastPrice } from "./kraken.js";

const { ChartJSNodeCanvas } = ChartJSNode;

export const getChart = async (currency) => {
  if (!isSupportedCurrency(currency)) {
    throw createError(400, "unsupported currency");
  }

  const pair = getPair(currency);
  const price = await lastPrice(pair);
  const priceData = await getPriceData(currency);

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
    close: price,
    date: dateFormatter.format(Date.now()),
  });

  const chart = new ChartJSNodeCanvas({
    width: 800,
    height: 300,
  });

  return chart.renderToBufferSync({
    type: "line",
    data: {
      labels: parsedData.map((item) => item.date),
      datasets: [
        {
          label: priceData.pair,
          data: parsedData.map((item) => item.close),
          fill: true,
          backgroundColor: "#f7931a",
        },
      ],
    },
  });
};
