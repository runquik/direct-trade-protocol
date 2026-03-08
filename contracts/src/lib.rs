/*!
 * Direct Trade Protocol (DTP) — NEAR Smart Contract v0.1
 *
 * This contract is the settlement layer of DTP: it holds escrow, enforces
 * state machines, records the audit trail, and maintains relationship records.
 *
 * All amounts are in microdollars (1 USDC = 1_000_000).
 *
 * TODO (post-v0): Replace native NEAR escrow placeholder with NEP-141 USDC
 * fungible token transfers for real stablecoin settlement.
 */

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::store::{LookupMap, IterableMap, Vector};
use near_sdk::{env, near, AccountId, PanicOnDefault};
use near_sdk::serde::{Deserialize, Serialize};

mod types;
mod events;
mod matching;

use types::*;
use events::*;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct DTPContract {
    /// Protocol owner (can set arbitrator, upgrade config)
    pub owner: AccountId,
    /// DTP spec version this contract implements
    pub protocol_version: String,
    /// Default dispute window in hours
    pub default_dispute_window_hours: u32,

    // -----------------------------------------------------------------------
    // Core storage
    // -----------------------------------------------------------------------
    pub parties: LookupMap<AccountId, Party>,
    pub catalogs: IterableMap<String, GoodsCatalogEntry>,
    pub lots: IterableMap<String, GoodsLot>,
    pub intents: IterableMap<String, TradeIntent>,
    pub listings: IterableMap<String, SupplyListing>,
    pub offers: IterableMap<String, Offer>,
    pub contracts: IterableMap<String, TradeContract>,
    pub fulfillments: IterableMap<String, Fulfillment>,
    pub settlements: IterableMap<String, Settlement>,
    pub standing_agreements: IterableMap<String, StandingAgreement>,
    pub relationships: LookupMap<String, RelationshipRecord>,
    pub finance_pools: LookupMap<String, FinancePool>,

    /// Append-only audit trail
    pub audit_log: Vector<AuditEvent>,
    /// Maps entity_id → list of audit_log indices for O(1) entity filtering
    pub audit_index: LookupMap<String, Vec<u32>>,

    /// Counter for generating sequential IDs
    pub id_counter: u64,
}

#[near]
impl DTPContract {
    // -----------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------

    #[init]
    pub fn new(owner: AccountId) -> Self {
        assert!(!env::state_exists(), "Already initialized");
        Self {
            owner,
            protocol_version: "0.1".to_string(),
            default_dispute_window_hours: 48,
            parties: LookupMap::new(b"p"),
            catalogs: IterableMap::new(b"g"),
            lots: IterableMap::new(b"h"),
            intents: IterableMap::new(b"i"),
            listings: IterableMap::new(b"l"),
            offers: IterableMap::new(b"o"),
            contracts: IterableMap::new(b"c"),
            fulfillments: IterableMap::new(b"f"),
            settlements: IterableMap::new(b"s"),
            standing_agreements: IterableMap::new(b"a"),
            relationships: LookupMap::new(b"r"),
            finance_pools: LookupMap::new(b"n"),
            audit_log: Vector::new(b"e"),
            audit_index: LookupMap::new(b"x"),
            id_counter: 0,
        }
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn next_id_for(&mut self, prefix: &str) -> String {
        self.id_counter += 1;
        format!("{}{}", prefix, self.id_counter)
    }

    fn now_ms(&self) -> u64 {
        env::block_timestamp() / 1_000_000
    }

    fn emit(&mut self, event: AuditEvent) {
        let idx = self.audit_log.len();
        let entity_id = event.entity_id.clone();
        let json = serde_json::to_string(&event).unwrap_or_default();
        self.audit_log.push(event);
        let mut indices = self.audit_index.get(&entity_id).cloned().unwrap_or_default();
        indices.push(idx);
        self.audit_index.insert(entity_id, indices);
        near_sdk::log!("DTP_EVENT:{}", json);
    }

    fn require_party(&self, account: &AccountId) {
        assert!(self.parties.contains_key(account), "Party not registered");
    }

    /// Assert that the caller is the owner account or one of its authorized agents.
    fn require_party_or_agent(&self, owner: &AccountId) {
        let caller = env::predecessor_account_id();
        if caller == *owner { return; }
        let party = self.parties.get(owner).expect("Party not registered");
        assert!(
            party.authorized_agents.contains(&caller),
            "Caller is not the owner or an authorized agent"
        );
    }

    fn validate_finance_terms(&self, finance: &Option<FinanceTerms>) {
        if let Some(f) = finance {
            assert!(f.net_days <= 60, "net_days must be <= 60 in v1");
            if f.paca_covered {
                assert!(f.net_days <= 30, "PACA-covered trades must have net_days <= 30");
            }
            assert!(f.finance_fee_bps <= 5000, "finance_fee_bps must be <= 5000");

            if matches!(f.financing_mode, FinancingMode::EscrowOnly) {
                assert!(f.liquidity_pool_id.is_none(), "EscrowOnly cannot set liquidity_pool_id");
                assert!(f.financer_id.is_none(), "EscrowOnly cannot set financer_id");
            }
        }
    }

    fn validate_freight_terms(&self, freight: &Option<FreightTerms>) {
        if let Some(f) = freight {
            assert!(f.quote_expires_at >= f.quoted_at, "freight quote expiry must be >= quoted_at");
            assert!(f.estimated_freight >= f.freight_allowance, "freight_allowance cannot exceed estimated_freight");
        }
    }

    // -----------------------------------------------------------------------
    // Party registration
    // -----------------------------------------------------------------------

    /// Register a new party. Each account may register once.
    pub fn register_party(
        &mut self,
        business_name: String,
        business_type: BusinessType,
        jurisdiction: String,
    ) {
        let account = env::predecessor_account_id();
        assert!(!self.parties.contains_key(&account), "Party already registered");

        let party = Party {
            party_id: account.clone(),
            business_name,
            business_type,
            jurisdiction,
            kyb: None,
            certifications: vec![],
            reputation: ReputationRecord::default(),
            authorized_agents: vec![],
            created_at: self.now_ms(),
        };
        self.parties.insert(account.clone(), party.clone());
        near_sdk::log!("Party registered: {}", account);
    }

    /// Add a certification to the caller's party record.
    pub fn add_certification(&mut self, cert: CertificationRef) {
        let account = env::predecessor_account_id();
        let mut party = self.parties.get(&account).cloned().expect("Party not registered");
        party.certifications.push(cert);
        self.parties.insert(account.clone(), party.clone());
    }

    /// Attach or replace a KYB (legal entity identity) attestation on the caller's account.
    /// Each account holds at most one KybRef. Calling this again replaces the previous one.
    pub fn add_kyb_attestation(&mut self, kyb: KybRef) {
        let account = env::predecessor_account_id();
        let mut party = self.parties.get(&account).cloned().expect("Party not registered");
        party.kyb = Some(kyb);
        self.parties.insert(account.clone(), party);
    }

    // -----------------------------------------------------------------------
    // Agent authorization
    // -----------------------------------------------------------------------

    /// Authorize an agent account to act on behalf of the caller's party.
    /// Agents can post listings, manage catalog entries and lots, and sign
    /// agreements. The owner key retains all capabilities.
    pub fn authorize_agent(&mut self, agent: AccountId) {
        let account = env::predecessor_account_id();
        let mut party = self.parties.get(&account).cloned().expect("Party not registered");
        assert_ne!(agent, account, "Cannot authorize self as agent");
        if !party.authorized_agents.contains(&agent) {
            party.authorized_agents.push(agent.clone());
            self.parties.insert(account.clone(), party);
            near_sdk::log!("Agent authorized: {} for {}", agent, account);
        }
    }

    /// Revoke a previously authorized agent.
    pub fn revoke_agent(&mut self, agent: AccountId) {
        let account = env::predecessor_account_id();
        let mut party = self.parties.get(&account).cloned().expect("Party not registered");
        party.authorized_agents.retain(|a| a != &agent);
        self.parties.insert(account.clone(), party);
        near_sdk::log!("Agent revoked: {} from {}", agent, account);
    }

    // -----------------------------------------------------------------------
    // TradeIntent
    // -----------------------------------------------------------------------

    /// Post a new TradeIntent. Caller must be a registered party.
    pub fn post_intent(
        &mut self,
        goods: GoodsSpec,
        delivery: DeliverySpec,
        pricing: BuyerPricing,
        finance: Option<FinanceTerms>,
        freight: Option<FreightTerms>,
        expires_at: u64,
    ) -> String {
        let buyer = env::predecessor_account_id();
        self.require_party(&buyer);
        self.validate_finance_terms(&finance);
        self.validate_freight_terms(&freight);

        let intent_id = self.next_id_for("int-");
        let now = self.now_ms();

        let intent = TradeIntent {
            intent_id: intent_id.clone(),
            version: self.protocol_version.clone(),
            buyer: buyer.clone(),
            catalog_id: None,
            goods,
            delivery,
            pricing,
            finance,
            freight,
            expires_at,
            status: IntentStatus::Posted,
            created_at: now,
            updated_at: now,
        };

        self.intents.insert(intent_id.clone(), intent.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(&intent_id, &EventType::IntentPosted, now),
            event_type: EventType::IntentPosted,
            entity_type: EntityType::Intent,
            entity_id: intent_id.clone(),
            actor: buyer.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&intent),
        });

