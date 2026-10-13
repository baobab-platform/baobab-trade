# P0-04B-02 — authenticated binding intake and CP-owned activation

13 October 2026. Follows P0-04B-01 (#146). Trade base `71e62d0`, CP `1a1ec8f`,
IAM `ad7989c`, Shared `a9c5308`. Live audit found no functional CP/IAM PRs and
unrelated dependency PRs in Trade/Shared. Older Trade runtime branches are not
merged wholesale. Shared #300 is merged at `5dcff30de1bc6142ad4b8801bbe3b2b66a0670ae`.
This set implements ADR-BCP-026/027 LA-05 and Trade ADR-0008/0009/0010/0014;
it does not close wider P0-04B or real P0-03 founding/legal/operator acceptance.

## Command boundary

`POST /internal/seller-bindings/{cartId}/{operation}` takes the actual CP-audience
human Bearer token. It forwards that credential only to the configured trusted
HTTPS CP origin, fixed `/internal/trade-binding/v1/{operation}/authorize` path.
No redirect, arbitrary gateway URL, unbounded authority response, locally decoded
JWT, Medusa customer/admin claim or caller-supplied CP receipt is authority.
Responses are bounded to 64 KiB with a three-second request/body deadline.

| Operation | Exact request body                                                                  | Result                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| propose   | `tenantId`, `organisationId`, `responsibleLegalEntityId`, `marketCode`, `expiresAt` | Original PROPOSED snapshot; native cart supplies channel, region and currency                                          |
| approve   | `revision`                                                                          | Independent checker; remains PROPOSED                                                                                  |
| activate  | `revision`                                                                          | Third canonical principal, fresh Trade-owned CP RUNTIME context and current seller fact; ACTIVE with append-only proof |
| revoke    | `revision`, `reason`                                                                | Terminal REVOKED; prior proposal, checker and activation history retained                                              |

Unknown/omitted fields deny. Clients cannot select makers, checkers, timestamps,
activity, capability, context or native coordinates. Approval/activation/revocation
load the original proposal, require its current revision and never replace history.
Proposal validity is capped at fifteen minutes. Activity `B2B_COFFEE_SALE` and
capability `commerce.order.create` are this server's bounded supported operation.
CP evaluates SELLER_OF_RECORD for `cart/{cartId}/complete`, whose seller must equal
the original proposed legal entity. A caller's proposed seller is never itself
proof of a legal mandate.

CP verifies the actual token at CP audience, existing ACTIVE canonical human
issuer/subject mapping, exact DIRECT Organisation HIGH administrative grant and
assurance on every call. Canonical `trade-binding:*` scopes and
`organisation.trade-binding.*` permissions are registered without any client,
profile or workload assignment. No role fallback, delegation or sibling scope.
Trade rechecks human admission after native/context/legal I/O. CP response expiry
is at most five seconds, bounded by token/grant validity. A deterministic SHA-256
covers exact command/scope/revision/original proposal. That admission decision is
retained as local audit provenance; it is not verification of a documentary reference.
Old candidate IAM/evidence gateway classes have been removed.

## Activation and commit protection

Trade's actual registered workload resolves its own CP RUNTIME context for the
original tenant, ORGANISATION kind and exact country. The legal assessment redeems
current workload identity, registry scopes, context owner, purpose/expiry, tenant,
market and mandate. Missing admission, unbounded/expired context, denied/mismatched
seller, changed human, self-approval/operator or changed native cart denies.
Activation grants no Payments/provider readiness and no canonical event publication.

The applied `Migration20261013150000` adds an activation snapshot and append-only
activation table plus CP admission snapshots on decisions. It permits exactly one
approved PROPOSED-to-ACTIVE transition, advances revision and requires exact
activation/decision/local candidate audit proof in the same transaction. Generated
CRUD, rewriting context/seller/expiry, repeated activation and deletion remain
blocked. Legacy ACTIVE records without the new proof cannot pass the native read. Original maker/checker decisions must both retain authenticated CP admission snapshots; old storage-only approvals cannot be promoted by a later operator.
Rollback refuses to discard or reinterpret recorded activation history.

Each mutation takes the per-cart advisory fence, row lock and bounded SQL waits.
Authenticated non-withdrawal commands also take a native cart share lock to keep
region/channel/currency/completion stable through COMMIT. Deferred constraints
recheck native coordinates, binding expiry, exact CP admission lease and activation
context/legal lease using `clock_timestamp()`. An expired authority after application
checks rolls the transition, activation proof, decision and outbox back together.
Revocation still works after the original context, tenant or mandate becomes invalid;
it requires current human withdrawal authority and preserves the activation receipt.

Native checkout uses only the recorded CP context while it remains unexpired and
reassesses current legal actor, documentary veto and independent merchant readiness
as before. Activation is not a renewable or permanently valid context lease. There
is no implicit refresh/reissue of an expired, completed or withdrawn binding.

## Enablement and evidence

Trade requires `BAOBAB_BINDING_INTAKE_ENABLED=true` and a recognised nonproduction
profile. CP requires `TRADE_BINDING_INTAKE_ENABLED=true` likewise. Existing trusted
CP and Trade workload credential settings are used; no credential is created here.
Checkout guard/provider settings are independent. Production and unknown profiles
remain closed. Scope definitions are not deployment assignments or workload activation.

Local checks cover full source tests, lint, typecheck, formatting, exact Shared
conformance and packaged schema verification. Hosted CI's real Medusa/PostgreSQL 17
lifecycle regression adds native carts, authenticated synthetic CP intake, three
independent principals, denied legal fact/completed cart/replay/direct rewrite,
concurrent activation/revocation, retained receipts and expired pre-COMMIT admission
rollback. CP's actual router tests cover current human/grant/assurance/scope/issuer,
revocation on the next request and enablement denial. Synthetic CP ports are explicitly
storage/contract fixtures, never real human/mandate/workload/provider authority.

Next bounded set: protected native checkout acceptance with commit-point revocation/
lease/replay fencing, current qualified merchant readiness and actual workload/human
admission. ERP, Payments, Subscriptions and Trade Docs execution-point enforcement
also remain separate outstanding sets.
