import type { ExecArgs } from "@medusajs/framework/types"
import { THAMANI_DIGITAL_ESTATE_CANONICAL_ID } from "../baobab/context/digital-estates"
import { THAMANI_INVENTORY_LOCATIONS } from "../baobab/thamani/inventory"
import type ErpIntegrationModuleService from "../modules/erp-integration/service"
import type InventoryBridgeModuleService from "../modules/inventory-bridge/service"
import type ThamaniModuleService from "../modules/thamani/service"

type MappingInput = {
  digital_estate: string
  mapping_type: "PRODUCT" | "SUPPLIER" | "WAREHOUSE"
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
  const thamani = container.resolve<ThamaniModuleService>("thamani")
  const inventory = container.resolve<InventoryBridgeModuleService>("inventoryBridge")
  const createMapping = async (input: MappingInput) => {
    const [existing] = await erp.listErpEntityMappings({
      mapping_type: input.mapping_type,
      digital_estate: input.digital_estate,
      canonical_entity_id: input.canonical_entity_id,
    })
    if (!existing) await erp.createErpEntityMappings(input)
  }
  const products = await thamani.listProductRetailProfiles({})
  for (const product of products)
    await createMapping({
      digital_estate: THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
      mapping_type: "PRODUCT",
      canonical_entity_id: product.canonical_product_key,
      medusa_entity_type: "product",
      medusa_native_id: product.product_id,
      erp_entity_type: "M_Product",
      erp_native_id: `PENDING:THAMANI:${product.canonical_product_key}`,
      external_reference: `idempiere:M_Product:thamani:${product.canonical_product_key}`,
      source_authority: "TRADE_PENDING_REGISTRATION",
      status: "UNVERIFIED",
    })
  const suppliers = await thamani.listSuppliers({})
  for (const supplier of suppliers)
    await createMapping({
      digital_estate: THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
      mapping_type: "SUPPLIER",
      canonical_entity_id: supplier.supplier_key,
      medusa_entity_type: "thamani_supplier",
      medusa_native_id: supplier.id,
      erp_entity_type: "C_BPartner",
      erp_native_id: supplier.erp_business_partner_reference ?? `PENDING:${supplier.supplier_key}`,
      external_reference: `idempiere:C_BPartner:thamani:${supplier.supplier_key}`,
      source_authority: supplier.erp_business_partner_reference
        ? "ERP"
        : "TRADE_PENDING_REGISTRATION",
      status: supplier.erp_business_partner_reference ? "ACTIVE" : "UNVERIFIED",
    })
  const locationKeys = new Set(THAMANI_INVENTORY_LOCATIONS.map((item) => item.canonicalKey))
  const warehouses = (await inventory.listLocationMappings({ status: "ACTIVE" })).filter((item) =>
    locationKeys.has(item.canonical_location_key),
  )
  for (const warehouse of warehouses)
    await createMapping({
      digital_estate: THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
      mapping_type: "WAREHOUSE",
      canonical_entity_id: warehouse.canonical_location_key,
      medusa_entity_type: "stock_location",
      medusa_native_id: warehouse.stock_location_id,
      erp_entity_type: "M_Warehouse",
      erp_native_id: warehouse.erp_warehouse_reference,
      external_reference: `idempiere:M_Warehouse:thamani:${warehouse.erp_warehouse_reference}`,
      source_authority: "ERP",
      status: "ACTIVE",
    })
  container
    .resolve("logger")
    .info(
      `Bootstrapped Thamani Gate 15 ERP mappings: ${products.length} products, ${suppliers.length} suppliers, ${warehouses.length} warehouses`,
    )
}
