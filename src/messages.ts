import { readFile } from 'fs/promises';
import { resolve } from 'path';

import { sendMessage } from './api';

async function fileContent(filename: string, replace: IReplace = null, extension = '.md'): Promise<string> {
  const buffer = await readFile(resolve(__dirname, '../messages', `${filename}${extension}`));
  let text = buffer.toString('utf-8');

  if (replace) {
    Object.keys(replace).forEach(key => {
      text = text.replace(new RegExp(`%${key}%`, 'g'), replace[key]);
    });
  }

  text = text.replace('.', '\\.');

  return text;
}

export interface IReplace {
  CURRENCY?: string;
  AMOUNT?: string;
  ALERT_ON?: string;
  ACTION?: string;
  PRICE?: string;
}

export async function start(chatId: number): Promise<void> {
  await sendMessage(chatId, await fileContent('start'));
}

export async function getHelp(chatId: number): Promise<void> {
  await sendMessage(chatId, await fileContent('help'));
}

export async function alertAcknowledgment(chatId: number): Promise<void> {
  await sendMessage(chatId, await fileContent('alert-acknowledgment'));
}

export async function unsupportedTarget(chatId: number): Promise<void> {
  await sendMessage(chatId, await fileContent('unsupported-target'));
}

export async function unsupportedCurrency(chatId: number): Promise<void> {
  await sendMessage(chatId, await fileContent('unsupported-currency'));
}

export async function alertSet(chatId: number, replace: IReplace = null): Promise<void> {
  await sendMessage(chatId, await fileContent('alert-set', replace));
}

export async function alertTriggered(chatId: number, replace: IReplace = null): Promise<void> {
  await sendMessage(chatId, await fileContent('alert-triggered', replace));
}
