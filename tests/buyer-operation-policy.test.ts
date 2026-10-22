import { describe, expect, it } from "vitest"
import buyerExecutionContext from "../src/baobab/contracts/shared/contracts/trade/v2/buyer-execution-context.schema.json"
import {
  CANONICAL_OPERATION_PROFILES,
  type BuyerOperation,
} from "../src/baobab/auth/buyer-assurance"
import {
  BUYER_OPERATION_POLICY_REVISION,
  BUYER_OPERATION_RULES,
  evaluateBuyerOperation,
  type BoundApproval,
  type BuyerOperationFacts,
  type RoleAssignment,
  type ScopeGrant,
} from "../src/baobab/b2b/buyer-operation-policy"
import type { DecisionReason } from "../src/baobab/b2b/buyer-authority"
import { B2B_ROLES, type B2BRole } from "../src/baobab/b2b/types"

/**
 * ADR-SHARED-042 section 14, CAA-05 ruling of 2026-10-22. Synthetic facts
 * only: this proves the evaluator, not connected acceptance.
 */
const NOW = new Date("2026-10-22T12:00:00Z")
const ORG = "b2borg_buyer000001"
const ALICE = "019a0915-a8c0-7000-8000-00000000a011"
const BOB = "019a0915-a8c0-7000-8000-00000000b022"
const DIGEST = `sha256:${"a".repeat(64)}`
const SITE = "b2bsite_dc00000001"

const grant = (key: string, change: Partial<ScopeGrant> = {}): ScopeGrant => ({
  key,
  status: "ACTIVE",
  effectiveFrom: null,
  effectiveUntil: null,
  ...change,
})
const assignment = (role: string, change: Partial<RoleAssignment> = {}): RoleAssignment => ({
  roleId: `b2brole_${role.toLowerCase()}`,
  role,
  markets: [grant("ZA")],
  sites: [grant(SITE)],
  ...change,
})

const facts = (change: Partial<BuyerOperationFacts> = {}): BuyerOperationFacts => ({
  operation: "trade.order.commit",
  now: NOW,
  principalId: ALICE,
  organisationId: ORG,
  membership: { status: "ACTIVE", effectiveFrom: null, effectiveUntil: null },
  roles: [assignment("BUYER")],
  marketKey: "ZA",
  marketAuthority: "ATTESTED",
  sites: [{ siteId: SITE, use: "SHIPPING" }],
  siteRecords: [
    {
      id: SITE,
      organisationId: ORG,
      marketKey: "ZA",
      status: "ACTIVE",
      allowShipping: true,
      allowBilling: false,
    },
  ],
  transaction: {
    amountMinor: 40_000n,
    currencyCode: "ZAR",
    transactionDigest: DIGEST,
    resourceVersion: "cart:v3",
  },
  spendAuthorities: [
    {
      marketKey: "ZA",
      currencyCode: "ZAR",
      orderLimitMinor: 100_000n,
      approvalLimitMinor: 500_000n,
      effectiveFrom: null,
      effectiveUntil: null,
    },
  ],
  approvalPolicies: [
    { marketKey: "ZA", currencyCode: "ZAR", thresholdMinor: 50_000n, enabled: true },
  ],
  purchaseOrder: { rule: null },
  ...change,
})

const approval = (change: Partial<BoundApproval> = {}): BoundApproval => ({
  status: "APPROVED",
  organisationId: ORG,
  initiatorPrincipalId: ALICE,
  approverPrincipalId: BOB,
  marketKey: "ZA",
  amountMinor: 75_000n,
  currencyCode: "ZAR",
  transactionDigest: DIGEST,
  resourceVersion: "cart:v3",
  policyRevision: BUYER_OPERATION_POLICY_REVISION,
  ...change,
})

const decide = (change: Partial<BuyerOperationFacts> = {}) => evaluateBuyerOperation(facts(change))
const denied = (reason: DecisionReason) => ({ outcome: "DENY", reasons: [reason] })
const ALLOW = { outcome: "ALLOW", reasons: [] }

