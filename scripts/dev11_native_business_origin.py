#!/usr/bin/env python3
"""DEV-07/11 read-only, PostgreSQL-backed native order/event origin qualification.

ADR-0014, ADR-0017, ADR-0036 and ADR-SHARED-042 Decisions 5–9.
This verifier never emits or grants a buyer/ERP authority fact. It examines the
ACTUAL Medusa PostgreSQL records at one repeatable-read snapshot BEFORE broker
dispatch. A signed CloudEvent, test fixture, span or broker confirmation cannot
substitute for an ENFORCED B2B native commit plus consumption in one transaction.

It is deliberately impossible for the current Trade SQL version to pass B2B:
Migration20261023120000 still returns BUYER_AUTHORITY_ABSENT and ships SHADOW.
The successor CAA-06b owner must implement native same-transaction buyer receipt,
fully final valuation, spend conversion and ENFORCED gate before using this as
positive source evidence. Do not revise these checks to make synthetic CI green.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

EVENT_TYPE = "com.baobab-platform.trade.order.placed.v1"
EVENT_SOURCE = "urn:baobab-platform:service:baobab-trade"
_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,199}$")
_TABLES = (
    'public."order"',
    "public.event_outbox",
    "public.trade_order_commitment",
    "public.trade_order_authority_receipt",
    "public.trade_commit_fence_decision",
    "public.trade_native_commitment_classification",
    "public.b2b_spend_ledger_entry",
    "public.b2b_spend_reservation",
)


class OriginRefusal(Exception):
    """Stable non-sensitive refusal category, never a SQL/provider error."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class OriginObservation:
    qualified: bool
    code: str
    # Stage booleans are source facts, NOT an IAM/CP fresh authority readback.
    native_order_readback: bool = False
    enforced_b2b_commit: bool = False
    exact_commit_transaction: bool = False
    spend_commit_same_transaction: bool = False


def _refuse(code: str) -> None:
    raise OriginRefusal(code)


def _normalised_envelope(envelope: Any, event_id: str, tenant_id: str,
                         idempotency_key: str) -> str:
    if not isinstance(envelope, dict) or set(("id", "source", "type", "data")) - set(envelope):
        _refuse("EVENT_ENVELOPE_INVALID")
    if (envelope["id"] != event_id or envelope["source"] != EVENT_SOURCE
            or envelope["type"] != EVENT_TYPE
            or envelope.get("baobabscope") != "tenant"
            or envelope.get("tenantid") != tenant_id
            or envelope.get("idempotencykey") != idempotency_key):
        _refuse("EVENT_PROVENANCE_MISMATCH")
    data = envelope["data"]
    order_id = data.get("commerce_order_id") if isinstance(data, dict) else None
    if not isinstance(order_id, str) or not _ID.fullmatch(order_id):
        _refuse("EVENT_ORDER_REFERENCE_INVALID")
    if (not isinstance(data.get("legal_entity_id"), str)
            or not isinstance(data.get("currency"), str)
            or not isinstance(envelope.get("traceparent"), str)
            or not re.fullmatch(r"00-[0-9a-f]{32}-[0-9a-f]{16}-0[1-9a-f]", envelope["traceparent"])):
        _refuse("EVENT_BUSINESS_CONTEXT_NOT_PROVEN")
    return order_id


