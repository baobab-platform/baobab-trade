# Supplier onboarding boundary (future note)

`nabhold/thamani` is building a supplier registration, vetting and
cross-border sourcing portal (see `nabhold/shared` ADR-0006 and
`nabhold/thamani` ADR-0002). This note exists to prevent two mix-ups this
repository is well positioned to cause, and changes no code here.

## Not the `b2b` module

`src/modules/b2b` models organisations that buy **from** the platform
(ZuriBeans' wholesale buyers, ADR-0017) — buyer memberships, roles, spend
limits, approval policies, and the buyer's own purchase-order _references_.
Supplier onboarding is the opposite direction: organisations that sell
**to** a Baobab estate. Nothing in `src/modules/b2b` represents a supplier,
a vendor, or a platform-issued purchase order, and this note does not add
anything there. The two concepts should never share a model, a migration,
or a database table.

## Not the same thing as ZuriBeans' own supplier-application workflow

`docs/discovery/zuribeans-b2b-gate-0.md` already documents that the
ZuriBeans estate has its own, separate supplier-application workflow with
its own schema (`nabhold/zuribeans`, ADR-0006 in that repository) — "sourcing
intake, not a Medusa customer model... must remain distinct from buyer
organisations." `nabhold/shared`'s new `@nabhold/supplier-domain` package
generalizes that same proven pattern so a _second_ estate (Thamani) does
not have to duplicate it from scratch; it does not change or consolidate
ZuriBeans' own implementation, and this repository is not where either
estate's supplier data lives.

## What baobab-trade's role actually is, eventually

Per `docs/architecture/engine-boundaries.md` ("ERP Business Partner |
iDempiere | EXTERNAL, not yet integrated") and ADR-0011 §82 ("Procurement
characteristics belong primarily to ERP"), this repository's only future
touchpoint with supplier onboarding is a **commerce assortment decision**:
once a product has been sourced, qualified, and provisioned upstream (ERP
and Control Plane concerns), a separate, deliberate decision creates a
Medusa product/variant here. Supplier vetting, capability declarations, and
certifications are never modeled in this repository — they stay upstream,
exactly as procurement attributes already do per ADR-0011.
