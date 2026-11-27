import type { IOrderModuleService } from "@medusajs/framework/types"
import { withNativeMedusaOrderTransaction } from "./medusa-native-transaction-owner"
import {
  nativeMedusaCartPriceReadback,
  type NativeCartModule,
  type CurrentPriceIssuerAuthority,
} from "./medusa-final-cart-pricing"
import { buildFinalBuyerCommitmentValuation } from "./buyer-commitment-valuation"
import type { BuyerIdentitySnapshot } from "./buyer-authority"
import type { NativeBuyerPurchase } from "./current-native-buyer-authority"
import type { PgClient } from "../orders/postgres-governed-binding-persistence"

/**
 * CAA-06b native buyer purchase reader.
 *
 * Joins Trade's *persisted* seller binding, buyer's formally submitted
 * reservation and real cart shipping/billing addresses to the B2B Delivery
 * Sites. Reads final native Cart Module pricing with the Order Module's own
 * PostgreSQL transaction, plus a fresh, independent CP issuer decision.
 *
 * There is no cart metadata/Medusa customer identity shortcut, no browser
 * total or Site choice, and no synthetic fee/Market/approval default.
 */
export type NativeBuyerPurchaseSourceOptions = {
  orders: IOrderModuleService
  carts: NativeCartModule
  currencyExponent(db: Pick<PgClient, "query">, currency: string): Promise<number>
  verifyCurrentIssuer: CurrentPriceIssuerAuthority
}

type Row = Record<string, unknown>
const CART = /^cart_[A-Za-z0-9_-]{6,128}$/
const KEY = /^[A-Za-z0-9._:-]{2,200}$/
const COUNTRY = /^[A-Z]{2}$/

function refuse(): never {
  throw new Error("NATIVE_BUYER_PURCHASE_SOURCE_NOT_PROVEN")
}
const equal = (a: unknown, b: unknown) => a === b
function one(rows: Row[]): Row {
  if (rows.length !== 1) return refuse()
  return rows[0]
}
function number(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(n) || n < 1) return refuse()
  return n
}
function value(v: unknown): string {
  if (typeof v !== "string" || !KEY.test(v)) return refuse()
  return v
}
function minor(v: unknown): bigint {
  const raw = typeof v === "string" ? v : String(v)
  if (!/^(0|[1-9][0-9]{0,15})$/.test(raw)) return refuse()
  return BigInt(raw)
}

/** Only an exact match of Medusa's ACTUAL cart address to one currently
 * registered Delivery Site counts as site selection. Ambiguous or missing
 * addresses deny; the buyer cannot nominate an arbitrary site in HTTP.
 * Role/Market/Site grants are then independently checked by CAA-05.
 */
async function site(
  db: Pick<PgClient, "query">,
  cartId: string,
  buyerOrganisationId: string,
  marketKey: string,
  use: "SHIPPING" | "BILLING",
): Promise<{ siteId: string; use: "SHIPPING" | "BILLING" }> {
  const shipping = use === "SHIPPING"
  const field = shipping ? "shipping_address_id" : "billing_address_id"
  const allow = shipping ? "allow_shipping" : "allow_billing"
  const result = await db.query(
    "SELECT s.id FROM cart c " +
      "JOIN cart_address a ON a.id=c." +
      field +
      " AND a.deleted_at IS NULL " +
      "JOIN b2b_delivery_site s ON s.organisation_id=$2 " +
      "AND s.market_key=$3 AND s.status='ACTIVE' AND s.deleted_at IS NULL AND s." +
      allow +
      "=true " +
      "AND s.address_1 IS NOT DISTINCT FROM a.address_1 " +
      "AND s.address_2 IS NOT DISTINCT FROM a.address_2 " +
      "AND s.city IS NOT DISTINCT FROM a.city " +
      "AND s.province IS NOT DISTINCT FROM a.province " +
      "AND s.postal_code IS NOT DISTINCT FROM a.postal_code " +
      "AND lower(s.country_code)=lower(a.country_code) " +
      "WHERE c.id=$1 AND c.deleted_at IS NULL FOR SHARE OF c,a,s",
    [cartId, buyerOrganisationId, marketKey],
  )
  return { siteId: value(one(result.rows).id), use }
}

