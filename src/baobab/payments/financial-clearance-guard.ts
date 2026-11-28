/**
 * ADR-0027 internal financial shipment/commit clearance gate.
 * ERP remains AR/exposure/posted settlement authority; a PSP status, credit
 * configuration or trade finance reference is not settled cash.
 */
export type FinanceScope = {
  tenantId: string
  sellerLegalEntityId: string
  buyerOrganisationId: string
  transactionReference: string
  currencyCode: string
  amountMinor: string
}
export type FinanceReceipt = FinanceScope & {
  authority: "ERP" | "CREDIT_POLICY" | "PAYMENT_PROVIDER" | "BANK"
  kind: "EXPOSURE" | "CREDIT_RESERVATION" | "ERP_SETTLEMENT" | "PROVIDER_PAYMENT" | "INSTRUMENT"
  status: "CLEARED" | "PENDING" | "PARTIAL" | "DECLINED" | "REVOKED" | "UNKNOWN"
  reference: string
  version: string
  observedAt: string
  expiresAt: string
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const MONEY = /^(?:0|[1-9][0-9]{0,23})$/
export class FinancialClearanceRefusal extends Error {
  constructor(readonly reason: string) { super("ADR-0027 financial clearance denied: " + reason) }
}
const deny = (reason: string): never => { throw new FinancialClearanceRefusal(reason) }
const date = (s: string) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s))
    return deny("invalid finance observation date")
  const n = Date.parse(s)
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 19) !== s.slice(0, 19))
    return deny("invalid finance observation date")
  return n
}
const fields = ["tenantId","sellerLegalEntityId","buyerOrganisationId","transactionReference","currencyCode","amountMinor"] as const

/** Required finance policy comes from an authenticated server-side resolver. */
export function assertFinancialClearance(
  scope: FinanceScope,
  required: readonly FinanceReceipt["kind"][],
  receipts: readonly FinanceReceipt[],
  now: string,
): { evidenceReferences: string[]; status: "CLEARED" } {
  const at = date(now)
  for (const field of fields) {
    const value = scope[field]
    if (typeof value !== "string" || (field === "amountMinor" ? !MONEY.test(value) :
      field === "currencyCode" ? !/^[A-Z]{3}$/.test(value) : !ID.test(value)))
      deny("invalid financial scope: " + field)
  }
  if (scope.amountMinor === "0") deny("zero commitment requires explicit policy")
  if (!Array.isArray(required) || required.length === 0 || !Array.isArray(receipts))
    deny("missing governed finance requirements")
  if (new Set(required).size !== required.length) deny("duplicate finance requirement")
  const refs: string[] = []
  for (const kind of required) {
    if (!["EXPOSURE","CREDIT_RESERVATION","ERP_SETTLEMENT","PROVIDER_PAYMENT","INSTRUMENT"].includes(kind))
      deny("unknown finance requirement")
    const matches = receipts.filter((r) => r.kind === kind)
    if (matches.length !== 1) deny("missing or ambiguous finance evidence: " + kind)
    const r = matches[0]
    for (const field of fields) if (r[field] !== scope[field]) deny("foreign finance scope: " + field)
    if (!ID.test(r.reference) || !ID.test(r.version)) deny("missing finance provenance")
    if (date(r.observedAt) > at || at >= date(r.expiresAt) || date(r.observedAt) >= date(r.expiresAt))
      deny("stale or future-dated finance evidence")
    if (r.status !== "CLEARED") deny("financial obligation is not cleared")
    const authority = ({
      EXPOSURE:"ERP", CREDIT_RESERVATION:"CREDIT_POLICY", ERP_SETTLEMENT:"ERP",
      PROVIDER_PAYMENT:"PAYMENT_PROVIDER", INSTRUMENT:"BANK",
    } as const)[kind]
    if (r.authority !== authority) deny("unqualified financial authority for " + kind)
    refs.push(r.reference)
  }
  if (new Set(refs).size !== refs.length) deny("reused finance receipt")
  return { evidenceReferences: refs, status: "CLEARED" }
}
