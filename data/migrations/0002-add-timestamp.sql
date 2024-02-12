--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE alertsTemp (
  id        INTEGER     PRIMARY KEY,
  chatId    TEXT        NOT NULL,
  target    REAL        NOT NULL,
  pair      TEXT        NOT NULL,
  alertOn   TEXT        NOT NULL,
  createdOn TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO alertsTemp (chatId, target, pair, alertOn) SELECT chatId, target, pair, alertOn from alerts;

DROP TABLE alerts;
ALTER TABLE alertsTemp RENAME TO alerts;

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

CREATE TABLE alertsTemp (
  id        INTEGER     PRIMARY KEY,
  chatId    TEXT        NOT NULL,
  target    REAL        NOT NULL,
  pair      TEXT        NOT NULL,
  alertOn   TEXT        NOT NULL
);

INSERT INTO alertsTemp (chatId, target, pair, alertOn) SELECT chatId, target, pair, alertOn from alerts;

DROP TABLE alerts;
ALTER TABLE alertsTemp RENAME TO alerts;