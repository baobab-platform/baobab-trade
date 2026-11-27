# DEV-07 CAA-06b — final buyer-obligation valuation (source-only)

**Governing:** EA v2.3, EA-DEV DEV-07/09/11, Trade ADR-0014/0017/0033–0036,
accepted Shared #430 ADR-SHARED-042 Decision 5 (spend reservation),
Decision 6 (buyer receipt), Decision 7 (full valuation) and Decision 9
(universal native commitment fence).

**Status (4 November 2026): non-binding deterministic semantic kernel;
IAM/CP, Medusa pricing-adapter and native business commitment NOT ACCEPTED.**

## Invariant

A buyer spending limit and its one reservation must cover the complete final
purchase obligation in _one transaction currency_; it is not merely the
merchandise subtotal or whatever the buyer pays at checkout today.
Merchandise, services, freight, insurance, handling, VAT/tax, import duties
and refundable deposits are charges; only genuine discounts reduce the sum.
Gift cards, wallet/store credit, deposits already collected and account terms
are tenders or settlement mechanics, **never** discounts.

The new pure server-side
`src/baobab/b2b/buyer-commitment-valuation.ts` computes this using safe
integer minor units and BigInt accumulation. It refuses unknown properties,
unknown categories (including tenders), estimates, positive discounts,
negative charges, non-final/governed maximum cases lacking a separately
authorised maximum, duplicate native source identities and numbers that
JavaScript cannot represent exactly.

Its `valuation_digest` follows the **exact accepted Shared Python 3.14
reference**: SHA-256 over a recursively key-sorted JSON object containing
`basis`, `buyer_commitment_amount_minor`, sorted components with
`component_kind,amount_minor,determination,source_reference`, `currency`,
`maximum_commitment_reference:null`, `resource_id`,
`resource_version`, and `transaction_digest`.
The generated valuation ID and timestamp are intentionally not hashed.
`tests/buyer-commitment-valuation.test.ts` asserts the accepted Shared
example digest `sha256:ec293faad4e8175b85ec59a2fffe99035860b132d9f2b8d811619ec27c4cc429`.
Any changed price, tax, service, currency, version or transaction changes it.

## Audit corrections and reference vectors

The initial implementation bounded each intermediate subtotal after adding a
component. That incorrectly made acceptance depend on ordering: a merchandise
charge of `Number.MAX_SAFE_INTEGER`, tax of 1 and discount of -1 have a safe
final obligation, but were refused when the discount came last. All components
are now accumulated in BigInt and only the complete final amount is bounded
before conversion to Number. Each individual input must still be a safe integer;
a truly unsafe final amount remains refused.

The generated valuation is checked against the exact embedded Shared schema.
Resource length follows Unicode character counts, and lone surrogates that
cannot be faithfully encoded by the Python UTF-8 reference are refused. Invalid
clocks and extended-year dates cannot produce an invalid canonical timestamp.

`tests/fixtures/buyer-commitment-valuation-parity.json` contains seven static
vectors generated with the actual Python reference at accepted Shared
`7f547ccdd759208355ef9224d2177929f4bf224e`, including its source-file SHA-256.
They were independently checked by that reference's schema and semantic rules.
Coverage includes all charge kinds, the safe final/large intermediate case,
Unicode character limits, escaping and the maximum safe resource version.
The TypeScript tests check both component orders, exact amounts/digests,
canonical output validity and preservation of input facts. These are contract
conformance vectors, not native prices or buyer authorisations. When updating
them, regenerate the expectations with the exact reviewed Shared reference and
schema; never derive expected digests from the TypeScript implementation under
test or from an unpinned network source.

## Trust and pending native completion

This function only validates **facts handed to it**. It has no way to prove
that a caller read a real, finalised Medusa order; therefore it is **not
connected to an HTTP route, IAM bearer, CP Principal or live checkout**.
There is deliberately no default ALLOW, buyer-receipt issuance or silent
conversion to a committed purchase. Its test fixtures are synthetic.

The remaining authoritative adapter must read _all_ native Medusa pricing,
discount, tax, shipping, service and Incoterm facts under the order's actual
transaction and recompute this digest at commit. Before allowing even one
B2B order it must join a current human IAM and CP Principal, current
market/Site and organisation membership, action-specific buyer role,
approval-with-no-self-approval, current spend policy, exact ACTIVE reservation,
single issued buyer receipt and the distinct seller receipt. Both receipt
consumptions and spend `RESERVE`→`COMMIT` must occur in the same actual
order transaction; the native `trade.order.placed` outbox fact must be
written atomically there as well. Revoked/missing/stale evidence denies.
The existing Trade SQL function still returns `BUYER_AUTHORITY_ABSENT`
under a default `SHADOW` classification gate; changing it to ENFORCED
before the full composed native positive and negatives would break checkout.

A genuine connected run must then prove the _same event_, not a synthetically
re-emitted lookalike, reached RabbitMQ, an independent ERP inbox,
a real iDempiere 13 business effect with current legal-actor and documentary
checks, second-company isolation and independently exported W3C spans.
Trade #188 and ERP #125 remain separate owners for those evidence boundaries.

**Never mark DEV-07, DEV-11, L4-OPS-01, staging or production accepted on this
component's green Vitest or digest parity alone.**
