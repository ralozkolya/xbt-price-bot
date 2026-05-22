import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import createError from "http-errors";
import { respondToInlineQuery } from "./inline-query.js";
import { getHelp, start } from "./messages.js";
import { TG_TOKEN, TG_WEBHOOK_SECRET } from "./config.js";
import { alertFromCommand, alertFromResponse, listAlerts } from "./alerts.js";
import { changeAlertFromCommand } from "./change-alerts.js";
import { current } from "./current.js";

export const COMMANDS = [
  { command: "start", description: "Start the bot" },
  { command: "help", description: "Show help" },
  { command: "current", description: "Show current XBT price" },
  { command: "alert", description: "Set a price alert" },
  { command: "changealert", description: "Alert on significant % moves" },
  { command: "alerts", description: "List your active alerts" },
];

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
    case /^\/alerts(@\w+)?(\s|$)/i.test(text):
      return listAlerts(id);
    case /^\/changealert(@\w+)?(\s|$)/i.test(text):
      return changeAlertFromCommand(id, text);
    case text.startsWith("/alert"):
      return alertFromCommand(id, text);
    case text.startsWith("/current"):
      return current(id, text);
    default:
      return alertFromResponse(id, text);
  }
};
