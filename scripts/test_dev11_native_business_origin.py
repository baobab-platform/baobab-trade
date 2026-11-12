"""DEV-11 native source provenance is distinct from real broker success.

Unit fixtures exercise SQL-shaped joins and refusal semantics, not runtime proof.
The Actions workflow separately
runs the unmodified checker against the genuine migrated PostgreSQL 17 schema
and requires the synthetic Medusa outbox event to be refused there as well.
"""
import unittest
from copy import deepcopy
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
from unittest.mock import MagicMock, patch

from psycopg._queries import PostgresQuery
from psycopg.adapt import Transformer

from dev11_native_business_origin import (
    EVENT_SOURCE, EVENT_TYPE, OriginObservation, OriginRefusal, _normalised_envelope,
    _read_native_origin, assess_native_origin, assess_order_origin, main,
)


class Rows:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


class Source:
    def __init__(self, results):
        self.results = iter(results)

    def execute(self, statement, params=()):
        return Rows(next(self.results))


class ReadOnlyTxn:
    def __init__(self, results):
        self.source = Source(results)

    def transaction(self):
        class Transaction:
            def __enter__(self_inner):
                return self.source
            def __exit__(self_inner, *_):
                return False
        return Transaction()

    def execute(self, *args):
        return self.source.execute(*args)