        intent_id
    }

    /// Cancel a posted intent. Caller must be the buyer.
    pub fn cancel_intent(&mut self, intent_id: String) {
        let caller = env::predecessor_account_id();
        let mut intent = self.intents.get(&intent_id).cloned().expect("Intent not found");
        assert_eq!(intent.buyer, caller, "Only buyer can cancel");
        assert_eq!(intent.status, IntentStatus::Posted, "Intent not in Posted state");

        intent.status = IntentStatus::Cancelled;
        intent.updated_at = self.now_ms();
        self.intents.insert(intent_id.clone(), intent.clone());

        let now = self.now_ms();
        self.emit(AuditEvent {
            event_id: make_event_id(&intent_id, &EventType::IntentCancelled, now),
            event_type: EventType::IntentCancelled,
            entity_type: EntityType::Intent,
            entity_id: intent_id,
            actor: caller.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&intent),
        });
    }

    // -----------------------------------------------------------------------
    // SupplyListing
    // -----------------------------------------------------------------------

    /// Post a new SupplyListing. Caller must be a registered party.
    /// If `lot_id` is provided the listing is backed by that specific GoodsLot;
    /// the lot must be owned by the caller and have available quantity.
    pub fn post_listing(
        &mut self,
        lot_id: Option<String>,
        goods: GoodsSpec,
        pack_structure: PackStructure,
        delivery: DeliverySpec,
        pricing: SellerPricing,
        finance: Option<FinanceTerms>,
        freight: Option<FreightTerms>,
        certifications: Vec<CertificationRef>,
        available_from: u64,
        expires_at: u64,
    ) -> String {
        let seller = env::predecessor_account_id();
        self.require_party(&seller);
        self.validate_finance_terms(&finance);
        self.validate_freight_terms(&freight);

        // Validate lot ownership if a lot is being linked
        if let Some(ref lid) = lot_id {
            let lot = self.lots.get(lid).cloned().expect("Lot not found");
            self.require_party_or_agent(&lot.owner);
            assert!(
                matches!(lot.status, LotStatus::Available | LotStatus::PartiallyAllocated),
                "Lot is not available for listing"
            );
        }

        let listing_id = self.next_id_for("lst-");
        let now = self.now_ms();

        let listing = SupplyListing {
            listing_id: listing_id.clone(),
            version: self.protocol_version.clone(),
            seller: seller.clone(),
            lot_id,
            goods,
            pack_structure,
            delivery,
            pricing,
            finance,
            freight,
            certifications,
            available_from,
            expires_at,
            status: ListingStatus::Active,
            created_at: now,
        };

        self.listings.insert(listing_id.clone(), listing.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(&listing_id, &EventType::ListingActivated, now),
            event_type: EventType::ListingActivated,
            entity_type: EntityType::Listing,
            entity_id: listing_id.clone(),
            actor: seller.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&listing),
        });

        listing_id
    }

    /// Withdraw an active listing. Caller must be the seller.
    pub fn withdraw_listing(&mut self, listing_id: String) {
        let caller = env::predecessor_account_id();
        let mut listing = self.listings.get(&listing_id).cloned().expect("Listing not found");
        assert_eq!(listing.seller, caller, "Only seller can withdraw");
        assert_eq!(listing.status, ListingStatus::Active, "Listing not active");

        listing.status = ListingStatus::Withdrawn;
        self.listings.insert(listing_id.clone(), listing.clone());

        let now = self.now_ms();
        self.emit(AuditEvent {
            event_id: make_event_id(&listing_id, &EventType::ListingWithdrawn, now),
            event_type: EventType::ListingWithdrawn,
            entity_type: EntityType::Listing,
            entity_id: listing_id,
            actor: caller.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&listing),
        });
    }

    // -----------------------------------------------------------------------
    // Offers
    // -----------------------------------------------------------------------

    /// Submit an offer targeting an intent or listing.
    pub fn submit_offer(
        &mut self,
        target_id: String,
        target_type: OfferTargetType,
        goods: GoodsSpec,
        delivery: DeliverySpec,
        finance: Option<FinanceTerms>,
        freight: Option<FreightTerms>,
        price_per_unit: Amount,
        total_price: Amount,
        certifications: Vec<CertificationRef>,
        expires_at: u64,
    ) -> String {
        let offerer = env::predecessor_account_id();
        self.require_party(&offerer);
        self.validate_finance_terms(&finance);
        self.validate_freight_terms(&freight);

        // Validate target exists and is in a matchable state
        match &target_type {
            OfferTargetType::Intent => {
                let intent = self.intents.get(&target_id).cloned().expect("Intent not found");
                assert_eq!(intent.status, IntentStatus::Posted, "Intent not open for offers");
            }
            OfferTargetType::Listing => {
                let listing = self.listings.get(&target_id).cloned().expect("Listing not found");
                assert_eq!(listing.status, ListingStatus::Active, "Listing not active");
            }
        }

        let offer_id = self.next_id_for("off-");
        let now = self.now_ms();

        let offer = Offer {
            offer_id: offer_id.clone(),
            version: self.protocol_version.clone(),
            target_id,
            target_type,
            offerer: offerer.clone(),
            goods,
            delivery,
            finance,
            freight,
            price_per_unit,
            total_price,
            certifications,
            expires_at,
            status: OfferStatus::Submitted,
            created_at: now,
        };

        self.offers.insert(offer_id.clone(), offer.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(&offer_id, &EventType::OfferSubmitted, now),
            event_type: EventType::OfferSubmitted,
            entity_type: EntityType::Offer,
            entity_id: offer_id.clone(),
            actor: offerer.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&offer),
        });

        offer_id
    }

    /// Retract a submitted offer. Caller must be the offerer.
    pub fn retract_offer(&mut self, offer_id: String) {
        let caller = env::predecessor_account_id();
        let mut offer = self.offers.get(&offer_id).cloned().expect("Offer not found");
        assert_eq!(offer.offerer, caller, "Only offerer can retract");
        assert_eq!(offer.status, OfferStatus::Submitted, "Offer not retractable");

        offer.status = OfferStatus::Retracted;
        self.offers.insert(offer_id.clone(), offer.clone());

        let now = self.now_ms();
        self.emit(AuditEvent {
            event_id: make_event_id(&offer_id, &EventType::OfferRetracted, now),
            event_type: EventType::OfferRetracted,
            entity_type: EntityType::Offer,
            entity_id: offer_id,
            actor: caller.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&offer),
        });
    }

    // -----------------------------------------------------------------------
    // Contract formation
    // -----------------------------------------------------------------------

    /// Accept an offer, forming a Contract and locking escrow.
    /// Caller must be the buyer (for intent-based offers) or seller
    /// (for listing-based offers).
    pub fn accept_offer(
        &mut self,
        offer_id: String,
        arbitrator: Option<AccountId>,
        standing_agreement_id: Option<String>,
    ) -> String {
        let caller = env::predecessor_account_id();
        let mut offer = self.offers.get(&offer_id).cloned().expect("Offer not found");

        assert!(
            matches!(offer.status, OfferStatus::Submitted | OfferStatus::Shortlisted),
            "Offer not available for acceptance"
        );

        // Determine buyer, seller, and optional lot reference based on offer target type
        let (buyer, seller, intent_id, listing_id, lot_id) = match &offer.target_type {
            OfferTargetType::Intent => {
                let mut intent = self.intents.get(&offer.target_id).cloned().expect("Intent not found");
                assert_eq!(intent.buyer, caller, "Only buyer can accept offer on their intent");
                assert_eq!(intent.status, IntentStatus::Posted, "Intent not open");
                intent.status = IntentStatus::Contracted;
                intent.updated_at = self.now_ms();
                self.intents.insert(intent.intent_id.clone(), intent.clone());
                (caller.clone(), offer.offerer.clone(), Some(offer.target_id.clone()), None, None)
            }
            OfferTargetType::Listing => {
                let mut listing = self.listings.get(&offer.target_id).cloned().expect("Listing not found");
                assert_eq!(listing.seller, caller, "Only seller can accept offer on their listing");
                assert_eq!(listing.status, ListingStatus::Active, "Listing not active");
                let lot_id = listing.lot_id.clone();
                listing.status = ListingStatus::Contracted;
                self.listings.insert(listing.listing_id.clone(), listing.clone());
                (offer.offerer.clone(), caller.clone(), None, Some(offer.target_id.clone()), lot_id)
            }
        };

        // Landed-cost guardrail for buyer-targeted intents:
        // if buyer pays freight, (goods total + net freight) must fit buyer ceiling.
        if let Some(intent_ref) = &intent_id {
            let intent = self.intents.get(intent_ref).cloned().expect("Intent not found");
            let mut landed_total = offer.total_price;
            if let Some(freight) = &offer.freight {
                if matches!(freight.payer, FreightPayer::Buyer) {
                    landed_total = landed_total.saturating_add(
                        freight.estimated_freight.saturating_sub(freight.freight_allowance)
                    );
                }
            }

            let ceiling_total = (intent.pricing.ceiling_price_per_unit)
                .saturating_mul(intent.goods.quantity.milliamount as u128)
                / 1000u128;

            assert!(
                landed_total <= ceiling_total,
                "landed cost exceeds buyer ceiling"
            );
        }

        offer.status = OfferStatus::Accepted;
        self.offers.insert(offer_id.clone(), offer.clone());

        let contract_id = self.next_id_for("ctr-");
        let now = self.now_ms();

        // TODO: Replace this placeholder with actual NEP-141 USDC escrow lock.
        // When USDC integration lands:
        //   1. Call ft_transfer_call on the USDC contract
        //   2. Record the escrow account and amount
        //   3. Funds held until fulfillment or dispute resolution
        let escrow_ref = format!("escrow-placeholder-{}", contract_id);

        // If this contract is backed by a lot, allocate the contracted quantity
        if let Some(ref lid) = lot_id {
            let contracted_milliamount = offer.goods.quantity.milliamount;
            self.allocate_lot(lid, contracted_milliamount);
        }

        let contract = TradeContract {
            contract_id: contract_id.clone(),
            version: self.protocol_version.clone(),
            intent_id,
            listing_id,
            offer_id: offer_id.clone(),
            buyer: buyer.clone(),
            seller: seller.clone(),
            lot_id,
            goods: offer.goods.clone(),
            delivery: offer.delivery.clone(),
            finance: offer.finance.clone(),
            freight: offer.freight.clone(),
            price_per_unit: offer.price_per_unit,
            total_value: offer.total_price,
            escrow_ref,
            dispute_window_hours: self.default_dispute_window_hours,
            arbitrator,
            standing_agreement_id,
            status: ContractStatus::Active,
            created_at: now,
            updated_at: now,
        };

        self.contracts.insert(contract_id.clone(), contract.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(&contract_id, &EventType::ContractCreated, now),
            event_type: EventType::ContractCreated,
            entity_type: EntityType::Contract,
            entity_id: contract_id.clone(),
            actor: caller.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&contract),
        });

        self.emit(AuditEvent {
            event_id: make_event_id(&contract_id, &EventType::ContractEscrowLocked, now),
            event_type: EventType::ContractEscrowLocked,
            entity_type: EntityType::Contract,
            entity_id: contract_id.clone(),
            actor: caller.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&contract.escrow_ref),
        });

        // If LP pool financing is requested, emit an event so the pool contract
        // can listen and call confirm_financing when capital is ready.
        if let Some(ref finance) = contract.finance {
            if matches!(finance.financing_mode, FinancingMode::LpPool) {
                self.emit(AuditEvent {
                    event_id: make_event_id(&contract_id, &EventType::FinancingRequested, now),
                    event_type: EventType::FinancingRequested,
                    entity_type: EntityType::Contract,
                    entity_id: contract_id.clone(),
                    actor: caller.to_string(),
                    timestamp: now,
                    payload_hash: hash_payload(&finance.liquidity_pool_id),
                });
            }
        }

        contract_id
    }

    // -----------------------------------------------------------------------
    // Fulfillment
    // -----------------------------------------------------------------------

    /// Seller attests to delivery. Moves contract to InFulfillment.
    pub fn seller_attest_delivery(
        &mut self,
        contract_id: String,
        quantity_delivered: Quantity,
        notes: Option<String>,
    ) -> String {
        let caller = env::predecessor_account_id();
        let mut contract = self.contracts.get(&contract_id).cloned().expect("Contract not found");
        assert_eq!(contract.seller, caller, "Only seller can attest delivery");
        assert!(
            matches!(contract.status, ContractStatus::Active | ContractStatus::InFulfillment),
            "Contract not in deliverable state"
        );

        // Guard against duplicate fulfillments for the same contract
        let already_fulfilled = self.fulfillments
            .iter()
            .any(|(_, f)| f.contract_id == contract_id);
        assert!(!already_fulfilled, "Fulfillment already exists for this contract");

        let now = self.now_ms();
        let fulfillment_id = self.next_id_for("ful-");

        let fulfillment = Fulfillment {
            fulfillment_id: fulfillment_id.clone(),
            contract_id: contract_id.clone(),
            delivered_at: now,
            quantity_delivered,
            seller_attestation: Attestation {
                party_id: caller.clone(),
                signed_at: now,
                notes,
            },
            buyer_attestation: None,
            status: FulfillmentStatus::SellerAttested,
        };

        self.fulfillments.insert(fulfillment_id.clone(), fulfillment.clone());

        contract.status = ContractStatus::InFulfillment;
        contract.updated_at = now;
        self.contracts.insert(contract_id.clone(), contract.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(&fulfillment_id, &EventType::FulfillmentSellerAttested, now),
            event_type: EventType::FulfillmentSellerAttested,
            entity_type: EntityType::Fulfillment,
            entity_id: fulfillment_id.clone(),
            actor: caller.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&fulfillment),
        });

        fulfillment_id
    }

    /// Buyer attests to receiving delivery. Triggers settlement if no dispute.
    pub fn buyer_attest_delivery(
        &mut self,
        fulfillment_id: String,
        notes: Option<String>,
        deductions: Vec<Deduction>,
    ) -> String {
        let caller = env::predecessor_account_id();
        let mut fulfillment = self.fulfillments.get(&fulfillment_id).cloned().expect("Fulfillment not found");
        let mut contract = self.contracts.get(&fulfillment.contract_id).cloned().expect("Contract not found");

        assert_eq!(contract.buyer, caller, "Only buyer can attest receipt");
        assert_eq!(fulfillment.status, FulfillmentStatus::SellerAttested, "Awaiting seller attestation first");

        let now = self.now_ms();

        fulfillment.buyer_attestation = Some(Attestation {
            party_id: caller.clone(),
            signed_at: now,
            notes,
        });
        fulfillment.status = FulfillmentStatus::Complete;
        self.fulfillments.insert(fulfillment_id.clone(), fulfillment.clone());

        contract.status = ContractStatus::Delivered;
        contract.updated_at = now;
        self.contracts.insert(fulfillment.contract_id.clone(), contract.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(&fulfillment_id, &EventType::FulfillmentBuyerAttested, now),
            event_type: EventType::FulfillmentBuyerAttested,
            entity_type: EntityType::Fulfillment,
            entity_id: fulfillment_id.clone(),
            actor: caller.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&fulfillment),
        });

        // Trigger settlement
        self.execute_settlement(fulfillment_id.clone(), contract, deductions, None)
    }

    fn execute_settlement(
        &mut self,
        fulfillment_id: String,
        mut contract: TradeContract,
        deductions: Vec<Deduction>,
        dispute_loser: Option<AccountId>,
    ) -> String {
        let now = self.now_ms();
        let settlement_id = self.next_id_for("set-");

        let total_deductions: Amount = deductions.iter().map(|d| d.amount).sum();
        let net_amount = contract.total_value.saturating_sub(total_deductions);

        // TODO: Execute actual USDC transfer from escrow to seller.
        // When NEP-141 integration lands, call ft_transfer on the USDC contract
        // here with net_amount to contract.seller.
        let escrow_release_tx = format!("release-placeholder-{}", settlement_id);

        let settlement = Settlement {
            settlement_id: settlement_id.clone(),
            contract_id: contract.contract_id.clone(),
            fulfillment_id: fulfillment_id.clone(),
            gross_amount: contract.total_value,
            deductions,
            net_amount,
            escrow_release_tx,
            settled_at: now,
        };

        self.settlements.insert(settlement_id.clone(), settlement.clone());

        // Transfer lot ownership to buyer if this contract was backed by a lot
        if let Some(ref lot_id) = contract.lot_id {
            self.transfer_lot_ownership(
                lot_id,
                &contract.seller.clone(),
                &contract.buyer.clone(),
                contract.goods.quantity.milliamount,
                contract.goods.quantity.unit.clone(),
                &contract.contract_id.clone(),
                now,
            );
        }

        contract.status = ContractStatus::Settled;
        contract.updated_at = now;
        self.contracts.insert(contract.contract_id.clone(), contract.clone());

        // Update relationship record
        self.update_relationship(&contract.buyer.clone(), &contract.seller.clone(), net_amount, true, now);

        // Update reputation records; if a dispute was resolved, the losing party is marked disputed
        let buyer_disputed = dispute_loser.as_ref() == Some(&contract.buyer);
        let seller_disputed = dispute_loser.as_ref() == Some(&contract.seller);
        self.update_reputation(&contract.buyer, true, buyer_disputed, !buyer_disputed);
        self.update_reputation(&contract.seller, true, seller_disputed, !seller_disputed);

        self.emit(AuditEvent {
            event_id: make_event_id(&settlement_id, &EventType::SettlementCreated, now),
            event_type: EventType::SettlementCreated,
            entity_type: EntityType::Settlement,
            entity_id: settlement_id.clone(),
            actor: contract.buyer.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&settlement),
        });

        self.emit(AuditEvent {
            event_id: make_event_id(&settlement_id, &EventType::EscrowReleased, now),
            event_type: EventType::EscrowReleased,
            entity_type: EntityType::Settlement,
            entity_id: settlement_id.clone(),
            actor: "contract".to_string(),
            timestamp: now,
            payload_hash: hash_payload(&settlement.escrow_release_tx),
        });

        settlement_id
    }

    // -----------------------------------------------------------------------
    // Disputes
    // -----------------------------------------------------------------------

    /// Buyer initiates a dispute during the dispute window.
    pub fn initiate_dispute(&mut self, fulfillment_id: String, reason: String) {
        let caller = env::predecessor_account_id();
        let mut fulfillment = self.fulfillments.get(&fulfillment_id).cloned().expect("Fulfillment not found");
        let mut contract = self.contracts.get(&fulfillment.contract_id).cloned().expect("Contract not found");

        assert_eq!(contract.buyer, caller, "Only buyer can initiate dispute");
        assert!(
            matches!(
                contract.status,
                ContractStatus::InFulfillment | ContractStatus::Delivered
            ),
            "Contract not in disputable state"
        );

        let now = self.now_ms();

        // Enforce dispute window: buyer must dispute within dispute_window_hours of seller attestation
        let window_ms = contract.dispute_window_hours as u64 * 3_600_000;
        assert!(
            now <= fulfillment.seller_attestation.signed_at + window_ms,
            "Dispute window has closed; use trigger_auto_settlement instead"
        );

        fulfillment.status = FulfillmentStatus::Disputed;
        self.fulfillments.insert(fulfillment_id.clone(), fulfillment.clone());

        contract.status = ContractStatus::Disputed;
        contract.updated_at = now;
        self.contracts.insert(fulfillment.contract_id.clone(), contract.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(&fulfillment_id, &EventType::FulfillmentDisputed, now),
            event_type: EventType::FulfillmentDisputed,
            entity_type: EntityType::Fulfillment,
            entity_id: fulfillment_id,
            actor: caller.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&reason),
        });
    }

    /// Trigger automatic settlement once the dispute window has elapsed without a buyer response.
    /// Anyone may call this; the contract enforces that the window has actually passed.
    pub fn trigger_auto_settlement(&mut self, fulfillment_id: String) -> String {
        let fulfillment = self.fulfillments.get(&fulfillment_id).cloned()
            .expect("Fulfillment not found");
        let contract = self.contracts.get(&fulfillment.contract_id).cloned()
            .expect("Contract not found");

        assert_eq!(
            fulfillment.status,
            FulfillmentStatus::SellerAttested,
            "Fulfillment not awaiting buyer attestation"
        );

        let now = self.now_ms();
        let window_ms = contract.dispute_window_hours as u64 * 3_600_000;
        assert!(
            now > fulfillment.seller_attestation.signed_at + window_ms,
            "Dispute window has not elapsed yet"
        );

        self.execute_settlement(fulfillment_id, contract, vec![], None)
    }

    /// Arbitrator resolves a dispute in favour of buyer or seller.
    pub fn resolve_dispute(
        &mut self,
        contract_id: String,
        resolution: DisputeResolution,
        deductions: Vec<Deduction>,
    ) {
        let caller = env::predecessor_account_id();
        let contract = self.contracts.get(&contract_id).cloned().expect("Contract not found");

        // Must be designated arbitrator or protocol owner
        assert!(
            contract.arbitrator.as_ref().map(|a| a == &caller).unwrap_or(false)
                || caller == self.owner,
            "Only arbitrator can resolve dispute"
        );
        assert_eq!(contract.status, ContractStatus::Disputed, "Contract not disputed");

        let now = self.now_ms();

        // Find the fulfillment for this contract (linear scan, acceptable for pilot scale)
        let fulfillment_id = self.fulfillments
            .iter()
            .find(|(_, f)| f.contract_id == contract_id)
            .map(|(id, _)| id.clone())
            .expect("No fulfillment found for disputed contract");

        // Determine which party bears the dispute mark based on who the arbitrator ruled against
        let (dispute_loser, final_status, event_type) = match resolution {
            DisputeResolution::Buyer => (
                Some(contract.seller.clone()), // seller failed to perform
                ContractStatus::ResolvedBuyer,
                EventType::ContractResolvedBuyer,
            ),
            DisputeResolution::Seller => (
                Some(contract.buyer.clone()), // buyer filed a bad dispute
                ContractStatus::ResolvedSeller,
                EventType::ContractResolvedSeller,
            ),
        };

        self.execute_settlement(fulfillment_id, contract, deductions, dispute_loser);

        // execute_settlement sets status to Settled; overwrite with the correct resolution status
        let mut contract = self.contracts.get(&contract_id).cloned().expect("Contract not found");
        contract.status = final_status;
        contract.updated_at = now;
        self.contracts.insert(contract_id.clone(), contract);

        self.emit(AuditEvent {
            event_id: make_event_id(&contract_id, &event_type, now),
            event_type,
            entity_type: EntityType::Contract,
            entity_id: contract_id,
            actor: caller.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&"dispute_resolved"),
        });
    }

    // -----------------------------------------------------------------------
    // Standing Agreements
    // -----------------------------------------------------------------------

    /// Propose a standing agreement. Requires both parties to sign to activate.
    ///
    /// The proposer explicitly declares their role in the agreement (`proposer_role`).
    /// Any registered account can act as buyer or seller regardless of business type —
    /// role is determined per-agreement, not stamped on the account at registration.
    pub fn propose_standing_agreement(
        &mut self,
        proposer_role: ProposerRole,
        counterparty: AccountId,
        goods: GoodsSpec,
        period_start: u64,
        period_end: u64,
        volume_commitment: VolumeCommitment,
        pricing: SellerPricing,
        delivery_cadence: Option<String>,
        renewal: RenewalPolicy,
    ) -> String {
        let proposer = env::predecessor_account_id();
        self.require_party(&proposer);
        self.require_party(&counterparty);

        let agreement_id = self.next_id_for("agr-");
        let now = self.now_ms();

        // Proposer signs their side immediately; counterparty signs via sign_standing_agreement()
        let (buyer, seller, buyer_signed, seller_signed) = match proposer_role {
            ProposerRole::Buyer  => (proposer.clone(), counterparty, Some(now), None),
            ProposerRole::Seller => (counterparty, proposer.clone(), None, Some(now)),
        };

        let agreement = StandingAgreement {
            agreement_id: agreement_id.clone(),
            version: self.protocol_version.clone(),
            buyer,
            seller,
            goods,
            period_start,
            period_end,
            volume_commitment,
            pricing,
            delivery_cadence,
            renewal,
            status: AgreementStatus::Proposed,
            buyer_signed_at: buyer_signed,
            seller_signed_at: seller_signed,
            created_at: now,
        };

        self.standing_agreements.insert(agreement_id.clone(), agreement.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(&agreement_id, &EventType::AgreementProposed, now),
            event_type: EventType::AgreementProposed,
            entity_type: EntityType::StandingAgreement,
            entity_id: agreement_id.clone(),
            actor: proposer.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&agreement),
        });

        agreement_id
    }

    /// Sign and activate a standing agreement. Once both parties sign, status → Active.
    pub fn sign_standing_agreement(&mut self, agreement_id: String) {
        let caller = env::predecessor_account_id();
        let mut agreement = self.standing_agreements.get(&agreement_id).cloned().expect("Agreement not found");
        let now = self.now_ms();

        if agreement.buyer == caller {
            assert!(agreement.buyer_signed_at.is_none(), "Buyer already signed");
            agreement.buyer_signed_at = Some(now);
        } else if agreement.seller == caller {
            assert!(agreement.seller_signed_at.is_none(), "Seller already signed");
            agreement.seller_signed_at = Some(now);
        } else {
            panic!("Caller is not a party to this agreement");
        }

        // Activate if both parties have signed
        if agreement.buyer_signed_at.is_some() && agreement.seller_signed_at.is_some() {
            agreement.status = AgreementStatus::Active;

            // Update relationship record to reflect the standing agreement
            let rel_key = RelationshipRecord::key(&agreement.buyer, &agreement.seller);
            if let Some(mut rel) = self.relationships.get(&rel_key).cloned() {
                if !rel.standing_agreement_ids.contains(&agreement_id) {
                    rel.standing_agreement_ids.push(agreement_id.clone());
                    rel.tier = RelationshipTier::derive(
                        rel.trades_completed,
                        rel.total_volume,
                        !rel.standing_agreement_ids.is_empty(),
                    );
                    rel.updated_at = now;
                    self.relationships.insert(rel_key.clone(), rel.clone());
                }
            }

            self.emit(AuditEvent {
                event_id: make_event_id(&agreement_id, &EventType::AgreementActivated, now),
                event_type: EventType::AgreementActivated,
                entity_type: EntityType::StandingAgreement,
                entity_id: agreement_id.clone(),
                actor: caller.to_string(),
                timestamp: now,
                payload_hash: hash_payload(&agreement),
            });
        }

        self.standing_agreements.insert(agreement_id.clone(), agreement.clone());
    }

    // -----------------------------------------------------------------------
    // Goods catalog
    // -----------------------------------------------------------------------

    /// Create a new catalog entry. The caller becomes the owner.
    /// catalog_id, owner, version, and timestamps are assigned by the contract.
    pub fn create_catalog_entry(&mut self, entry: GoodsCatalogEntry) -> String {
        let owner = env::predecessor_account_id();
        self.require_party(&owner);

        let catalog_id = self.next_id_for("cat-");
        let now = self.now_ms();

        let mut entry = entry;
        entry.catalog_id = catalog_id.clone();
        entry.owner = owner.clone();
        entry.version = 1;
        entry.created_at = now;
        entry.updated_at = now;

        self.catalogs.insert(catalog_id.clone(), entry.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(&catalog_id, &EventType::CatalogEntryCreated, now),
            event_type: EventType::CatalogEntryCreated,
            entity_type: EntityType::Catalog,
            entity_id: catalog_id.clone(),
            actor: owner.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&entry),
        });

        catalog_id
    }

    /// Update an existing catalog entry. Caller must be the owner or an authorized agent.
    /// Bumps version and updated_at; catalog_id and owner are immutable.
    pub fn update_catalog_entry(&mut self, catalog_id: String, entry: GoodsCatalogEntry) {
        let mut existing = self.catalogs.get(&catalog_id).cloned().expect("Catalog entry not found");
        self.require_party_or_agent(&existing.owner);

        let now = self.now_ms();
        let mut entry = entry;
        entry.catalog_id = existing.catalog_id.clone();
        entry.owner = existing.owner.clone();
        entry.version = existing.version + 1;
        entry.created_at = existing.created_at;
        entry.updated_at = now;
        existing = entry;

        self.catalogs.insert(catalog_id.clone(), existing.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(&catalog_id, &EventType::CatalogEntryUpdated, now),
            event_type: EventType::CatalogEntryUpdated,
            entity_type: EntityType::Catalog,
            entity_id: catalog_id.clone(),
            actor: env::predecessor_account_id().to_string(),
            timestamp: now,
            payload_hash: hash_payload(&existing),
        });
    }

    // -----------------------------------------------------------------------
    // Goods lots
    // -----------------------------------------------------------------------

    /// Bring a new goods lot on-chain. Caller must be a registered party.
    /// lot_id, owner, available_milliamount, provenance, status, and timestamps
    /// are assigned by the contract; all other fields are caller-provided.
    pub fn create_lot(&mut self, lot: GoodsLot) -> String {
        let owner = env::predecessor_account_id();
        self.require_party(&owner);
        assert!(
            self.catalogs.contains_key(&lot.catalog_id),
            "Catalog entry not found"
        );
        assert!(lot.total_milliamount > 0, "Lot quantity must be > 0");

        let lot_id = self.next_id_for("lot-");
        let now = self.now_ms();

        let mut lot = lot;
        lot.lot_id = lot_id.clone();
        lot.owner = owner.clone();
        lot.origin_account = owner.clone();
        lot.available_milliamount = lot.total_milliamount;
        lot.provenance = vec![];
        lot.status = LotStatus::Available;
        lot.created_at = now;
        lot.updated_at = now;

        self.lots.insert(lot_id.clone(), lot.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(&lot_id, &EventType::LotCreated, now),
            event_type: EventType::LotCreated,
            entity_type: EntityType::Lot,
            entity_id: lot_id.clone(),
            actor: owner.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&lot),
        });

        lot_id
    }

    /// Dispose of a lot (Spoiled, Donated, or Recalled). Caller must be the
    /// owner or an authorized agent. Only available if lot has no active allocations.
    pub fn dispose_lot(&mut self, lot_id: String, disposition: LotStatus, notes: Option<String>) {
        let mut lot = self.lots.get(&lot_id).cloned().expect("Lot not found");
        self.require_party_or_agent(&lot.owner);
        assert!(
            matches!(disposition, LotStatus::Spoiled | LotStatus::Donated | LotStatus::Recalled),
            "disposition must be Spoiled, Donated, or Recalled"
        );
        assert!(
            matches!(lot.status, LotStatus::Available | LotStatus::PartiallyAllocated),
            "Lot cannot be disposed in current status"
        );

        let now = self.now_ms();
        lot.status = disposition;
        lot.updated_at = now;
        self.lots.insert(lot_id.clone(), lot.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(&lot_id, &EventType::LotDisposed, now),
            event_type: EventType::LotDisposed,
            entity_type: EntityType::Lot,
            entity_id: lot_id.clone(),
            actor: env::predecessor_account_id().to_string(),
            timestamp: now,
            payload_hash: hash_payload(&notes),
        });
    }

    /// Allocate quantity from a lot when a contract is formed.
    /// Decrements available_milliamount and updates status.
    fn allocate_lot(&mut self, lot_id: &str, milliamount: u64) {
        let mut lot = self.lots.get(lot_id).cloned().expect("Lot not found");
        assert!(
            lot.available_milliamount >= milliamount,
            "Insufficient lot quantity available"
        );
        lot.available_milliamount -= milliamount;
        lot.status = if lot.available_milliamount == 0 {
            LotStatus::FullyAllocated
        } else {
            LotStatus::PartiallyAllocated
        };
        lot.updated_at = self.now_ms();
        self.lots.insert(lot_id.to_string(), lot);
    }

    /// Transfer lot ownership to the buyer at settlement.
    /// Appends a ProvenanceEvent and updates owner and status.
    fn transfer_lot_ownership(
        &mut self,
        lot_id: &str,
        from: &AccountId,
        to: &AccountId,
        milliamount: u64,
        unit: String,
        contract_id: &str,
        now: u64,
    ) {
        let mut lot = self.lots.get(lot_id).cloned().expect("Lot not found");
        lot.owner = to.clone();
        lot.status = LotStatus::Fulfilled;
        lot.updated_at = now;
        lot.provenance.push(ProvenanceEvent {
            from: from.clone(),
            to: to.clone(),
            milliamount,
            unit,
            contract_id: contract_id.to_string(),
            timestamp: now,
        });
        self.lots.insert(lot_id.to_string(), lot.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(lot_id, &EventType::LotOwnershipTransferred, now),
            event_type: EventType::LotOwnershipTransferred,
            entity_type: EntityType::Lot,
            entity_id: lot_id.to_string(),
            actor: contract_id.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&lot),
        });
    }

    // -----------------------------------------------------------------------
    // Finance pool registry
    // -----------------------------------------------------------------------

    /// Register a new DeFi liquidity pool. Owner only.
    /// The pool_account is the NEAR contract authorized to call confirm_financing.
    pub fn register_finance_pool(
        &mut self,
        pool_id: String,
        pool_account: AccountId,
        max_rate_bps: u16,
        available_microdollars: u128,
    ) {
        let caller = env::predecessor_account_id();
        assert_eq!(caller, self.owner, "Owner only");
        assert!(!self.finance_pools.contains_key(&pool_id), "Pool already registered");
        assert!(max_rate_bps <= 5000, "max_rate_bps must be <= 5000 (50%)");

        let now = self.now_ms();
        let pool = FinancePool {
            pool_id: pool_id.clone(),
            pool_account: pool_account.clone(),
            max_rate_bps,
            available_microdollars,
            deployed_microdollars: 0,
            active: true,
            created_at: now,
            updated_at: now,
        };

        self.finance_pools.insert(pool_id.clone(), pool.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(&pool_id, &EventType::FinancePoolRegistered, now),
            event_type: EventType::FinancePoolRegistered,
            entity_type: EntityType::FinancePool,
            entity_id: pool_id,
            actor: caller.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&pool),
        });
    }

    /// Called by the registered pool_account to confirm it has funded a contract.
    /// The pool emits this after transferring capital; DTP records the confirmation
    /// and the contract can proceed knowing financing is in place.
    pub fn confirm_financing(&mut self, contract_id: String, pool_id: String) {
        let caller = env::predecessor_account_id();
        let pool = self.finance_pools.get(&pool_id).cloned().expect("Finance pool not found");
        assert_eq!(caller, pool.pool_account, "Only pool_account can confirm financing");
        assert!(pool.active, "Finance pool is not active");

        let contract = self.contracts.get(&contract_id).cloned().expect("Contract not found");
        assert!(
            matches!(contract.finance.as_ref().map(|f| &f.financing_mode),
                Some(FinancingMode::LpPool)),
            "Contract does not use LP pool financing"
        );

        let now = self.now_ms();
        self.emit(AuditEvent {
            event_id: make_event_id(&contract_id, &EventType::FinancingConfirmed, now),
            event_type: EventType::FinancingConfirmed,
            entity_type: EntityType::Contract,
            entity_id: contract_id.clone(),
            actor: caller.to_string(),
            timestamp: now,
            payload_hash: hash_payload(&pool_id),
        });
    }

    pub fn get_finance_pool(&self, pool_id: String) -> Option<FinancePool> {
        self.finance_pools.get(&pool_id).cloned()
    }

    // -----------------------------------------------------------------------
    // Matching helpers (read-only)
    // -----------------------------------------------------------------------

    /// Check if a listing is eligible to match an intent and return a score.
    pub fn check_match(&self, intent_id: String, listing_id: String) -> MatchResult {
        let intent = self.intents.get(&intent_id).cloned().expect("Intent not found");
        let listing = self.listings.get(&listing_id).cloned().expect("Listing not found");
        let seller_rep = self.parties.get(&listing.seller)
            .map(|p| p.reputation.score);
        // Resolve the catalog_id of the lot backing this listing, if any
        let listing_catalog_id = listing.lot_id.as_ref()
            .and_then(|lid| self.lots.get(lid))
            .map(|lot| lot.catalog_id.clone());
        let result = matching::check_listing_vs_intent(
            &intent, &listing, self.now_ms(), seller_rep, listing_catalog_id,
        );
        MatchResult {
            eligible: result.eligible,
            score: result.score,
            reasons: result.reasons,
        }
    }

    // -----------------------------------------------------------------------
    // Bidirectional match discovery
    // -----------------------------------------------------------------------

    /// Given a buyer's intent, scan all active listings and return eligible
    /// matches sorted by score descending.  Pagination is applied after
    /// sorting so the caller always gets the best matches at offset 0.
    ///
    /// Only listings with status Active are considered.
    pub fn find_matches_for_intent(
        &self,
        intent_id: String,
        offset: u64,
        limit: u64,
    ) -> Vec<RankedMatch> {
        let intent = self.intents.get(&intent_id).cloned().expect("Intent not found");
        let now = self.now_ms();

        let mut matches: Vec<RankedMatch> = self
            .listings
            .iter()
            .filter(|(_, l)| l.status == ListingStatus::Active)
            .filter_map(|(listing_id, listing)| {
                let seller_rep = self.parties.get(&listing.seller).map(|p| p.reputation.score);
                let listing_catalog_id = listing.lot_id.as_ref()
                    .and_then(|lid| self.lots.get(lid))
                    .map(|lot| lot.catalog_id.clone());
                let result = matching::check_listing_vs_intent(
                    &intent, listing, now, seller_rep, listing_catalog_id,
                );
                if result.eligible {
                    Some(RankedMatch {
                        intent_id: intent_id.clone(),
                        listing_id: listing_id.clone(),
                        score: result.score,
                        reasons: vec![],
                    })
                } else {
                    None
                }
            })
            .collect();

        matches.sort_by(|a, b| b.score.cmp(&a.score));
        matches
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .collect()
    }

    /// Given a seller's listing, scan all posted intents and return eligible
    /// matches sorted by score descending.
    ///
    /// Only intents with status Posted are considered.
    pub fn find_matches_for_listing(
        &self,
        listing_id: String,
        offset: u64,
        limit: u64,
    ) -> Vec<RankedMatch> {
        let listing = self.listings.get(&listing_id).cloned().expect("Listing not found");
        let now = self.now_ms();
        let seller_rep = self.parties.get(&listing.seller).map(|p| p.reputation.score);
        let listing_catalog_id = listing.lot_id.as_ref()
            .and_then(|lid| self.lots.get(lid))
            .map(|lot| lot.catalog_id.clone());

        let mut matches: Vec<RankedMatch> = self
            .intents
            .iter()
            .filter(|(_, i)| i.status == IntentStatus::Posted)
            .filter_map(|(intent_id, intent)| {
                let result = matching::check_listing_vs_intent(
                    intent, &listing, now, seller_rep, listing_catalog_id.clone(),
                );
                if result.eligible {
                    Some(RankedMatch {
                        intent_id: intent_id.clone(),
                        listing_id: listing_id.clone(),
                        score: result.score,
                        reasons: vec![],
                    })
                } else {
                    None
                }
            })
            .collect();

        matches.sort_by(|a, b| b.score.cmp(&a.score));
        matches
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .collect()
    }

    /// Return tier comparison data for a buyer considering a listing.
    pub fn get_tier_comparisons(&self, intent_id: String, listing_id: String) -> Vec<TierComparisonResult> {
        let intent = self.intents.get(&intent_id).cloned().expect("Intent not found");
        let listing = self.listings.get(&listing_id).cloned().expect("Listing not found");
        let comparisons = matching::compute_tier_comparisons(&intent, &listing);
        comparisons.into_iter().map(|c| TierComparisonResult {
            label: c.label,
            price_per_unit: c.price_per_unit,
            total_price: c.total_price,
            pct_savings_vs_asking: c.pct_savings_vs_asking,
        }).collect()
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    pub fn get_party(&self, account: AccountId) -> Option<Party> {
        self.parties.get(&account).cloned()
    }

    pub fn get_catalog_entry(&self, catalog_id: String) -> Option<GoodsCatalogEntry> {
        self.catalogs.get(&catalog_id).cloned()
    }

    pub fn get_lot(&self, lot_id: String) -> Option<GoodsLot> {
        self.lots.get(&lot_id).cloned()
    }

    pub fn get_intent(&self, intent_id: String) -> Option<TradeIntent> {
        self.intents.get(&intent_id).cloned()
    }

    pub fn get_listing(&self, listing_id: String) -> Option<SupplyListing> {
        self.listings.get(&listing_id).cloned()
    }

    pub fn get_offer(&self, offer_id: String) -> Option<Offer> {
        self.offers.get(&offer_id).cloned()
    }

    pub fn get_contract(&self, contract_id: String) -> Option<TradeContract> {
        self.contracts.get(&contract_id).cloned()
    }

    pub fn get_fulfillment(&self, fulfillment_id: String) -> Option<Fulfillment> {
        self.fulfillments.get(&fulfillment_id).cloned()
    }

    pub fn get_settlement(&self, settlement_id: String) -> Option<Settlement> {
        self.settlements.get(&settlement_id).cloned()
    }

    pub fn get_relationship(&self, party_a: AccountId, party_b: AccountId) -> Option<RelationshipRecord> {
        let key = RelationshipRecord::key(&party_a, &party_b);
        self.relationships.get(&key).cloned()
    }

    pub fn get_standing_agreement(&self, agreement_id: String) -> Option<StandingAgreement> {
        self.standing_agreements.get(&agreement_id).cloned()
    }

    // -----------------------------------------------------------------------
    // Account summary (portable account snapshot)
    // -----------------------------------------------------------------------

    /// Returns the full on-chain snapshot of an account.
    /// Any DTP-compatible platform can call this to read an account's
    /// complete state without a custom connector.
    /// Returns None if the account is not a registered party.
    pub fn get_account_summary(&self, account: AccountId) -> Option<AccountSummary> {
        let party = self.parties.get(&account).cloned()?;

        let catalog_count = self.catalogs.iter()
            .filter(|(_, e)| e.owner == account)
            .count() as u64;

        let lots_owned = self.lots.iter()
            .filter(|(_, l)| l.owner == account)
            .count() as u64;

        let active_listings = self.listings.iter()
            .filter(|(_, l)| l.seller == account && l.status == ListingStatus::Active)
            .count() as u64;

        let active_intents = self.intents.iter()
            .filter(|(_, i)| i.buyer == account && i.status == IntentStatus::Posted)
            .count() as u64;

        let open_contracts = self.contracts.iter()
            .filter(|(_, c)| {
                (c.buyer == account || c.seller == account)
                    && !matches!(c.status, ContractStatus::Settled
                        | ContractStatus::ResolvedBuyer
                        | ContractStatus::ResolvedSeller
                        | ContractStatus::Cancelled)
            })
            .count() as u64;

        // Total volume: sum all settlements where account was buyer or seller
        let total_volume_microdollars = self.settlements.iter()
            .filter_map(|(_, s)| {
                self.contracts.get(&s.contract_id)
                    .filter(|c| c.buyer == account || c.seller == account)
                    .map(|_| s.net_amount)
            })
            .fold(0u128, |acc, v| acc.saturating_add(v));

        Some(AccountSummary {
            party: party.clone(),
            catalog_count,
            lots_owned,
            active_listings,
            active_intents,
            open_contracts,
            total_trades: party.reputation.trades_completed,
            total_volume_microdollars,
            protocol_version: self.protocol_version.clone(),
            queried_at: self.now_ms(),
        })
    }

    /// Paginated list of catalog entries owned by an account.
    pub fn get_account_catalogs(
        &self,
        account: AccountId,
        offset: u64,
        limit: u64,
    ) -> Vec<GoodsCatalogEntry> {
        self.catalogs.iter()
            .filter(|(_, e)| e.owner == account)
            .skip(offset as usize)
            .take(limit as usize)
            .map(|(_, e)| e.clone())
            .collect()
    }

    /// Paginated list of lots currently owned by an account.
    pub fn get_account_lots(
        &self,
        account: AccountId,
        offset: u64,
        limit: u64,
    ) -> Vec<GoodsLot> {
        self.lots.iter()
            .filter(|(_, l)| l.owner == account)
            .skip(offset as usize)
            .take(limit as usize)
            .map(|(_, l)| l.clone())
            .collect()
    }

    /// Paginated list of active supply listings for an account.
    pub fn get_account_listings(
        &self,
        account: AccountId,
        offset: u64,
        limit: u64,
    ) -> Vec<SupplyListing> {
        self.listings.iter()
            .filter(|(_, l)| l.seller == account)
            .skip(offset as usize)
            .take(limit as usize)
            .map(|(_, l)| l.clone())
            .collect()
    }

    /// Paginated list of posted trade intents for an account.
    pub fn get_account_intents(
        &self,
        account: AccountId,
        offset: u64,
        limit: u64,
    ) -> Vec<TradeIntent> {
        self.intents.iter()
            .filter(|(_, i)| i.buyer == account)
            .skip(offset as usize)
            .take(limit as usize)
            .map(|(_, i)| i.clone())
            .collect()
    }

    /// Paginated list of contracts (as buyer or seller) for an account.
    pub fn get_account_contracts(
        &self,
        account: AccountId,
        offset: u64,
        limit: u64,
    ) -> Vec<TradeContract> {
        self.contracts.iter()
            .filter(|(_, c)| c.buyer == account || c.seller == account)
            .skip(offset as usize)
            .take(limit as usize)
            .map(|(_, c)| c.clone())
            .collect()
    }

    /// Get paginated audit trail entries for a specific entity.
    pub fn get_audit_trail(&self, entity_id: String, offset: u64, limit: u64) -> Vec<AuditEvent> {
        let indices = self.audit_index.get(&entity_id).cloned().unwrap_or_default();
        let start = (offset as usize).min(indices.len());
        let end = ((offset + limit) as usize).min(indices.len());
        indices[start..end]
            .iter()
            .map(|&i| self.audit_log.get(i).cloned().unwrap())
            .collect()
    }

    // -----------------------------------------------------------------------
    // Internal: reputation + relationship updates
    // -----------------------------------------------------------------------

    fn update_reputation(&mut self, account: &AccountId, completed: bool, disputed: bool, on_time: bool) {
        if let Some(mut party) = self.parties.get(account).cloned() {
            if completed { party.reputation.trades_completed += 1; }
            if disputed  { party.reputation.trades_disputed += 1; }
            if on_time   { party.reputation.trades_settled_on_time += 1; }
            party.reputation.last_updated = self.now_ms();
            party.reputation.recompute();
            self.parties.insert(account.clone(), party);
        }
    }

    fn update_relationship(
        &mut self,
        buyer: &AccountId,
        seller: &AccountId,
        volume: Amount,
        on_time: bool,
        now: u64,
    ) {
        let key = RelationshipRecord::key(buyer, seller);
        let mut rel = self.relationships.get(&key).cloned().unwrap_or_else(|| RelationshipRecord {
            relationship_id: key.clone(),
            party_a: buyer.clone(),
            party_b: seller.clone(),
            first_trade_at: now,
            last_trade_at: now,
            trades_completed: 0,
            total_volume: 0,
            dispute_rate_bp: 0,
            on_time_delivery_rate_bp: 10000,
            tier: RelationshipTier::New,
            standing_agreement_ids: vec![],
            updated_at: now,
        });

        rel.trades_completed += 1;
        rel.total_volume += volume;
        rel.last_trade_at = now;
        rel.updated_at = now;

        // Update on-time delivery rate as a running weighted average (basis points)
        let n = rel.trades_completed as u64;
        let prev = rel.on_time_delivery_rate_bp as u64;
        rel.on_time_delivery_rate_bp = if on_time {
            ((prev * (n - 1) + 10_000) / n) as u32
        } else {
            ((prev * (n - 1)) / n) as u32
        };

        rel.tier = RelationshipTier::derive(
            rel.trades_completed,
            rel.total_volume,
            !rel.standing_agreement_ids.is_empty(),
        );

        self.relationships.insert(key.clone(), rel.clone());

        self.emit(AuditEvent {
            event_id: make_event_id(&key, &EventType::RelationshipTierUpdated, now),
            event_type: EventType::RelationshipTierUpdated,
            entity_type: EntityType::Relationship,
            entity_id: key,
            actor: "contract".to_string(),
            timestamp: now,
            payload_hash: hash_payload(&rel.tier),
        });
    }
}

