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

/// Status of a KYB (Know Your Business) legal identity attestation.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum KybStatus {
    Pending,
    Verified,
    Expired,
    Revoked,
}

/// Legal entity identity attestation attached to a DTP Account.
///
/// KybRef bridges the cryptographic identity (NEAR account) and the legal
/// identity of the business or individual behind it. In v1, parties
/// self-report and reference an external KYB provider. Future versions
/// will allow providers to write attestations directly to the party record.
///
/// This field is optional at registration and never required for trading,
/// but platforms and counterparties may filter or weight by KYB status.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct KybRef {
    /// Legal entity name as registered (may differ from business_name display name)
    pub legal_name: String,
    /// Tax identifier (EIN for US entities, VAT for EU, etc.)
    pub tax_id: Option<String>,
    /// Jurisdiction of registration (ISO 3166-1 alpha-2 country code)
    pub jurisdiction: String,
    /// KYB attestation provider (e.g. "stripe_identity", "persona", "manual")
    pub provider: String,
    /// Provider's attestation reference ID or verification URL
    pub attestation_ref: Option<String>,
    /// When this attestation was issued (Unix ms)
    pub issued_at: u64,
    /// When this attestation expires; None means no expiry
    pub expires_at: Option<u64>,
    pub status: KybStatus,
}

/// The role the proposer is taking in a StandingAgreement.
/// Any registered account can propose as either buyer or seller —
/// business type does not constrain trade role.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum ProposerRole {
    Buyer,
    Seller,
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
    /// Optional legal entity identity attestation (KYB).
    /// Bridges the NEAR account (cryptographic identity) to a real-world
    /// business or individual. Not required for trading in v1.
    pub kyb: Option<KybRef>,
    pub certifications: Vec<CertificationRef>,
    pub reputation: ReputationRecord,
    /// Accounts authorized to act on behalf of this party (agents, sub-accounts).
    /// Owner-only management via authorize_agent / revoke_agent.
    pub authorized_agents: Vec<AccountId>,
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
// Goods Catalog + Lots
// ---------------------------------------------------------------------------

/// Product preparation / form factor. The `Other` variant handles commodity-
/// specific forms not covered by the canonical list.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum Preparation {
    Fresh,
    Frozen,
    /// Individually Quick Frozen
    IQF,
    Dried,
    Concentrate,
    Puree,
    Juice,
    Smoked,
    Fermented,
    Canned,
    RoastedOrToasted,
    Other(String),
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum StorageCondition {
    Ambient,
    Refrigerated,
    Frozen,
    ControlledAtmosphere,
}

/// FDA FALCPA major food allergens plus sesame (FASTER Act 2023).
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum Allergen {
    Milk,
    Eggs,
    Fish,
    Shellfish,
    TreeNuts,
    Peanuts,
    Wheat,
    Soybeans,
    Sesame,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum PalletType {
    GMA,   // 48"×40" GMA pallet (US standard)
    Euro,  // 1200mm×800mm EUR pallet
    Custom,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum MediaKind {
    ProductImage,
    SpecSheet,
    LabReport,
    CertDocument,
    Other(String),
}

/// Lifecycle status of a GoodsLot.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum LotStatus {
    /// All quantity available for contracting
    Available,
    /// Some quantity reserved under active contracts; remainder still available
    PartiallyAllocated,
    /// All quantity reserved; no more allocations possible
    FullyAllocated,
    /// Goods delivered and attested on-chain; ownership transferred to buyer
    Fulfilled,
    /// Lot has been fully transferred to a new owner (resale complete)
    Transferred,
    Spoiled,
    Donated,
    Recalled,
}

/// Extensible key-value attribute for commodity-specific fields.
/// Examples: `{key: "brix", value: "14-16"}`, `{key: "scoville", value: "50000"}`
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct ProductAttribute {
    pub key: String,
    pub value: String,
}

/// Off-chain media reference. The hash (SHA-256 or IPFS CID) is stored on-chain
/// for tamper-evidence; the actual file is stored off-chain.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct MediaRef {
    pub kind: MediaKind,
    /// SHA-256 hex hash or IPFS CIDv1 of the content
    pub hash: String,
    /// Optional retrieval hint (IPFS gateway, S3 presigned URL). Not authoritative.
    pub uri_hint: Option<String>,
}

/// Physical dimensions in millimetres.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Dimensions {
    pub length_mm: u32,
    pub width_mm: u32,
    pub height_mm: u32,
}

/// Each/unit-level physical spec.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct EachSpec {
    pub net_weight_g: Option<u32>,
    pub gross_weight_g: Option<u32>,
    pub dimensions_mm: Option<Dimensions>,
    /// 12-digit UPC-A barcode
    pub upc: Option<String>,
}

/// Case-level physical spec. The standard B2B order unit.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct CaseSpec {
    /// Number of eaches per case (e.g. 12 bottles per case)
    pub units_per_case: u32,
    /// Total net weight of case contents in grams
    pub net_weight_g: u32,
    pub gross_weight_g: u32,
    pub dimensions_mm: Dimensions,
    /// Case-level GTIN-14 (may differ from each GTIN)
    pub gtin: Option<String>,
}

