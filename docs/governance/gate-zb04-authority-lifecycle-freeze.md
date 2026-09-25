# Gate ZB-04 authority and lifecycle freeze

Status: implementation constraint
Reviewed: 2026-09-20

## Governing decisions

This slice follows the ZuriBeans Go-Live masterplan, Trade ADR-0017 and ADR-0018,
Control Plane ADR-BCP-014 and ADR-BCP-016, and Control Plane ADR-BCP-017.

ADR-BCP-017 governs an organisation applying to become a Baobab platform tenant.
It does not govern a buyer applying to trade with ZuriBeans. A ZuriBeans buyer
remains a counterparty inside the already-authorised ZuriBeans tenant.

## Authority matrix

| Concern | Authority |
| --- | --- |
| Human authentication and canonical principal | IAM / Control Plane identity mapping |
| Tenant, legal entity and verified organisation context | Control Plane |
| Buyer application and commercial relationship | Trade |
| Buyer membership, roles and purchasing authority | Trade |
| Credit decision and accounting consequence | ERP |
| Documents and evidence binaries | approved document/object-storage capability |
| Buyer-facing presentation | ZuriBeans estate |

## ZB-04 lifecycle decision

The current Trade `b2b_organisation` PENDING state is not sufficient as an application
record because it cannot preserve applicant ownership, submission/review history,
information requests or immutable decisions without conflating a prospective relationship
with an approved trading organisation. ZB-04 therefore introduces a separate
`buyer_application` aggregate.

```text
DRAFT -> SUBMITTED -> INFORMATION_REQUIRED | UNDER_REVIEW
UNDER_REVIEW -> APPROVED | REJECTED
DRAFT | SUBMITTED | INFORMATION_REQUIRED -> WITHDRAWN
```

Approval is a coordinated operation. It must not activate purchasing merely by changing
one status column. Required evidence includes an immutable decision, server-authoritative
tenant context, canonical linkage when registered, and creation of the initial membership
without conflating the IAM principal ID with the Medusa customer ID.

## Non-negotiable invariants

- The request body cannot choose `tenant_id`, canonical IDs, credit limits or privileged roles.
- `principal_id`, `customer_id` and `organisation_id` are distinct identifiers.
- An authenticated customer is not automatically an approved buyer.
- A pending or suspended organisation has no catalogue, order or document capability.
- Cross-tenant administration and cross-buyer IDOR fail closed.
- Application, decision, organisation and membership writes are atomic or compensating.
- State-changing requests are idempotent and auditable.
- Canonical events are written through the transactional outbox.
- ZuriBeans consumes Trade APIs; it never persists or infers commercial authority.

## Deferred by this slice

Credit approval, price agreements and accounting projections remain ERP/commercial
integration work. Email delivery remains a provider concern; raw invitation tokens must
not be presented as a production delivery mechanism.
