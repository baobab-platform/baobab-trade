"""DEV-11 native publisher ownership and payload fences (synthetic unit negatives).

Actual RabbitMQ confirms, PostgreSQL leases, crash and ERP redelivery are in
dev11-rabbit-connected.yml and must NOT be inferred from these unit mocks.
"""
from __future__ import annotations

from dataclasses import replace
import json
import os
import unittest
from unittest.mock import patch

from dev11_rabbit_dispatcher import (
    Claimed, SourceEnvelopeInvalid, claim_next, payload_for, TYPES,
)

EVENT_TYPE = "com.baobab-platform.trade.order.placed.v1"


def test_claim():
    event = {
        "specversion": "1.0",
        "id": "1d032305-669c-45df-b988-01166de4c14c",
        "type": EVENT_TYPE,
        "source": "urn:baobab-platform:service:baobab-trade",
        "subject": "order:order_dev11_fixture",
        "time": "2026-11-02T12:00:00Z",
        "datacontenttype": "application/json",
        "dataschema": "https://contracts.baobab-platform.com/erp/v1/commerce-order-consequence.schema.json",
        "baobabscope": "tenant",
        "tenantid": "tn_dev11synthetic",
        "correlationid": "ea733cd4-0daa-4c52-89f8-a940cfa8a1ac",
        "idempotencykey": "dev11-native-test:1d032305-669c-45df-b988-01166de4c14c",
        "data": {"commerce_order_id": "order_dev11_fixture"},
    }
    return Claimed("evtout_dev11", event["id"], EVENT_TYPE,
                   event, 1, event["tenantid"], event["idempotencykey"])


class NativeTradeRabbitOwnerTests(unittest.TestCase):
    def test_only_order_placed_is_enabled_for_first_vertical(self):
        self.assertEqual(TYPES, frozenset({EVENT_TYPE}))

    def test_native_tenant_and_event_id_must_equal_stored_row(self):
        claim = test_claim()
        self.assertEqual(json.loads(payload_for(claim)), claim.envelope)
        for changed in (
            replace(claim, tenant_id="tn_wrong"),
            replace(claim, idempotency_key="other"),
            replace(claim, event_id="00000000-0000-4000-8000-000000000001"),
            replace(claim, event_type="com.baobab-platform.trade.customer.projected.v1"),
            replace(claim, envelope={**claim.envelope, "source": "urn:untrusted:trade"}),
            replace(claim, envelope={**claim.envelope, "baobabscope": "platform"}),
            replace(claim, envelope={**claim.envelope, "data": None}),
        ):
            with self.subTest(changed=changed.event_type,
                              tenant=changed.tenant_id):
                with self.assertRaises(SourceEnvelopeInvalid):
                    payload_for(changed)

    def test_unowned_expiring_lease_is_denied(self):
        # No DB connection is made: the preflight rejects an unsafe production
        # lease override before it can claim any Trade outbox row.
        with patch.dict(os.environ, {"BAOBAB_DEV11_RABBIT_CONNECTED_REQUIRED": "false"}):
            with self.assertRaisesRegex(ValueError, "TRADE_OUTBOX_LEASE_POLICY_UNAPPROVED"):
                claim_next(None, lease_seconds=3)

    def test_unbounded_lease_is_denied(self):
        with patch.dict(os.environ, {"BAOBAB_DEV11_RABBIT_CONNECTED_REQUIRED": "true"}):
            for seconds in (0, 1, 2, 61, 600):
                with self.subTest(seconds=seconds):
                    with self.assertRaisesRegex(ValueError, "TRADE_OUTBOX_LEASE_POLICY_UNAPPROVED"):
                        claim_next(None, lease_seconds=seconds)


if __name__ == "__main__":
    unittest.main()
