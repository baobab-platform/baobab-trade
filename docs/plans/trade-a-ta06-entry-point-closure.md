# Trade-A TA-06: Medusa entry-point closure

Date: 21 October 2026. Programme: EA v2.3 EA-R03 (§10.1, Track P0-B.3),
which supersedes v2.2 for sequencing and evidence status only.
Governing decisions: Accepted Shared ADR-SHARED-039 §§1, 2 and 6, and
ADR-SHARED-041 (engineering principle).
Evidence classification (EA v2.3 §3.3): `LOCAL_TESTED`. The CI regression
runs real Medusa and PostgreSQL with synthetic data and no CP, so it is not
`REAL_COMPONENT_SYNTHETIC_DATA` in the EA-INT sense. It is not L4, not EA
Gate D and not protected staging.

## Scope and dependency

TA-06 connects the TA-05 enforcement point to every native Medusa route and
workflow that creates or commits an order. It also denies the Trade-B and
Trade-C order and money surfaces by name.

**It activates nothing.** In a protected runtime (staging, production or an
unknown profile), every Trade-A class is still refused. The reason:
`PERSISTENCE_FENCED_CLASSES` is empty until TA-07 certifies each class's
PostgreSQL commit fence. That certification is a hard activation dependency,
recorded in code, not a runtime flag.

Production stays denied whatever is certified. The local sandbox
(`development`, `test`, `integration`) is unchanged unless
`BAOBAB_TRADE_A_ORDER_AUTHORITY_ENABLED=true`. When it is set, the full PEP
runs and fails closed (503) without a trusted CP/IAM configuration.

## Engineering choices (ADR-SHARED-041)

- **Adopt** Medusa's own extension points: the `completeCartWorkflow`
  `validate` hook, the `createOrderWorkflow` `setPricingContext` hook and
  project middlewares. They run inside the native saga and router, so
  nothing reimplements or forks core flows.
- **Adapt** the existing LA-05 runtime-profile rule
  (`resolveNativeCheckoutEnvironment`) and the Shared problem-details shape,
  rather than adding a second profile or error model.
- **Re-engineer** where Medusa is insufficient. Its admin RBAC is not seller
  authority (ADR-SHARED-039 §6), and two order paths have no governed
  pre-commit hook. Those paths are denied at HTTP, and TA-07 closes them at
  persistence.
- **Rejected alternatives:**
  - _Monkeypatching the Order module service._ It is fragile across Medusa
    upgrades, and the database fence (TA-07) closes direct service calls
    regardless.
  - _Overriding core route files._ It is undocumented precedence and would
    duplicate native handlers.
  - _A flag-gated allow path._ Activation is never a flag.

EA v2.3 notes that an HTTP 403 alone is not sufficient evidence. TA-06
therefore also proves denial at the workflow layer by running the real
workflows directly. Commit-level negatives belong to TA-07.

## Entry-point map (Medusa 2.21.2)

| Entry point                  | Medusa path                                                                    | Class                                | Enforced at                                                |
| ---------------------------- | ------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------- |
| Store cart completion        | `POST /store/carts/:id/complete` → `completeCartWorkflow`                      | `trade.order.commit`                 | HTTP guard (refuses where the hook would), `validate` hook |
| Payment webhook              | `/hooks/payment/:provider` → `processPaymentWorkflow` → `completeCartWorkflow` | `trade.order.commit`                 | `validate` hook                                            |
| Direct workflow run          | `completeCartWorkflow(container).run()`                                        | `trade.order.commit`                 | `validate` hook                                            |
| Admin draft creation         | `POST /admin/draft-orders` → `createOrderWorkflow`                             | none (no governed commit point)      | HTTP guard, `setPricingContext` hook: denied               |
| Direct order creation        | `createOrderWorkflow(container).run()`                                         | `trade.order.create`, never honoured | `setPricingContext` hook: denied                           |
| Draft finalisation           | `POST /admin/draft-orders/:id/convert-to-order` → `convertDraftOrderWorkflow`  | `trade.draft-order.finalize`         | HTTP guard (the PEP: the workflow has no hook)             |
| Draft finalisation, non-HTTP | `convertDraftOrderWorkflow(container).run()`                                   | `trade.draft-order.finalize`         | **TA-07 persistence fence** (no in-repo caller; see below) |