/// Pallet-level spec for freight planning.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct PalletSpec {
    pub cases_per_layer: u32,
    pub layers: u32,
    /// Total cases per pallet = cases_per_layer * layers
    pub cases_per_pallet: u32,
    pub gross_weight_kg: u32,
    pub dimensions_mm: Dimensions,
    pub pallet_type: PalletType,
}

/// Full pack hierarchy for a catalog entry.
/// `trade_unit` is the unit in which prices are quoted and quantities traded
/// (e.g. "lb", "oz", "kg", "gal", "L", "ea").
/// The case and pallet specs provide freight-planning geometry.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct PackDefinition {
    /// Trade/pricing unit: "lb", "oz", "kg", "gal", "L", "ea", etc.
    pub trade_unit: String,
    /// Weight of one case in trade units (e.g. Quantity { 30_000, "lb" } = 30 lb/case).
    /// Used to convert between weight quantities and case counts for freight.
    pub case_weight: Option<Quantity>,
    pub each: Option<EachSpec>,
    pub case: Option<CaseSpec>,
    pub pallet: Option<PalletSpec>,
}

/// Lot-level certification (e.g. COA, lab test result, harvest-specific cert).
/// Distinct from account-level and catalog-level certifications.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct LotCertRef {
    pub cert_type: String,
    pub issuer: String,
    pub issued_at: u64,
    pub expires_at: Option<u64>,
    /// SHA-256 of the certificate document (off-chain)
    pub doc_hash: Option<String>,
    pub status: CertStatus,
}

/// An ownership transfer event appended to a GoodsLot's provenance chain.
/// Every on-chain transfer writes one of these — forming an immutable
/// traceability record from origin to current holder.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct ProvenanceEvent {
    pub from: AccountId,
    pub to: AccountId,
    /// Quantity transferred in milliamount (same unit as GoodsLot)
    pub milliamount: u64,
    pub unit: String,
    /// The DTP contract that effected this transfer
    pub contract_id: String,
    pub timestamp: u64,
}

/// Reference to an input lot consumed during manufacturing (BOM line item).
/// Enables FSMA 204 one-up / one-down traceability for processed goods.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct InputLotRef {
    pub lot_id: String,
    pub milliamount: u64,
    pub unit: String,
}

/// A reusable product master record owned by a DTP account.
/// Created once per unique product definition; referenced by GoodsLots,
/// SupplyListings, and TradeIntents.
///
/// System-assigned fields (catalog_id, owner, version, created_at, updated_at)
/// are set by the contract and overwrite any caller-supplied values.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct GoodsCatalogEntry {
    // ── System-assigned ────────────────────────────────────────────────────
    pub catalog_id: String,
    pub owner: AccountId,
    pub version: u32,

    // ── Identification ─────────────────────────────────────────────────────
    /// GS1 GTIN-14 (case-level by convention)
    pub gtin: Option<String>,
    pub brand: Option<String>,
    /// Display name: "Organic IQF Duke Blueberries 30lb"
    pub product_name: String,
    /// Owner's internal SKU (not globally unique, not published)
    pub internal_sku: Option<String>,
    /// Dotted taxonomy: "food.produce.berries.blueberries" or "auto.parts.engine"
    pub category: String,

    // ── Commodity detail ───────────────────────────────────────────────────
    pub commodity: Option<String>,
    pub variety: Option<String>,
    pub grade: Option<String>,
    pub growing_region: Option<String>,
    /// ISO 3166-1 alpha-2 country code
    pub country_of_origin: Option<String>,
    pub preparation: Option<Preparation>,
    pub storage_condition: StorageCondition,
    pub shelf_life_days: Option<u32>,

    // ── Pack hierarchy ─────────────────────────────────────────────────────
    pub pack: PackDefinition,
    /// True when case weight varies by unit (common in meat and whole produce)
    pub catch_weight: bool,

    // ── Compliance ─────────────────────────────────────────────────────────
    /// INCI / plain-text ingredient declaration
    pub ingredients: Option<String>,
    pub allergens: Vec<Allergen>,
    /// SHA-256 of nutrition facts JSON (off-chain). None = not applicable.
    pub nutrition_hash: Option<String>,

    // ── Product-level certifications ───────────────────────────────────────
    /// e.g. USDA Organic handler cert, Non-GMO Project, Kosher, Halal
    pub certifications: Vec<CertificationRef>,

    // ── Extensibility ──────────────────────────────────────────────────────
    pub attributes: Vec<ProductAttribute>,

    // ── Off-chain media (content-addressed) ───────────────────────────────
    pub media_hashes: Vec<MediaRef>,

    // ── System-assigned timestamps ─────────────────────────────────────────
    pub created_at: u64,
    pub updated_at: u64,
}

