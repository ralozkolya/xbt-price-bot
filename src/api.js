import axios from "axios";
import { BITSTAMP_URL, TELEGRAM_URL } from "./config.js";

export const sendMessage = async (chatId, text, parseMode = "MarkdownV2") => {
  const response = await axios.post(`${TELEGRAM_URL}/sendMessage`, {
    disable_web_page_preview: true,
    chat_id: chatId,
    parse_mode: parseMode,
    text,
  });
  return response.data;
};

export const sendPhoto = (
  chatId,
  url,
  caption = "",
  parseMode = "MarkdownV2"
) => {
  return axios.post(`${TELEGRAM_URL}/sendPhoto`, {
    chat_id: chatId,
    photo: url,
    parse_mode: parseMode,
    caption,
  });
};

export const getPriceData = async (currency) => {
  const response = await axios.get(`${BITSTAMP_URL}/ohlc/btc${currency}`, {
    params: {
      limit: 24,
      step: 3600,
    },
  });
  return response.data.data;
};
