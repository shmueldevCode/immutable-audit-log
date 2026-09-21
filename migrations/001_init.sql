CREATE TABLE audit_log (
  seq        BIGINT PRIMARY KEY,
  id         UUID NOT NULL UNIQUE,
  ts         TIMESTAMPTZ NOT NULL,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  resource   TEXT NOT NULL,
  payload    JSONB NOT NULL,
  prev_hash  CHAR(64) NOT NULL UNIQUE,
  hash       CHAR(64) NOT NULL UNIQUE
);

CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER no_update_delete BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE ROLE audit_app LOGIN PASSWORD 'app-pass';
GRANT INSERT, SELECT ON audit_log TO audit_app;
