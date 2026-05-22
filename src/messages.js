import { readFile } from "node:fs/promises";
import { sendMessage, sendPhoto } from "./api.js";

const numberFormatter = new Intl.NumberFormat("en-US");

// Full MarkdownV2 special-char set per Telegram's spec:
// https://core.telegram.org/bots/api#markdownv2-style
const MD_V2_SPECIALS = /([_*[\]()~`>#+\-=|{}.!\\])/g;
const escapeMarkdownV2 = (s) => String(s).replace(MD_V2_SPECIALS, "\\$1");

const buildSubstitutions = (replace) => {
  const out = {};
  for (const key of Object.keys(replace)) {
    const raw = replace[key];
    const formatted = ["AMOUNT", "PRICE"].includes(key)
      ? numberFormatter.format(raw)
      : String(raw);
    out[key] = escapeMarkdownV2(formatted);
  }
  return out;
};

export const fileContent = async (
  filename,
  replace = null,
  extension = ".md"
) => {
  const buffer = await readFile(`./messages/${filename}${extension}`);
  let text = buffer.toString("utf-8");

  if (replace) {
    const escaped = buildSubstitutions(replace);
    for (const key of Object.keys(escaped)) {
      text = text.replace(new RegExp(`%${key}%`, "g"), escaped[key]);
    }
  }

  return text;
};

export const start = async (chatId) => {
  return sendMessage(chatId, await fileContent("start"));
};

export const getHelp = async (chatId) => {
  return sendMessage(chatId, await fileContent("help"));
};

export const alertAcknowledgment = async (chatId) => {
  return sendMessage(chatId, await fileContent("alert-acknowledgment"));
};

export const unsupportedTarget = async (chatId) => {
  return sendMessage(chatId, await fileContent("unsupported-target"));
};

export const unsupportedCurrency = async (chatId) => {
  return sendMessage(chatId, await fileContent("unsupported-currency"));
};

export const alertSet = async (chatId, replace = null) => {
  return sendMessage(chatId, await fileContent("alert-set", replace));
};

export const alertTriggered = async (chatId, replace = null) => {
  return sendMessage(chatId, await fileContent("alert-triggered", replace));
};

export const getCurrent = async (chatId, url, replace = null) => {
  return sendPhoto(chatId, url, await fileContent("current-price", replace));
};

export const errorOccured = (chatId, errorText = "An error has occured") => {
  return sendMessage(chatId, errorText);
};
