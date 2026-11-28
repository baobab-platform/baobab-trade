# DEV-07 purchase approval assurance

The initial IAM-N06 `HIGH_VALUE_APPROVAL` candidate is
`trade.purchase-approval.decide`, scoped to an existing pending Trade
PurchaseApproval. Trade #189 models `PENDING`, `APPROVED`, `REJECTED` and
`CANCELLED` and evaluates independent approver roles, Market and referenced
Sites, current spend authority, exact transaction facts and current policy.
The ZuriBeans `/api/buyer/commit` and Trade `/store/b2b/buyer-commit` paths
execute the separate order-commit operation. The audited candidate contains
no PurchaseApproval decision handler.

The approval row's PostgreSQL-owned `revision` starts at one and advances
on each update. It is separate from the governed cart or quotation version
stored as `resource_version`. Existing rows keep their current binding facts.
Any future transition must compare the expected approval revision and
`PENDING` status under the Trade transaction fence.

Shared #471 proposes the full binding. The decision command still requires a
reviewed admission contract, CP Principal and policy readback, Trade-owned
valuation and threshold, an IAM assurance handoff, and atomic proof redemption
and outcome custody. Keep the ZuriBeans step-up handoff and physical-device
qualification gated on that connected command. DEV-11 evidence must join the
original authority, approval, transaction outcome and replay readback.

Governing sources include ADR-SHARED-042, Trade ADR-0014/0017/0033/0036
and DEV-07/DEV-11. ADR-0019 describes supplier procurement and does not
establish a buyer approval route. CP #510 concerns Go-module archive
packaging. CP remains the policy decision authority, IAM supplies assurance,
and Trade owns the domain transition.
