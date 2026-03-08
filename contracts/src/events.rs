use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Every state transition in DTP emits an AuditEvent.
/// Events are append-only and cannot be modified or deleted.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct AuditEvent {
    pub event_id: String,
    pub event_type: EventType,
    pub entity_type: EntityType,
    pub entity_id: String,
    pub actor: String,
    pub timestamp: u64,
    /// SHA-256 hex digest of the canonical JSON payload
    pub payload_hash: String,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum EntityType {
    Intent,
    Listing,
    Offer,
    Contract,
    Fulfillment,
    Settlement,
    StandingAgreement,
    Relationship,
    Catalog,
    Lot,
    FinancePool,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum EventType {
    // Intent lifecycle
    IntentCreated,
    IntentPosted,
    IntentMatched,
    IntentContracted,
    IntentExpired,
    IntentCancelled,

    // Listing lifecycle
    ListingCreated,
    ListingActivated,
    ListingMatched,
    ListingContracted,
    ListingExpired,
    ListingWithdrawn,

    // Offer lifecycle
    OfferSubmitted,
    OfferShortlisted,
    OfferAccepted,
    OfferRejected,
    OfferExpired,
    OfferRetracted,

    // Contract lifecycle
    ContractCreated,
    ContractEscrowLocked,
    ContractInFulfillment,
    ContractDelivered,
    ContractSettled,
    ContractDisputed,
    ContractResolvedBuyer,
    ContractResolvedSeller,
    ContractCancelled,

    // Fulfillment
    FulfillmentSellerAttested,
    FulfillmentBuyerAttested,
    FulfillmentComplete,
    FulfillmentDisputed,

    // Settlement
    SettlementCreated,
    EscrowReleased,

    // Standing Agreements
    AgreementProposed,
    AgreementCountered,
    AgreementActivated,
    AgreementCompleted,
    AgreementTerminated,

    // Relationship
    RelationshipTierUpdated,

    // Goods catalog
    CatalogEntryCreated,
    CatalogEntryUpdated,

    // Goods lots
    LotCreated,
    LotDisposed,
    LotOwnershipTransferred,

    // Finance pools
    FinancePoolRegistered,
    /// Emitted when a contract with FinancingMode::LpPool is accepted.
    /// The registered pool contract listens for this and calls confirm_financing.
    FinancingRequested,
    /// Emitted when a pool account confirms it has funded a trade.
    FinancingConfirmed,
}

/// Compute SHA-256 hash of a JSON-serializable payload.
pub fn hash_payload<T: Serialize>(payload: &T) -> String
where
    T: serde::Serialize,
{
    let json = serde_json::to_string(payload).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    hex::encode(hasher.finalize())
}

/// Build an event ID from entity type, entity id, event type, and timestamp.
pub fn make_event_id(entity_id: &str, event_type: &EventType, timestamp: u64) -> String {
    let type_str = format!("{:?}", event_type);
    format!("evt:{}:{}:{}", entity_id, type_str.to_lowercase(), timestamp)
}
