/**
 * These identifiers describe the canonical sources consumed by this adapter.
 * They are intentionally not presented as canonical definitions themselves.
 * Update them together with contracts.lock.yaml after compatibility review.
 */
import provenance from "./shared/provenance.json"

export const CONTRACT_PROVENANCE = {
  sharedRepository: provenance.repository,
  sharedCommit: provenance.commit,
  tenancyPath: "contracts/tenancy/tenancy.yaml",
  legalEntityRegistryPath: "contracts/legal-entity/registry.yaml",
  contextResolutionPath: "contracts/control-plane/v1/context-resolution.schema.json",
  marketRegistryPath: "contracts/control-plane/v1/market.schema.json",
  canonicalMappingPath: "contracts/control-plane/v1/canonical-mapping.schema.json",
  problemDetailsPath: "contracts/errors/v1/problem-details.schema.json",
  eventEnvelopePath: "contracts/events/v1/envelope.schema.json",
  tenancyVersion: provenance.tenancy_version,
} as const
