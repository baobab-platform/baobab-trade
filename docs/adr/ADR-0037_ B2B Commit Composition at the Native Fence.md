# ADR-0037: B2B Commit Composition at the Native Fence

Status: Proposed. This is Trade's implementation record for ADR-SHARED-042 §§9, 12 and 14 Decisions 5 and 6, covering the CAA-06b B2B composition step. Where this record and ADR-SHARED-042 differ, ADR-SHARED-042 governs.
Date: 2026-10-23

## Context

Decision 6 lets a native B2B order commit only when all of these hold in the same native transaction:

- one current buyer-authority receipt and one current seller receipt name the same operation reference;
- the buyer receipt is consumed once;
- the buyer's spend reservation converts to committed consumption.

The universal fence (ADR-0036) refused every B2B commitment (`BUYER_AUTHORITY_ABSENT`) until this composition existed.

The spend reservation commit command (CAA-06a) runs in its own transaction, and Medusa's order workflows own theirs. Only the database fence, which runs at COMMIT of the order's own transaction for every path, can make the three facts atomic.

## Decision

`Migration20261023150000` and `PostgresBuyerAuthorityReceiptStore`:

1. **Receipt.** `trade_buyer_authority_receipt` records the server-built `BuyerAuthorityReceipt` (Shared trade/v2), validated against the contract before insert.
   - It is immutable and lives at most 60 seconds.
   - It may only name an ACTIVE reservation that holds exactly its purchase: Tenant, buyer Organisation, membership, currency, transaction digest, resource version, amount and hold revision.
   - There is at most one live receipt per operation reference.
2. **Consumption.** `trade_buyer_authority_consumption` records the receipt's single consumption. Only the fence writes it, and it is unique per receipt, per seller receipt and per reservation.
3. **B2B regime.** For a B2B classification, the fence:
   - looks up the buyer receipt for the seller receipt's exact operation and reference;
   - checks it against the commitment, the classification, the seller receipt, the membership's current revision and the reservation;
   - re-applies the TypeScript commit command's rule that every currently applicable budget holds the full amount at its current period and revision, with no stale hold;
   - in one subtransaction, writes the consumption, posts a COMMIT ledger entry per hold, and marks the reservation COMMITTED. The ledger trigger is the capacity authority.

   Refusals use the contract's `consumptionRefusal` codes (`FOREIGN_RECEIPT`, `RECEIPT_EXPIRED`, `RECEIPT_CONSUMED`, `MEMBERSHIP_REVISED`, `TRANSACTION_MISMATCH`, `RESERVATION_NOT_CURRENT`). With no receipt at all, the verdict stays `BUYER_AUTHORITY_ABSENT`. Verdicts carry the buyer receipt id.

4. **Gate.** The behaviour depends on the gate mode:
   - `SHADOW` (as shipped): a refused composition changes nothing, the order proceeds, and the verdict is recorded.
   - `ENFORCED`: a refusal raises, and everything rolls back together.
   - Either mode: a successful composition is the real conversion.

## Consequences and limits

- **Nothing builds a receipt yet.** No route or workflow writes a buyer receipt. Wiring the buyer operation decision (CAA-05) to `PostgresBuyerAuthorityReceiptStore` before checkout is the next step. Until then every B2B verdict is `BUYER_AUTHORITY_ABSENT`, and in `SHADOW` that refuses nothing.
- **Native-record binding gap.** The fence binds the receipt to the seller receipt, the classification, the membership and the reservation. It does not yet recompute the native order's valuation digest or committed amount; those are bound when the receipt is built from the native record. The contract requires every bound fact to equal the native record at consumption. Closing that at the fence is a known remaining item for the composition wiring and the TA-08 rerun.
- **Activation.** Activation (`ENFORCED`) still needs connected evidence, the approved scope allocation and Platform Owner approval. The canonical registry activation hold stays in place. Existing TA-08 evidence is a historical baseline only.

## Evidence

`regression:trade-a-commit-fences` (8d), on the real `completeCartWorkflow` with a real reservation and ledger:

- **Under `ENFORCED`:**
  - a B2B cart with a current buyer receipt commits: its reservation is COMMITTED, the receipt is consumed once, and the verdict is `ALLOWED`;
  - these are refused and nothing commits:
    - a receipt for another Market (`FOREIGN_RECEIPT`);
    - an expired receipt (`RECEIPT_EXPIRED`);
    - a revised membership (`MEMBERSHIP_REVISED`);
    - a released reservation (`RESERVATION_NOT_CURRENT`);
  - these are refused: a receipt that does not hold its reservation's amount, a consumption written outside the fence, and a rewritten receipt.
- **Under `SHADOW`:** a foreign receipt's order proceeds, the verdict is recorded `FOREIGN_RECEIPT`, and the reservation stays ACTIVE.
