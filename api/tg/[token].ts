import { NowRequest, NowResponse } from '@vercel/node';

import { TG_TOKEN } from '../../src/config';
import { answerInlineQuery } from '../../src/inline-query';
import { start, getHelp } from '../../src/messages';
import { alertFromCommand, alertFromResponse } from '../../src/alert';

export default async function hook(
  req: NowRequest,
  res: NowResponse
): Promise<void> {
  if (req.query.token !== TG_TOKEN) {
    return res.status(400).end();
  }

  if (req.body.inline_query) {
    await answerInlineQuery(req.body.inline_query.id);
    return res.end();
  }

  if (req.body.message) {
    const {
      text,
      chat: { id: chatId },
    } = req.body.message;

    if (text && !req.body.message.via_bot) {

      if (text.startsWith('/start')) {
        await start(chatId);
      } else if (text.startsWith('/help')) {
        await getHelp(chatId);
      } else if (text.startsWith('/alert')) {
        await alertFromCommand(chatId, text);
      } else {
        await alertFromResponse(chatId, text);
      }
    }
  }

  res.end();
}
