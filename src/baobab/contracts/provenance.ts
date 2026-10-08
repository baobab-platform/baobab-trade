/**
 * These identifiers describe the canonical sources consumed by this adapter.
 * They are intentionally not presented as canonical definitions themselves.
 * Update them together with contracts.lock.yaml after compatibility review.
 */
export const CONTRACT_PROVENANCE = {
  sharedRepository: "nabhold/shared",
  sharedCommit: "c518b9aa7be1e67c2b9d360c75a97123ee47382f",
  tenancyPath: "contracts/tenancy/tenancy.yaml",
  legalEntityRegistryPath: "contracts/legal-entity/registry.yaml",
  contextResolutionPath: "contracts/control-plane/v1/context-resolution.schema.json",
  marketRegistryPath: "contracts/control-plane/v1/market.schema.json",
  canonicalMappingPath: "contracts/control-plane/v1/canonical-mapping.schema.json",
  problemDetailsPath: "contracts/errors/v1/problem-details.schema.json",
  eventEnvelopePath: "contracts/events/v1/envelope.schema.json",
  tenancyVersion: "1.0",
} as const
