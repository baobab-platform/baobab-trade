"""Disposable DEV-11 fault: real RabbitMQ confirm, then hard crash before PG settlement.

Not deployed, not a production publisher. Only the exact run-owned second
Medusa outbox row may be leased. A real broker confirmation is required BEFORE
the process exits 73. Reclaiming the un-settled lease and duplicate suppression
are verified in an independent process.
"""
from __future__ import annotations

import argparse
import os
import uuid

import pika
import psycopg
from psycopg.rows import dict_row

from dev11_rabbit_dispatcher import EXCHANGE, claim_next, publish_confirmed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--event-id", required=True)
    args = parser.parse_args()
    try:
        event_id = str(uuid.UUID(args.event_id))
    except ValueError:
        raise RuntimeError("DEV11_AMBIGUOUS_EVENT_ID_INVALID") from None
    if os.environ.get("BAOBAB_ENVIRONMENT") != "development" or (
            os.environ.get("BAOBAB_DEV11_RABBIT_CONNECTED_REQUIRED") != "true"
            or os.environ.get("BAOBAB_EVENT_DISPATCH_BACKEND") != "rabbitmq-confirmed"):
        raise RuntimeError("DEV11_CRASH_PUBLISHER_DISPOSABLE_ONLY")

    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True, row_factory=dict_row) as db:
        previous = db.execute(
            "SELECT idempotency_key, status FROM event_outbox WHERE event_id=%s",
            (event_id,),
        ).fetchone()
        if (previous is None or previous["status"] != "PENDING" or
                previous["idempotency_key"] != "dev11-rabbit-ambiguous:" + event_id):
            raise RuntimeError("DEV11_UNOWNED_EVENT_CRASH_DENIED")
        claimed = claim_next(db, only_event_id=event_id, lease_seconds=5)
        if claimed is None or claimed.event_id != event_id or claimed.attempt != 1:
            raise RuntimeError("DEV11_FENCED_AMBIGUOUS_CLAIM_FAILED")

        broker = pika.BlockingConnection(pika.URLParameters(
            os.environ["BAOBAB_RABBITMQ_URL"]))
        channel = broker.channel()
        channel.exchange_declare(exchange=EXCHANGE, passive=True)
        channel.confirm_delivery()
        publish_confirmed(channel, claimed, os.environ["BAOBAB_EVENT_SIGNING_SECRET"])
        # REAL broker confirm has returned; PostgreSQL is intentionally
        # still PUBLISHING. An abrupt exit prevents all further cleanup or
        # outbox status writes in this child. CI observes the native row and
        # RabbitMQ before retrying.
        os._exit(73)


if __name__ == "__main__":
    main()
