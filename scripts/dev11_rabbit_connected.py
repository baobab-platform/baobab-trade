"""Connected DEV-11 component qualification: native Medusa PG outbox -> RabbitMQ
publisher confirm -> canonical ERP inbox (two separate real PostgreSQL DBs).

This run does NOT execute an iDempiere business effect, does NOT use an actual
commercial order, and MUST NEVER set L4-OPS-01 = PASS. A second engine-native
authority and iDempiere posting/effect scenario remains a separate hard gate.
"""
from __future__ import annotations
import base64
import json
import os
import subprocess
import sys
from urllib.parse import quote, unquote, urlsplit
from urllib.request import Request, urlopen
from pathlib import Path
import time

import pika
import psycopg
from psycopg.rows import dict_row

from dev11_rabbit_dispatcher import (
    CONTENT_TYPE, EXCHANGE, Claimed, one, publish_confirmed, configure_otel,
)

QUEUE = "baobab.erp.trade-order.v1"
DLX = "baobab.trade.dlx.v1"
DEAD = "baobab.erp.trade-order.dlq.v1"
SIGN = "x-baobab-signature"


def demand(ok, code):
    if not ok:
        raise RuntimeError(code)


def fetch_message(channel, queue=DEAD):
    for _ in range(60):
        method, properties, body = channel.basic_get(queue, auto_ack=False)
        if method:
            return method, properties, body
        time.sleep(0.25)
    raise RuntimeError("DEV11_REAL_RABBIT_DLQ_EVIDENCE_ABSENT")


def await_erp_record(erp_url, event, consumer, *, allow_crash=False):
    """Independent real ERP consumer process has committed a PG receipt."""
    for _ in range(80):
        exited = consumer.poll()
        if exited is not None and (not allow_crash or exited != 73):
            raise RuntimeError("DEV11_NATIVE_ERP_CONSUMER_EXITED_BEFORE_RECEIPT")
        with psycopg.connect(erp_url) as erp:
            match = erp.execute(
                """SELECT status, ce_traceparent, payload_json
                   FROM baobab.event_inbox
                   WHERE envelope_format='cloudevents' AND event_id=%s::uuid
                     AND ce_source=%s""",
                (event["id"], event["source"]),
            ).fetchone()
        if match is not None:
            demand(match[0] == "received" and
                   match[1] == event["traceparent"] and
                   match[2] == event["data"],
                   "DEV11_NATIVE_ERP_DURABLE_ADMISSION_INVALID")
            return
        time.sleep(0.25)
    raise RuntimeError("DEV11_REAL_ERP_DURABLE_ADMISSION_MISSING")


MAX_MANAGEMENT_STATS_BYTES = 64 * 1024


def parse_management_stats(body: bytes) -> dict:
    """Bounded full JSON response; the management record exceeds 2 KiB in practice."""
    if len(body) > MAX_MANAGEMENT_STATS_BYTES:
        raise RuntimeError("DEV11_BROKER_MANAGEMENT_STATS_OVERSIZED")
    try:
        result = json.loads(body)
    except (ValueError, UnicodeError):
        raise RuntimeError("DEV11_BROKER_MANAGEMENT_STATS_MALFORMED") from None
    if not isinstance(result, dict):
        raise RuntimeError("DEV11_BROKER_MANAGEMENT_STATS_MALFORMED")
    return result


def wait_durable_ack(channel, consumer, *, minimum_ack):
    """Independently verify RabbitMQ's own manual ACK counter, not a guess
    from inbox persistence or the absence of READY messages. All inspection
    stays on this disposable runner's loopback management listener.
    """
    connection = urlsplit(os.environ["BAOBAB_RABBITMQ_URL"])
    if connection.hostname not in ("127.0.0.1", "localhost"):
        raise RuntimeError("DEV11_MANAGEMENT_PROBE_MUST_BE_LOOPBACK")
    user = unquote(connection.username or "")
    password = unquote(connection.password or "")
    token = base64.b64encode((user + ":" + password).encode()).decode()
    request = Request(
        "http://127.0.0.1:15672/api/queues/%2F/" + quote(QUEUE, safe=""),
        headers={"Authorization": "Basic " + token,
                 "User-Agent": "dev11-independent-broker-ack-observer"},
    )
    for _ in range(80):
        if consumer.poll() is not None:
            raise RuntimeError("DEV11_NATIVE_ERP_CONSUMER_EXITED")
        with urlopen(request, timeout=5) as response:
            payload = response.read(MAX_MANAGEMENT_STATS_BYTES + 1)
        stats = parse_management_stats(payload)
        counters = stats.get("message_stats") or {}
        if (counters.get("ack", 0) >= minimum_ack
                and stats.get("messages_ready") == 0
                and stats.get("messages_unacknowledged") == 0):
            return
        time.sleep(.25)
    raise RuntimeError("DEV11_BROKER_DELIVERY_NOT_ACKED")


