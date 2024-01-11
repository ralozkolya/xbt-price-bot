import {
  ReplaySubject,
  combineLatest,
  debounceTime,
  firstValueFrom,
  map,
  take,
  tap,
} from "rxjs";
import { WebSocket } from "ws";
import { DEBOUNCE_TIME } from "./config.js";
import { logger } from "./logger.js";

export const pairs = {
  usd: "XBT/USD",
  eur: "XBT/EUR",
};

const onMessage = async (message) => {
  message = JSON.parse(message);

  if (Array.isArray(message) && "trade" === message[2]) {
    const [, [[price]], , pair] = message;
    trackers[pair].next({ price, pair });
  }
};

const subscribe = (ws, name) => {
  ws.send(
    JSON.stringify({
      event: "subscribe",
      pair: Object.values(pairs),
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
    // Reconnect every hour, Kraken seems to stop sending updates for long-running connections
    setTimeout(() => {
      logger.warn("Restarting to keep receiving updates...");
      ws.close();
    }, 3600000);
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

const trackers = Object.values(pairs).reduce((trackers, value) => {
  trackers[value] = new ReplaySubject(1);
  return trackers;
}, {});

export const priceTracker = new ReplaySubject(1);

combineLatest(Object.values(trackers), (...pairs) => {
  return pairs.reduce((pairs, value) => {
    pairs[value.pair] = value.price;
    return pairs;
  }, {});
})
  .pipe(
    debounceTime(DEBOUNCE_TIME),
    tap((data) => priceTracker.next(data))
  )
  .subscribe();

export const lastPrice = (pair) => {
  return firstValueFrom(
    priceTracker.pipe(
      take(1),
      map((price) => price[pair])
    )
  );
};

export const getPair = (currency) => pairs[currency] ?? pairs.usd;

export const getCurrency = (pair) => {
  return (Object.entries(pairs).find((entry) => entry[1] === pair) ?? [
    "usd",
  ])[0].toUpperCase();
};

export const isSupportedCurrency = (currency) =>
  Object.keys(pairs).includes(currency);
