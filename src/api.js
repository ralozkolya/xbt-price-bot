import axios from "axios";
import { TELEGRAM_URL } from "./config.js";

export const sendMessage = async (chatId, text, parseMode = "MarkdownV2") => {
  const response = await axios.post(`${TELEGRAM_URL}/sendMessage`, {
    disable_web_page_preview: true,
    chat_id: chatId,
    parse_mode: parseMode,
    text,
  });
  return response.data;
};