export function medusaNativeBuyerPurchaseSource(deps: NativeBuyerPurchaseSourceOptions) {
  if (
    !deps?.orders ||
    !deps.carts ||
    typeof deps.currencyExponent !== "function" ||
    typeof deps.verifyCurrentIssuer !== "function"
  )
    return refuse()
  const pricing = nativeMedusaCartPriceReadback(
    deps.carts,
    deps.currencyExponent,
    deps.verifyCurrentIssuer,
  )

  return async (identity: BuyerIdentitySnapshot, cartId: string): Promise<NativeBuyerPurchase> => {
    if (
      !CART.test(cartId) ||
      !identity?.market_id ||
      !identity.tenant_id ||
      !identity.buyer_organisation_id ||
      !identity.buyer_membership_id ||
      !identity.actor_principal_id ||
      !identity.canonical_organisation_id
    )
      return refuse()
    const marketId = identity.market_id
    return withNativeMedusaOrderTransaction(deps.orders, async ({ db, manager }) => {
      // A seller's native binding cannot assert *buyer* permission; require
      // the independent buyer reservation and IAM-resolved Principal below.
      const binding = one(
        (
          await db.query(
            "SELECT b.tenant_id,b.organisation_id AS seller_organisation_id," +
              "b.responsible_legal_entity_id,b.market_code,b.market_key," +
              "b.currency_code,b.sales_channel_id,b.region_id,b.expires_at," +
              "c.currency_code AS cart_currency,c.customer_id AS cart_customer_id " +
              "FROM native_seller_cart_binding b JOIN cart c ON c.id=b.cart_id " +
              "WHERE b.cart_id=$1 AND b.status='ACTIVE' AND b.deleted_at IS NULL " +
              "AND b.expires_at>clock_timestamp() AND c.completed_at IS NULL " +
              "AND c.sales_channel_id=b.sales_channel_id AND c.region_id=b.region_id " +
              "AND c.deleted_at IS NULL FOR UPDATE OF c FOR SHARE OF b",
            [cartId],
          )
        ).rows,
      )
      if (
        !equal(binding.tenant_id, identity.tenant_id) ||
        typeof binding.market_code !== "string" ||
        !COUNTRY.test(binding.market_code) ||
        !KEY.test(String(binding.market_key)) ||
        binding.market_key === "PENDING" ||
        typeof binding.cart_customer_id !== "string" ||
        !binding.cart_customer_id ||
        !equal(String(binding.cart_currency).toUpperCase(), binding.currency_code)
      ) {
        return refuse()
      }
      // One active, exact buyer membership + Principal-owned commitment.
      // No other organisation's reservation is visible to this operation.
      // During live recheck the order owner already holds the reservation
      // lock and has staged its conversion. Read the committed ACTIVE row
      // through MVCC, without blocking on the owning transaction. The owner
      // independently verifies the exact hold under its own lock.
      const reservation = one(
        (
          await db.query(
            "SELECT id,tenant_id,organisation_id,membership_id," +
              "submitted_by_principal_id,purchase_reference,market_key,currency_code," +
              "agreement_reference,transaction_digest,resource_version,amount_minor," +
              "hold_revision,expires_at FROM b2b_spend_reservation " +
              "WHERE purchase_reference=$1 AND tenant_id=$2 AND organisation_id=$3 " +
              "AND membership_id=$4 AND status='ACTIVE' " +
              "AND deleted_at IS NULL AND expires_at>clock_timestamp() " +
              "AND EXISTS (SELECT 1 FROM b2b_buyer_membership m WHERE m.id=$4 " +
              "AND m.organisation_id=$3 AND m.customer_id=$5 AND m.principal_id=$6 " +
              "AND m.revision=$7 AND m.status='ACTIVE' AND m.deleted_at IS NULL " +
              "AND (m.effective_from IS NULL OR m.effective_from<=clock_timestamp()) " +
              "AND (m.effective_until IS NULL OR m.effective_until>clock_timestamp()))",
            [
              cartId,
              identity.tenant_id,
              identity.buyer_organisation_id,
              identity.buyer_membership_id,
              binding.cart_customer_id,
              identity.actor_principal_id,
              identity.membership_revision,
            ],
          )
        ).rows,
      )
      if (
        !equal(reservation.submitted_by_principal_id, identity.actor_principal_id) ||
        !equal(reservation.market_key, binding.market_key) ||
        !equal(reservation.currency_code, binding.currency_code) ||
        !equal(reservation.purchase_reference, cartId)
      )
        return refuse()

      // One native PostgreSQL connection is the ordering authority; run
      // registered-site joins sequentially so the lock order is reproducible.
      const shipping = await site(
        db,
        cartId,
        identity.buyer_organisation_id,
        String(binding.market_key),
        "SHIPPING",
      )
      const billing = await site(
        db,
        cartId,
        identity.buyer_organisation_id,
        String(binding.market_key),
        "BILLING",
      )
      const price = await pricing(
        db,
        "READ_ONLY",
        {
          receipt: {
            resource_id: cartId,
            tenant_id: identity.tenant_id,
            market_id: marketId,
            seller_legal_entity_id: value(binding.responsible_legal_entity_id),
            currency: value(binding.currency_code),
          },
        },
        manager,
      )
      const obligation = buildFinalBuyerCommitmentValuation(price.valuation)
      if (
        obligation.resource_id !== cartId ||
        obligation.currency !== binding.currency_code ||
        obligation.transaction_digest !== reservation.transaction_digest ||
        obligation.resource_version !== number(reservation.resource_version) ||
        minor(reservation.amount_minor) !== BigInt(obligation.buyer_commitment_amount_minor)
      ) {
        return refuse()
      }
      const po = (
        await db.query(
          "SELECT customer_po_number FROM b2b_purchase_order_reference " +
            "WHERE cart_id=$1 AND organisation_id=$2 " +
            "AND submitted_by_membership_id=$3 AND status='DRAFT' AND deleted_at IS NULL FOR SHARE",
          [cartId, identity.buyer_organisation_id, identity.buyer_membership_id],
        )
      ).rows
      if (po.length > 1) return refuse()
      const purchaseOrderNumber = po.length === 1 ? value(po[0].customer_po_number) : undefined
      const agreementReference =
        reservation.agreement_reference == null ? undefined : value(reservation.agreement_reference)
      return {
        native: {
          salesChannelId: value(binding.sales_channel_id),
          regionId: value(binding.region_id),
          currency: value(binding.currency_code),
        },
        operationReference: `cart/${cartId}/buyer-commit/${value(reservation.id)}`,
        marketKey: value(binding.market_key),
        valuation: price.valuation,
        priceLeaseExpiresAt: price.leaseExpiresAt,
        reservationId: value(reservation.id),
        holdRevision: number(reservation.hold_revision),
        sites: [shipping, billing],
        ...(purchaseOrderNumber ? { purchaseOrderNumber } : {}),
        ...(agreementReference ? { agreementReference } : {}),
      }
    })
  }
}
