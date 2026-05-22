--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE changeAlerts (
  id        INTEGER     PRIMARY KEY,
  chatId    TEXT        NOT NULL,
  pair      TEXT        NOT NULL,
  threshold REAL        NOT NULL,
  createdOn TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX changeAlerts_pair ON changeAlerts (pair);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP INDEX changeAlerts_pair;
DROP TABLE changeAlerts;
