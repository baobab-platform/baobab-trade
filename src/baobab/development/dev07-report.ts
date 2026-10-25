/** DEV-07 component evidence, never an alternative INT-05 acceptance matrix. */
export const DEV07_COMPONENT_CASES = [
  "independent-buyer-relationships",
  "persisted-principal-reference",
  "other-buyer-relationship-refused",
  "unknown-customer-refused",
  "revoked-membership-refused",
  "role-bound-market-grants",
  "absent-role-refused",
  "missing-canonical-market-fails-closed",
  "ug-native-catalogue",
  "za-native-catalogue",
  "public-clearance-cannot-be-relaxed",
  "current-market-assortment",
  "expired-market-assortment-refused",
  "future-market-assortment-refused",
  "withdrawn-market-assortment-refused",
  "owned-active-fixtures-removed",
] as const

export const DEV07_BLOCKED_CASES = {
  "current-iam-cp-buyer-principal": "CONNECTED_BUYER_AUTHORITY_NOT_QUALIFIED",
  "supplier-organisation-and-erp-onboarding": "CONNECTED_SUPPLIER_PROVIDER_NOT_QUALIFIED",
  "entitled-private-catalogue-and-price": "CANONICAL_BUYER_MARKET_AUTHORITY_NOT_IMPLEMENTED",
  "rfq-and-controlled-approval": "CANONICAL_RFQ_PROVIDER_NOT_IMPLEMENTED",
  "quotation-lifecycle": "CANONICAL_QUOTATION_PROVIDER_NOT_IMPLEMENTED",
  "guarded-native-order-and-replay": "COMPOSED_BUYER_COMMIT_FENCE_NOT_QUALIFIED",
  "erp-native-step": "CONNECTED_ERP_PROVIDER_NOT_QUALIFIED",
  "shipment-and-document-access": "CONNECTED_DOCUMENTARY_PROVIDER_NOT_QUALIFIED",
  "cross-jurisdiction-seller-authority": "CONNECTED_LEGAL_ACTOR_AUTHORITY_NOT_QUALIFIED",
} as const

type Row = { result: "PASS" | "BLOCKED"; reason: string }

export function dev07Report(observed: string[], sourceSha: string) {
  if (
    !/^[a-f0-9]{40}$/.test(sourceSha) ||
    observed.length !== DEV07_COMPONENT_CASES.length ||
    new Set(observed).size !== observed.length ||
    DEV07_COMPONENT_CASES.some((name) => !observed.includes(name))
  )
    throw new Error("DEV07_INCOMPLETE_COMPONENT_EVIDENCE")
  const cases: Record<string, Row> = {}
  for (const name of DEV07_COMPONENT_CASES)
    cases[name] = { result: "PASS", reason: "OBSERVED_NATIVE_COMPONENT" }
  for (const [name, reason] of Object.entries(DEV07_BLOCKED_CASES))
    cases[name] = { result: "BLOCKED", reason }
  return {
    schema: "baobab-trade.dev07-components.v1",
    canonical_scenario: "INT-05",
    evidence_class: "REAL_COMPONENT_SYNTHETIC_DATA",
    scope: "NATIVE_MEDUSA_POSTGRES_COMPONENTS_ONLY",
    source_sha: sourceSha,
    synthetic_principal_reference_only: true,
    current_iam_cp_buyer_qualified: false,
    int05_qualified: false,
    provider_qualified: false,
    protected_acceptance: false,
    production_authorized: false,
    cases,
  }
}