/** The same request expressed for any operation, so the matrix varies only role and operation. */
const forOperation = (operation: BuyerOperation, role: B2BRole): Partial<BuyerOperationFacts> => {
  const base: Partial<BuyerOperationFacts> = { operation, roles: [assignment(role)] }
  if (operation === "trade.purchase-approval.decide") {
    return {
      ...base,
      principalId: BOB,
      approval: approval({ status: "PENDING", approverPrincipalId: null, amountMinor: 40_000n }),
    }
  }
  if (operation === "trade.buyer-context.resolve" || operation === "trade.buyer-member.manage") {
    return { ...base, sites: [] }
  }
  return base
}

describe("the CAA-05 role matrix", () => {
  const permitted: Record<BuyerOperation, readonly B2BRole[]> = {
    "trade.buyer-context.resolve": B2B_ROLES,
    "trade.private-catalogue.view": B2B_ROLES,
    "trade.contract-price.view": B2B_ROLES,
    "trade.rfq.submit": ["BUYER", "SENIOR_BUYER", "PROCUREMENT_MANAGER", "ACCOUNT_ADMIN"],
    "trade.quotation.accept": ["BUYER", "SENIOR_BUYER", "PROCUREMENT_MANAGER", "ACCOUNT_ADMIN"],
    "trade.cart.modify": ["BUYER", "SENIOR_BUYER", "PROCUREMENT_MANAGER", "ACCOUNT_ADMIN"],
    "trade.purchase-approval.decide": ["APPROVER", "PROCUREMENT_MANAGER", "ACCOUNT_ADMIN"],
    "trade.order.commit": ["BUYER", "SENIOR_BUYER", "PROCUREMENT_MANAGER", "ACCOUNT_ADMIN"],
    "trade.draft-order.finalize": ["BUYER", "SENIOR_BUYER", "PROCUREMENT_MANAGER", "ACCOUNT_ADMIN"],
    "trade.buyer-invitation.accept": [],
    "trade.buyer-member.manage": ["ACCOUNT_ADMIN"],
  }

  it("covers exactly the Shared operations, each with the ruled role set", () => {
    expect(Object.keys(BUYER_OPERATION_RULES).sort()).toEqual(
      Object.keys(CANONICAL_OPERATION_PROFILES).sort(),
    )
    for (const [operation, roles] of Object.entries(permitted)) {
      expect([...BUYER_OPERATION_RULES[operation as BuyerOperation].roles].sort()).toEqual(
        [...roles].sort(),
      )
    }
  })

  for (const operation of Object.keys(permitted) as BuyerOperation[]) {
    for (const role of B2B_ROLES) {
      const allowedRole = permitted[operation].includes(role)
      it(`${operation} as ${role}: ${allowedRole ? "role passes" : "ROLE_NOT_PERMITTED"}`, () => {
        const result = decide(forOperation(operation, role))
        if (operation === "trade.buyer-invitation.accept") {
          // The single-use recipient evaluator is not part of this revision.
          expect(result).toEqual(denied("OPERATION_NOT_ACTIVATED"))
        } else if (!allowedRole) {
          expect(result).toEqual(denied("ROLE_NOT_PERMITTED"))
        } else if (operation === "trade.buyer-member.manage") {
          expect(result).toEqual(denied("OPERATION_NOT_ACTIVATED"))
        } else {
          expect(result).toEqual(ALLOW)
        }
      })
    }
  }

  it("never lets VIEWER change or commit anything", () => {
    for (const operation of [
      "trade.rfq.submit",
      "trade.cart.modify",
      "trade.quotation.accept",
      "trade.order.commit",
      "trade.draft-order.finalize",
      "trade.purchase-approval.decide",
      "trade.buyer-member.manage",
    ] as const) {
      expect(decide({ ...forOperation(operation, "VIEWER") })).toEqual(denied("ROLE_NOT_PERMITTED"))
    }
  })

  it("grants nothing for an unknown or misspelled role, and has no implicit hierarchy", () => {
    expect(decide({ roles: [assignment("SUPER_ADMIN")] })).toEqual(denied("ROLE_NOT_PERMITTED"))
    expect(decide({ roles: [assignment("buyer")] })).toEqual(denied("ROLE_NOT_PERMITTED"))
    // SENIOR_BUYER is not an APPROVER.
    expect(decide(forOperation("trade.purchase-approval.decide", "SENIOR_BUYER"))).toEqual(
      denied("ROLE_NOT_PERMITTED"),
    )
  })

  it("refuses an inactive, expired or not-yet-effective membership as BUYER_NOT_AUTHORISED", () => {
    for (const membership of [
      { status: "SUSPENDED", effectiveFrom: null, effectiveUntil: null },
      { status: "INVITED", effectiveFrom: null, effectiveUntil: null },
      { status: "ACTIVE", effectiveFrom: null, effectiveUntil: NOW },
      { status: "ACTIVE", effectiveFrom: new Date(NOW.getTime() + 1), effectiveUntil: null },
    ]) {
      expect(decide({ membership })).toEqual(denied("BUYER_NOT_AUTHORISED"))
    }
  })
})

