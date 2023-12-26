import winston from "winston";
import { isProd } from "./config.js";

export const logger = winston.createLogger({
  transports: new winston.transports.Console({
    level: isProd() ? "warn" : "debug",
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }),
});
