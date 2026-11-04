"""Native Trade PostgreSQL outbox -> real RabbitMQ publisher-confirm adapter.

The *owner* is baobab-trade. This standalone Python runtime executes only
already-committed Medusa event_outbox rows; it does NOT create orders, grant
IAM/CP authority, reclassify retired events or replace Medusa mutations.

Exactly one dispatcher backend must own the deployment. PostgreSQL row leases
and fenced completion protect multiple instances; RabbitMQ confirms provide
at-least-once transport, NOT exactly-once delivery or ERP business completion.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import uuid
from dataclasses import dataclass
from opentelemetry import trace
from opentelemetry.propagate import extract
from opentelemetry.trace import Link, SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from datetime import timedelta
from urllib.parse import urlsplit

import pika
import psycopg
from psycopg.rows import dict_row

# DEV-11: deliberately ONE fully qualified event until its native ERP effect
# is certified. Customer projections and all other engines are NOT subscribed
# through this publisher by inference from a shared exchange.
TYPES = frozenset({"com.baobab-platform.trade.order.placed.v1"})
EXCHANGE = "baobab.trade.events.v1"
CONTENT_TYPE = "application/cloudevents+json"
MAX_BYTES = 1_048_576
MAX_ATTEMPTS = 8
LEASE_SECONDS = 60
SAFE_W3C = re.compile(
    r"^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$")


def configure_otel(environment: str):
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
    if not endpoint:
        return None
    target = urlsplit(endpoint)
    if target.scheme not in ("http", "https") or target.username or target.password or target.query or target.fragment or (
            target.path != "/v1/traces") or (environment not in ("development", "test", "integration") and target.scheme != "https"):
        raise RuntimeError("TRADE_OTLP_ENDPOINT_NOT_APPROVED")
    provider = TracerProvider(resource=Resource.create({
        "service.name": "baobab-trade-rabbit-publisher",
        "service.namespace": "baobab",
        "service.version": os.environ.get("BAOBAB_SERVICE_VERSION", "development"),
        "deployment.environment.name": environment,
    }))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint, timeout=6)))
    trace.set_tracer_provider(provider)
    return provider


def publish_span(claimed):
    origin = claimed.envelope.get("traceparent")
    links = []
    remote_context = None
    if isinstance(origin, str) and SAFE_W3C.fullmatch(origin):
        remote = extract({"traceparent": origin})
        scope = trace.get_current_span(remote).get_span_context()
        if scope.is_valid:
            remote_context = remote
            links.append(Link(scope))
    return trace.get_tracer("baobab.trade.rabbit.publisher", "dev11").start_as_current_span(
        "baobab.trade.rabbit.publish", context=remote_context,
        kind=SpanKind.PRODUCER, links=links)


class SourceEnvelopeInvalid(Exception):
    pass


@dataclass(frozen=True)
class Claimed:
    id: str
    event_id: str
    event_type: str
    envelope: dict
    attempt: int
    tenant_id: str | None = None
    idempotency_key: str | None = None


CLAIM_SQL = """
WITH next AS (
    SELECT id FROM event_outbox
    WHERE deleted_at IS NULL
      AND event_type = ANY(%(types)s::text[])
      AND (%(only_event_id)s::text IS NULL OR event_id = %(only_event_id)s)
      AND (
        (status IN ('PENDING','RETRY') AND next_attempt_at <= now())
        OR (status = 'PUBLISHING' AND lease_expires_at < now())
      )
    ORDER BY next_attempt_at, id
    FOR UPDATE SKIP LOCKED LIMIT 1
)
UPDATE event_outbox AS o
SET status = 'PUBLISHING',
    attempt_count = o.attempt_count + 1,
    lease_expires_at = now() + make_interval(secs => %(lease)s),
    updated_at = now()
FROM next
WHERE o.id = next.id
RETURNING o.id, o.event_id, o.event_type, o.envelope, o.attempt_count, o.tenant_id, o.idempotency_key
"""

PUBLISHED_SQL = """
UPDATE event_outbox
SET status = 'PUBLISHED', published_at = now(), lease_expires_at = NULL,
    last_error_code = NULL, updated_at = now()
WHERE id = %(id)s AND status = 'PUBLISHING'
  AND attempt_count = %(attempt)s AND lease_expires_at > now()
  AND deleted_at IS NULL
RETURNING id
"""

FAILED_SQL = """
UPDATE event_outbox
SET status = %(status)s, last_error_code = %(cause)s,
    lease_expires_at = NULL, next_attempt_at = now() + make_interval(secs => %(delay)s),
    updated_at = now()