def publish_synthetic(channel, event, signature):
    body = json.dumps(event, separators=(",", ":"), sort_keys=True).encode("utf-8")
    channel.basic_publish(
        exchange=EXCHANGE, routing_key=event["type"], body=body, mandatory=True,
        properties=pika.BasicProperties(
            content_type=CONTENT_TYPE, delivery_mode=2, message_id=event["id"],
            headers={SIGN: signature},
        ),
    )


def main():
    trade_url = os.environ["DATABASE_URL"]
    erp_url = os.environ["ERP_DATABASE_URL"]
    rabbit_url = os.environ["BAOBAB_RABBITMQ_URL"]
    secret = os.environ["BAOBAB_EVENT_SIGNING_SECRET"]
    import hashlib
    import hmac

    exporter = configure_otel(os.environ.get("BAOBAB_ENVIRONMENT", "development"))
    broker = pika.BlockingConnection(pika.URLParameters(rabbit_url))
    consumer = None
    try:
        channel = broker.channel()
        # Synthetic disposable topology is provisioned only by this lab.
        # Production must provision identical governance outside consumers.
        channel.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
        channel.exchange_declare(exchange=DLX, exchange_type="direct", durable=True)
        channel.queue_declare(queue=QUEUE, durable=True, arguments={
            "x-queue-type": "quorum",
            "x-dead-letter-exchange": DLX,
            "x-dead-letter-routing-key": "invalid",
        })
        channel.queue_declare(queue=DEAD, durable=True,
                              arguments={"x-queue-type": "quorum"})
        channel.queue_bind(exchange=EXCHANGE, queue=QUEUE,
                           routing_key="com.baobab-platform.trade.order.placed.v1")
        channel.queue_bind(exchange=DLX, queue=DEAD, routing_key="invalid")
        channel.confirm_delivery()

        # Separate executable ERP process, not a direct unit-test invocation
        # of the consumer callback in this Trade process. Its only durable
        # result is ERP's independently read Postgres inbox and broker ACK.
        child_env = {
            **os.environ,
            "DATABASE_URL": erp_url,
            "BAOBAB_AMQP_INBOX_QUEUE": QUEUE,
        }
        consumer = subprocess.Popen(
            [sys.executable, "-B", "scripts/dev11_erp_crash_consumer.py"],
            env=child_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(.75)
        demand(consumer.poll() is None, "DEV11_NATIVE_ERP_CONSUMER_FAILED_STARTUP")

        with psycopg.connect(trade_url, autocommit=True, row_factory=dict_row) as trade:
            row = trade.execute(
                """SELECT id, event_id, event_type, envelope, attempt_count
                     FROM event_outbox
                    WHERE idempotency_key LIKE 'dev11-rabbit-connected:%'
                      AND status = 'PENDING' AND deleted_at IS NULL"""
            ).fetchone()
            demand(row is not None, "DEV11_REAL_MEDUSA_NATIVE_EVENT_MISSING")
            original = dict(row["envelope"])
            demand(one(trade, channel, secret, only_event_id=row["event_id"]) == "PUBLISHED",
                   "DEV11_RABBIT_PUBLISH_NOT_CONFIRMED")
            persisted = trade.execute(
                "SELECT status, attempt_count, envelope FROM event_outbox WHERE id=%s",
                (row["id"],),
            ).fetchone()
            demand(persisted["status"] == "PUBLISHED" and
                   persisted["attempt_count"] == 1 and
                   persisted["envelope"] == original,
                   "DEV11_NATIVE_OUTBOX_CONFIRMATION_NOT_DURABLE")

            # Failure injection is a real separate ERP process that commits
            # its native Postgres row and then exits BEFORE RabbitMQ ACK.
            await_erp_record(erp_url, original, consumer, allow_crash=True)
            for _ in range(60):
                if consumer.poll() is not None:
                    break
                time.sleep(.2)
            demand(consumer.poll() == 73, "DEV11_POST_COMMIT_PRE_ACK_CRASH_NOT_OBSERVED")

            # The server, not the parent test, redelivers the unacked message
            # after the crash process's AMQP connection disappears.
            consumer = subprocess.Popen(
                [sys.executable, "-B", "-m", "application.amqp_consumer"],
                env=child_env, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            time.sleep(.75)
            demand(consumer.poll() is None, "DEV11_ERP_RECOVERY_CONSUMER_NOT_RUNNING")
            wait_durable_ack(channel, consumer, minimum_ack=1)

            # A broker confirm may have arrived just before publisher crash;
            # genuine broker redelivery must not duplicate the ERP inbox.
            claimed = Claimed(row["id"], row["event_id"], row["event_type"],
                              original, row["attempt_count"] + 1,
                              original["tenantid"], original["idempotencykey"])
            publish_confirmed(channel, claimed, secret)
            wait_durable_ack(channel, consumer, minimum_ack=2)

            # Real second Medusa row: the publisher subprocess must receive
            # actual RabbitMQ confirmation before hard-exiting without a PG
            # status write. This reproduces broker ACK -> process death ->
            # native PUBLISHING lease expiry -> new claim -> redelivery.
            ambiguous = trade.execute(
                """SELECT id, event_id, envelope, status, attempt_count
                   FROM event_outbox
                   WHERE idempotency_key LIKE 'dev11-rabbit-ambiguous:%'
                     AND deleted_at IS NULL"""
            ).fetchone()
            demand(ambiguous is not None and ambiguous["status"] == "PENDING",
                   "DEV11_AMBIGUOUS_NATIVE_OUTBOX_NOT_PREPARED")
            crashed = subprocess.run(
                [sys.executable, "-B",
                 "scripts/dev11_broker_crash_publisher.py",
                 "--event-id", ambiguous["event_id"]],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                check=False, timeout=30,
            )
            demand(crashed.returncode == 73,
                   "DEV11_REAL_BROKER_POST_CONFIRM_PRE_SETTLEMENT_CRASH_MISSING")
            after_crash = trade.execute(
                """SELECT status, attempt_count, lease_expires_at
                     FROM event_outbox WHERE id=%s""",
                (ambiguous["id"],),
            ).fetchone()
            demand(after_crash["status"] == "PUBLISHING"
                   and after_crash["attempt_count"] == 1
                   and after_crash["lease_expires_at"] is not None,
                   "DEV11_AMBIGUOUS_BROKER_CONFIRM_NOT_DURABLE")

            # First delivery is a real native consumer execution; no Trade
            # outbox settlement occurred, so the source is genuinely unknown.
            await_erp_record(erp_url, ambiguous["envelope"], consumer)
            wait_durable_ack(channel, consumer, minimum_ack=3)
            lease_expired = False
            for _ in range(45):
                lease_expired = trade.execute(
                    "SELECT lease_expires_at <= now() FROM event_outbox WHERE id=%s",
                    (ambiguous["id"],),
                ).fetchone()[0]
                if lease_expired:
                    break
                time.sleep(.25)
            demand(lease_expired, "DEV11_ACTUAL_PUBLISHER_LEASE_NOT_EXPIRED")
            demand(
                one(trade, channel, secret, only_event_id=ambiguous["event_id"])
                == "PUBLISHED",
                "DEV11_NATIVE_PUBLISH_RECLAIM_NOT_CONFIRMED",
            )
            wait_durable_ack(channel, consumer, minimum_ack=4)
            recovered = trade.execute(
                "SELECT status, attempt_count FROM event_outbox WHERE id=%s",
                (ambiguous["id"],),
            ).fetchone()
            demand(recovered["status"] == "PUBLISHED"
                   and recovered["attempt_count"] == 2,
                   "DEV11_AMBIGUOUS_BROKER_RECOVERY_NOT_FENCED")
            with psycopg.connect(erp_url) as erp:
                ambiguous_rows = erp.execute(
                    """SELECT count(*) FROM baobab.event_inbox
                       WHERE ce_source=%s AND event_id=%s::uuid
                         AND envelope_format='cloudevents'""",
                    (ambiguous["envelope"]["source"], ambiguous["event_id"]),
                ).fetchone()[0]
            demand(ambiguous_rows == 1,
                   "DEV11_REAL_BROKER_REDELIVERY_DUPLICATED_ERP_ADMISSION")

            def signed(doc):
                body = json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()
                return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

            # Same event ID with changed canonical business facts MUST fail,
            # even with a correctly signed payload. It must reach the DLQ.
            changed = {
                **original,
                "data": {
                    **original["data"],
                    # This remains a valid ERP v1 order document but is a
                    # DIFFERENT business revision under the same event ID.
                    "order_version": original["data"]["order_version"] + 1,
                },
            }
            publish_synthetic(channel, changed, signed(changed))
            # Real independent ERP process rejects to broker-owned DLQ.
            # Bad signature to existing event also goes to the durable DLQ.
            publish_synthetic(channel, original, "sha256=" + "0" * 64)
            # Real independent ERP process rejects to broker-owned DLQ.
            for _ in range(25):
                with psycopg.connect(erp_url) as erp:
                    count = erp.execute(
                        "SELECT count(*) FROM baobab.event_inbox WHERE event_id=%s::uuid",
                        (original["id"],),
                    ).fetchone()[0]
                    status = erp.execute(
                        "SELECT status FROM baobab.event_inbox WHERE event_id=%s::uuid",
                        (original["id"],),
                    ).fetchone()[0]
                if count == 1 and status == "received":
                    break
                time.sleep(.2)
            demand(count == 1 and status == "received",
                   "DEV11_RABBIT_REPLAY_CREATED_DUPLICATE_OR_EFFECT")

            invalid1 = fetch_message(channel, DEAD)
            channel.basic_ack(delivery_tag=invalid1[0].delivery_tag)
            invalid2 = fetch_message(channel, DEAD)
            channel.basic_ack(delivery_tag=invalid2[0].delivery_tag)
            # Broker returns messages on failed mandatory routing rather than
            # letting confirmed publish imply routing to a consumer.
            unroutable = {**original, "type": "com.baobab-platform.trade.customer.projected.v1"}
            try:
                publish_synthetic(channel, unroutable, signed(unroutable))
            except pika.exceptions.UnroutableError:
                unrouted_refused = True
            else:
                unrouted_refused = False
            demand(unrouted_refused, "DEV11_MANDATORY_ROUTING_NOT_ENFORCED")

            result = {
                "schema": "trade.dev11.real-rabbit-erp-inbox.v1",
                "run_class": "REAL_NATIVE_MEDUSA_PG_RABBIT_ERPINBOX",
                "native_medusa_outbox_persisted": True,
                "real_rabbitmq_publisher_confirmed": True,
                "erp_postgres_canonical_admission": True,
                "real_crash_after_inbox_commit_before_ack_recovered": True,
                "real_crash_after_broker_confirm_before_pg_settlement_recovered": True,
                "broker_unknown_outcome_reclaimed_with_fenced_attempt": True,
                "unchanged_event_redelivery_deduplicated": True,
                "changed_business_replay_rejected": True,
                "bad_signature_rejected_to_dlx": True,
                "mandatory_unroutable_rejected": True,
                "native_erp_business_effect_qualified": False,
                "independent_exported_span_graph_qualified": False,
                "l4_ops_01": "BLOCKED",
                "protected_acceptance": False,
                "production_authorized": False,
            }
            target = Path("artifacts/dev11-rabbit/connected.json")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
            # Private only, never included in uploaded artifact glob.
            private_trace = Path("artifacts/dev11-rabbit/source-trace.private")
            private_trace.write_text(original["traceparent"].split("-")[1] + "\n")
            print("DEV11_REAL_RABBIT_ERP_INBOX_COMPONENT_PASS; NATIVE_ERP_EFFECT_UNPROVEN")
    finally:
        if consumer is not None and consumer.poll() is None:
            consumer.terminate()
            try:
                consumer.wait(timeout=15)
            except subprocess.TimeoutExpired:
                consumer.kill()
                consumer.wait(timeout=5)
        if broker.is_open:
            broker.close()
        if exporter is not None:
            exporter.shutdown()


if __name__ == "__main__":
    main()
