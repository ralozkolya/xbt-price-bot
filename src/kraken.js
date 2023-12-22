import { WebSocket } from "ws";
import { getConnection } from "./db.js";

const db = await getConnection();

const processAlert = (alert, price) => {
  if (
    (alert.target < price && "higher" === alert.alertOn) ||
    (alert.target > price && "lower" === alert.alertOn)
  ) {
    console.log(
      `Alert ${alert.id} sent. ${alert.pair} price went ${alert.alertOn} than ${alert.target} (${price})`
    );
    db.run("delete from alerts where id = ?", [alert.id]);
  }
};

const onMessage = async (message) => {
  message = JSON.parse(message);

  if (Array.isArray(message) && "trade" === message[2]) {
    const [, [[price]], , pair] = message;

    const alerts = await db.all("select * from alerts where pair = ?", [pair]);

    alerts.forEach(async (alert) => processAlert(alert, price));
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
  ws.destroy();
  const delay = Math.min(20000, 500 * 2 ** tries++);
  console.log("Trying to reconnect in:", delay / 1000, "secs");
  setTimeout(init, delay);
};

export const init = () => {
  const ws = new WebSocket("wss://ws.kraken.com");

  console.log("Connecting to Kraken WS server...");

  ws.on("open", () => {
    console.log("Connected!");
    subscribe(ws, "trade");
  });

  ws.on("message", onMessage);

  ws.on("error", (error) => {
    console.error(error.message);
    reconnect();
  });

  ws.on("close", () => {
    console.error("Channel closed");
    reconnect();
  });
};