describe("role-bound Market and Site scope", () => {
  it("requires CP Market authority and never ALLOWs without it", () => {
    expect(decide({ marketAuthority: "UNAVAILABLE" })).toEqual({
      outcome: "UNAVAILABLE",
      reasons: ["SOURCE_UNAVAILABLE"],
    })
    expect(decide({ marketAuthority: "DENIED" })).toEqual(denied("MARKET_NOT_PERMITTED"))
    expect(decide({ marketKey: undefined })).toEqual(denied("CONTEXT_NOT_USABLE"))
  })

  it("treats no grant, an empty grant set or an inactive grant as no access", () => {
    for (const markets of [
      [],
      [grant("KE")],
      [grant("ZA", { status: "REVOKED" })],
      [grant("ZA", { status: "SUSPENDED" })],
      [grant("ZA", { effectiveUntil: NOW })],
      [grant("ZA", { effectiveFrom: new Date(NOW.getTime() + 1) })],
    ]) {
      expect(decide({ roles: [assignment("BUYER", { markets })] })).toEqual(
        denied("MARKET_NOT_PERMITTED"),
      )
    }
    for (const sites of [[], [grant("b2bsite_other0001")], [grant(SITE, { status: "REVOKED" })]]) {
      expect(decide({ roles: [assignment("BUYER", { sites })] })).toEqual(
        denied("SITE_NOT_PERMITTED"),
      )
    }
  })

  it("never composes one role's Market grant with another role's Site grant", () => {
    const split = [assignment("BUYER", { sites: [] }), assignment("SENIOR_BUYER", { markets: [] })]
    expect(decide({ roles: split })).toEqual(denied("SITE_NOT_PERMITTED"))
    // A BUYER in ZA and an APPROVER in KE never buys in KE.
    const mixed = [assignment("BUYER"), assignment("APPROVER", { markets: [grant("KE")] })]
    expect(
      decide({
        roles: mixed,
        marketKey: "KE",
        siteRecords: [
          {
            id: SITE,
            organisationId: ORG,
            marketKey: "KE",
            status: "ACTIVE",
            allowShipping: true,
            allowBilling: false,
          },
        ],
      }),
    ).toEqual(denied("MARKET_NOT_PERMITTED"))
  })

  it("validates every referenced Site and never reveals a foreign one", () => {
    const site = {
      id: SITE,
      organisationId: ORG,
      marketKey: "ZA",
      status: "ACTIVE" as const,
      allowShipping: true,
      allowBilling: false,
    }
    expect(decide({ siteRecords: [{ ...site, organisationId: "b2borg_foreign0001" }] })).toEqual(
      denied("BUYER_NOT_AUTHORISED"),
    )
    expect(decide({ siteRecords: [] })).toEqual(denied("BUYER_NOT_AUTHORISED"))
    expect(decide({ siteRecords: [{ ...site, status: "SUSPENDED" }] })).toEqual(
      denied("SITE_NOT_PERMITTED"),
    )
    expect(decide({ siteRecords: [{ ...site, marketKey: "KE" }] })).toEqual(
      denied("SITE_NOT_PERMITTED"),
    )
    expect(
      decide({
        sites: [
          { siteId: SITE, use: "SHIPPING" },
          { siteId: SITE, use: "BILLING" },
        ],
      }),
    ).toEqual(denied("SITE_NOT_PERMITTED"))
    expect(decide({ siteRecords: "UNAVAILABLE" })).toEqual({
      outcome: "UNAVAILABLE",
      reasons: ["SOURCE_UNAVAILABLE"],
    })
  })

  it("requires a delivery Site for a commitment and refuses Sites where none apply", () => {
    expect(decide({ sites: [] })).toEqual(denied("CONTEXT_NOT_USABLE"))
    expect(decide({ operation: "trade.buyer-context.resolve" })).toEqual(
      denied("CONTEXT_NOT_USABLE"),
    )
  })
})