// ---------------------------------------------------------------------------
// Return types for view methods
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, BorshDeserialize, BorshSerialize)]
#[serde(crate = "near_sdk::serde")]
#[borsh(crate = "near_sdk::borsh")]
pub struct MatchResult {
    pub eligible: bool,
    pub score: u32,
    pub reasons: Vec<String>,
}

/// A single entry in a bidirectional match-discovery result set.
/// Returned by find_matches_for_intent and find_matches_for_listing,
/// sorted by score descending (best match first).
#[derive(Serialize, Deserialize, BorshDeserialize, BorshSerialize)]
#[serde(crate = "near_sdk::serde")]
#[borsh(crate = "near_sdk::borsh")]
pub struct RankedMatch {
    pub intent_id: String,
    pub listing_id: String,
    /// Composite match score 0–10000 (higher is better).
    pub score: u32,
    /// Reserved for future use (ineligible results with failure reasons).
    pub reasons: Vec<String>,
}

#[derive(Serialize, Deserialize, BorshDeserialize, BorshSerialize)]
#[serde(crate = "near_sdk::serde")]
#[borsh(crate = "near_sdk::borsh")]
pub struct TierComparisonResult {
    pub label: String,
    pub price_per_unit: u128,
    pub total_price: u128,
    pub pct_savings_vs_asking: i32,
}

