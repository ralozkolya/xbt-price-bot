import { readFile } from "node:fs/promises";
import { sendMessage, sendPhoto } from "./api.js";

const fileContent = async (filename, replace = null, extension = ".md") => {
  const buffer = await readFile(`./messages/${filename}${extension}`);
  let text = buffer.toString("utf-8");

  if (replace) {
    Object.keys(replace).forEach((key) => {
      const value = ["AMOUNT", "PRICE"].includes(key)
        ? Intl.NumberFormat().format(replace[key])
        : replace[key];
      text = text.replace(new RegExp(`%${key}%`, "g"), value);
    });

    text = text.replace(".", "\\.");
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
