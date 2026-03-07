use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::AccountId;

// ---------------------------------------------------------------------------
// Amounts: all values in microdollars (1 USDC = 1_000_000)
// ---------------------------------------------------------------------------
pub type Amount = u128;

// ---------------------------------------------------------------------------
// Party
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum BusinessType {
    Producer,
    Distributor,
    Retailer,
    Cooperative,
    Agent,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct CertificationRef {
    pub cert_id: String,
    pub cert_type: String,
    pub issuer: String,
    pub issuer_url: String,
    pub issued_at: u64,    // Unix ms
    pub expires_at: u64,   // Unix ms
    pub verification_url: String,
    pub status: CertStatus,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum CertStatus {
    Active,
    Expired,
    Revoked,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct ReputationRecord {
    pub trades_completed: u32,
    pub trades_disputed: u32,
    pub trades_settled_on_time: u32,
    /// 0.0 – 1.0
    pub average_delivery_accuracy: u32, // stored as basis points (10000 = 100%)
    /// 0 – 10000 (basis points)
    pub score: u32,
    pub last_updated: u64,
}

impl ReputationRecord {
    pub fn default() -> Self {
        ReputationRecord {
            trades_completed: 0,
            trades_disputed: 0,
            trades_settled_on_time: 0,
            average_delivery_accuracy: 10000,
            score: 10000,
            last_updated: 0,
        }
    }

    /// Recompute score after a trade outcome.
    pub fn recompute(&mut self) {
        if self.trades_completed == 0 {
            self.score = 10000;
            return;
        }
        let dispute_penalty = (self.trades_disputed as u64 * 10000)
            / self.trades_completed as u64;
        let base = 10000u64.saturating_sub(dispute_penalty);
        self.score = ((base * self.average_delivery_accuracy as u64) / 10000) as u32;
    }
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Party {
    pub party_id: AccountId,
    pub business_name: String,
    pub business_type: BusinessType,
    pub jurisdiction: String,
    pub certifications: Vec<CertificationRef>,
    pub reputation: ReputationRecord,
    pub created_at: u64,
}

// ---------------------------------------------------------------------------
// Goods
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum ProductType {
    Commodity,
    Branded,
    ValueAdded,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Quantity {
    /// Stored as integer * 1000 to handle decimals (e.g. 1.5 lb = 1500)
    pub milliamount: u64,
    pub unit: String,
}

impl Quantity {
    pub fn new(amount_x1000: u64, unit: impl Into<String>) -> Self {
        Quantity { milliamount: amount_x1000, unit: unit.into() }
    }
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct CommodityDetails {
    pub country_of_origin: String,
    pub farming_practices: Vec<String>,
    pub grade: String,
    pub harvest_date: Option<u64>,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct BrandedDetails {
    pub brand_name: String,
    pub sku: String,
    pub gtin: String,
    pub upc: Option<String>,
    pub manufacturer: String,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct ValueAddedDetails {
    pub process_type: String,
    pub base_ingredients: Vec<String>,
    pub processing_facility: Option<String>,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct GoodsSpec {
    pub category: String,
    pub product_name: String,
    pub description: String,
    pub product_type: ProductType,
    pub commodity_details: Option<CommodityDetails>,
    pub branded_details: Option<BrandedDetails>,
    pub value_added_details: Option<ValueAddedDetails>,
    pub quantity: Quantity,
    pub grade: String,
    pub quality_specs: Vec<String>,
    pub required_certifications: Vec<String>,
    pub packaging: String,
    pub shelf_life_days: Option<u32>,
}

// ---------------------------------------------------------------------------
// Pack Structure
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct PackStructure {
    pub unit_size: Quantity,
    pub units_per_case: u32,
    pub cases_per_pallet: u32,
    pub pallets_per_truckload: Option<u32>,
    pub moq: Quantity,
    pub moq_label: String,
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum PricingModel {
    Flat,
    Tiered,
    Negotiable,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct PriceTier {
    pub min_quantity: Quantity,
    pub max_quantity: Option<Quantity>,
    /// Price per unit in microdollars
    pub price_per_unit: Amount,
    pub label: Option<String>,
}

/// Used on SupplyListings (seller side).
/// Floor price is NOT stored here — it lives in private agent context only.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct SellerPricing {
    pub model: PricingModel,
    /// Price at lowest tier / flat price
    pub asking_price_per_unit: Amount,
    pub tiers: Vec<PriceTier>,
}

/// Used on TradeIntents (buyer side).
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct BuyerPricing {
    /// Maximum willing to pay per unit
    pub ceiling_price_per_unit: Amount,
}

// ---------------------------------------------------------------------------
// Finance (v1)
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum PaymentTiming {
    DeliveryAttestation,
    InspectionPeriodEnd,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum FinancingMode {
    /// Buyer pays from escrow at settlement (no external financer)
    EscrowOnly,
    /// Invoice financed by a single DTP LP pool in v1
    LpPool,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct FinanceTerms {
    pub payment_timing: PaymentTiming,
    /// 0 means immediate at settlement event. In v1 this is capped at 60 days.
    pub net_days: u16,
    pub financing_mode: FinancingMode,
    /// Optional in v1; defaults to protocol pool when FinancingMode::LpPool.
    pub liquidity_pool_id: Option<String>,
    /// Optional funding partner account (future-proof for v2 lender selection).
    pub financer_id: Option<AccountId>,
    /// Protocol finance fee in basis points.
    pub finance_fee_bps: u16,
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum DeliveryMethod {
    Delivered,
    FobOrigin,
    ThirdPartyLogistics,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum TemperatureRequirement {
    Ambient,
    Refrigerated,
    Frozen,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct DeliverySpec {
    pub destination_city: String,
    pub destination_state: String,
    pub destination_zip: String,
    pub destination_country: String,
    pub window_earliest: u64, // Unix ms
    pub window_latest: u64,   // Unix ms
    pub method: DeliveryMethod,
    pub temperature: Option<TemperatureRequirement>,
    pub notes: Option<String>,
}

// ---------------------------------------------------------------------------
// TradeIntent
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum IntentStatus {
    Draft,
    Posted,
    Matched,
    Contracted,
    Fulfilled,
    Settled,
    Expired,
    Cancelled,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct TradeIntent {
    pub intent_id: String,
    pub version: String,
    pub buyer: AccountId,
    pub goods: GoodsSpec,
    pub delivery: DeliverySpec,
    pub pricing: BuyerPricing,
    pub finance: Option<FinanceTerms>,
    pub expires_at: u64,
    pub status: IntentStatus,
    pub created_at: u64,
    pub updated_at: u64,
}

// ---------------------------------------------------------------------------
// SupplyListing
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum ListingStatus {
    Draft,
    Active,
    Matched,
    Contracted,
    Expired,
    Withdrawn,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct SupplyListing {
    pub listing_id: String,
    pub version: String,
    pub seller: AccountId,
    pub goods: GoodsSpec,
    pub pack_structure: PackStructure,
    pub delivery: DeliverySpec,
    pub pricing: SellerPricing,
    pub finance: Option<FinanceTerms>,
    pub certifications: Vec<CertificationRef>,
    pub available_from: u64,
    pub expires_at: u64,
    pub status: ListingStatus,
    pub created_at: u64,
}

// ---------------------------------------------------------------------------
// Offer
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum OfferStatus {
    Submitted,
    Shortlisted,
    Accepted,
    Rejected,
    Expired,
    Retracted,
}

/// An Offer is a targeted response to either a TradeIntent or a SupplyListing.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Offer {
    pub offer_id: String,
    pub version: String,
    /// References either an intent_id or listing_id
    pub target_id: String,
    pub target_type: OfferTargetType,
    pub offerer: AccountId,
    pub goods: GoodsSpec,
    pub delivery: DeliverySpec,
    pub finance: Option<FinanceTerms>,
    /// Price per unit in microdollars
    pub price_per_unit: Amount,
    pub total_price: Amount,
    pub certifications: Vec<CertificationRef>,
    pub expires_at: u64,
    pub status: OfferStatus,
    pub created_at: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum OfferTargetType {
    Intent,
    Listing,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum ContractStatus {
    Active,
    InFulfillment,
    Delivered,
    Settled,
    Disputed,
    ResolvedBuyer,
    ResolvedSeller,
    Cancelled,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct TradeContract {
    pub contract_id: String,
    pub version: String,
    pub intent_id: Option<String>,
    pub listing_id: Option<String>,
    pub offer_id: String,
    pub buyer: AccountId,
    pub seller: AccountId,
    pub goods: GoodsSpec,
    pub delivery: DeliverySpec,
    pub finance: Option<FinanceTerms>,
    pub price_per_unit: Amount,
    pub total_value: Amount,
    /// TODO: replace with NEAR USDC NEP-141 escrow reference when integrating
    /// stablecoin support. For v0, this is a placeholder string.
    pub escrow_ref: String,
    /// Hours after delivery attestation before auto-settlement
    pub dispute_window_hours: u32,
    pub arbitrator: Option<AccountId>,
    pub standing_agreement_id: Option<String>,
    pub status: ContractStatus,
    pub created_at: u64,
    pub updated_at: u64,
}

// ---------------------------------------------------------------------------
// Fulfillment
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum FulfillmentStatus {
    SellerAttested,
    BuyerAttested,
    Complete,
    Disputed,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Attestation {
    pub party_id: AccountId,
    pub signed_at: u64,
    pub notes: Option<String>,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Fulfillment {
    pub fulfillment_id: String,
    pub contract_id: String,
    pub delivered_at: u64,
    pub quantity_delivered: Quantity,
    pub seller_attestation: Attestation,
    pub buyer_attestation: Option<Attestation>,
    pub status: FulfillmentStatus,
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Deduction {
    pub reason: String,
    pub amount: Amount,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Settlement {
    pub settlement_id: String,
    pub contract_id: String,
    pub fulfillment_id: String,
    pub gross_amount: Amount,
    pub deductions: Vec<Deduction>,
    pub net_amount: Amount,
    /// TODO: populate with actual on-chain USDC transfer tx when NEP-141 integration lands
    pub escrow_release_tx: String,
    pub settled_at: u64,
}

// ---------------------------------------------------------------------------
// RelationshipRecord
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum RelationshipTier {
    New,
    Established,
    Preferred,
    Strategic,
}

impl RelationshipTier {
    pub fn derive(trades: u32, volume_usd_cents: u128, has_standing_agreement: bool) -> Self {
        let volume_usd = volume_usd_cents / 100;
        if has_standing_agreement && volume_usd >= 250_000 {
            return RelationshipTier::Strategic;
        }
        if trades >= 10 || volume_usd >= 50_000 || has_standing_agreement {
            return RelationshipTier::Preferred;
        }
        if trades >= 3 {
            return RelationshipTier::Established;
        }
        RelationshipTier::New
    }
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct RelationshipRecord {
    pub relationship_id: String,
    pub party_a: AccountId,
    pub party_b: AccountId,
    pub first_trade_at: u64,
    pub last_trade_at: u64,
    pub trades_completed: u32,
    /// Stored as microdollars (1 USDC = 1_000_000)
    pub total_volume: Amount,
    /// Basis points (10000 = 100%)
    pub dispute_rate_bp: u32,
    pub on_time_delivery_rate_bp: u32,
    pub tier: RelationshipTier,
    pub standing_agreement_ids: Vec<String>,
    pub updated_at: u64,
}

impl RelationshipRecord {
    /// Canonical key for a pair of accounts (always sorted to avoid duplicates)
    pub fn key(a: &AccountId, b: &AccountId) -> String {
        let mut ids = vec![a.to_string(), b.to_string()];
        ids.sort();
        format!("{}:{}", ids[0], ids[1])
    }
}

// ---------------------------------------------------------------------------
// StandingAgreement
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum AgreementStatus {
    Proposed,
    Countered,
    Active,
    Completed,
    Terminated,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum RenewalPolicy {
    Auto,
    Manual,
    None,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct VolumeCommitment {
    pub min_quantity_per_period: Quantity,
    pub period: String, // "monthly" | "quarterly" | "annual"
    pub committed_total: Quantity,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct StandingAgreement {
    pub agreement_id: String,
    pub version: String,
    pub buyer: AccountId,
    pub seller: AccountId,
    pub goods: GoodsSpec,
    pub period_start: u64,
    pub period_end: u64,
    pub volume_commitment: VolumeCommitment,
    pub pricing: SellerPricing,
    pub delivery_cadence: Option<String>,
    pub renewal: RenewalPolicy,
    pub status: AgreementStatus,
    pub buyer_signed_at: Option<u64>,
    pub seller_signed_at: Option<u64>,
    pub created_at: u64,
}