/// Portable account snapshot returned by get_account_summary.
/// This is the DTP "plug-in" read surface — any DTP-compatible platform
/// can call this to get the full picture of an account's on-chain state.
#[derive(Serialize, Deserialize, BorshDeserialize, BorshSerialize)]
#[serde(crate = "near_sdk::serde")]
#[borsh(crate = "near_sdk::borsh")]
pub struct AccountSummary {
    pub party: Party,
    /// Counts of active/owned entities (use paginated queries for full lists)
    pub catalog_count: u64,
    pub lots_owned: u64,
    pub active_listings: u64,
    pub active_intents: u64,
    /// Contracts where this account is buyer or seller, not yet settled
    pub open_contracts: u64,
    /// Total completed trades (from reputation record)
    pub total_trades: u32,
    /// Total settled volume in microdollars (1 USDC = 1_000_000)
    pub total_volume_microdollars: u128,
    pub protocol_version: String,
    pub queried_at: u64,
}

#[derive(Serialize, Deserialize, BorshDeserialize, BorshSerialize)]
#[serde(crate = "near_sdk::serde")]
#[borsh(crate = "near_sdk::borsh")]
pub enum DisputeResolution {
    Buyer,
    Seller,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner() -> AccountId {
        "owner.testnet".parse().unwrap()
    }

