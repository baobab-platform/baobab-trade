#!/usr/bin/env python3
"""DEV-07: publish ONLY a read-back genuine buyer event through existing AMQP.

Not a new publisher. The already deployed dev11_rabbit_dispatcher owns the
exclusive broker/lease/confirm/replay path. No native order is created here.
This gate intentionally never claims IAM/CP, ERP or L4 acceptance from a
publisher confirmation, even when all Trade native SQL checks pass.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import uuid

import psycopg
from psycopg.rows import dict_row

from dev11_native_business_origin import assess_native_origin
from dev11_rabbit_dispatcher import (
    MAX_ATTEMPTS, configure_otel, dispatch, validate_broker_url,
)

PROVEN = "DEV07_GENUINE_NATIVE_EVENT_PUBLISHED"
BLOCKED = "DEV07_GENUINE_EVENT_NOT_PUBLISHABLE"


class HandoffRefusal(Exception):
    pass


def check_published(origin: dict[str, str], row: dict) -> dict:
    """Independently compare immutable original order/XID/digest after dispatch."""
    if (
        not isinstance(origin, dict) or
        row.get("event_id") != origin.get("event_id") or
        row.get("event_type") != "com.baobab-platform.trade.order.placed.v1" or
        row.get("native_insert_xid") != origin.get("transaction_id") or
        row.get("envelope_digest") != origin.get("persisted_envelope_digest") or
        row.get("status") != "PUBLISHED" or
        not isinstance(row.get("attempt_count"), int) or
        not 1 <= row["attempt_count"] <= MAX_ATTEMPTS or
        not isinstance(row.get("envelope"), dict) or
        row["envelope"].get("id") != origin.get("event_id") or
        row["envelope"].get("data", {}).get("commerce_order_id") != origin.get("order_id") or
        row["envelope"].get("traceparent") != origin.get("traceparent")
    ):
        raise HandoffRefusal(BLOCKED)
    return {
        "schema": "baobab.trade.dev07-genuine-publisher-handoff.v1",
        "event_id": origin["event_id"],
        "order_id": origin["order_id"],
        "native_transaction_id": origin["transaction_id"],
        "immutable_envelope_digest": origin["persisted_envelope_digest"],
        "trade_native_order_readback": True,
        "exact_original_outbox_publisher_confirmed": True,
        "erp_inbox_qualified": False,
        "native_erp_business_effect_qualified": False,
        "current_iam_cp_authority_independently_qualified": False,
        "independent_exported_trace_qualified": False,
        "l4_ops_01": "BLOCKED",
        "protected_acceptance": False,
        "production_authorized": False,
    }


def one_outbox(db, event_id: str) -> dict:
    rows = db.execute(
        """SELECT event_id, event_type, native_insert_xid, envelope_digest,
                  envelope, status, attempt_count
           FROM event_outbox WHERE event_id=%s AND deleted_at IS NULL""",
        (event_id,),
    ).fetchall()
    if len(rows) != 1:
        raise HandoffRefusal(BLOCKED)
    return dict(rows[0])


def dispatch_genuine_event(event_id: str, database: str, broker: str, secret: str) -> dict:
    """No source-qualified B2B order -> no broker call or new event."""
    with psycopg.connect(database, autocommit=True, row_factory=dict_row,
                        connect_timeout=5) as db:
        observed = assess_native_origin(db, event_id)
        if (not observed.qualified or observed.business_origin is None or
                not observed.enforced_b2b_commit or
                not observed.exact_commit_transaction or
                not observed.spend_commit_same_transaction):
            raise HandoffRefusal("NATIVE_ORIGIN_NOT_PROVEN:" + observed.code)
        original = dict(observed.business_origin)
        before = one_outbox(db, event_id)
        if before["status"] not in ("PENDING", "RETRY"):
            raise HandoffRefusal("ORIGINAL_OUTBOX_NOT_PENDING")
        if (before.get("native_insert_xid") != original["transaction_id"] or
                before.get("envelope_digest") != original["persisted_envelope_digest"]):
            raise HandoffRefusal("ORIGINAL_OUTBOX_MUTATED")
        # Only the preexisting, publisher-confirmed implementation can send.
        # No direct AMQP publish, event construction or native SQL mutation.
        dispatch(database, broker, secret, 1, only_event_id=event_id)
        after = one_outbox(db, event_id)
        return check_published(original, after)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if (str(uuid.UUID(args.event_id)) != args.event_id or
                os.environ.get("NODE_ENV") != "test" or
                os.environ.get("BAOBAB_ENVIRONMENT") not in ("development", "integration") or
                os.environ.get("BAOBAB_EVENT_DISPATCH_BACKEND") != "rabbitmq-confirmed" or
                os.environ.get("NODE_TLS_REJECT_UNAUTHORIZED") == "0"):
            raise HandoffRefusal("DISPOSABLE_ORIGINAL_EVENT_RUNTIME_REQUIRED")
        database = os.environ["DATABASE_URL"]
        secret = os.environ["BAOBAB_EVENT_SIGNING_SECRET"]
        if len(secret) < 24:
            raise HandoffRefusal("SIGNING_AUTHORITY_NOT_CONFIGURED")
        broker = validate_broker_url(os.environ["BAOBAB_RABBITMQ_URL"],
                                     os.environ["BAOBAB_ENVIRONMENT"])
        provider = configure_otel(os.environ["BAOBAB_ENVIRONMENT"])
        try:
            receipt = dispatch_genuine_event(args.event_id, database, broker, secret)
        finally:
            if provider is not None:
                provider.shutdown()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
        print(PROVEN + "; ERP_AND_L4_STILL_BLOCKED")
        return 0
    except (HandoffRefusal, KeyError, ValueError, psycopg.Error):
        # Do not expose private broker connection, credentials or SQL.
        print(BLOCKED)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
