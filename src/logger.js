import { createLogger, format, transports } from "winston";
import { isProd } from "./config.js";

const { combine, colorize, timestamp, printf } = format;

export const logger = createLogger({
  transports: new transports.Console({
    level: isProd() ? "warn" : "debug",
    format: combine(
      colorize(),
      timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      printf(
        ({ timestamp, level, message }) =>
          `[${timestamp}] (${level}): ${message}`
      )
    ),
  }),
});
