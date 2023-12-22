import { open } from "sqlite";
import sqlite3 from "sqlite3";

export const getConnection = async () => {
  const db = await open({
    filename: "./data/db.sqlite",
    driver: sqlite3.cached.Database,
  });

  db.migrate({
    migrationsPath: "./data/migrations",
  });

  return db;
};
