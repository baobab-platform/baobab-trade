-- LA-05C5 reference PostgreSQL 17 DDL; NOT an applied Medusa migration.
-- Requires a reviewed integration migration and transactional adapter before use.
CREATE TABLE IF NOT EXISTS la05_binding_decision (
  id uuid PRIMARY KEY,
  cart_id text NOT NULL,
  tenant_id text NOT NULL,
  organisation_id text NOT NULL,
  market_code char(2) NOT NULL,
  currency_code char(3) NOT NULL,
  decision text NOT NULL CHECK (decision IN ('PROPOSED','APPROVED','REVOKED')),
  actor_subject text NOT NULL,
  evidence_reference text NOT NULL,
  evidence_decision_id text NOT NULL,
  -- Mandatory for REVOKED: revocation must be evidence- AND reason-backed (LA-05C3).
  reason text,
  CHECK (decision <> 'REVOKED' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (cart_id, id)
);
CREATE TABLE IF NOT EXISTS la05_binding_outbox (
  id uuid PRIMARY KEY,
  decision_id uuid NOT NULL REFERENCES la05_binding_decision(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  published_at timestamptz,
  UNIQUE (decision_id, event_type)
);
-- An adapter must lock the cart binding FOR UPDATE, compare immutable scope,
-- apply state transition, append decision and insert outbox IN ONE transaction.
-- Canonical event types/versions remain blocked on Shared contract approval.
-- Never publish from an uncommitted transaction or use this SQL as a standalone rollout.
