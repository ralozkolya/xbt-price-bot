--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE alerts (
  id        INTEGER PRIMARY KEY,
  chatId    TEXT    NOT NULL,
  target    REAL    NOT NULL,
  pair      TEXT    NOT NULL,
  alertOn   TEXT    NOT NULL
);

CREATE INDEX alerts_pair ON alerts (pair);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP INDEX alerts_pair;
DROP TABLE alerts;