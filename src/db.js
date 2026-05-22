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

export const getChangeAlertsByPair = (pair) => {
  return db.all(
    "select id, chatId, pair, threshold from changeAlerts where pair = ?",
    [pair]
  );
};

export const getChangeAlertsByChatId = (chatId) => {
  return db.all(
    "select id, pair, threshold from changeAlerts where chatId = ? order by id asc",
    [chatId]
  );
};

export const insertChangeAlert = ({ chatId, pair, threshold }) => {
  return db.run(
    "insert into changeAlerts (chatId, pair, threshold) values (?, ?, ?)",
    [chatId, pair, threshold]
  );
};

export const insertChangeAlertIfUnderCap = ({ chatId, pair, threshold }, cap) => {
  return db.run(
    "INSERT INTO changeAlerts (chatId, pair, threshold) SELECT ?, ?, ? WHERE (SELECT count(*) FROM changeAlerts WHERE chatId = ?) < ?",
    [chatId, pair, threshold, chatId, cap]
  );
};

export const getChangeAlertCount = async (chatId) => {
  const row = await db.get(
    "select count(*) as count from changeAlerts where chatId = ?",
    [chatId]
  );
  return row?.count ?? 0;
};

export const deleteChangeAlert = (id) => {
  return db.run("delete from changeAlerts where id = ?", [id]);
};
