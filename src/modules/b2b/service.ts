import { MedusaService } from "@medusajs/framework/utils"
import ApprovalPolicy from "./models/approval-policy"
import BuyerApplication from "./models/buyer-application"
import BuyerApplicationDecision from "./models/buyer-application-decision"
import BuyerApplicationEvidence from "./models/buyer-application-evidence"
import BuyerApplicationEvidenceDecision from "./models/buyer-application-evidence-decision"
import BuyerApplicationReviewAction from "./models/buyer-application-review-action"
import B2BOrganisation from "./models/b2b-organisation"
import BuyerMembership from "./models/buyer-membership"
import BuyerInvitationDelivery from "./models/buyer-invitation-delivery"
import BuyerRole from "./models/buyer-role"
import CommercialTerms from "./models/commercial-terms"
import CreditTerms from "./models/credit-terms"
import ContractPrice from "./models/contract-price"
import DeliverySite from "./models/delivery-site"
import PurchaseApproval from "./models/purchase-approval"
import PurchaseOrderReference from "./models/purchase-order-reference"
import PurchaseOrderRequirement from "./models/purchase-order-requirement"
import ProductTradeProfile from "./models/product-trade-profile"
import MarketProductEligibility from "./models/market-product-eligibility"
import PurchaseConstraint from "./models/purchase-constraint"
import SpendLimit from "./models/spend-limit"
import TaxRegistration from "./models/tax-registration"

class B2BModuleService extends MedusaService({
  ApprovalPolicy,
  BuyerApplication,
  BuyerApplicationDecision,
  BuyerApplicationEvidence,
  BuyerApplicationEvidenceDecision,
  BuyerApplicationReviewAction,
  B2BOrganisation,
  BuyerMembership,
  BuyerInvitationDelivery,
  BuyerRole,
  CommercialTerms,
  ContractPrice,
  CreditTerms,
  DeliverySite,
  PurchaseApproval,
  ProductTradeProfile,
  MarketProductEligibility,
  PurchaseConstraint,
  PurchaseOrderReference,
  PurchaseOrderRequirement,
  SpendLimit,
  TaxRegistration,
}) {}

export default B2BModuleService
