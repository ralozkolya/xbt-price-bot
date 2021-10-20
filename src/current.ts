import QuickChart from 'quickchart-js';

import { unsupportedCurrency, getCurrent, errorOccured } from './messages';
import { getLastPrice, getPriceData, IOHLCResponse } from './api';
import { Currency } from './db';

export async function current(chatId: number, text: string): Promise<void> {

  let [, currency = 'usd' ] = text.split(' ');
  currency = currency.toLowerCase();

  if (!['usd', 'eur'].includes(currency)) {
    return unsupportedCurrency(chatId);
  }

  let currentPrice: number;
  let priceData: IOHLCResponse;

  try {
    currentPrice = await getLastPrice(currency as Currency);
    priceData = await getPriceData(currency as Currency);
  } catch {
    return errorOccured(chatId, 'Error retrieving the price data');
  }

  const dateFormatter = Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' });

  const parsedData = priceData.ohlc.map(item => ({
    close: parseFloat(item.close),
    date: dateFormatter.format(parseInt(item.timestamp, 10) * 1000)
  }));
  
  parsedData.push({
    close: currentPrice,
    date: dateFormatter.format(Date.now())
  });

  const chart = new QuickChart();
  chart.setConfig({
    type: 'line',
    data: {
      labels: parsedData.map(item => item.date),
      datasets: [
        { label: priceData.pair, data: parsedData.map(item => item.close) }
      ]
    },
    options: {
      scales: {
        yAxes: [
          {
            ticks: {
              callback: (value: number) => Intl.NumberFormat().format(value)
            }
          }
        ]
      }
    }
  });
  chart.setWidth(800);
  chart.setHeight(300);

  return getCurrent(chatId, chart.getUrl(), {
    CURRENCY: currency.toUpperCase(),
    AMOUNT: String(currentPrice)
  });
}
