"""DEV-07 same-original-event publisher handoff negatives (no runtime PASS)."""
import unittest
from dev07_genuine_event_dispatch import check_published, HandoffRefusal

origin = {
    "event_id": "d10aa081-a3a7-4c84-9ae5-35e7b2f70cc8",
    "order_id": "order_dev07_native",
    "transaction_id": "15009",
    "persisted_envelope_digest": "f" * 64,
    "traceparent": "00-" + "1" * 32 + "-" + "2" * 16 + "-01",
}
row = {
    "event_id": origin["event_id"],
    "event_type": "com.baobab-platform.trade.order.placed.v1",
    "native_insert_xid": origin["transaction_id"],
    "envelope_digest": origin["persisted_envelope_digest"],
    "envelope": {
        "id": origin["event_id"],
        "data": {"commerce_order_id": origin["order_id"]},
        "traceparent": origin["traceparent"],
    },
    "status": "PUBLISHED", "attempt_count": 1,
}


class GenuineOriginalHandoffTests(unittest.TestCase):
    def test_consistent_publisher_proof_is_not_erp_or_l4_acceptance(self):
        result = check_published(origin, row)
        self.assertTrue(result["trade_native_order_readback"])
        self.assertTrue(result["exact_original_outbox_publisher_confirmed"])
        for field in ("erp_inbox_qualified", "native_erp_business_effect_qualified",
                      "current_iam_cp_authority_independently_qualified",
                      "independent_exported_trace_qualified", "protected_acceptance",
                      "production_authorized"):
            self.assertIs(result[field], False)
        self.assertEqual("BLOCKED", result["l4_ops_01"])

    def test_original_event_id_order_xid_digest_and_trace_are_immutable(self):
        mutations = {
            "event_id": "wrong", "event_type": "trade.new-event", "native_insert_xid": "15010",
            "envelope_digest": "e" * 64, "status": "RETRY", "attempt_count": 9,
        }
        for key, bad in mutations.items():
            with self.subTest(key=key), self.assertRaises(HandoffRefusal):
                check_published(origin, {**row, key: bad})
        for k, bad in [("id", "foreign"), ("traceparent", "00-wrong")]:
            with self.subTest(key=k), self.assertRaises(HandoffRefusal):
                check_published(origin, {**row, "envelope": {**row["envelope"], k: bad}})
        with self.assertRaises(HandoffRefusal):
            check_published(origin, {**row, "envelope":
                {**row["envelope"], "data": {"commerce_order_id": "another"}}})

    def test_status_and_attempts_never_fake_confirm(self):
        for status in ["PENDING", "RETRY", "DEAD", "CLAIMED"]:
            with self.subTest(status=status), self.assertRaises(HandoffRefusal):
                check_published(origin, {**row, "status": status})
        with self.assertRaises(HandoffRefusal):
            check_published(origin, {**row, "attempt_count": 0})


if __name__ == "__main__":
    unittest.main()