describe("fail-closed spend authority", () => {
  it("allows a commitment within an explicit limit and below the approval threshold", () => {
    expect(decide()).toEqual(ALLOW)
  })

  it("never treats a missing, null, zero, expired or other-scope limit as unlimited", () => {
    const limit = {
      marketKey: "ZA",
      currencyCode: "ZAR",
      orderLimitMinor: 100_000n,
      approvalLimitMinor: null,
      effectiveFrom: null,
      effectiveUntil: null,
    }
    for (const spendAuthorities of [
      [],
      [{ ...limit, orderLimitMinor: null }],
      [{ ...limit, orderLimitMinor: 0n }],
      [{ ...limit, effectiveUntil: NOW }],
      [{ ...limit, marketKey: "KE" }],
      [{ ...limit, marketKey: null }],
      [{ ...limit, currencyCode: "USD" }],
    ]) {
      expect(decide({ spendAuthorities })).toEqual(denied("SPEND_POLICY_NOT_CONFIGURED"))
    }
    expect(decide({ spendAuthorities: [limit, limit] })).toEqual(denied("CONTEXT_NOT_USABLE"))
    expect(decide({ spendAuthorities: "UNAVAILABLE" })).toEqual({
      outcome: "UNAVAILABLE",
      reasons: ["SOURCE_UNAVAILABLE"],
    })
  })

  it("cannot be bypassed by switching currency", () => {
    const tx = {
      amountMinor: 40_000n,
      currencyCode: "USD",
      transactionDigest: DIGEST,
      resourceVersion: "cart:v3",
    }
    expect(decide({ transaction: tx })).toEqual(denied("SPEND_POLICY_NOT_CONFIGURED"))
  })

  it("denies an over-limit purchase unless an explicit approval policy permits escalation", () => {
    const over = {
      amountMinor: 150_000n,
      currencyCode: "ZAR",
      transactionDigest: DIGEST,
      resourceVersion: "cart:v3",
    }
    expect(decide({ transaction: over, approvalPolicies: [] })).toEqual(
      denied("SPEND_LIMIT_EXCEEDED"),
    )
    expect(
      decide({
        transaction: over,
        approvalPolicies: [
          { marketKey: "ZA", currencyCode: "ZAR", thresholdMinor: 50_000n, enabled: false },
        ],
      }),
    ).toEqual(denied("SPEND_LIMIT_EXCEEDED"))
    expect(
      decide({
        transaction: over,
        approvalPolicies: [
          { marketKey: null, currencyCode: "ZAR", thresholdMinor: 50_000n, enabled: true },
        ],
      }),
    ).toEqual(denied("SPEND_LIMIT_EXCEEDED"))
    expect(decide({ transaction: over })).toEqual({
      outcome: "APPROVAL_REQUIRED",
      reasons: ["SPEND_LIMIT_EXCEEDED", "APPROVAL_THRESHOLD_EXCEEDED"],
    })
  })

  it("does not let ACCOUNT_ADMIN override spend authority", () => {
    expect(decide({ roles: [assignment("ACCOUNT_ADMIN")], spendAuthorities: [] })).toEqual(
      denied("SPEND_POLICY_NOT_CONFIGURED"),
    )
  })

  it("requires a well-formed purchase order where the organisation requires one", () => {
    const rule = { required: true, formatPattern: "PO-[0-9]{4}-[0-9]{4}" }
    expect(decide({ purchaseOrder: { rule } })).toEqual(denied("PURCHASE_ORDER_REQUIRED"))
    expect(decide({ purchaseOrder: { rule, number: "PO-12" } })).toEqual(
      denied("PURCHASE_ORDER_REQUIRED"),
    )
    expect(decide({ purchaseOrder: { rule, number: " PO-2026-0042" } })).toEqual(
      denied("PURCHASE_ORDER_REQUIRED"),
    )
    expect(decide({ purchaseOrder: { rule, number: "PO-2026-0042" } })).toEqual(ALLOW)
    expect(
      decide({ purchaseOrder: { rule: { required: true, formatPattern: "(" }, number: "PO-1" } }),
    ).toEqual(denied("CONTEXT_NOT_USABLE"))
    expect(decide({ purchaseOrder: "UNAVAILABLE" })).toEqual({
      outcome: "UNAVAILABLE",
      reasons: ["SOURCE_UNAVAILABLE"],
    })
  })
})