**Why `createOrderWorkflow` is denied, not governed.** Its only pre-commit
hook, `setPricingContext`, runs before `createOrdersStep`. However, it sees
neither the order's sales channel and currency nor its identity. So it cannot
attribute or authorise a commitment, and it denies outside the local sandbox.
`trade.order.create` stays unhonoured until a governed pre-commit point
exists (TA-07 / TA-08).

**Why the guard can refuse a valid decision.** In the protected profile, the
guard and hooks refuse before any CP call. A CP decision without a persistence
fence would only create an unconsumable receipt.

## Denied by name in protected runtimes

The HTTP guard is mounted ahead of every native handler on these prefixes:
`/admin/{orders, draft-orders, order-edits, order-changes, claims, exchanges,
returns, payments, payment-collections, fulfillments, reservations}` and
`/store/{carts, orders, returns, payment-collections}`.

Mutations under them fall into three groups:

- **Trade-A classes.** These are listed above.
- **The explicit allowlist.** This is cart building (line items, shipping
  methods, promotions) and `POST /admin/orders/export`, which is a history
  read.
- **Everything else.** This answers 403 `TRADE_OPERATION_NOT_AUTHORISED` as
  RFC 9457 with `Cache-Control: no-store`, and never reaches Medusa. It covers
  order edits, cancellations, completion, transfers, claims, exchanges,
  returns, fulfilment and shipments, reservations, payment-session
  authorisation, capture, refund and mark-as-paid.

Reads stay available under IAM. Medusa's own authentication runs first, so a
missing credential is still 401. Matching follows Express routing: it is
case-insensitive, and it tolerates trailing or repeated slashes and query
strings. An unknown encoded variant is denied, not passed.

## Evidence

- **`tests/trade-a-entry-points.test.ts` (30 tests).**
  - Runtime profiles.
  - The gate in each profile, with no dependency resolved in protected
    profiles.
  - Denial of `createOrderWorkflow`.
  - Classification of **every** mutating route in the installed
    `@medusajs/medusa` under the protected prefixes. The inventory must
    exceed 100 routes. Only the two Trade-A routes are classified, and only
    the allowlist passes.
  - A real Express server mounted as Medusa mounts global middleware. It
    proves 403 problem documents, `no-store`, no fall-through and no CP call
    in staging and production. It also proves reads and cart building stay
    available, and that the local draft PEP runs (409 for a non-draft).
  - A source inventory proving no in-repo caller of
    `convertDraftOrderWorkflow`, `createOrdersStep` or
    `orderModule.createOrders`.
- **`regression:trade-a-entry-points` (CI core-module integration, disposable
  PostgreSQL 17).** It invokes the real `completeCartWorkflow` and
  `createOrderWorkflow` directly, with no HTTP, under staging, production and
  misconfigured local enforcement. Each attempt denies with the
  ADR-SHARED-039 §6 outcome before any order row exists. The cart stays open.
  The unchanged sandbox then creates a draft and completes the same cart.
- **Unchanged regressions.** The existing regressions still pass:
  - checkout commit fence;
  - store credit;
  - simulation pack;
  - attestation;
  - binding lifecycle.

- **A local run of the real server.** `medusa develop` ran with
  `BAOBAB_ENVIRONMENT=staging` on that database, with a real admin session
  and publishable key. It showed:
  - an unauthenticated admin mutation answers 401;
  - cancel, draft create, convert-to-order, refund, a mixed-case capture
    with a trailing slash, reservation delete, store cart complete, store
    payment sessions and store returns all answer 403
    `application/problem+json` with `no-store`, and the cart stayed open;
  - `GET /admin/orders`, `GET /store/carts/:id` and order export still answer
    200 and 202.

All of this is engine-local synthetic evidence. It is **not EA Gate D and not
L4**.

## Migration and rollback

There is no migration. The P0-04B-03 never-activated-cart exemption in
`Migration20261014090000` is a persistence-layer matter, so TA-07 replaces
it. Removing it here would break the sandbox regressions without closing any
protected path, because protected cart completion is already refused at the
hook.

Rollback is a revert of this change. It reopens protected native routes to
their pre-TA-06 state, so prefer to keep this change and withhold TA-07
instead.

## Remaining Trade-A work

**TA-07** must add:

- the PostgreSQL commit fences that consume a live receipt for cart
  completion (replacing the never-activated exemption), order insertion and
  the `is_draft_order` true→false transition;
- the classes to `PERSISTENCE_FENCED_CLASSES`, in the same change as their
  regression evidence.

**TA-08** must supply the real-runtime acceptance. Trade-B, Trade-C and
Trade-D remain out of scope.
