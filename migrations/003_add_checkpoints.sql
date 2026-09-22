CREATE TABLE verification_checkpoints (
  id          SERIAL PRIMARY KEY,
  seq         BIGINT NOT NULL,
  hash        CHAR(64) NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkpoints_seq ON verification_checkpoints (seq DESC);

GRANT INSERT, SELECT ON verification_checkpoints TO audit_app;
GRANT USAGE, SELECT ON SEQUENCE verification_checkpoints_id_seq TO audit_app;