describe("approval binding and separation of duties", () => {
  const over = {
    amountMinor: 75_000n,
    currencyCode: "ZAR",
    transactionDigest: DIGEST,
    resourceVersion: "cart:v3",
  }
  const reevaluated = { outcome: "ALLOW" as const, reasons: [] }

  it("releases a commitment only for a bound approval whose approver still holds authority", () => {
    expect(decide({ transaction: over })).toEqual({
      outcome: "APPROVAL_REQUIRED",
      reasons: ["APPROVAL_THRESHOLD_EXCEEDED"],
    })
    expect(decide({ transaction: over, approval: approval({ status: "PENDING" }) })).toEqual({
      outcome: "APPROVAL_REQUIRED",
      reasons: ["APPROVAL_THRESHOLD_EXCEEDED"],
    })
    expect(
      decide({ transaction: over, approval: approval(), approverReevaluation: reevaluated }),
    ).toEqual(ALLOW)
    expect(decide({ transaction: over, approval: approval() })).toEqual({
      outcome: "UNAVAILABLE",
      reasons: ["SOURCE_UNAVAILABLE"],
    })
    expect(
      decide({
        transaction: over,
        approval: approval(),
        approverReevaluation: denied("APPROVAL_AUTHORITY_NOT_CONFIGURED") as never,
      }),
    ).toEqual({ outcome: "APPROVAL_REQUIRED", reasons: ["APPROVAL_THRESHOLD_EXCEEDED"] })
  })

  it("invalidates an approval on any material change", () => {
    for (const change of [
      { transactionDigest: `sha256:${"b".repeat(64)}` },
      { resourceVersion: "cart:v4" },
      { amountMinor: 74_999n },
      { currencyCode: "USD" },
      { marketKey: "KE" },
      { policyRevision: "trade.buyer-operation-policy:v0" },
    ]) {
      expect(
        decide({
          transaction: over,
          approval: approval(change),
          approverReevaluation: reevaluated,
        }),
      ).toEqual(denied("TRANSACTION_CHANGED"))
    }
  })

  it("refuses self-approval, another buyer's approval and a legacy unbound approval", () => {
    expect(
      decide({
        transaction: over,
        approval: approval({ approverPrincipalId: ALICE }),
        approverReevaluation: reevaluated,
      }),
    ).toEqual(denied("SEPARATION_OF_DUTIES"))
    expect(
      decide({
        transaction: over,
        principalId: BOB,
        approval: approval({ approverPrincipalId: "019a0915-a8c0-7000-8000-00000000c033" }),
        approverReevaluation: reevaluated,
      }),
    ).toEqual(denied("BUYER_NOT_AUTHORISED"))
    expect(
      decide({
        transaction: over,
        approval: approval({ transactionDigest: null, policyRevision: null }),
        approverReevaluation: reevaluated,
      }),
    ).toEqual(denied("CONTEXT_NOT_USABLE"))
    expect(
      decide({
        transaction: over,
        approval: approval({ organisationId: "b2borg_foreign0001" }),
        approverReevaluation: reevaluated,
      }),
    ).toEqual(denied("BUYER_NOT_AUTHORISED"))
  })

  describe("deciding an approval", () => {
    const pending = approval({ status: "PENDING", approverPrincipalId: null })
    const asApprover = (change: Partial<BuyerOperationFacts> = {}) =>
      decide({
        operation: "trade.purchase-approval.decide",
        principalId: BOB,
        roles: [assignment("APPROVER")],
        transaction: over,
        approval: pending,
        ...change,
      })

    it("needs an explicit approval limit; absent or null is DENY, never APPROVAL_REQUIRED", () => {
      expect(asApprover()).toEqual(ALLOW)
      const limit = {
        marketKey: "ZA",
        currencyCode: "ZAR",
        orderLimitMinor: null,
        approvalLimitMinor: null,
        effectiveFrom: null,
        effectiveUntil: null,
      }
      for (const spendAuthorities of [
        [],
        [limit],
        [{ ...limit, approvalLimitMinor: 0n }],
        [{ ...limit, approvalLimitMinor: 500_000n, effectiveUntil: NOW }],
        [{ ...limit, approvalLimitMinor: 500_000n, currencyCode: "USD" }],
      ]) {
        expect(asApprover({ spendAuthorities })).toEqual(
          denied("APPROVAL_AUTHORITY_NOT_CONFIGURED"),
        )
      }
      expect(asApprover({ spendAuthorities: [{ ...limit, approvalLimitMinor: 70_000n }] })).toEqual(
        denied("APPROVAL_THRESHOLD_EXCEEDED"),
      )
    })

    it("never lets anyone approve their own transaction, whatever roles they hold", () => {
      for (const role of ["APPROVER", "PROCUREMENT_MANAGER", "ACCOUNT_ADMIN"]) {
        expect(asApprover({ principalId: ALICE, roles: [assignment(role)] })).toEqual(
          denied("SEPARATION_OF_DUTIES"),
        )
      }
      expect(
        asApprover({ principalId: ALICE, roles: [assignment("BUYER"), assignment("APPROVER")] }),
      ).toEqual(denied("SEPARATION_OF_DUTIES"))
    })

    it("binds the decision to the exact transaction and its scope", () => {
      expect(asApprover({ transaction: { ...over, resourceVersion: "cart:v4" } })).toEqual(
        denied("TRANSACTION_CHANGED"),
      )
      expect(asApprover({ roles: [assignment("APPROVER", { markets: [grant("KE")] })] })).toEqual(
        denied("MARKET_NOT_PERMITTED"),
      )
      expect(
        asApprover({ approval: approval({ status: "REJECTED", approverPrincipalId: null }) }),
      ).toEqual(denied("CONTEXT_NOT_USABLE"))
      // Re-evaluation at commit is only for the approver who decided it.
      expect(asApprover({ approval: approval() })).toEqual(ALLOW)
      expect(
        asApprover({
          approval: approval({ approverPrincipalId: "019a0915-a8c0-7000-8000-00000000c033" }),
        }),
      ).toEqual(denied("CONTEXT_NOT_USABLE"))
    })
  })
})

describe("vocabulary", () => {
  it("uses only the pinned Shared decision reasons", () => {
    const reasons: string[] = buyerExecutionContext.$defs.decisionReason.enum
    const used: DecisionReason[] = [
      "BUYER_NOT_AUTHORISED",
      "ROLE_NOT_PERMITTED",
      "SITE_NOT_PERMITTED",
      "MARKET_NOT_PERMITTED",
      "PURCHASE_ORDER_REQUIRED",
      "SPEND_LIMIT_EXCEEDED",
      "SPEND_POLICY_NOT_CONFIGURED",
      "APPROVAL_THRESHOLD_EXCEEDED",
      "APPROVAL_AUTHORITY_NOT_CONFIGURED",
      "SEPARATION_OF_DUTIES",
      "TRANSACTION_CHANGED",
      "CONTEXT_NOT_USABLE",
      "OPERATION_NOT_ACTIVATED",
      "SOURCE_UNAVAILABLE",
    ]
    for (const reason of used) expect(reasons).toContain(reason)
  })
})