/// A specific, finite quantity of goods on-chain — the atomic unit of trade.
///
/// Quantity is tracked in the catalog entry's `trade_unit` (usually weight).
/// Ownership transfers via the provenance chain on each DTP settlement.
///
/// System-assigned fields (lot_id, owner, available_milliamount, provenance,
/// status, created_at, updated_at) are set by the contract.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct GoodsLot {
    // ── System-assigned ────────────────────────────────────────────────────
    pub lot_id: String,
    pub owner: AccountId,
    pub available_milliamount: u64,
    pub provenance: Vec<ProvenanceEvent>,
    pub status: LotStatus,
    pub created_at: u64,
    pub updated_at: u64,

    // ── Caller-provided ────────────────────────────────────────────────────
    pub catalog_id: String,
    /// First account to bring this lot on-chain (immutable after creation)
    pub origin_account: AccountId,
    /// Total quantity in catalog entry's trade_unit (milliamount)
    pub total_milliamount: u64,
    pub unit: String,

    // ── Lot identity ───────────────────────────────────────────────────────
    /// Farm / manufacturer lot code (FSMA Key Traceability Lot Code)
    pub lot_number: Option<String>,
    pub pack_date: Option<u64>,
    pub harvest_date: Option<u64>,
    pub best_by: Option<u64>,

    // ── Lot-specific certifications ────────────────────────────────────────
    pub lot_certifications: Vec<LotCertRef>,

    // ── Manufacturing inputs (FSMA one-up traceability) ────────────────────
    pub input_lots: Vec<InputLotRef>,
}

// ---------------------------------------------------------------------------
// Finance pools
// ---------------------------------------------------------------------------

/// A registered DeFi liquidity pool that can finance DTP trades.
///
/// The pool account is an external NEAR contract that listens for
/// `FinancingRequested` events and calls `confirm_financing` when funded.
/// Capital deployed earns yield from finance_fee_bps charged to the buyer.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct FinancePool {
    pub pool_id: String,
    /// The NEAR account of the pool contract (authorized to confirm financing)
    pub pool_account: AccountId,
    /// Maximum rate this pool charges, in basis points (e.g. 150 = 1.5%)
    pub max_rate_bps: u16,
    /// Capital available to deploy, in microdollars
    pub available_microdollars: u128,
    /// Capital currently deployed (outstanding), in microdollars
    pub deployed_microdollars: u128,
    pub active: bool,
    pub created_at: u64,
    pub updated_at: u64,
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
    /// True when transaction is PACA-covered produce.
    pub paca_covered: bool,
    pub financing_mode: FinancingMode,
    /// Optional in v1; defaults to protocol pool when FinancingMode::LpPool.
    pub liquidity_pool_id: Option<String>,
    /// Optional funding partner account (future-proof for v2 lender selection).
    pub financer_id: Option<AccountId>,
    /// Protocol finance fee in basis points.
    pub finance_fee_bps: u16,
}

// ---------------------------------------------------------------------------
// Freight (v1)
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum FreightPayer {
    Buyer,
    Seller,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum FreightQuoteSource {
    Project44,
    ManualEstimate,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct FreightTerms {
    /// Default policy in v1 is Buyer.
    pub payer: FreightPayer,
    /// Estimated freight amount in microdollars.
    pub estimated_freight: Amount,
    /// Allowance/credit applied against freight in microdollars.
    pub freight_allowance: Amount,
    pub quote_source: FreightQuoteSource,
    /// Quote provider reference (id/hash) when available.
    pub quote_ref: Option<String>,
    /// Quote timestamp and expiry for staleness checks.
    pub quoted_at: u64,
    pub quote_expires_at: u64,
    /// If true, freight was booked/locked at contract formation.
    pub booked_at_contract: bool,
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
    /// If set, buyer will accept any lot matching this catalog entry.
    /// Takes precedence over inline GoodsSpec for matching purposes.
    pub catalog_id: Option<String>,
    pub goods: GoodsSpec,
    pub delivery: DeliverySpec,
    pub pricing: BuyerPricing,
    pub finance: Option<FinanceTerms>,
    pub freight: Option<FreightTerms>,
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
    /// If set, this listing is backed by a specific on-chain GoodsLot.
    /// Quantity available is governed by lot.available_milliamount.
    pub lot_id: Option<String>,
    pub goods: GoodsSpec,
    pub pack_structure: PackStructure,
    pub delivery: DeliverySpec,
    pub pricing: SellerPricing,
    pub finance: Option<FinanceTerms>,
    pub freight: Option<FreightTerms>,
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
    pub freight: Option<FreightTerms>,
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
    /// If the listing referenced a GoodsLot, the contract captures it here.
    /// Ownership transfers to buyer at settlement.
    pub lot_id: Option<String>,
    pub goods: GoodsSpec,
    pub delivery: DeliverySpec,
    pub finance: Option<FinanceTerms>,
    pub freight: Option<FreightTerms>,
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
    pub fn derive(trades: u32, volume_microdollars: u128, has_standing_agreement: bool) -> Self {
        let volume_usd = volume_microdollars / 1_000_000;
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
