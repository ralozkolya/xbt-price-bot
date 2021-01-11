import { unsupportedCurrency, getCurrent } from './messages';
import { getLastPrice } from './api';
import { Currency } from './db';

export async function current(chatId: number, text: string): Promise<void> {

  let [, currency = 'usd' ] = text.split(' ');
  currency = currency.toLowerCase();

  if (currency !== 'usd' && currency !== 'eur') {
    return unsupportedCurrency(chatId);
  }

  return getCurrent(chatId, {
    CURRENCY: currency.toUpperCase(),
    AMOUNT: String(await getLastPrice(currency as Currency))
  });
}
