import { CanvasRenderService } from 'chartjs-node-canvas';
import axios from 'axios';
import { sendPhoto } from './api';
import { unsupportedCurrency } from './messages';

export default async function (chatId: number, text: string): Promise<void> {

  let [, currency = 'usd' ] = text.split(' ');
  currency = currency.toLowerCase();

  if (currency !== 'usd' && currency !== 'eur') {
    return unsupportedCurrency(chatId);
  }

  const symbol = currency === 'usd' ? '$' : '€';

  const service = new CanvasRenderService(800, 600);

  const response = await axios.get(
    `https://www.bitstamp.net/api/v2/ohlc/btc${currency}/?step=3600&limit=24`
  );
  const data = response.data.data.ohlc.map((entry) => parseFloat(entry.close));
  const labels = response.data.data.ohlc.map((entry) => {
    return Intl.DateTimeFormat('en-GB', { timeStyle: 'short' } as any).format(
      entry.timestamp * 1000
    );
  });

  const chart = service.renderToStream({
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          data,
          label: `BTC/${currency.toUpperCase()}`,
          borderColor: '#55a',
          backgroundColor: 'rgba(50, 50, 128, .5)',
          lineTension: .2,
        },
      ],
    },
    options: {
      legend: {
        labels: {
          boxWidth: 0
        }
      },
      scales: {
        xAxes: [{
          ticks: {
            callback: v => `${v} UTC`
          }
        }],
        yAxes: [{
          ticks: {
            callback: v => `${symbol}${Intl.NumberFormat('en-GB').format(v)}`
          }
        }]
      }
    },
  });

  return sendPhoto(chatId, chart);
}
