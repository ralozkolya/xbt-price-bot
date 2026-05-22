import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import createError from "http-errors";
import { respondToInlineQuery } from "./inline-query.js";
import { getHelp, start } from "./messages.js";
import { TG_TOKEN, TG_WEBHOOK_SECRET } from "./config.js";
import { alertFromCommand, alertFromResponse } from "./alerts.js";
import { current } from "./current.js";

const constantTimeEquals = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
};

const validate = (token, headerSecret) => {
  if (!constantTimeEquals(token, TG_TOKEN)) {
    throw createError(401);
  }
  if (TG_WEBHOOK_SECRET && !constantTimeEquals(headerSecret, TG_WEBHOOK_SECRET)) {
    throw createError(401);
  }
};

export const handle = (token, body, headerSecret) => {
  validate(token, headerSecret);

  if (body.inline_query) {
    return respondToInlineQuery();
  }

  if (!body.message || body.message.via_bot) {
    return;
  }

  const {
    text,
    chat: { id },
  } = body.message;

  if (typeof text !== "string") {
    return;
  }

  switch (true) {
    case text.startsWith("/start"):
      return start(id);
    case text.startsWith("/help"):
      return getHelp(id);
    case text.startsWith("/alert"):
      return alertFromCommand(id, text);
    case text.startsWith("/current"):
      return current(id, text);
    default:
      return alertFromResponse(id, text);
  }
};