    fn sample_pack() -> PackDefinition {
        PackDefinition {
            trade_unit: "lb".to_string(),
            case_weight: Some(Quantity::new(30_000, "lb")),
            each: None,
            case: None,
            pallet: None,
        }
    }

    fn sample_catalog_entry() -> GoodsCatalogEntry {
        GoodsCatalogEntry {
            catalog_id: String::new(),
            owner: owner(),
            version: 0,
            gtin: None,
            brand: None,
            product_name: "Organic IQF Blueberries".to_string(),
            internal_sku: Some("SKU-001".to_string()),
            category: "food.produce.berries.blueberries".to_string(),
            commodity: Some("blueberries".to_string()),
            variety: Some("Duke".to_string()),
            grade: Some("USDA Fancy".to_string()),
            growing_region: None,
            country_of_origin: Some("US".to_string()),
            preparation: Some(Preparation::IQF),
            storage_condition: StorageCondition::Frozen,
            shelf_life_days: Some(365),
            pack: sample_pack(),
            catch_weight: false,
            ingredients: None,
            allergens: vec![],
            nutrition_hash: None,
            certifications: vec![],
            attributes: vec![],
            media_hashes: vec![],
            created_at: 0,
            updated_at: 0,
        }
    }

    fn sample_lot(catalog_id: String) -> GoodsLot {
        GoodsLot {
            lot_id: String::new(),
            owner: owner(),
            available_milliamount: 0,
            provenance: vec![],
            status: LotStatus::Available,
            created_at: 0,
            updated_at: 0,
            catalog_id,
            origin_account: owner(),
            total_milliamount: 500_000, // 500 lb
            unit: "lb".to_string(),
            lot_number: Some("LOT-2026-001".to_string()),
            pack_date: None,
            harvest_date: None,
            best_by: None,
            lot_certifications: vec![],
            input_lots: vec![],
        }
    }

