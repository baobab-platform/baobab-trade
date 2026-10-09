import type {
  OrderCommand,
  OrderOrchestrationPort,
  OrderSnapshot,
} from "../orders/orchestration-port"
import type { WorkloadTokenProvider } from "../control-plane/workload-token"
import type {
  LegalActorAssessmentPort,
  LegalActorDecision,
} from "../control-plane/legal-actor-assessment"

/**
 * LA-05C opt-in Medusa order gate. NO automatic enablement or provider grant.
 * Gate each order placement (including idempotent replays) on freshly obtained
 * CP legal authority AND a separate locally governed seller/provider readiness.
 */
export type GovernedSellerOrderCommand = OrderCommand & {
  /** CP-issued runtime context owned by the Trade workload. */
  legalContextId: string
  /** ISO 3166-1 alpha-2, NOT a storefront market alias. */
  marketCode: string
  /** Operation-specific, never derived from LegalEntity or group ownership. */
  legalActivity: string
  legalCapability: string
}

export type LegalSellerEvidence = {
  mandateId: string
  responsibleLegalEntityId: string
  contextId: string
  marketCode: string
  capability: string
  operationReference: string
}

/** Separate provider/market/merchant readiness gate. Absence MUST deny. */
export interface LegalSellerProviderReadiness {
  assertReadyForSeller(
    command: GovernedSellerOrderCommand,
    evidence: LegalSellerEvidence,
  ): Promise<void>
}

export class GovernedMedusaOrderOrchestrationAdapter implements OrderOrchestrationPort {
  constructor(
    private readonly native: OrderOrchestrationPort,
    private readonly cp: LegalActorAssessmentPort,
    private readonly tokens: WorkloadTokenProvider,
    private readonly readiness: LegalSellerProviderReadiness,
    private readonly now: () => number = Date.now,
  ) {}

  async place(input: OrderCommand): Promise<OrderSnapshot> {
    const command = input as GovernedSellerOrderCommand
    if (
      !command.legalContextId ||
      !command.marketCode ||
      !/^[A-Z]{2}$/.test(command.marketCode) ||
      !command.legalActivity ||
      !command.legalCapability ||
      !command.orderReference ||
      !command.correlationId ||
      !command.legalSellerKey ||
      !this.cp ||
      !this.tokens ||
      !this.readiness
    ) {
      throw new Error("Legal seller readiness denied: governed operation context missing")
    }
    const token = await this.tokens.getAccessToken()
    const fact = await this.cp.assess(
      {
        context_id: command.legalContextId,
        role: "SELLER_OF_RECORD",
        activity: command.legalActivity,
        market: command.marketCode,
        capability: command.legalCapability,
        operation_reference: command.orderReference,
      },
      token,
      command.correlationId,
    )
    const evidence = assertFreshSellerFact(fact, command, this.now())
    // CP legal responsibility does not prove market/provider/merchant/legal
    // permissions. A separate, current readiness adapter is compulsory.
    await this.readiness.assertReadyForSeller(command, evidence)
    // The underlying Medusa adapter remains the owner of idempotent order
    // execution. Never bypass the guard on replay, since authority may revoke.
    return this.native.place(command)
  }

  retrieve(id: string): Promise<OrderSnapshot> {
    // Reading historical orders does not confer authority to place new ones.
    return this.native.retrieve(id)
  }
}

export function assertFreshSellerFact(
  fact: LegalActorDecision,
  command: GovernedSellerOrderCommand,
  nowMs: number,
): LegalSellerEvidence {
  const resolution = fact?.legal_actor_resolution
  if (
    !fact ||
    fact.context_id !== command.legalContextId ||
    fact.operation_reference !== command.orderReference ||
    fact.provider_permissions_granted !== false ||
    resolution?.outcome !== "AUTHORIZED" ||
    typeof resolution.responsible_legal_entity_id !== "string" ||
    resolution.responsible_legal_entity_id !== command.legalSellerKey ||
    typeof resolution.mandate_id !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(resolution.mandate_id) ||
    !resolution.evidence_references?.length ||
    !resolution.valid_until
  ) {
    throw new Error("Legal seller authority denied: no matching CP decision")
  }
  const evaluated = Date.parse(resolution.evaluated_at)
  const until = Date.parse(resolution.valid_until)
  // Do not accept forged, future-dated, stale or long-leased CP facts.
  // This does not replace current resolution: the caller MUST invoke CP on
  // every irreversible operation immediately before placement.
  if (
    !Number.isFinite(evaluated) ||
    !Number.isFinite(until) ||
    evaluated > nowMs + 1000 ||
    evaluated < nowMs - 30_000 ||
    until <= nowMs ||
    until > evaluated + 30_000 + 1000
  ) {
    throw new Error("Legal seller authority denied: CP decision is stale")
  }
  return {
    mandateId: resolution.mandate_id,
    responsibleLegalEntityId: resolution.responsible_legal_entity_id,
    contextId: fact.context_id,
    marketCode: command.marketCode,
    capability: command.legalCapability,
    operationReference: command.orderReference,
  }
}
