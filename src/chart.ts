import path from 'path';
import chrome from 'chrome-aws-lambda';
import puppeteer from 'puppeteer';

import { sendPhoto } from './api';

export async function chart(chatId: number, text: string): Promise<void> {

  const filePath = `file://${path.join(__dirname, '../res/index.html')}`;

  const browser = await puppeteer.launch({
    args: chrome.args,
    executablePath: await chrome.executablePath,
    headless: chrome.headless
  });
  const page = await browser.newPage();

  return new Promise(async (resolve, reject) => {
    page.on('console', async (e) => {
      if ('done' === e.text()) {
        const photo = await page.screenshot();
        await sendPhoto(chatId, photo);
        resolve();
      } else {
        reject(e);
      }
      browser.close();
    });
  
    await page.setViewport({ width: 800, height: 600 });
    await page.goto(filePath);
  });
}
