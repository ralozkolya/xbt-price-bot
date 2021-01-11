import axios from 'axios';

import { BITSTAMP_URL, TELEGRAM_URL } from './config';
import { getArticle } from './inline-query';
import { Currency } from './db';

export async function getLastPrice(currency: Currency): Promise<number> {
  const response = await axios.get(`${BITSTAMP_URL}/btc${currency}`);
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
