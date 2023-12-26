import createError from "http-errors";
import { respondToInlineQuery } from "./inline-query.js";
import { getHelp, start } from "./messages.js";
import { TG_TOKEN } from "./config.js";
import { alertFromCommand } from "./alerts.js";
import { current } from "./current.js";

const validate = (token) => {
  if (TG_TOKEN !== token) {
    throw createError(401);
  }
};

export const handle = (token, body) => {
  validate(token);

  console.log(!body.message || !body.message.via_bot);

  if (body.inline_query) {
    return respondToInlineQuery();
  }

  if (!body.message || body.message.via_bot) {
    return;
  }

  console.log(body);

  const {
    text,
    chat: { id },
  } = body.message;

  switch (true) {
    case text?.startsWith("/start"):
      return start(id);
    case text?.startsWith("/help"):
      return getHelp(id);
    case text?.startsWith("/alert"):
      return alertFromCommand(id, text);
    case text?.startsWith("/current"):
      return current(id, text);
    case text:
      return alertFromResponse(id, text);
  }
};
