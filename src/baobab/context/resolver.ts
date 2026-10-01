import type { ControlPlaneClient } from "../control-plane/client"
import {
  isCanonicalEntityId,
  isExternalReferenceResolution,
  type ExternalReferenceResolution,
} from "../contracts/canonical-mapping"
import { assertMarketTransactable, type BaobabMarket } from "../contracts/market"
import type { BaobabTenantContext } from "../contracts/tenant-context"

/**
 * Where Trade's Medusa projections live in the Control Plane's mapping
 * registry: the registered (system_namespace, engine_id) pair for Medusa
 * objects held by baobab-trade (Shared control-plane/v1 external-systems.yaml).
 * Mapping resolution has no capability argument (ADR-SHARED-014 section 3), so
 * a canonical entity is resolved to its one mapping into this system.
 */
export const TRADE_MEDUSA_TARGET = {
  target_system_namespace: "medusa",
  target_engine_id: "baobab-trade",
} as const

export type CommerceContextSelection = {
  marketId: string
  digitalEstateCanonicalId: string
}

export type BaobabCommerceContext = {
  tenant: BaobabTenantContext
  /** The stored Control Plane context every mapping below was resolved in (ADR-SHARED-014). */
  contextId: string
  market: BaobabMarket
  legalSellerCanonicalId: string
  digitalEstateCanonicalId: string
  externalReferences: {
    market: ExternalReferenceResolution
    legalSeller: ExternalReferenceResolution
    digitalEstate: ExternalReferenceResolution
  }
}

const resolveExternalReference = async (
  client: ControlPlaneClient,
  canonicalEntityId: string,
  contextId: string,
  tenantId: string,
  accessToken: string,
  correlationId: string,
): Promise<ExternalReferenceResolution> => {
  const resolution = await client.resolveMapping(
    {
      context_id: contextId,
      canonical_entity_id: canonicalEntityId,
      ...TRADE_MEDUSA_TARGET,
    },
    accessToken,
    correlationId,
  )
  if (resolution.tenant_id !== tenantId) {
    throw new Error("Mapping resolved in a tenant other than the authenticated tenant")
  }
  if (!isExternalReferenceResolution(resolution)) {
    throw new Error(
      `Canonical entity ${canonicalEntityId} resolves to another canonical entity, not a Medusa object`,
    )
  }
  return resolution
}

/**
 * Builds the complete governed context used by later commerce workflows.
 * The selection must come from trusted route/deployment policy, never raw
 * tenant, legal-entity, or market headers supplied by a caller.
 */
export const resolveCommerceContext = async (
  client: ControlPlaneClient,
  selection: CommerceContextSelection,
  accessToken: string,
  correlationId: string,
): Promise<BaobabCommerceContext> => {
  if (!selection.marketId.trim()) {
    throw new Error("A trusted Market selection is required")
  }
  if (!isCanonicalEntityId(selection.digitalEstateCanonicalId)) {
    throw new Error("A valid Digital Estate canonical ID is required")
  }

  const tenant = await client.resolveContext(accessToken, correlationId)
  const market = assertMarketTransactable(
    await client.getMarket(selection.marketId, accessToken, correlationId),
  )

  if (market.owner_tenant_id !== tenant.tenantId) {
    throw new Error("Resolved Market is outside the authenticated tenant boundary")
  }
  if (!market.legal_entity_id || !isCanonicalEntityId(market.legal_entity_id)) {
    throw new Error("Resolved Market has no valid Legal Seller canonical ID")
  }

  // Mapping resolution redeems a context the Control Plane resolved and stored
  // itself; Trade never asserts tenant, market or legal entity to it
  // (ADR-SHARED-014, Canonical Mapping Model section 17.3). The Market's own
  // country picks the tenant's market participation when it has several.
  const stored = await client.resolveStoredContext(accessToken, correlationId, {
    tenantId: tenant.tenantId,
    ...(market.default_country && /^[A-Z]{2}$/.test(market.default_country)
      ? { countryCode: market.default_country }
      : {}),
  })
  if (stored.tenant_id !== tenant.tenantId) {
    throw new Error("Stored context belongs to a tenant other than the authenticated tenant")
  }
  if (stored.market_id !== undefined && stored.market_id !== market.market_id) {
    throw new Error("Selected Market is not the Market of the Control Plane's resolved context")
  }

  const [marketReference, legalSellerReference, digitalEstateReference] = await Promise.all([
    resolveExternalReference(
      client,
      market.market_id,
      stored.context_id,
      tenant.tenantId,
      accessToken,
      correlationId,
    ),
    resolveExternalReference(
      client,
      market.legal_entity_id,
      stored.context_id,
      tenant.tenantId,
      accessToken,
      correlationId,
    ),
    resolveExternalReference(
      client,
      selection.digitalEstateCanonicalId,
      stored.context_id,
      tenant.tenantId,
      accessToken,
      correlationId,
    ),
  ])

  return {
    tenant,
    contextId: stored.context_id,
    market,
    legalSellerCanonicalId: market.legal_entity_id,
    digitalEstateCanonicalId: selection.digitalEstateCanonicalId,
    externalReferences: {
      market: marketReference,
      legalSeller: legalSellerReference,
      digitalEstate: digitalEstateReference,
    },
  }
}
