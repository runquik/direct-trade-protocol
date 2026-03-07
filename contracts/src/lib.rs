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
    pub intents: IterableMap<String, TradeIntent>,
    pub listings: IterableMap<String, SupplyListing>,
    pub offers: IterableMap<String, Offer>,
    pub contracts: IterableMap<String, TradeContract>,
    pub fulfillments: IterableMap<String, Fulfillment>,
    pub settlements: IterableMap<String, Settlement>,
    pub standing_agreements: IterableMap<String, StandingAgreement>,
    pub relationships: LookupMap<String, RelationshipRecord>,

    /// Append-only audit trail
    pub audit_log: Vector<AuditEvent>,

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
            intents: IterableMap::new(b"i"),
            listings: IterableMap::new(b"l"),
            offers: IterableMap::new(b"o"),
            contracts: IterableMap::new(b"c"),
            fulfillments: IterableMap::new(b"f"),
            settlements: IterableMap::new(b"s"),
            standing_agreements: IterableMap::new(b"a"),
            relationships: LookupMap::new(b"r"),
            audit_log: Vector::new(b"e"),
            id_counter: 0,
        }
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn next_id(&mut self) -> String {
        self.id_counter += 1;
        format!("dtp-{}", self.id_counter)
    }

    fn now_ms(&self) -> u64 {
        env::block_timestamp() / 1_000_000
    }

    fn emit(&mut self, event: AuditEvent) {
        let json = serde_json::to_string(&event).unwrap_or_default();
        self.audit_log.push(event);
        near_sdk::log!("DTP_EVENT:{}", json);
    }

    fn require_party(&self, account: &AccountId) {
        assert!(self.parties.contains_key(account), "Party not registered");
    }

    fn require_owner(&self) {
        assert_eq!(env::predecessor_account_id(), self.owner, "Owner only");
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
            certifications: vec![],
            reputation: ReputationRecord::default(),
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

    // -----------------------------------------------------------------------
    // TradeIntent
    // -----------------------------------------------------------------------

    /// Post a new TradeIntent. Caller must be a registered party.
    pub fn post_intent(
        &mut self,
        goods: GoodsSpec,
        delivery: DeliverySpec,
        pricing: BuyerPricing,
        expires_at: u64,
    ) -> String {
        let buyer = env::predecessor_account_id();
        self.require_party(&buyer);

        let intent_id = self.next_id();
        let now = self.now_ms();

        let intent = TradeIntent {
            intent_id: intent_id.clone(),
            version: self.protocol_version.clone(),
            buyer: buyer.clone(),
            goods,
            delivery,
            pricing,
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
    pub fn post_listing(
        &mut self,
        goods: GoodsSpec,
        pack_structure: PackStructure,
        delivery: DeliverySpec,
        pricing: SellerPricing,
        certifications: Vec<CertificationRef>,
        available_from: u64,
        expires_at: u64,
    ) -> String {
        let seller = env::predecessor_account_id();
        self.require_party(&seller);

        let listing_id = self.next_id();
        let now = self.now_ms();

        let listing = SupplyListing {
            listing_id: listing_id.clone(),
            version: self.protocol_version.clone(),
            seller: seller.clone(),
            goods,
            pack_structure,
            delivery,
            pricing,
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
        price_per_unit: Amount,
        total_price: Amount,
        certifications: Vec<CertificationRef>,
        expires_at: u64,
    ) -> String {
        let offerer = env::predecessor_account_id();
        self.require_party(&offerer);

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

        let offer_id = self.next_id();
        let now = self.now_ms();

        let offer = Offer {
            offer_id: offer_id.clone(),
            version: self.protocol_version.clone(),
            target_id,
            target_type,
            offerer: offerer.clone(),
            goods,
            delivery,
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

        // Determine buyer and seller based on offer target type
        let (buyer, seller, intent_id, listing_id) = match &offer.target_type {
            OfferTargetType::Intent => {
                let mut intent = self.intents.get(&offer.target_id).cloned().expect("Intent not found");
                assert_eq!(intent.buyer, caller, "Only buyer can accept offer on their intent");
                assert_eq!(intent.status, IntentStatus::Posted, "Intent not open");
                intent.status = IntentStatus::Contracted;
                intent.updated_at = self.now_ms();
        self.intents.insert(intent.intent_id.clone(), intent.clone());
                (caller.clone(), offer.offerer.clone(), Some(offer.target_id.clone()), None)
            }
            OfferTargetType::Listing => {
                let mut listing = self.listings.get(&offer.target_id).cloned().expect("Listing not found");
                assert_eq!(listing.seller, caller, "Only seller can accept offer on their listing");
                assert_eq!(listing.status, ListingStatus::Active, "Listing not active");
                listing.status = ListingStatus::Contracted;
        self.listings.insert(listing.listing_id.clone(), listing.clone());
                (offer.offerer.clone(), caller.clone(), None, Some(offer.target_id.clone()))
            }
        };

        offer.status = OfferStatus::Accepted;
        self.offers.insert(offer_id.clone(), offer.clone());

        let contract_id = self.next_id();
        let now = self.now_ms();

        // TODO: Replace this placeholder with actual NEP-141 USDC escrow lock.
        // When USDC integration lands:
        //   1. Call ft_transfer_call on the USDC contract
        //   2. Record the escrow account and amount
        //   3. Funds held until fulfillment or dispute resolution
        let escrow_ref = format!("escrow-placeholder-{}", contract_id);

        let contract = TradeContract {
            contract_id: contract_id.clone(),
            version: self.protocol_version.clone(),
            intent_id,
            listing_id,
            offer_id: offer_id.clone(),
            buyer: buyer.clone(),
            seller: seller.clone(),
            goods: offer.goods.clone(),
            delivery: offer.delivery.clone(),
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

        let now = self.now_ms();
        let fulfillment_id = self.next_id();

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
        self.execute_settlement(fulfillment_id.clone(), contract, deductions)
    }

    fn execute_settlement(
        &mut self,
        fulfillment_id: String,
        mut contract: TradeContract,
        deductions: Vec<Deduction>,
    ) -> String {
        let now = self.now_ms();
        let settlement_id = self.next_id();

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

        contract.status = ContractStatus::Settled;
        contract.updated_at = now;
        self.contracts.insert(contract.contract_id.clone(), contract.clone());

        // Update relationship record
        self.update_relationship(&contract.buyer.clone(), &contract.seller.clone(), net_amount, true, now);

        // Update reputation records
        self.update_reputation(&contract.buyer, true, true);
        self.update_reputation(&contract.seller, true, true);

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

        let event_type = match resolution {
            DisputeResolution::Buyer => EventType::ContractResolvedBuyer,
            DisputeResolution::Seller => EventType::ContractResolvedSeller,
        };

        // Find the fulfillment for this contract
        // In v0 we do a linear scan (acceptable for pilot scale)
        let fulfillment_id = self.fulfillments
            .iter()
            .find(|(_, f)| f.contract_id == contract_id)
            .map(|(id, _)| id.clone());

        if let Some(fid) = fulfillment_id {
            self.execute_settlement(fid, contract, deductions);
        }

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
    pub fn propose_standing_agreement(
        &mut self,
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

        let agreement_id = self.next_id();
        let now = self.now_ms();

        // Proposer signs immediately; counterparty signs via sign_standing_agreement()
        let (buyer, seller, buyer_signed, seller_signed) =
            if matches!(self.parties.get(&proposer).unwrap().business_type, BusinessType::Retailer | BusinessType::Cooperative) {
                (proposer.clone(), counterparty, Some(now), None)
            } else {
                (counterparty, proposer.clone(), None, Some(now))
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
    // Matching helpers (read-only)
    // -----------------------------------------------------------------------

    /// Check if a listing is eligible to match an intent and return a score.
    pub fn check_match(&self, intent_id: String, listing_id: String) -> MatchResult {
        let intent = self.intents.get(&intent_id).cloned().expect("Intent not found");
        let listing = self.listings.get(&listing_id).cloned().expect("Listing not found");
        let result = matching::check_listing_vs_intent(&intent, &listing, self.now_ms());
        MatchResult {
            eligible: result.eligible,
            score: result.score,
            reasons: result.reasons,
        }
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

    /// Get paginated audit trail entries for a specific entity.
    pub fn get_audit_trail(&self, entity_id: String, offset: u64, limit: u64) -> Vec<AuditEvent> {
        let total = self.audit_log.len() as u64;
        let mut results = vec![];
        let mut count = 0u64;
        let mut skipped = 0u64;

        for i in 0..total {
            let event = self.audit_log.get(i as u32).cloned().unwrap();
            if event.entity_id == entity_id {
                if skipped < offset {
                    skipped += 1;
                    continue;
                }
                if count >= limit {
                    break;
                }
                results.push(event);
                count += 1;
            }
        }
        results
    }

    // -----------------------------------------------------------------------
    // Internal: reputation + relationship updates
    // -----------------------------------------------------------------------

    fn update_reputation(&mut self, account: &AccountId, completed: bool, on_time: bool) {
        if let Some(mut party) = self.parties.get(account).cloned() {
            if completed { party.reputation.trades_completed += 1; }
            if on_time  { party.reputation.trades_settled_on_time += 1; }
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

#[derive(Serialize, Deserialize, BorshDeserialize, BorshSerialize)]
#[serde(crate = "near_sdk::serde")]
#[borsh(crate = "near_sdk::borsh")]
pub struct TierComparisonResult {
    pub label: String,
    pub price_per_unit: u128,
    pub total_price: u128,
    pub pct_savings_vs_asking: i32,
}

#[derive(Serialize, Deserialize, BorshDeserialize, BorshSerialize)]
#[serde(crate = "near_sdk::serde")]
#[borsh(crate = "near_sdk::borsh")]
pub enum DisputeResolution {
    Buyer,
    Seller,
}
