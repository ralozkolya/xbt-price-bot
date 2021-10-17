import axios from 'axios';

import { BITSTAMP_URL, TELEGRAM_URL } from './config';
import { getArticle } from './inline-query';
import { Currency } from './db';

interface IOHLCResponse {
  pair: string;
  ohlc: {
    close: string;
    timestamp: string;
  }[]
}

export async function getLastPrice(currency: Currency): Promise<number> {
  const response = await axios.get(`${BITSTAMP_URL}/ticker/btc${currency}`);
  return response.data.last;
}

export async function answerInlineQuery(queryId: string): Promise<void> {
  await axios.post(`${TELEGRAM_URL}/answerInlineQuery`, {
    inline_query_id: queryId,
    cache_time: 15,
    results: [
      getArticle('BTC/USD', await getLastPrice('usd')),
      getArticle('BTC/EUR', await getLastPrice('eur')),
    ],
  });
}

export async function sendMessage(chatId: number, text: string, parseMode = 'MarkdownV2'): Promise<void> {
  await axios.post(`${TELEGRAM_URL}/sendMessage`, {
    chat_id: chatId,
    parse_mode: parseMode,
    text
  });
}

export async function getPriceData(currency: Currency): Promise<IOHLCResponse> {
  const response = await axios.get(`${BITSTAMP_URL}/ohlc/btc${currency}`, {
    params: {
      limit: 24,
      step: 3600
    }
  });
  return response.data.data;
}

export async function sendPhoto(chatId: number, url: string, caption: string = '', parseMode = 'MarkdownV2'): Promise<void> {
  await axios.post(`${TELEGRAM_URL}/sendPhoto`, {
    chat_id: chatId,
    photo: url,
    parse_mode: parseMode,
    caption
  });
}
