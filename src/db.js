import { open } from "sqlite";
import sqlite3 from "sqlite3";

const getConnection = async () => {
  const db = await open({
    filename: "./db.sqlite",
    driver: sqlite3.cached.Database,
  });

  db.migrate({
    migrationsPath: "./data/migrations",
  });

  return db;
};

const db = await getConnection();

export const getAlerts = (pair) => {
  return db.all("select * from alerts where pair = ?", [pair]);
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