def _read_native_origin(db, event_id: str) -> OriginObservation:
    """Use owner-created Medusa rows, not a producer-uploaded proof document."""
    if not isinstance(event_id, str) or not _ID.fullmatch(event_id):
        _refuse("EVENT_ID_INVALID")
    # A schema has no business meaning if these owning migrations are absent.
    missing = db.execute(
        "SELECT required.table_name FROM unnest(%s::text[]) AS required(table_name) WHERE to_regclass(required.table_name) IS NULL",
        (list(_TABLES),),
    ).fetchall()
    if missing:
        _refuse("NATIVE_SCHEMA_OR_FENCE_NOT_INSTALLED")

    events = db.execute(
        """SELECT event_id, event_type, tenant_id, idempotency_key, envelope,
                  xmin::text AS insert_xid
           FROM event_outbox WHERE event_id=%s AND deleted_at IS NULL""",
        (event_id,),
    ).fetchall()
    if len(events) != 1:
        _refuse("NATIVE_OUTBOX_EVENT_ABSENT")
    event = events[0]
    if event["event_type"] != EVENT_TYPE or not event["tenant_id"]:
        _refuse("NATIVE_EVENT_TYPE_OR_TENANT_MISMATCH")
    order_id = _normalised_envelope(
        event["envelope"], event_id, event["tenant_id"], event["idempotency_key"],
    )
    native = db.execute(
        """SELECT id, currency_code, is_draft_order
           FROM "order" WHERE id=%s AND deleted_at IS NULL""", (order_id,),
    ).fetchall()
    # This is the expected denial for the current synthetic RabbitMQ fixture.
    if len(native) != 1:
        _refuse("NATIVE_ORDER_ABSENT")
    if native[0]["is_draft_order"] or native[0]["currency_code"].upper() != event["envelope"]["data"]["currency"]:
        _refuse("NATIVE_ORDER_SCOPE_OR_STATE_MISMATCH")

    results = db.execute(
        """SELECT k.receipt_id::text, k.subject_id, k.subject_type,
                  k.xmin::text AS native_commit_xid,
                  r.tenant_id, r.consumed_at,
                  d.outcome, d.enforcement_mode, d.commerce_model,
                  d.xmin::text AS decision_xid,
                  c.status AS classification_status, c.buyer_account_model,
                  c.buyer_organisation_id, c.buyer_membership_id
           FROM trade_order_commitment k
           JOIN trade_order_authority_receipt r ON r.receipt_id=k.receipt_id
           JOIN trade_commit_fence_decision d
             ON d.receipt_id=k.receipt_id
            AND d.subject_type=k.subject_type AND d.subject_id=k.subject_id
           LEFT JOIN trade_native_commitment_classification c
             ON c.classification_id=d.classification_id
           WHERE k.order_id=%s""", (order_id,),
    ).fetchall()
    if len(results) != 1:
        _refuse("NATIVE_COMMITMENT_RECEIPT_NOT_UNIQUE")
    commitment = results[0]
    if (commitment["tenant_id"] != event["tenant_id"]
            or commitment["consumed_at"] is None
            or commitment["classification_status"] != "ACTIVE"
            or commitment["buyer_account_model"] != "BUYER_ORGANISATION"
            or not commitment["buyer_organisation_id"]
            or not commitment["buyer_membership_id"]):
        _refuse("NATIVE_BUYER_SCOPE_NOT_BOUND")
    if (commitment["outcome"] != "ALLOWED"
            or commitment["commerce_model"] != "B2B"
            or commitment["enforcement_mode"] != "ENFORCED"):
        # In the current accepted migration, B2B always refuses here.
        _refuse("NATIVE_B2B_ENFORCEMENT_NOT_QUALIFIED")
    if (event["insert_xid"] != commitment["native_commit_xid"]
            or event["insert_xid"] != commitment["decision_xid"]):
        # A second transaction that writes a plausible outbox row is NOT an
        # atomic native Medusa order/outbox source, regardless of signature.
        _refuse("NATIVE_OUTBOX_NOT_IN_ORDER_TRANSACTION")

    ledger = db.execute(
        """SELECT l.xmin::text AS conversion_xid, l.reservation_id,
                  l.amount_minor, s.amount_minor AS reserved_amount_minor,
                  s.membership_id, s.organisation_id, s.status
           FROM b2b_spend_ledger_entry l
           JOIN b2b_spend_reservation s ON s.id=l.reservation_id
           WHERE l.commitment_reference=%s AND l.entry_kind='COMMIT'
             AND l.deleted_at IS NULL""",
        (order_id,),
    ).fetchall()
    if not ledger or any(
        row["conversion_xid"] != event["insert_xid"]
        or row["membership_id"] != commitment["buyer_membership_id"]
        or row["organisation_id"] != commitment["buyer_organisation_id"]
        or row["amount_minor"] != row["reserved_amount_minor"]
        or row["status"] != "COMMITTED" for row in ledger
    ):
        _refuse("NATIVE_SPEND_CONVERSION_NOT_ATOMIC")
    return OriginObservation(
        qualified=True, code="NATIVE_ORIGIN_SQL_CONFIRMED",
        native_order_readback=True, enforced_b2b_commit=True,
        exact_commit_transaction=True, spend_commit_same_transaction=True,
    )


