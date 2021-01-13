import { parse } from 'human-format';

import { alertAcknowledgment, unsupportedTarget, unsupportedCurrency, alertSet } from './messages';
import { store, Currency } from './db';
import { getLastPrice } from './api';

async function setAlert(chatId: number, amount: string, currency: Currency = 'usd'): Promise<void> {
  try {
    const target = parse(amount);

    const price = await getLastPrice(currency);
    const alertOn = price > target ? 'lower' : 'higher';

    await store({ chatId, target, currency, alertOn });
    await alertSet(chatId, {
      CURRENCY: currency.toUpperCase(),
      AMOUNT: target,
      ALERT_ON: alertOn === 'higher' ? 'rises above' : 'drops below'
    });
  } catch (e) {
    await unsupportedTarget(chatId);
  }
}

export function alertFromCommand(chatId: number, text: string): Promise<void> {
  const targetRaw = text.replace(/\/alert(@XbtPriceBot)?\s?/, '');

  if (!targetRaw) {
    return alertAcknowledgment(chatId);
  }

  return alertFromResponse(chatId, targetRaw);
}

export function alertFromResponse(chatId: number, text: string): Promise<void> {

  let [ amount, currency = 'usd' ] = text.split(' ');
  currency = currency.toLowerCase();

  if (currency !== 'usd' && currency !== 'eur') {
    return unsupportedCurrency(chatId);
  }

  if (amount.toLowerCase() === 'moon') {
    amount = '100k';
  }

  return setAlert(chatId, amount, currency);
}
