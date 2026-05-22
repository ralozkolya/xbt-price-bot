import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { DB_PATH } from "./config.js";

const getConnection = async () => {
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.cached.Database,
  });

  await db.migrate({
    migrationsPath: "./migrations",
  });

  return db;
};

const db = await getConnection();

export const getAlerts = (pair) => {
  return db.all("select * from alerts where pair = ?", [pair]);
};

export const getAlertsByChatId = (chatId) => {
  return db.all(
    "select id, target, pair, alertOn from alerts where chatId = ? order by id asc",
    [chatId]
  );
};

export const insertAlert = ({ chatId, target, pair, alertOn }) => {
  return db.run(
    "insert into alerts (chatId, target, pair, alertOn) values (?, ?, ?, ?)",
    [chatId, target, pair, alertOn]
  );
};

export const deleteAlert = (id) => {
  return db.run("delete from alerts where id = ?", [id]);
};