    fn sample_finance(net_days: u16, paca_covered: bool) -> FinanceTerms {
        FinanceTerms {
            payment_timing: PaymentTiming::DeliveryAttestation,
            net_days,
            paca_covered,
            financing_mode: FinancingMode::LpPool,
            liquidity_pool_id: Some("default-lp".to_string()),
            financer_id: None,
            finance_fee_bps: 250,
        }
    }

    #[test]
    #[should_panic(expected = "PACA-covered trades must have net_days <= 30")]
    fn finance_validation_enforces_paca_cap() {
        let c = DTPContract::new(owner());
        let finance = Some(sample_finance(45, true));
        c.validate_finance_terms(&finance);
    }

    #[test]
    fn finance_validation_accepts_non_paca_sixty_days() {
        let c = DTPContract::new(owner());
        let finance = Some(sample_finance(60, false));
        c.validate_finance_terms(&finance);
    }

    #[test]
    #[should_panic(expected = "freight_allowance cannot exceed estimated_freight")]
    fn freight_validation_rejects_over_allowance() {
        let c = DTPContract::new(owner());
        let freight = Some(FreightTerms {
            payer: FreightPayer::Buyer,
            estimated_freight: 100,
            freight_allowance: 101,
            quote_source: FreightQuoteSource::ManualEstimate,
            quote_ref: None,
            quoted_at: 10,
            quote_expires_at: 20,
            booked_at_contract: false,
        });
        c.validate_freight_terms(&freight);
    }

