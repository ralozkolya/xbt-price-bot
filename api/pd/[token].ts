import { NowRequest, NowResponse } from '@vercel/node';
import Bluebird from 'bluebird';

import { PD_TOKEN } from '../../src/config';
import { getLastPrice } from '../../src/api';
import { retrieve, remove, IAlert } from '../../src/db';
import { alertTriggered, IReplace } from '../../src/messages';

export default async function (
  req: NowRequest,
  res: NowResponse
): Promise<void> {
  if (req.query.token !== PD_TOKEN) {
    return res.status(400).end();
  }

  const alerts = await retrieve();
  const usd = await getLastPrice('usd');
  const eur = await getLastPrice('eur');

  await Bluebird.each<IAlert>(alerts, async (alert: IAlert) => {
    const compareTo = alert.currency === 'usd' ? usd : eur;

    const replace: IReplace = {
      CURRENCY: alert.currency.toUpperCase(),
      AMOUNT: String(alert.target),
      PRICE: String(compareTo)
    };

    if (alert.alertOn === 'higher' && alert.target < compareTo) {
      await alertTriggered(alert.chatId, { ...replace, ACTION: 'risen above' });
      await remove(alert.id);
    } else if (alert.alertOn === 'lower' && alert.target > compareTo) {
      await alertTriggered(alert.chatId, { ...replace, ACTION: 'dropped below' });
      await remove(alert.id);
    }
  });

  res.send({ done: true });
}
