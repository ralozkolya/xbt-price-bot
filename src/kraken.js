import { BehaviorSubject, filter } from "rxjs";
import { WebSocket } from "ws";
import { logger } from "./logger.js";

const onMessage = async (message) => {
  message = JSON.parse(message);

  if (Array.isArray(message) && "trade" === message[2]) {
    const [, [[price]], , pair] = message;
    priceTracker.next({ price, pair });
  }
};

const subscribe = (ws, name) => {
  ws.send(
    JSON.stringify({
      event: "subscribe",
      pair: ["BTC/USD", "BTC/EUR"],
      subscription: {
        name,
      },
    })
  );
};

let tries = 0;
const reconnect = (ws) => {
  ws.terminate();
  const delay = Math.min(20000, 500 * 2 ** tries++);
  logger.warn(`Trying to reconnect in: ${delay / 1000} secs`);
  setTimeout(connect, delay);
};

export const connect = () => {
  const ws = new WebSocket("wss://ws.kraken.com");

  logger.info("Connecting to Kraken WS server...");

  ws.on("open", () => {
    logger.info("Connected!");
    subscribe(ws, "trade");
  });

  ws.on("message", onMessage);

  ws.on("error", (error) => {
    logger.error(error.message);
    reconnect(ws);
  });

  ws.on("close", () => {
    logger.error("Channel closed");
    reconnect(ws);
  });
};

export const priceTracker = new BehaviorSubject().pipe(filter((_) => _));
