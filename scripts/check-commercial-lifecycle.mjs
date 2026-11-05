// Dependency-free exact-decimal/state regressions. Run with Node 24's TS transform.
import assert from "node:assert/strict"
import { test } from "node:test"
import {
  createRfq,
  issueQuotation,
  transitionQuotation,
  transitionRfq,
  commercialDigest,
  sameCommercialScope,
} from "../src/baobab/b2b/commercial-lifecycle.ts"

const now = new Date("2026-10-29T12:00:00.000Z")
const context = {
  principal_id: "principal-1",
  tenant_id: "tenant-1",
  legal_entity_id: "legal-1",
  digital_estate_id: "estate-1",
  market_id: "market-1",
  buyer_organisation_id: "buyer-1",
}
const input = () => ({
  context: structuredClone(context),
  lines: [
    { client_line_id: "line-1", variant_id: "variant-1", quantity: { value: "3", unit: "KG" } },
  ],
})
const reviewing = () =>
  transitionRfq(
    transitionRfq(createRfq(input(), context, now), "SUBMITTED", 1, now),
    "UNDER_REVIEW",
    2,
    now,
  )
const offer = () => ({
  currency: "ZAR",
  lines: [
    {
      line_id: "line-1",
      variant_id: "variant-1",
      quantity: { value: "3", unit: "KG" },
      unit_price: { amount: "0.1", currency: "ZAR" },
      line_total: { amount: "0.3", currency: "ZAR" },
    },
  ],
  total: { amount: "0.30", currency: "ZAR" },
  valid_until: "2026-10-29T13:00:00Z",
})
test("non-binding RFQ progresses without spend and does not mutate its input", () => {
  const command = input(),
    before = structuredClone(command),
    rfq = createRfq(command, context, now)
  assert.equal(rfq.status, "DRAFT")
  assert.equal(rfq.version, 1)
  assert.deepEqual(command, before)
  assert.equal(reviewing().status, "UNDER_REVIEW")
})
test("all requested context fields bind to independently resolved scope", () => {
  for (const field of Object.keys(context)) {
    const command = input()
    Object.assign(command.context, { [field]: "foreign-1" })
    assert.throws(() => createRfq(command, context, now), /AUTHORITY_DENIED/)
  }
  assert(sameCommercialScope(context, { ...context, principal_id: "another-member" }))
})
test("reject lifecycle/id/version/actor injection", () => {
  for (const extra of [
    { status: "SUBMITTED" },
    { rfq_id: "rfq-injected" },
    { version: 99 },
    { actor: "admin" },
  ])
    assert.throws(() => createRfq({ ...input(), ...extra }, context, now), /INVALID_REQUEST/)
})
test("closed bounded line validation rejects duplicates, zero, floats and unknown fields", () => {
  const command = input()
  assert.throws(() => createRfq({ ...command, lines: [] }, context, now))
  assert.throws(() =>
    createRfq({ ...command, lines: Array(101).fill(command.lines[0]) }, context, now),
  )
  assert.throws(() =>
    createRfq({ ...command, lines: [command.lines[0], command.lines[0]] }, context, now),
  )
  for (const value of [
    0,
    1.25,
    "0",
    "0.000",
    "-1",
    "NaN",
    "1e3",
    "01",
    "1.",
    "0." + "1".repeat(64),
  ])
    assert.throws(() =>
      createRfq(
        { ...command, lines: [{ ...command.lines[0], quantity: { value, unit: "KG" } }] },
        context,
        now,
      ),
    )
  assert.throws(() =>
    createRfq({ ...command, lines: [{ ...command.lines[0], private_price: "1" }] }, context, now),
  )
})
test("calendar normalization and invalid Incoterms reject", () => {
  for (const requested_delivery_date of ["2026-02-29", "2026-04-31", "2026-13-01"])
    assert.throws(() => createRfq({ ...input(), requested_delivery_date }, context, now))
  assert.throws(() => createRfq({ ...input(), requested_incoterm: "anything" }, context, now))
})
test("optimistic versions and terminal RFQ states cannot be bypassed", () => {
  const draft = createRfq(input(), context, now)
  assert.throws(() => transitionRfq(draft, "QUOTED", 1, now), /CONFLICT/)
  assert.throws(() => transitionRfq(draft, "SUBMITTED", 2, now), /CONFLICT/)
  assert.throws(() => transitionRfq(draft, "SUBMITTED", 1, new Date(now.getTime() - 1)), /CONFLICT/)
  const withdrawn = transitionRfq(draft, "WITHDRAWN", 1, now)
  assert.throws(() => transitionRfq(withdrawn, "SUBMITTED", 2, now), /CONFLICT/)
})
test("quotation arithmetic uses exact decimals beyond IEEE-754 precision", () => {
  assert.equal(issueQuotation(offer(), reviewing(), now).total.amount, "0.30")
  const huge = offer()
  huge.lines[0].unit_price.amount = "9007199254740993.01"
  huge.lines[0].line_total.amount = "27021597764222979.03"
  huge.total.amount = "27021597764222979.03"
  assert.equal(issueQuotation(huge, reviewing(), now).total.amount, huge.total.amount)
})
test("currency substitution, rounding and inconsistent totals reject", () => {
  for (const value of ["0.30000000000000004", "0.29"]) {
    const o = offer()
    o.lines[0].line_total.amount = value
    assert.throws(() => issueQuotation(o, reviewing(), now))
  }
  const o = offer()
  o.total.currency = "USD"
  assert.throws(() => issueQuotation(o, reviewing(), now))
  const wrong = offer()
  wrong.total.amount = "0.31"
  assert.throws(() => issueQuotation(wrong, reviewing(), now))
})
test("foreign variants and measurement-unit changes reject", () => {
  for (const field of [{ variant_id: "foreign-1" }, { quantity: { value: "3", unit: "TON" } }]) {
    const o = offer()
    Object.assign(o.lines[0], field)
    assert.throws(() => issueQuotation(o, reviewing(), now))
  }
})
test("validity is current, bounded to a real calendar instant", () => {
  for (const valid_until of [now.toISOString(), "2026-02-30T13:00:00Z", "invalid"])
    assert.throws(() => issueQuotation({ ...offer(), valid_until }, reviewing(), now))
})
test("expired quote cannot be accepted, rejected or withdrawn as a live offer", () => {
  const quote = issueQuotation(offer(), reviewing(), now),
    expired = new Date("2026-10-29T13:00:00Z")
  assert.throws(() => transitionQuotation(quote, "REJECTED", 1, expired), /CONFLICT/)
  assert.throws(() => transitionQuotation(quote, "EXPIRED", 1, now), /CONFLICT/)
  assert.equal(transitionQuotation(quote, "EXPIRED", 1, expired).status, "EXPIRED")
})
test("acceptance/conversion never bypass the native commitment qualification", () => {
  const quote = issueQuotation(offer(), reviewing(), now)
  for (const status of ["ACCEPTED", "CONVERTED"])
    assert.throws(() => transitionQuotation(quote, status, 1, now), /COMMITMENT_NOT_QUALIFIED/)
})
test("idempotency digests are key-order independent and bind quantities/versions", () => {
  assert.equal(commercialDigest({ a: 1, b: "0.30" }), commercialDigest({ b: "0.30", a: 1 }))
  assert.notEqual(commercialDigest({ a: 1 }), commercialDigest({ a: 2 }))
  assert.notEqual(commercialDigest({ a: "0.30" }), commercialDigest({ a: "0.3" }))
  assert.throws(() => commercialDigest({ a: NaN }))
})
