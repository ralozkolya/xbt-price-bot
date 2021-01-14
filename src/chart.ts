import { CanvasRenderService } from 'chartjs-node-canvas';
import axios from 'axios';
import { Readable } from 'stream';
import { sendPhoto } from './api';

export default async function (chatId: number): Promise<void> {
  const service = new CanvasRenderService(800, 600);

  const response = await axios.get(
    'https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=3600&limit=24'
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
          label: 'BTC/USD',
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
            callback: v => `$${Intl.NumberFormat('en-GB').format(v)}`
          }
        }]
      }
    },
  });

  return sendPhoto(chatId, chart);
}
