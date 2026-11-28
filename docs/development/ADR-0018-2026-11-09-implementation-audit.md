# ADR-0018 — Tax architecture implementation audit (2026-11-09)

**Sources:** Accepted ADR-0018 and the **multi-jurisdiction/cross-border enterprise tax Addendum** (not competing decisions); TAX-COM-001–030 and addendum §§88–105, 137–140.

**Defect:** The effective-dated tax provider multiplied two JavaScript Numbers, then used `Math.round`. At large taxable bases this loses exact integer minor-unit precision before rounding. It also accepted malformed rate basis points and absent source provenance. Reconciliation accepted NaN/fractional/unsafe ERP tax facts, producing an invalid delta.

**Implemented:** BigInt-based deterministic half-up minor-unit tax rounding (inclusive or exclusive), safe integer/overflow bounds, request seller registration/currency/jurisdiction and tax-point validation, nonempty rule version/source and valid source retrieval timestamp, invalid-rate refusal even for zero-treatment policies, and numeric reconciliation guards. Tests demonstrate half-up, large base exactness, provider provenance, zero-rated vs exempt identity and invalid ERP evidence.

**Authority boundary:** The tax provider and tax rule projection do not themselves bind a legal seller/registration to a CP-attested operating authority. This PR does not assert that the local tax config authorises multi-country tax. **Do not infer tax treatment from destination country, currency, Market, Incoterm, customs classification or related-party status.** CP/ERP legal registration validity, import VAT/duty, withholding, evidence-gated exports, statutory invoice provenance, provider sandbox and connected ADR §116/addendum §140 qualification remain HELD.

**Status: PARTIAL.** Reconciliation does not rewrite committed Trade tax or replace statutory ERP accounting.


## 27 November 2026 follow-up

- The generic tax determination contract now carries tenant, Principal, transaction reference, opaque CP Market ID/revision, Market key, Legal Seller ID/key, seller-registration reference and a sourced TaxPoint (type, occurrence time, source event and jurisdiction).
- Generic effective-rule selection now requires an exact match on tenant, Market ID/key, Legal Seller ID/key, seller registration, transaction currency, jurisdiction, product tax classification, transaction type and effective period. Digital Estate is deliberately not a generic tax-rule determinant; the legacy Digital Estate selector remains only for the existing Thamani-specific provider path and is not qualified by this PR.
- Customer tax registration evidence now carries verification status, jurisdiction, source, verification time and effective dates. A rule that requires verified customer registration cannot be applied from a customer-supplied identifier alone.
- Removed the unsupported global 100,000-basis-point ceiling. Rates must be exact non-negative safe integers; the selected rule supplies the rate and BigInt arithmetic plus final safe-range checks control precision.
- **Persistence/authority blockers remain:** the existing `tax_determination`, `tax_rule_projection` and `tax_policy_binding` models do not yet persist/resolve the full scoped context above. No connected provider currently demonstrates the new scoped-rule contract, CP seller/registration authority is not verified here, and the returned determination is not yet written as an immutable PostgreSQL snapshot. PostgreSQL 17 migration/integration evidence and ADR-0018 Addendum §140 qualification remain outstanding.
