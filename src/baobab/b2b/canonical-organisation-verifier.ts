export const CANONICAL_ORGANISATION_VERIFIER = "canonicalOrganisationVerifier"

export type CanonicalOrganisationVerification = {
  verified: boolean
  canonicalOrganisationId: string
  kind: "BUYER_ORGANISATION"
  verifiedAt: string
}

export interface CanonicalOrganisationVerifier {
  verify(input: {
    tenantId: string
    canonicalOrganisationId: string
    expectedKind: "BUYER_ORGANISATION"
  }): Promise<CanonicalOrganisationVerification>
}
