# Trade-A TA-07: PostgreSQL provenance and commit protection

Date: 21 October 2026. Programme: EA v2.3 EA-R03 (§10.1, Track P0-B.3).
Governing decisions: Accepted Shared ADR-SHARED-039 §§1, 4, 6 and 7, and
ADR-SHARED-041.
Evidence classification (EA v2.3 §3.3): `LOCAL_TESTED`. This is not L4, not
EA Gate D and not protected staging.

## Scope

TA-07 enforces Trade-A at the actual persistence boundary. A native order
commitment is refused unless it consumes exactly one current order-authority
receipt (TA-05). It does not matter how the write arrives: Medusa workflow,
module service, admin route or direct SQL.

**It activates nothing.** `PERSISTENCE_FENCED_CLASSES` stays empty.
Certifying a class needs TA-08's real-runtime acceptance and a runtime check
that the database posture is `ENFORCED`, made in the same change.

## What Medusa 2.21.2 does (observed)

Completing a cart writes the `order`, `order_line_item` and `order_item` rows
in **one transaction**. That transaction carries no cart ID, and it writes the
line items before the order row.

The `order_cart` link and the cart's `completed_at` follow, each in a
**later, separate transaction**. Compensation hard-deletes the order
(`deleteOrders`).

Draft finalisation is a single `UPDATE` of `is_draft_order` from true to
false.

## Fences (Migration20261021090000)

| Write                               | Rule                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order` INSERT, not a draft         | Consumes exactly one live `trade.order.commit` receipt. The receipt's attributed open cart must have the order's sales channel, region, currency, customer and email. Zero candidates are refused in `ENFORCED`. Candidates on two or more carts are refused as ambiguous: Trade never guesses. Older live receipts for the same cart are voided. One append-only `trade_order_commitment` row is written. |
| At COMMIT of that transaction       | A deferred check compares the order's lines (variant, quantity and unit price, as a multiset) and its scope with the authorised cart. Any difference rolls the transaction back, so a receipt cannot authorise different contents.                                                                                                                                                                         |
| `order.is_draft_order` true → false | Consumes a live `trade.draft-order.finalize` receipt attributed to that draft. An attributed draft, or any draft in `ENFORCED`, without one is refused.                                                                                                                                                                                                                                                    |
| `cart.completed_at` NULL → NOT NULL | Requires a commitment for this cart whose order still exists. A compensated (deleted) order no longer counts, so a retry needs a new receipt. Refused in `ENFORCED`, or for any attributed cart.                                                                                                                                                                                                           |
| Receipt consumption                 | Only inside a fence, at trigger depth 2 or more. A direct `UPDATE` cannot consume or void a receipt. This tightens the TA-05 guard.                                                                                                                                                                                                                                                                        |
| Commitment rows                     | Written only by the fence. UPDATE, DELETE and TRUNCATE are refused.                                                                                                                                                                                                                                                                                                                                        |

**Persistence posture.**

- `ENFORCED` applies every rule to every row. It supersedes the P0-04B-03
  never-activated-cart exemption: an unattributed cart cannot complete
  ("absence of a seller binding is grounds for denial").
- `SANDBOX` is recorded only when the migration runs under an explicit local
  profile (development, test or integration). It still fences every record
  that carries Trade-A attribution or a matching receipt. Unattributed
  synthetic fixtures are left to native Medusa, so existing sandbox
  regressions keep working.
- The posture only moves from `SANDBOX` to `ENFORCED`. A session may opt into
  `ENFORCED` (`SET baobab.trade_a_posture = 'ENFORCED'`) but never out of
  it. A missing posture row reads as `ENFORCED`.

`Migration20261014090000` is not rewritten. Its LA-05 fence continues to
govern LA-05 bindings, and the new cart fence adds the Trade-A rule
alongside it.

## Residual risk (stated, not hidden)

**Raw-SQL replay inside the lease.** Medusa gives the order row no cart
identity, so the fence matches a receipt by scope and content. A writer who
can run raw SQL inside the 30-second lease could insert one order exactly
equal to the authorised cart: same seller binding, scope, customer, lines
and prices. They could not change the seller, currency, items or prices.
The receipt is then consumed, and the real cart cannot complete. Fully
binding the transaction's origin needs a correlation that Medusa 2.21.2
does not offer.

**Ambiguity.** Two open carts with identical scope (the same channel,
region, currency, customer and email), both holding live receipts, are
refused as ambiguous. The cost of failing closed is a customer retry.

**Trade-B changes.** Material changes to committed orders (channel,
currency, customer) are Trade-B. They are denied at HTTP in protected
runtimes (TA-06), not here.

## Evidence

**`regression:trade-a-commit-fences`** (CI core-module integration,
disposable PostgreSQL 17). It uses real Thamani carts and the real workflows,
attestation, attribution, receipt and commitment stores. The TA-05 PEP runs
under explicit local enforcement, with synthetic CP and IAM ports only. It
proves:

1. An authorised completion consumes one receipt and commits the order to
   that cart. A replay adds nothing.
2. Two concurrent completions each bind to their own cart.
3. In `ENFORCED`:
   - an order without authority is refused;
   - an unattributed cart cannot complete;
   - a consumed receipt is not reused.
4. An attributed cart cannot complete without a commitment.
5. An order with the cart's scope but different lines is refused at COMMIT,
   and the receipt stays unconsumed.
6. Ambiguous candidates are refused.
7. An expired lease is refused.
8. Draft finalisation consumes its receipt. An attributed draft without
   authority is refused, and so is an unattributed draft in `ENFORCED`.
9. The following are all refused:
   - a direct receipt consumption;
   - a forged commitment;
   - a commitment UPDATE, DELETE or TRUNCATE.
10. The posture cannot be downgraded, deleted or truncated.

**`regression:native-configuration-attestation`** now asserts that a direct
receipt consumption is refused.

All existing sandbox regressions pass unchanged. These cover:

- checkout commit fence;
- store credit;
- simulation pack;
- TA-06 entry points;
- the rest of the core-module integration sequence.

## Migration and rollback

The migration is forward-only. `down()` refuses, so history is never erased.
Containment is to keep `PERSISTENCE_FENCED_CLASSES` empty, which leaves the
protected runtimes denied at TA-06.

A protected database must be migrated under its protected profile, so its
posture is `ENFORCED`. TA-08 adds the runtime check that refuses to certify
against a `SANDBOX` database.

## Remaining Trade-A work

TA-08 supplies the real-runtime acceptance, the posture check and the
certification of `trade.order.commit` and `trade.draft-order.finalize`
([TA-08 record](trade-a-ta08-real-runtime-acceptance.md)).
Real mandates, bindings and IAM, protected staging and Gate E remain
external. Trade-B, Trade-C and Trade-D stay out of scope.