class NativeOriginRefusalTests(unittest.TestCase):
    def setUp(self):
        self.event_id = "af08523e-45da-4672-9958-fd124cf750f3"
        self.order_id = "order_real_accepted_ref"
        self.envelope = {
            "id": self.event_id,
            "source": EVENT_SOURCE, "type": EVENT_TYPE,
            "baobabscope": "tenant", "tenantid": "tn_synthetic",
            "idempotencykey": "some-immutable-key",
            "correlationid": "11111111-1111-4111-8111-111111111111",
            "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            "data": {
                "commerce_order_id": self.order_id,
                "legal_entity_id": "LE-EXAMPLE",
                "currency": "ZAR",
            },
        }
        self.event = {
            "event_id": self.event_id, "event_type": EVENT_TYPE,
            "tenant_id": "tn_synthetic",
            "idempotency_key": "some-immutable-key",
            "envelope": self.envelope, "insert_xid": "101", "envelope_digest": "a" * 64,
        }

    def test_refuse_noncanonical_envelope(self):
        corruptions = [
            {**self.envelope, "id": "another"},
            {**self.envelope, "source": "other"},
            {**self.envelope, "tenantid": "another"},
            {**self.envelope, "idempotencykey": "altered"},
            {**self.envelope, "traceparent": "unexported-fake"},
            {**self.envelope, "data": {**self.envelope["data"], "commerce_order_id": ""}},
        ]
        for candidate in corruptions:
            with self.subTest(change=candidate), self.assertRaises(OriginRefusal):
                _normalised_envelope(
                    candidate, self.event_id, "tn_synthetic", "some-immutable-key")

    def test_original_synthetic_event_can_never_be_qualified(self):
        # Existing table schema + committed event, but no Medusa native order.
        stub = ReadOnlyTxn([[], [], [], [self.event], []])
        result = assess_native_origin(stub, self.event_id)
        self.assertFalse(result.qualified)
        self.assertEqual(result.code, "NATIVE_ORDER_ABSENT")
        self.assertFalse(result.native_order_readback)

    def test_missing_migration_is_not_a_success(self):
        stub = ReadOnlyTxn([[], [], [("public.trade_order_commitment",)]])
        result = assess_native_origin(stub, self.event_id)
        self.assertEqual(result.code, "NATIVE_SCHEMA_OR_FENCE_NOT_INSTALLED")
        self.assertFalse(result.qualified)

    def test_legacy_shadow_can_never_be_positive_even_with_order_and_receipt(self):
        with self.assertRaisesRegex(OriginRefusal, "NATIVE_B2B_ENFORCEMENT_NOT_QUALIFIED"):
            _read_native_origin(Source([
            [], [self.event],
            [{"id": self.order_id, "currency_code": "zar", "is_draft_order": False}],
            [{
                "receipt_id": "seller-receipt",
                "subject_id": "cart_native", "subject_type": "cart",
                "native_commit_xid": "101", "tenant_id": "tn_synthetic",
                "consumed_at": datetime.now(timezone.utc),
                "outcome": "BUYER_AUTHORITY_ABSENT",
                "enforcement_mode": "SHADOW", "commerce_model": "B2B",
                "decision_xid": "101", "classification_status": "ACTIVE",
                "buyer_account_model": "BUYER_ORGANISATION",
                "buyer_organisation_id": "b2borg_native",
                "buyer_membership_id": "b2bmem_native",
            }],
        ]), self.event_id)

    def test_missing_schema_and_database_fail_closed(self):
        for event in ("", "contains space", "../../sensitive"):
            with self.subTest(event=event):
                self.assertFalse(assess_native_origin(ReadOnlyTxn([]), event).qualified)

    def complete_unit_snapshot(self):
        """SQL-shaped unit input only; no issuer, pricing or database proof."""
        event = deepcopy(self.event)
        event["envelope"]["data"]["lines"] = [{}]
        payload = {
            "receipt_id": "buyer-receipt", "tenant_id": "tn_synthetic",
            "correlation_id": self.envelope["correlationid"],
            "buyer_organisation_id": "b2borg_native", "buyer_membership_id": "b2bmem_native",
            "resource_id": "cart_native", "resource_version": 1,
            "operation": "trade.order.commit", "operation_reference": "operation-unit",
            "spend_reservation_id": "reservation-unit", "seller_legal_entity_id": "LE-EXAMPLE",
            "currency": "ZAR", "amount_minor": 12345, "spend_hold_revision": 1,
            "transaction_digest": "sha256:" + "a" * 64,
        }
        dt = lambda text: datetime.fromisoformat(text.replace("Z", "+00:00"))
        return [
            [], [event],
            [{"id": self.order_id, "currency_code": "zar", "is_draft_order": False, "order_xid": "101"}],
            [{"receipt_id": "seller-receipt", "subject_id": "cart_native", "subject_type": "cart",
              "native_commit_xid": "101", "tenant_id": "tn_synthetic", "consumed_at": dt("2026-11-05T00:00:01Z"),
              "outcome": "ALLOWED", "enforcement_mode": "ENFORCED", "commerce_model": "B2B",
              "decision_xid": "101", "classification_status": "ACTIVE", "buyer_account_model": "BUYER_ORGANISATION",
              "buyer_organisation_id": "b2borg_native", "buyer_membership_id": "b2bmem_native"}],
            [{"receipt_id": "buyer-receipt", "payload": payload, "receipt_xid": "101", "consumption_xid": "101",
              "seller_receipt_id": "seller-receipt", "spend_reservation_id": "reservation-unit",
              "operation_reference": "operation-unit", "evaluated_at": dt("2026-11-05T00:00:00Z"),
              "consumed_at": dt("2026-11-05T00:00:01Z"), "expires_at": dt("2026-11-05T00:00:30Z")}],
            [{"item_xid": "101", "line_xid": "101"}],
            [{"conversion_xid": "101", "reservation_id": "reservation-unit", "amount_minor": 12345,
              "reserved_amount_minor": 12345, "membership_id": "b2bmem_native", "organisation_id": "b2borg_native",
              "status": "COMMITTED", "tenant_id": "tn_synthetic", "purchase_reference": "cart_native",
              "resource_version": 1, "transaction_digest": payload["transaction_digest"],
              "currency_code": "ZAR", "hold_revision": 1}],
        ]

    def test_complete_unit_snapshot_is_only_source_sql_not_current_authority(self):
        observed = _read_native_origin(Source(self.complete_unit_snapshot()), self.event_id)
        self.assertEqual(observed.code, "NATIVE_ORIGIN_SQL_CONFIRMED")
        self.assertTrue(observed.exact_commit_transaction)
        self.assertEqual(observed.business_origin["event_id"], self.event_id)
        self.assertEqual(observed.business_origin["transaction_id"], "101")

    def test_later_native_order_cannot_borrow_an_atomic_seller_event_pair(self):
        rows = self.complete_unit_snapshot()
        rows[2][0]["order_xid"] = "102"
        with self.assertRaisesRegex(OriginRefusal, "NATIVE_OUTBOX_NOT_IN_ORDER_TRANSACTION"):
            _read_native_origin(Source(rows), self.event_id)

    def test_checkout_selector_requires_one_original_event_and_the_same_request_key(self):
        key = self.envelope["idempotencykey"]
        event = {"event_id": self.event_id, "idempotency_key": key}
        source = ReadOnlyTxn([[], [], [event], *self.complete_unit_snapshot()])
        self.assertTrue(assess_order_origin(source, self.order_id, key).qualified)
        for events in ([event, event], [{**event, "idempotency_key": "another-checkout-key"}]):
            with self.subTest(events=events):
                source = ReadOnlyTxn([[], [], events])
                self.assertEqual(assess_order_origin(source, self.order_id, key).code,
                                 "CHECKOUT_ORIGINAL_EVENT_NOT_UNIQUE_OR_BOUND")

    def test_absent_buyer_consumption_never_qualifies_from_seller_and_spend_only(self):
        rows = self.complete_unit_snapshot()
        rows[4] = []
        with self.assertRaisesRegex(OriginRefusal, "NATIVE_BUYER_CONSUMPTION_NOT_UNIQUE"):
            _read_native_origin(Source(rows), self.event_id)

    def test_buyer_receipt_and_consumption_cannot_be_added_later_or_borrowed(self):
        for key, value in (("receipt_xid", "102"), ("consumption_xid", "102"),
                           ("seller_receipt_id", "other-seller"), ("operation_reference", "other-operation"),
                           ("spend_reservation_id", "other-reservation")):
            rows = self.complete_unit_snapshot()
            rows[4][0][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(OriginRefusal, "NATIVE_BUYER_CONSUMPTION_NOT_ATOMIC"):
                _read_native_origin(Source(rows), self.event_id)

    def test_native_children_cannot_be_added_later_or_omitted_from_event(self):
        for key in ("item_xid", "line_xid"):
            rows = self.complete_unit_snapshot()
            rows[5][0][key] = "102"
            with self.subTest(key=key), self.assertRaisesRegex(OriginRefusal, "NATIVE_ORDER_LINES_NOT_IN_COMMIT_TRANSACTION"):
                _read_native_origin(Source(rows), self.event_id)

    def test_ledger_conversion_must_bind_the_consumed_buyer_hold_and_purchase(self):
        for key, value in (("reservation_id", "other"), ("tenant_id", "other"),
                           ("purchase_reference", "other"), ("resource_version", 2),
                           ("transaction_digest", "sha256:" + "b" * 64),
                           ("currency_code", "UGX"), ("hold_revision", 2), ("amount_minor", 12344)):
            rows = self.complete_unit_snapshot()
            rows[6][0][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(OriginRefusal, "NATIVE_SPEND_CONVERSION_NOT_ATOMIC"):
                _read_native_origin(Source(rows), self.event_id)

    def test_synthetic_selector_passes_actual_psycopg_parameter_parser(self):
        # This is an offline driver regression, not a PostgreSQL acceptance
        # claim. Running the real parser catches the former literal '%' bug
        # that a permissive database mock would silently accept.
        db = MagicMock()
        db.__enter__.return_value = db

        def parsed_query(statement, params):
            query = PostgresQuery(Transformer())
            query.convert(statement, params)
            self.assertEqual(params, ("dev11-rabbit-connected:%", EVENT_TYPE))
            return Rows([{"event_id": self.event_id}])

        db.execute.side_effect = parsed_query
        with patch("sys.argv", ["native-origin", "--expect-synthetic-refusal"]), \
                patch.dict("os.environ", {
                    "NODE_ENV": "test", "BAOBAB_ENVIRONMENT": "integration",
                    "DATABASE_URL": "postgresql://unused-offline-regression",
                }), \
                patch("dev11_native_business_origin.psycopg.connect", return_value=db), \
                patch("dev11_native_business_origin.assess_native_origin", return_value=
                      OriginObservation(False, "NATIVE_ORDER_ABSENT")) as assess, \
                redirect_stdout(StringIO()):
            self.assertEqual(main(), 0)
        assess.assert_called_once_with(db, self.event_id)

    def test_synthetic_mode_does_not_accept_schema_outage_or_other_refusal(self):
        db = MagicMock()
        db.__enter__.return_value = db
        db.execute.return_value = Rows([{"event_id": self.event_id}])
        for code in ("NATIVE_SCHEMA_OR_FENCE_NOT_INSTALLED",
                     "NATIVE_ORIGIN_READBACK_UNAVAILABLE",
                     "NATIVE_B2B_ENFORCEMENT_NOT_QUALIFIED"):
            with self.subTest(code=code), \
                    patch("sys.argv", ["native-origin", "--expect-synthetic-refusal"]), \
                    patch.dict("os.environ", {
                        "NODE_ENV": "test", "BAOBAB_ENVIRONMENT": "integration",
                        "DATABASE_URL": "postgresql://unused-offline-regression",
                    }), \
                    patch("dev11_native_business_origin.psycopg.connect", return_value=db), \
                    patch("dev11_native_business_origin.assess_native_origin",
                          return_value=OriginObservation(False, code)), \
                    self.assertRaisesRegex(SystemExit,
                        "NATIVE_ORIGIN_SYNTHETIC_NEGATIVE_NOT_OBSERVED:" + code):
                main()


if __name__ == "__main__":
    unittest.main()
