# Thamani ERP integration

Gate 15 extends the existing durable ERP boundary for Thamani B2C. It does not connect directly to an iDempiere database: Medusa records canonical mappings and replay-safe projection commands for an external adapter to publish.

## Canonical mappings

- Every Thamani retail product maps to `M_Product`.
- Every procurement supplier maps to `C_BPartner`; suppliers remain procurement parties, never storefront sellers.
- The five Thamani-owned inventory locations map to `M_Warehouse` and retain their Digital Estate and Market ownership.
- Pending ERP registrations are explicitly `UNVERIFIED`; the bootstrap does not invent native ERP identifiers.

## Projection contract

The durable queue supports product, supplier, warehouse, order, shipment, payment, and combined return/refund consequences. Each command contains canonical identity, Market, legal seller, source version, correlation ID, and a deterministic idempotency key. A canonical command digest makes exact replay safe and rejects reuse of a key with different content.

The boundary validates the Market/legal-seller pair before persistence. Payloads use minor currency units and reference canonical supplier and warehouse keys. Acknowledgement and reconciliation remain asynchronous because ERP is authoritative for its native identifiers and accounting state.

## Verification

Run `npm run bootstrap:thamani-erp-integration` after the catalogue and inventory bootstraps, then `npm run verify:thamani-erp-integration`. The verifier checks 38 product, 17 supplier, and five warehouse mappings; exercises all seven projection families; proves exact replay; and proves collision rejection.
