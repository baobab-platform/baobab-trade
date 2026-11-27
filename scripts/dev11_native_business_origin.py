#!/usr/bin/env python3
"""DEV-07/11 read-only, PostgreSQL-backed native order/event origin qualification.

ADR-0014, ADR-0017, ADR-0036 and ADR-SHARED-042 Decisions 5–9.
This verifier never emits or grants a buyer/ERP authority fact. It examines the
ACTUAL Medusa PostgreSQL records at one repeatable-read snapshot. The original outbox insertion XID survives
broker dispatch. A signed CloudEvent, test fixture, span or broker confirmation cannot
substitute for an ENFORCED B2B native commit plus consumption in one transaction.

Migration20261104190000 adds CAA-06b buyer consumption but ships SHADOW.
A positive source must independently expose native same-transaction order and
lines, buyer receipt/consumption, seller commitment, spend and event, under an
ENFORCED decision. This SQL proof still grants no current IAM/CP authority and
does not establish complete pricing finality or downstream ERP execution.
Do not revise these checks to make synthetic CI green.
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
    "public.order_item",
    "public.order_line_item",
    "public.event_outbox",
    "public.trade_order_commitment",
    "public.trade_order_authority_receipt",
    "public.trade_buyer_authority_receipt",
    "public.trade_buyer_authority_consumption",
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
    business_origin: dict[str, str] | None = None


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
            or not isinstance(envelope.get("correlationid"), str)
            or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", envelope["correlationid"])
            or not isinstance(envelope.get("traceparent"), str)
            or not re.fullmatch(r"00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-0[01]", envelope["traceparent"])):
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
                  native_insert_xid AS insert_xid, envelope_digest
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
        """SELECT id, currency_code, is_draft_order, xmin::text AS order_xid
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
        # A SHADOW decision cannot qualify a native commitment.
        _refuse("NATIVE_B2B_ENFORCEMENT_NOT_QUALIFIED")
    if (not event["insert_xid"]
            or not re.fullmatch(r"[a-f0-9]{64}", event["envelope_digest"] or "")
            or event["insert_xid"] != native[0]["order_xid"]
            or event["insert_xid"] != commitment["native_commit_xid"]
            or event["insert_xid"] != commitment["decision_xid"]):
        # A second transaction that writes a plausible outbox row is NOT an
        # atomic native Medusa order/outbox source, regardless of signature.
        _refuse("NATIVE_OUTBOX_NOT_IN_ORDER_TRANSACTION")

    # Observe the actual CAA-06b rows, not a claim that their trigger was
    # installed. Receipt and consumption must have originated in the SAME
    # native transaction, with the exact original event and seller receipt.
    buyers = db.execute(
        """SELECT b.receipt_id::text, b.payload, b.xmin::text AS receipt_xid,
                  b.evaluated_at, b.expires_at,
                  u.xmin::text AS consumption_xid, u.seller_receipt_id::text,
                  u.spend_reservation_id, u.operation_reference, u.consumed_at
           FROM trade_buyer_authority_consumption u
           JOIN trade_buyer_authority_receipt b ON b.receipt_id=u.receipt_id
           WHERE u.order_id=%s AND u.event_id=%s""", (order_id, event_id),
    ).fetchall()
    if len(buyers) != 1:
        _refuse("NATIVE_BUYER_CONSUMPTION_NOT_UNIQUE")
    buyer = buyers[0]
    payload = buyer["payload"]
    if (not isinstance(payload, dict)
            or buyer["receipt_xid"] != event["insert_xid"]
            or buyer["consumption_xid"] != event["insert_xid"]
            or buyer["seller_receipt_id"] != commitment["receipt_id"]
            or payload.get("receipt_id") != buyer["receipt_id"]
            or payload.get("tenant_id") != event["tenant_id"]
            or payload.get("correlation_id") != event["envelope"].get("correlationid")
            or payload.get("buyer_organisation_id") != commitment["buyer_organisation_id"]
            or payload.get("buyer_membership_id") != commitment["buyer_membership_id"]
            or payload.get("resource_id") != commitment["subject_id"]
            or payload.get("operation") != "trade.order.commit"
            or commitment["subject_type"] != "cart"
            or payload.get("operation_reference") != buyer["operation_reference"]
            or payload.get("spend_reservation_id") != buyer["spend_reservation_id"]
            or payload.get("seller_legal_entity_id") != event["envelope"]["data"]["legal_entity_id"]
            or payload.get("currency") != event["envelope"]["data"]["currency"]
            or not buyer["evaluated_at"] <= buyer["consumed_at"] < buyer["expires_at"]):
        _refuse("NATIVE_BUYER_CONSUMPTION_NOT_ATOMIC")

    lines = db.execute(
        """SELECT i.xmin::text AS item_xid, l.xmin::text AS line_xid
           FROM order_item i JOIN order_line_item l ON l.id=i.item_id
           WHERE i.order_id=%s AND i.deleted_at IS NULL AND l.deleted_at IS NULL""",
        (order_id,),
    ).fetchall()
    business_lines = event["envelope"]["data"].get("lines")
    if (not isinstance(business_lines, list) or not business_lines
            or len(lines) != len(business_lines)
            or any(row["item_xid"] != event["insert_xid"]
                   or row["line_xid"] != event["insert_xid"] for row in lines)):
        _refuse("NATIVE_ORDER_LINES_NOT_IN_COMMIT_TRANSACTION")

    ledger = db.execute(
        """SELECT l.xmin::text AS conversion_xid, l.reservation_id,
                  l.amount_minor, s.amount_minor AS reserved_amount_minor,
                  s.membership_id, s.organisation_id, s.status,
                  s.tenant_id, s.purchase_reference, s.resource_version,
                  s.transaction_digest, s.currency_code, s.hold_revision
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
        or row["reservation_id"] != buyer["spend_reservation_id"]
        or row["tenant_id"] != payload.get("tenant_id")
        or row["purchase_reference"] != payload.get("resource_id")
        or row["resource_version"] != payload.get("resource_version")
        or row["transaction_digest"] != payload.get("transaction_digest")
        or row["currency_code"] != payload.get("currency")
        or row["hold_revision"] != payload.get("spend_hold_revision")
        or row["amount_minor"] != payload.get("amount_minor")
        or row["status"] != "COMMITTED" for row in ledger
    ):
        _refuse("NATIVE_SPEND_CONVERSION_NOT_ATOMIC")
    return OriginObservation(
        qualified=True, code="NATIVE_ORIGIN_SQL_CONFIRMED",
        native_order_readback=True, enforced_b2b_commit=True,
        exact_commit_transaction=True, spend_commit_same_transaction=True,
        business_origin={
            "event_id": event_id,
            "order_id": order_id,
            "transaction_id": event["insert_xid"],
            "persisted_envelope_digest": event["envelope_digest"],
            "traceparent": event["envelope"]["traceparent"],
        },
    )


def assess_native_origin(db, event_id: str) -> OriginObservation:
    # Refuse malformed event identities without opening any database statement.
    # This is both a security boundary and the source of the strict negative
    # regression: a bad identifier can never appear as a DB/provider outage.
    if not isinstance(event_id, str) or not _ID.fullmatch(event_id):
        return OriginObservation(False, "EVENT_ID_INVALID")
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


def assess_order_origin(db, order_id: str, idempotency_key: str) -> OriginObservation:
    """Locate the original event from the real checkout response and request."""
    if not _ID.fullmatch(order_id) or not re.fullmatch(r"[A-Za-z0-9._:-]{16,128}", idempotency_key):
        return OriginObservation(False, "CHECKOUT_SELECTOR_INVALID")
    try:
        with db.transaction():
            db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            db.execute("SET LOCAL statement_timeout = '3s'")
            rows = db.execute(
                """SELECT event_id, idempotency_key FROM event_outbox
                   WHERE event_type=%s AND deleted_at IS NULL
                     AND envelope #>> '{data,commerce_order_id}' = %s
                   LIMIT 2""",
                (EVENT_TYPE, order_id),
            ).fetchall()
            if len(rows) != 1 or rows[0]["idempotency_key"] != idempotency_key:
                _refuse("CHECKOUT_ORIGINAL_EVENT_NOT_UNIQUE_OR_BOUND")
            return _read_native_origin(db, rows[0]["event_id"])
    except OriginRefusal as err:
        return OriginObservation(False, err.code)
    except (psycopg.Error, KeyError, ValueError, TypeError, AttributeError):
        return OriginObservation(False, "NATIVE_ORIGIN_READBACK_UNAVAILABLE")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--event-id")
    group.add_argument("--order-id")
    group.add_argument("--expect-synthetic-refusal", action="store_true")
    parser.add_argument("--idempotency-key")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if bool(args.order_id) != bool(args.idempotency_key):
        parser.error("--order-id and --idempotency-key must be used together")
    if (os.getenv("NODE_ENV") != "test"
            or os.getenv("BAOBAB_ENVIRONMENT") not in {"test", "development", "integration"}
            or not os.getenv("DATABASE_URL")):
        raise SystemExit("NATIVE_ORIGIN_VERIFIER_DISPOSABLE_POSTGRES_REQUIRED")
    try:
        with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True,
                             row_factory=dict_row, connect_timeout=5) as db:
            if args.order_id:
                observed = assess_order_origin(db, args.order_id, args.idempotency_key)
            elif args.expect_synthetic_refusal:
                # Bind the complete LIKE pattern: a literal percent in a query
                # with parameters is parsed by psycopg before PostgreSQL sees
                # it. The wildcard is data, not a driver placeholder.
                event_ids = db.execute(
                    """SELECT event_id FROM event_outbox
                       WHERE idempotency_key LIKE %s
                         AND event_type=%s AND deleted_at IS NULL""",
                    ("dev11-rabbit-connected:%", EVENT_TYPE),
                ).fetchall()
                if len(event_ids) != 1:
                    raise SystemExit("NATIVE_ORIGIN_SYNTHETIC_FIXTURE_NOT_UNIQUE")
                observed = assess_native_origin(db, event_ids[0]["event_id"])
            else:
                observed = assess_native_origin(db, args.event_id)
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
            **({"business_origin": observed.business_origin} if observed.qualified else {}),
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