    fn setup_with_party() -> DTPContract {
        near_sdk::testing_env!(near_sdk::test_utils::VMContextBuilder::new()
            .predecessor_account_id(owner())
            .build());
        let mut c = DTPContract::new(owner());
        c.parties.insert(owner(), Party {
            party_id: owner(),
            business_name: "Acme Foods".to_string(),
            business_type: BusinessType::Producer,
            jurisdiction: "US".to_string(),
            kyb: None,
            certifications: vec![],
            reputation: ReputationRecord::default(),
            authorized_agents: vec![],
            created_at: 0,
        });
        c
    }

    #[test]
    fn catalog_entry_creation_assigns_system_fields() {
        let mut c = setup_with_party();
        let id = c.create_catalog_entry(sample_catalog_entry());
        let stored = c.get_catalog_entry(id.clone()).unwrap();
        assert!(id.starts_with("cat-"), "ID should have cat- prefix, got {}", id);
        assert_eq!(stored.catalog_id, id);
        assert_eq!(stored.version, 1);
        assert_eq!(stored.product_name, "Organic IQF Blueberries");
        assert_eq!(stored.preparation, Some(Preparation::IQF));
    }

    #[test]
    fn lot_creation_sets_available_equal_to_total() {
        let mut c = setup_with_party();
        let catalog_id = c.create_catalog_entry(sample_catalog_entry());
        let lot_id = c.create_lot(sample_lot(catalog_id));
        let stored = c.get_lot(lot_id.clone()).unwrap();
        assert!(lot_id.starts_with("lot-"), "ID should have lot- prefix");
        assert_eq!(stored.status, LotStatus::Available);
        assert_eq!(stored.available_milliamount, 500_000);
        assert_eq!(stored.total_milliamount, 500_000);
    }