def assess_native_origin(db, event_id: str) -> OriginObservation:
    try:
        # Fail safe if the source/schema/database cannot be independently read.
        with db.transaction():
            db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            db.execute("SET LOCAL statement_timeout = '3s'")
            return _read_native_origin(db, event_id)
    except OriginRefusal as err:
        return OriginObservation(False, err.code)
    except (psycopg.Error, KeyError, ValueError, TypeError, AttributeError):
        return OriginObservation(False, "NATIVE_ORIGIN_READBACK_UNAVAILABLE")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--event-id")
    group.add_argument("--expect-synthetic-refusal", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if (os.getenv("NODE_ENV") != "test"
            or os.getenv("BAOBAB_ENVIRONMENT") not in {"test", "development", "integration"}
            or not os.getenv("DATABASE_URL")):
        raise SystemExit("NATIVE_ORIGIN_VERIFIER_DISPOSABLE_POSTGRES_REQUIRED")
    try:
        with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True,
                             row_factory=dict_row, connect_timeout=5) as db:
            if args.expect_synthetic_refusal:
                event_ids = db.execute(
                    """SELECT event_id FROM event_outbox
                       WHERE idempotency_key LIKE 'dev11-rabbit-connected:%'
                         AND event_type=%s AND deleted_at IS NULL""",
                    (EVENT_TYPE,),
                ).fetchall()
                if len(event_ids) != 1:
                    raise SystemExit("NATIVE_ORIGIN_SYNTHETIC_FIXTURE_NOT_UNIQUE")
                event_id = event_ids[0]["event_id"]
            else:
                event_id = args.event_id
            observed = assess_native_origin(db, event_id)
    except psycopg.Error:
        raise SystemExit("NATIVE_ORIGIN_DATABASE_UNAVAILABLE") from None

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps({
            "schema": "baobab.trade.dev11.native-origin.v1",
            "classification": "SOURCE_SQL_READBACK_ONLY",
            "native_origin_qualified": observed.qualified,
            "reason": observed.code,
            "native_order_readback": observed.native_order_readback,
            "enforced_b2b_commit": observed.enforced_b2b_commit,
            "exact_commit_transaction": observed.exact_commit_transaction,
            "spend_commit_same_transaction": observed.spend_commit_same_transaction,
            "current_iam_cp_authority_qualified": False,
            "native_erp_business_effect_qualified": False,
            "l4_ops_01": "BLOCKED",
            "production_authorized": False,
        }, indent=2, sort_keys=True) + "\n")
    if args.expect_synthetic_refusal:
        if observed.code != "NATIVE_ORDER_ABSENT":
            raise SystemExit("NATIVE_ORIGIN_SYNTHETIC_NEGATIVE_NOT_OBSERVED:" + observed.code)
        print("NATIVE_ORIGIN_SYNTHETIC_ORDER_REFUSED_BY_REAL_POSTGRES")
        return 0
    if observed.qualified:
        print("NATIVE_ORIGIN_SQL_READBACK_ONLY_NOT_CONNECTED_ACCEPTANCE")
        return 0
    print("NATIVE_ORIGIN_REFUSED:" + observed.code)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
