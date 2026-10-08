# Thamani B2C Inventory (Gate 10)

Gate 10 gives Thamani its own commerce inventory locations and availability projection while preserving iDempiere as the future enterprise physical-stock and accounting authority. Medusa owns retail reservations and checkout availability; it does not become an inventory ledger.

```mermaid
flowchart TD
  ERP[iDempiere physical stock] --> P[Replay-safe stock projection]
  P --> M[Medusa inventory levels]
  M --> R[Retail reservations]
  R --> ATS[Available to sell]
  P --> REC[Reconciliation record]
```

## Locations and isolation

| Market       | Canonical location | Purpose                   | Gate 4 primary reused |
| ------------ | ------------------ | ------------------------- | --------------------- |
| Uganda       | `TH-UG-KLA-01`     | Kampala retail warehouse  | Yes                   |
| Uganda       | `TH-UG-EBB-01`     | Entebbe import staging    | No                    |
| South Africa | `TH-ZA-CPT-01`     | Cape Town distribution    | Yes                   |
| South Africa | `TH-ZA-JNB-01`     | Johannesburg distribution | No                    |
| South Africa | `TH-ZA-DUR-01`     | Durban import staging     | No                    |

The `TH-` prefix is intentional: Thamani does not silently reuse ZuriBeans commerce locations merely because both estates may eventually map to facilities in the same enterprise network. Each location carries Digital Estate, Market, canonical-location, and ERP-reference breadcrumbs. Engine UUIDs remain implementation identifiers.

Only locations in a product's configured eligible Markets receive inventory levels. This makes the catalogue's Uganda-only and South-Africa-only test products useful isolation canaries. All other launch products receive levels at all five locations.

The bootstrap inspects and repairs Sales Channel and fulfillment-provider links for both new and existing locations. A retry therefore completes a location left behind by an interrupted earlier attempt instead of mistaking mere row existence for successful provisioning.

## Reservations and reconciliation

`MedusaInventoryAvailabilityAdapter` remains the native-in-Medusa implementation of `InventoryAvailabilityPort`. Gate verification creates and releases a real reservation and proves the reserved quantity rises and returns to its baseline. Available-to-sell calculation is covered independently because Medusa's aggregate `available_quantity` decoration is context-dependent. Initial ERP projections use stable idempotency keys and reconciliation records expose variance; they do not conceal it by overwriting either side. Verification accepts a correctly calculated `VARIANCE` (including stock left by an earlier integration scenario) and rejects inconsistent delta/status pairs.

Run `npm run bootstrap:thamani-inventory` after the Thamani Market and catalogue bootstraps. Run `npm run verify:thamani-inventory` for an integration check (it briefly creates and releases one reservation).
