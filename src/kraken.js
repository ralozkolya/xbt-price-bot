import {
  ReplaySubject,
  combineLatest,
  debounceTime,
  firstValueFrom,
  map,
  take,
  tap,
  timeout,
} from "rxjs";
import { WebSocket } from "ws";
import { DEBOUNCE_TIME } from "./config.js";
import { logger } from "./logger.js";

export const pairs = {
  usd: "XBT/USD",
  eur: "XBT/EUR",
  gbp: "XBT/GBP",
};

const onMessage = async (raw) => {
  let message;
  try {
    message = JSON.parse(raw);
  } catch (e) {
    logger.warn(`Kraken WS: invalid JSON payload (${e.message})`);
    return;
  }

  if (!Array.isArray(message) || "trade" !== message[2]) {
    return;
  }

  const [, trades, , pair] = message;
  if (!Object.prototype.hasOwnProperty.call(trackers, pair)) {
    return;
  }
  if (!Array.isArray(trades) || trades.length === 0) {
    return;
  }
  const lastTrade = trades[trades.length - 1];
  if (!Array.isArray(lastTrade) || lastTrade.length === 0) {
    return;
  }

  const price = Number(lastTrade[0]);
  if (!Number.isFinite(price)) {
    logger.warn(`Kraken WS: non-finite price for ${pair} (${lastTrade[0]})`);
    return;
  }

  trackers[pair].next({ price, pair });
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
let reconnectTimer;
const reconnect = (ws) => {
  clearTimeout(reconnectTimer);
  ws.terminate();
  const delay = Math.min(60000, 500 * 2 ** tries++);
  logger.warn(`Trying to reconnect in: ${delay / 1000} secs`);
  reconnectTimer = setTimeout(connect, delay);
};

// Kraken WS v1 emits {"event":"heartbeat"} every second on a healthy subscription.
// If nothing arrives for this long, the connection is silently dead — terminate to reconnect.
const LIVENESS_TIMEOUT_MS = 60000;
let livenessTimer;
const armLiveness = (ws) => {
  clearTimeout(livenessTimer);
  livenessTimer = setTimeout(() => {
    logger.warn(
      `Kraken WS: no message in ${LIVENESS_TIMEOUT_MS / 1000}s, terminating`
    );
    ws.terminate();
  }, LIVENESS_TIMEOUT_MS);
};

export const connect = () => {
  const ws = new WebSocket("wss://ws.kraken.com");

  logger.info("Connecting to Kraken WS server...");

  ws.on("open", () => {
    tries = 0;
    logger.info("Connected!");
    subscribe(ws, "trade");
    armLiveness(ws);
  });

  ws.on("message", (raw) => {
    armLiveness(ws);
    onMessage(raw);
  });

  ws.on("error", (error) => {
    logger.error(error.message);
  });

  ws.on("close", () => {
    clearTimeout(livenessTimer);
    logger.error("Channel closed");
    resetTrackers();
    reconnect(ws);
  });
};

let trackers;
let combinedSubscription;
export const priceTracker = new ReplaySubject(1);

const resetListeners = new Set();
export const onTrackerReset = (fn) => {
  resetListeners.add(fn);
  return () => resetListeners.delete(fn);
};

const buildTrackers = () => {
  trackers = Object.values(pairs).reduce((acc, value) => {
    acc[value] = new ReplaySubject(1);
    return acc;
  }, {});

  combinedSubscription = combineLatest(Object.values(trackers), (...pairs) => {
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
};

const resetTrackers = () => {
  if (combinedSubscription) {
    combinedSubscription.unsubscribe();
    combinedSubscription = undefined;
  }
  if (trackers) {
    for (const subject of Object.values(trackers)) {
      subject.complete();
    }
  }
  for (const fn of resetListeners) {
    try {
      fn();
    } catch (e) {
      logger.warn(`tracker reset listener failed: ${e.message}`);
    }
  }
  buildTrackers();
};

buildTrackers();

const LAST_PRICE_TIMEOUT_MS = 5000;

export const lastPrice = (pair) =>
  firstValueFrom(
    trackers[pair].pipe(
      take(1),
      map((entry) => entry.price),
      timeout(LAST_PRICE_TIMEOUT_MS)
    )
  );

export const getPair = (currency) => pairs[currency] ?? pairs.usd;

export const getCurrency = (pair) =>
  (Object.entries(pairs).find((entry) => entry[1] === pair) ?? [
    "usd",
  ])[0].toUpperCase();

export const isSupportedCurrency = (currency) =>
  Object.keys(pairs).includes(currency);