WHERE id = %(id)s AND status = 'PUBLISHING'
  AND attempt_count = %(attempt)s AND lease_expires_at > now()
  AND deleted_at IS NULL
RETURNING id
"""


def validate_broker_url(url: str, environment: str):
    parsed = urlsplit(url)
    if (parsed.scheme not in ("amqp", "amqps") or not parsed.hostname or
            not parsed.username or not parsed.password or parsed.fragment):
        raise RuntimeError("TRADE_AMQP_CONNECTION_INVALID")
    if parsed.scheme != "amqps" and environment not in ("development", "test", "integration"):
        raise RuntimeError("TRADE_AMQP_TLS_REQUIRED")
    return url


def payload_for(claim: Claimed):
    value = claim.envelope
    if (type(value) is not dict or value.get("id") != claim.event_id or
            value.get("type") != claim.event_type or claim.event_type not in TYPES or
            value.get("source") not in (
                "urn:baobab-platform:service:trade",
                "urn:baobab-platform:service:baobab-trade",
            ) or value.get("baobabscope") != "tenant"
            or not isinstance(claim.tenant_id, str)
            or value.get("tenantid") != claim.tenant_id
            or not isinstance(claim.idempotency_key, str)
            or value.get("idempotencykey") != claim.idempotency_key
            or not isinstance(value.get("data"), dict)):
        raise SourceEnvelopeInvalid("TRADE_CANONICAL_EVENT_INVALID")
    body = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(body) == 0 or len(body) > MAX_BYTES:
        raise SourceEnvelopeInvalid("TRADE_EVENT_SIZE_INVALID")
    return body


def claim_next(db, *, only_event_id: str | None = None, lease_seconds: int = LEASE_SECONDS):
    # The limit is only lowered during disposable crash injection; production
    # never borrows an unsafe one-second lease from a test.
    if not 3 <= lease_seconds <= LEASE_SECONDS or (
            lease_seconds != LEASE_SECONDS and
            os.environ.get("BAOBAB_DEV11_RABBIT_CONNECTED_REQUIRED") != "true"):
        raise ValueError("TRADE_OUTBOX_LEASE_POLICY_UNAPPROVED")
    with db.transaction():
        row = db.execute(CLAIM_SQL, {
            "types": list(TYPES), "lease": lease_seconds,
            "only_event_id": only_event_id,
        }).fetchone()
    return Claimed(row["id"], row["event_id"], row["event_type"],
                   row["envelope"], row["attempt_count"], row["tenant_id"],
                   row["idempotency_key"]) if row else None


def settle(db, claimed: Claimed, *, confirmed: bool, cause: str = "BROKER_UNKNOWN_OUTCOME"):
    allowed = {"BROKER_NACK", "BROKER_UNROUTABLE", "BROKER_UNKNOWN_OUTCOME",
               "TRADE_CANONICAL_EVENT_INVALID", "TRADE_EVENT_SIZE_INVALID"}
    if not confirmed and cause not in allowed:
        raise RuntimeError("TRADE_BROKER_FAILURE_CODE_UNAPPROVED")
    if confirmed:
        statement = PUBLISHED_SQL
        parameters = {"id": claimed.id, "attempt": claimed.attempt}
    else:
        parameters = {"id": claimed.id, "attempt": claimed.attempt, "cause": cause,
                      "status": "DEAD_LETTER" if claimed.attempt >= MAX_ATTEMPTS
                      or cause in {"TRADE_CANONICAL_EVENT_INVALID", "TRADE_EVENT_SIZE_INVALID"}
                      else "RETRY",
                      "delay": min(300, 2 ** min(claimed.attempt - 1, 8))}
        statement = FAILED_SQL
    with db.transaction():
        row = db.execute(statement, parameters).fetchone()
    # A lost lease is NOT a confirmation or a reason to erase broker ambiguity.
    if row is None:
        raise RuntimeError("TRADE_OUTBOX_LEASE_FENCE_LOST")
    return "PUBLISHED" if confirmed else parameters["status"]


def publish_confirmed(channel, claimed: Claimed, secret: str):
    body = payload_for(claimed)
    signature = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    properties = pika.BasicProperties(
        content_type=CONTENT_TYPE,
        delivery_mode=2,
        message_id=claimed.event_id,
        type=claimed.event_type,
        headers={
            "x-baobab-signature": signature,
            # Diagnostic context survives redelivery unchanged. A broker
            # transport header never grants an ERP posting right.
            **({"traceparent": claimed.envelope["traceparent"]}
               if isinstance(claimed.envelope.get("traceparent"), str) and
               SAFE_W3C.fullmatch(claimed.envelope["traceparent"]) else {}),
        },
    )
    # A ConfirmChannel ACK alone is insufficient for unroutable messages;
    # mandatory publishing raises pika.exceptions.UnroutableError.
    channel.basic_publish(
        exchange=EXCHANGE, routing_key=claimed.event_type,
        body=body, properties=properties, mandatory=True,
    )


def one(db, channel, secret: str, *, only_event_id: str | None = None):
    claimed = claim_next(db, only_event_id=only_event_id)
    if claimed is None:
        return "NO_DUE"
    with publish_span(claimed) as span:
        span.set_attribute("messaging.system", "rabbitmq")
        span.set_attribute("messaging.operation.type", "publish")
        span.set_attribute("messaging.message.id", claimed.event_id)
        span.set_attribute("baobab.event.type", claimed.event_type)
        try:
            publish_confirmed(channel, claimed, secret)
        except SourceEnvelopeInvalid as error:
            outcome = settle(db, claimed, confirmed=False, cause=str(error))
        except pika.exceptions.UnroutableError:
            outcome = settle(db, claimed, confirmed=False, cause="BROKER_UNROUTABLE")
        except pika.exceptions.NackError:
            outcome = settle(db, claimed, confirmed=False, cause="BROKER_NACK")
        except Exception:
            # Connection/confirmation ambiguity may mean the broker persisted
            # the message. Retrying is safe only with ERP's durable dedup.
            outcome = settle(db, claimed, confirmed=False, cause="BROKER_UNKNOWN_OUTCOME")
        else:
            outcome = settle(db, claimed, confirmed=True)
        span.set_attribute("baobab.outbox.result", outcome)
        if outcome != "PUBLISHED":
            span.set_status(Status(StatusCode.ERROR))
        return outcome


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max", type=int, default=50)
    parser.add_argument("--event-id", help="Dispatch only this existing immutable outbox event")
    args = parser.parse_args()
    if args.event_id is not None:
        try:
            if str(uuid.UUID(args.event_id)) != args.event_id:
                raise ValueError
        except (ValueError, AttributeError):
            raise RuntimeError("TRADE_DISPATCH_EVENT_ID_INVALID") from None
    if not 1 <= args.max <= 500:
        raise RuntimeError("TRADE_DISPATCH_LIMIT_INVALID")
    environment = os.environ.get("BAOBAB_ENVIRONMENT", "")
    if environment not in ("development", "test", "integration", "staging", "production"):
        raise RuntimeError("TRADE_AMQP_ENVIRONMENT_REQUIRED")
    if os.environ.get("BAOBAB_EVENT_DISPATCH_BACKEND") != "rabbitmq-confirmed":
        raise RuntimeError("TRADE_EXCLUSIVE_DISPATCHER_BACKEND_NOT_SELECTED")
    url = validate_broker_url(os.environ.get("BAOBAB_RABBITMQ_URL", ""), environment)
    secret = os.environ.get("BAOBAB_EVENT_SIGNING_SECRET", "")
    database = os.environ.get("DATABASE_URL", "")
    if not database or len(secret) < 24:
        raise RuntimeError("TRADE_SIGNING_KEY_AND_POSTGRES_REQUIRED")
    provider = configure_otel(environment)
    try:
        dispatch(database, url, secret, args.max, only_event_id=args.event_id)
    finally:
        if provider is not None:
            provider.shutdown()


def dispatch(database, url, secret, limit, *, only_event_id=None):
    with psycopg.connect(database, autocommit=True, row_factory=dict_row) as db:
        broker = pika.BlockingConnection(pika.URLParameters(url))
        try:
            channel = broker.channel()
            # Infrastructure provisions the durable exchange and routes.
            # A missing exchange must fail rather than silently publish to a
            # different authority or create a new public event stream.
            channel.exchange_declare(exchange=EXCHANGE, passive=True)
            channel.confirm_delivery()
            counts = {}
            for _ in range(limit):
                outcome = one(db, channel, secret, only_event_id=only_event_id)
                counts[outcome] = counts.get(outcome, 0) + 1
                if outcome == "NO_DUE":
                    break
            # No message contents, secrets, tenant or event identities.
            print(json.dumps({"event": "trade.rabbitmq.dispatch", "counts": counts,
                              "business_effect_qualified": False}, sort_keys=True))
        finally:
            if broker.is_open:
                broker.close()


if __name__ == "__main__":
    main()