    #[test]
    fn lot_allocation_decrements_available() {
        let mut c = setup_with_party();
        let catalog_id = c.create_catalog_entry(sample_catalog_entry());
        let lot_id = c.create_lot(sample_lot(catalog_id));
        c.allocate_lot(&lot_id, 200_000); // 200 lb
        let stored = c.get_lot(lot_id).unwrap();
        assert_eq!(stored.available_milliamount, 300_000);
        assert_eq!(stored.status, LotStatus::PartiallyAllocated);
    }

    #[test]
    #[should_panic(expected = "Insufficient lot quantity available")]
    fn lot_allocation_rejects_over_quantity() {
        let mut c = setup_with_party();
        let catalog_id = c.create_catalog_entry(sample_catalog_entry());
        let lot_id = c.create_lot(sample_lot(catalog_id));
        c.allocate_lot(&lot_id, 600_000); // more than 500 lb total
    }

    fn sample_goods_spec(qty_milliamount: u64, ceiling_or_ask: u128) -> (GoodsSpec, DeliverySpec, BuyerPricing, SellerPricing) {
        let goods = GoodsSpec {
            category: "food.produce.berries".to_string(),
            product_name: "IQF Blueberries".to_string(),
            description: "Frozen blueberries".to_string(),
            product_type: ProductType::Commodity,
            commodity_details: None,
            branded_details: None,
            value_added_details: None,
            quantity: Quantity::new(qty_milliamount, "lb"),
            grade: "USDA Fancy".to_string(),
            quality_specs: vec![],
            required_certifications: vec![],
            packaging: "case".to_string(),
            shelf_life_days: None,
        };
        // delivery window: 2000..4000 ms (test epoch)
        let delivery = DeliverySpec {
            destination_city: "Portland".to_string(),
            destination_state: "OR".to_string(),
            destination_zip: "97201".to_string(),
            destination_country: "US".to_string(),
            window_earliest: 2000,
            window_latest: 4000,
            method: DeliveryMethod::Delivered,
            temperature: None,
            notes: None,
        };
        let buyer_pricing = BuyerPricing { ceiling_price_per_unit: ceiling_or_ask };
        let seller_pricing = SellerPricing {
            model: PricingModel::Flat,
            asking_price_per_unit: ceiling_or_ask,
            tiers: vec![],
        };
        (goods, delivery, buyer_pricing, seller_pricing)
    }

    fn insert_intent(c: &mut DTPContract, buyer: AccountId, qty: u64, ceiling: u128, expires_at: u64) -> String {
        let (goods, delivery, pricing, _) = sample_goods_spec(qty, ceiling);
        let id = format!("int-test-{}", c.intents.len());
        let intent = TradeIntent {
            intent_id: id.clone(),
            version: "0.1".to_string(),
            buyer,
            catalog_id: None,
            goods,
            delivery,
            pricing,
            finance: None,
            freight: None,
            expires_at,
            status: IntentStatus::Posted,
            created_at: 0,
            updated_at: 0,
        };
        c.intents.insert(id.clone(), intent);
        id
    }

    fn insert_listing(c: &mut DTPContract, seller: AccountId, qty: u64, ask: u128, expires_at: u64) -> String {
        let (goods, delivery, _, pricing) = sample_goods_spec(qty, ask);
        let id = format!("lst-test-{}", c.listings.len());
        let listing = SupplyListing {
            listing_id: id.clone(),
            version: "0.1".to_string(),
            seller,
            lot_id: None,
            goods,
            pack_structure: PackStructure {
                unit_size: Quantity::new(1000, "lb"),
                units_per_case: 1,
                cases_per_pallet: 40,
                pallets_per_truckload: None,
                moq: Quantity::new(1000, "lb"),
                moq_label: "1 lb".to_string(),
            },
            delivery,
            pricing,
            finance: None,
            freight: None,
            certifications: vec![],
            available_from: 0,
            expires_at,
            status: ListingStatus::Active,
            created_at: 0,
        };
        c.listings.insert(id.clone(), listing);
        id
    }

    #[test]
    fn find_matches_for_intent_returns_eligible_listings() {
        let mut c = setup_with_party();
        let seller: AccountId = "seller.testnet".parse().unwrap();

        // Intent: 100 lb, ceiling $2.00/lb (2_000_000 microdollars), expires far future
        let intent_id = insert_intent(&mut c, owner(), 100_000, 2_000_000, u64::MAX);

        // Matching listing: 200 lb (≥100), ask $1.80 (≤$2.00 ceiling), overlapping window
        let _good_id = insert_listing(&mut c, seller.clone(), 200_000, 1_800_000, u64::MAX);
        // Non-matching listing: ask $2.50 (exceeds ceiling)
        let _bad_id = insert_listing(&mut c, seller, 200_000, 2_500_000, u64::MAX);

        let results = c.find_matches_for_intent(intent_id, 0, 10);
        assert_eq!(results.len(), 1, "Only one listing should be eligible");
        assert_eq!(results[0].listing_id, _good_id);
        assert!(results[0].score > 0);
    }

    #[test]
    fn find_matches_for_listing_returns_eligible_intents() {
        let mut c = setup_with_party();
        let buyer: AccountId = "buyer.testnet".parse().unwrap();

        // Listing: 500 lb at $1.50/lb
        let listing_id = insert_listing(&mut c, owner(), 500_000, 1_500_000, u64::MAX);

        // Eligible intent: wants 100 lb, ceiling $2.00 (≥ ask $1.50), overlapping window
        let _good_id = insert_intent(&mut c, buyer.clone(), 100_000, 2_000_000, u64::MAX);
        // Ineligible intent: ceiling $1.00 < ask $1.50
        let _bad_id = insert_intent(&mut c, buyer, 100_000, 1_000_000, u64::MAX);

        let results = c.find_matches_for_listing(listing_id, 0, 10);
        assert_eq!(results.len(), 1, "Only one intent should be eligible");
        assert_eq!(results[0].intent_id, _good_id);
        assert!(results[0].score > 0);
    }
}
