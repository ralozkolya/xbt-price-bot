import { v1 } from 'uuid';

import { answerInlineQuery as _answerInlineQuery } from './api';

type Pair = 'BTC/USD' | 'BTC/EUR';

interface IArticle {
  type: 'article';
  id: string;
  title: Pair;
  description: string;
  thumb_url: string;
  input_message_content: {
    message_text: string;
  };
}

export function getArticle(pair: Pair, currentPrice: number): IArticle {
  return {
    type: 'article',
    id: v1(),
    title: pair,
    description: String(currentPrice),
    thumb_url:
      'https://raw.githubusercontent.com/roslinpl/bitcoin.it-promotional_graphics/master/bitcoinLogo1000.png',
    input_message_content: {
      message_text: `${pair}: ${currentPrice}`,
    },
  };
}


export async function answerInlineQuery(queryId: string): Promise<void> {
  await _answerInlineQuery(queryId);
}
