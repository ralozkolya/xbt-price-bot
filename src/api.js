import axios from "axios";
import { BITSTAMP_URL, TELEGRAM_URL } from "./config.js";
import { logger } from "./logger.js";

const TIMEOUT_MS = 5000;

const logAxiosFailure = (label, chatId, e) => {
  const status = e.response?.status;
  logger.error(
    `${label} failed${chatId ? ` (chatId=${chatId})` : ""}${status ? ` status=${status}` : ""}: ${e.message}`
  );
};

export const sendMessage = async (chatId, text, parseMode = "MarkdownV2") => {
  try {
    const response = await axios.post(
      `${TELEGRAM_URL}/sendMessage`,
      {
        disable_web_page_preview: true,
        chat_id: chatId,
        parse_mode: parseMode,
        text,
      },
      { timeout: TIMEOUT_MS }
    );
    return response.data;
  } catch (e) {
    logAxiosFailure("Telegram sendMessage", chatId, e);
    throw e;
  }
};

export const sendPhoto = async (
  chatId,
  url,
  caption = "",
  parseMode = "MarkdownV2"
) => {
  try {
    return await axios.post(
      `${TELEGRAM_URL}/sendPhoto`,
      {
        chat_id: chatId,
        photo: url,
        parse_mode: parseMode,
        caption,
      },
      { timeout: TIMEOUT_MS }
    );
  } catch (e) {
    logAxiosFailure("Telegram sendPhoto", chatId, e);
    throw e;
  }
};

export const getPriceData = async (currency) => {
  try {
    const response = await axios.get(`${BITSTAMP_URL}/ohlc/btc${currency}`, {
      params: { limit: 24, step: 3600 },
      timeout: TIMEOUT_MS,
    });
    return response.data.data;
  } catch (e) {
    logAxiosFailure("Bitstamp getPriceData", null, e);
    throw e;
  }
};
