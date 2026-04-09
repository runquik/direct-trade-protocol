/**
 * TypeScript interfaces for DTP contract types.
 * These mirror the Rust types in contracts/src/types.rs
 * but use JavaScript-native representations.
 */

// All amounts on-chain are in microdollars (1 USDC = 1_000_000)
// All quantities are in milliamounts (1 lb = 1000 milliamount)
// All timestamps are Unix milliseconds

export type BusinessType = "Producer" | "Distributor" | "Retailer" | "Cooperative" | "Agent";
export type ProductType = "Commodity" | "Branded" | "ValueAdded";
export type DeliveryMethod = "Delivered" | "FobOrigin" | "ThirdPartyLogistics";
export type PricingModel = "Flat" | "Tiered" | "Negotiable";
export type OfferTargetType = "Intent" | "Listing";
export type IntentStatus = "Draft" | "Posted" | "Matched" | "Contracted" | "Fulfilled" | "Settled" | "Expired" | "Cancelled";
export type ListingStatus = "Draft" | "Active" | "Matched" | "Contracted" | "Expired" | "Withdrawn";
export type OfferStatus = "Submitted" | "Shortlisted" | "Accepted" | "Rejected" | "Expired" | "Retracted";
export type ContractStatus = "Active" | "InFulfillment" | "Delivered" | "Settled" | "Disputed" | "ResolvedBuyer" | "ResolvedSeller" | "Cancelled";
export type FulfillmentStatus = "SellerAttested" | "BuyerAttested" | "Complete" | "Disputed";
export type RelationshipTier = "New" | "Established" | "Preferred" | "Strategic";

// Contract return types (as received from NEAR RPC view calls)
export interface Quantity {
  milliamount: number;
  unit: string;
}

export interface GoodsSpec {
  category: string;
  product_name: string;
  description: string;
  product_type: ProductType;
  commodity_details: any | null;
  branded_details: any | null;
  value_added_details: any | null;
  quantity: Quantity;
  grade: string;
  quality_specs: string[];
  required_certifications: string[];
  packaging: string;
  shelf_life_days: number | null;
}

export interface DeliverySpec {
  destination_city: string;
  destination_state: string;
  destination_zip: string;
  destination_country: string;
  window_earliest: number;
  window_latest: number;
  method: DeliveryMethod;
  temperature: string | null;
  notes: string | null;
}

export interface PackStructure {
  unit_size: Quantity;
  units_per_case: number;
  cases_per_pallet: number;
  pallets_per_truckload: number | null;
  moq: Quantity;
  moq_label: string;
}

export interface SellerPricing {
  model: PricingModel;
  asking_price_per_unit: string; // u128 as string
  tiers: PriceTier[];
}

export interface BuyerPricing {
  ceiling_price_per_unit: string; // u128 as string
}

export interface PriceTier {
  min_quantity: Quantity;
  max_quantity: Quantity | null;
  price_per_unit: string; // u128 as string
  label: string | null;
}

export interface CertificationRef {
  cert_id: string;
  cert_type: string;
  issuer: string;
  issuer_url: string;
  issued_at: number;
  expires_at: number;
  verification_url: string;
  status: "Active" | "Expired" | "Revoked";
}

export interface ReputationRecord {
  trades_completed: number;
  trades_disputed: number;
  trades_settled_on_time: number;
  average_delivery_accuracy: number;
  score: number;
  last_updated: number;
}

export interface Party {
  party_id: string;
  business_name: string;
  business_type: BusinessType;
  jurisdiction: string;
  kyb: any | null;
  certifications: CertificationRef[];
  reputation: ReputationRecord;
  authorized_agents: string[];
  created_at: number;
  gs1_gln: string | null;
  duns_number: string | null;
  fsma_pcqi_on_file: boolean;
  facility_allergens: string[];
  data_vault_uri: string | null;
}

export interface TradeIntent {
  intent_id: string;
  version: string;
  buyer: string;
  catalog_id: string | null;
  goods: GoodsSpec;
  delivery: DeliverySpec;
  pricing: BuyerPricing;
  finance: any | null;
  freight: any | null;
  expires_at: number;
  status: IntentStatus;
  created_at: number;
  updated_at: number;
}

export interface SupplyListing {
  listing_id: string;
  version: string;
  seller: string;
  lot_id: string | null;
  goods: GoodsSpec;
  pack_structure: PackStructure;
  delivery: DeliverySpec;
  pricing: SellerPricing;
  finance: any | null;
  freight: any | null;
  certifications: CertificationRef[];
  available_from: number;
  expires_at: number;
  status: ListingStatus;
  created_at: number;
}

export interface Offer {
  offer_id: string;
  version: string;
  target_id: string;
  target_type: OfferTargetType;
  offerer: string;
  goods: GoodsSpec;
  delivery: DeliverySpec;
  finance: any | null;
  freight: any | null;
  price_per_unit: string;
  total_price: string;
  certifications: CertificationRef[];
  expires_at: number;
  status: OfferStatus;
  created_at: number;
}

export interface TradeContract {
  contract_id: string;
  version: string;
  intent_id: string | null;
  listing_id: string | null;
  offer_id: string;
  buyer: string;
  seller: string;
  lot_id: string | null;
  goods: GoodsSpec;
  delivery: DeliverySpec;
  finance: any | null;
  freight: any | null;
  price_per_unit: string;
  total_value: string;
  escrow_ref: string;
  dispute_window_hours: number;
  arbitrator: string | null;
  standing_agreement_id: string | null;
  status: ContractStatus;
  created_at: number;
  updated_at: number;
}

export interface Fulfillment {
  fulfillment_id: string;
  contract_id: string;
  delivered_at: number;
  quantity_delivered: Quantity;
  seller_attestation: { party_id: string; signed_at: number; notes: string | null };
  buyer_attestation: { party_id: string; signed_at: number; notes: string | null } | null;
  status: FulfillmentStatus;
}

export interface Settlement {
  settlement_id: string;
  contract_id: string;
  fulfillment_id: string;
  gross_amount: string;
  deductions: { reason: string; amount: string }[];
  net_amount: string;
  escrow_release_tx: string;
  settled_at: number;
}

export interface MatchResult {
  eligible: boolean;
  score: number;
  reasons: string[];
}

export interface RankedMatch {
  intent_id: string;
  listing_id: string;
  score: number;
  reasons: string[];
}

export interface AccountSummary {
  party: Party;
  catalog_count: number;
  lots_owned: number;
  active_listings: number;
  active_intents: number;
  open_contracts: number;
  total_trades: number;
  total_volume_microdollars: string;
  protocol_version: string;
  queried_at: number;
}
