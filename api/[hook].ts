import { NowRequest, NowResponse } from '@vercel/node';
import axios from 'axios';
import { v1 } from 'uuid';

const token = process.env.TOKEN;
const telegramUrl = `https://api.telegram.org/bot${token}`;
const bistrampUrl = 'https://www.bitstamp.net/api/v2/ticker';

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

function getArticle(pair: Pair, currentPrice: number): IArticle {
  return {
    type: 'article',
    id: v1(),
    title: pair,
    description: String(currentPrice),
    thumb_url: 'https://raw.githubusercontent.com/roslinpl/bitcoin.it-promotional_graphics/master/bitcoinLogo1000.png',
    input_message_content: {
      message_text: `${pair}: ${currentPrice}`,
    },
  };
}

export default async function hook(req: NowRequest, res: NowResponse): Promise<void> {

  if (req.query.hook !== token) {
    return res.status(400).end();
  }

  if (req.body.inline_query) {
    const usd = await axios.get(`${bistrampUrl}/btcusd`);
    const eur = await axios.get(`${bistrampUrl}/btceur`);

    await axios.post(`${telegramUrl}/answerInlineQuery`, {
      inline_query_id: req.body.inline_query.id,
      cache_time: 15,
      results: [
        getArticle('BTC/USD', usd.data.last),
        getArticle('BTC/EUR', eur.data.last),
      ],
    });

    return res.end();
  }

  if (req.body.message) {
    const res = await axios.post(`${telegramUrl}/sendMessage`, {
      chat_id: req.body.message.chat.id,
      text: 'Only inline queries are supported\n\nSummon with @XbtPriceBot and choose from the list'
    });
  }

  res.end();
  
}
