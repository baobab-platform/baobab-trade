import type { ExecArgs, IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID } from "../baobab/context/digital-estates"
import { ZURIBEANS_INVENTORY_LOCATIONS } from "../baobab/inventory"
import type B2BModuleService from "../modules/b2b/service"
import type ErpIntegrationModuleService from "../modules/erp-integration/service"
import type InventoryBridgeModuleService from "../modules/inventory-bridge/service"

type MappingInput = {
  digital_estate: string
  mapping_type: "BUSINESS_PARTNER" | "PRODUCT" | "WAREHOUSE"
  canonical_entity_id: string
  medusa_entity_type: string
  medusa_native_id: string
  erp_entity_type: string
  erp_native_id: string
  external_reference: string
  source_authority: "CONTROL_PLANE" | "ERP" | "TRADE_PENDING_REGISTRATION"
  status: "ACTIVE" | "UNVERIFIED"
}

export default async function ({ container }: ExecArgs) {
  const erp = container.resolve<ErpIntegrationModuleService>("erpIntegration")
  const b2b = container.resolve<B2BModuleService>("b2b")
  const inventory = container.resolve<InventoryBridgeModuleService>("inventoryBridge")
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const createMapping = async (input: MappingInput) => {
    const [existing] = await erp.listErpEntityMappings({
      mapping_type: input.mapping_type,
      digital_estate: input.digital_estate,
      canonical_entity_id: input.canonical_entity_id,
    })
    if (!existing) await erp.createErpEntityMappings(input)
  }
  const profiles = await b2b.listProductTradeProfiles({})
  for (const profile of profiles) {
    const [product] = await products.listProducts({ id: profile.product_id })
    if (!product) throw new Error(`Missing Medusa Product ${profile.product_id}`)
    await createMapping({
      digital_estate: ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
      mapping_type: "PRODUCT",
      canonical_entity_id: profile.canonical_product_key,
      medusa_entity_type: "product",
      medusa_native_id: product.id,
      erp_entity_type: "M_Product",
      erp_native_id: `PENDING:${profile.canonical_product_key}`,
      external_reference: `idempiere:M_Product:${profile.canonical_product_key}`,
      source_authority: "TRADE_PENDING_REGISTRATION",
      status: "UNVERIFIED",
    })
  }
  // listLocationMappings has no estate filter of its own — it returns every active location,
  // ZuriBeans' and Thamani's alike, once both have been bootstrapped. Scope to ZuriBeans' own
  // canonical location keys so this never claims a Thamani warehouse as a ZuriBeans ERP mapping
  // (mirrors the same filter bootstrap-thamani-erp-integration.ts already applies).
  const zuriBeansLocationKeys = new Set(ZURIBEANS_INVENTORY_LOCATIONS.map((item) => item.code))
  const warehouses = (await inventory.listLocationMappings({ status: "ACTIVE" })).filter((item) =>
    zuriBeansLocationKeys.has(item.canonical_location_key),
  )
  for (const warehouse of warehouses)
    await createMapping({
      digital_estate: ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
      mapping_type: "WAREHOUSE",
      canonical_entity_id: warehouse.canonical_location_key,
      medusa_entity_type: "stock_location",
      medusa_native_id: warehouse.stock_location_id,
      erp_entity_type: "M_Warehouse",
      erp_native_id: warehouse.erp_warehouse_reference,
      external_reference: `idempiere:M_Warehouse:${warehouse.erp_warehouse_reference}`,
      source_authority: "ERP",
      status: "ACTIVE",
    })
  await createMapping({
    digital_estate: ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
    mapping_type: "BUSINESS_PARTNER",
    canonical_entity_id: "gate12-b2b-organisation",
    medusa_entity_type: "b2b_organisation",
    medusa_native_id: "gate12-b2b-organisation",
    erp_entity_type: "C_BPartner",
    erp_native_id: "PENDING:gate12-b2b-organisation",
    external_reference: "idempiere:C_BPartner:gate12-b2b-organisation",
    source_authority: "TRADE_PENDING_REGISTRATION",
    status: "UNVERIFIED",
  })
  container
    .resolve("logger")
    .info(
      `Bootstrapped Gate 12 ERP mappings: ${profiles.length} Products, ${warehouses.length} Warehouses, 1 Business Partner`,
    )
}
