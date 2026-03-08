use crate::types::{TradeIntent, SupplyListing};

/// Result of an eligibility check between a TradeIntent and a SupplyListing.
#[derive(Debug)]
pub struct MatchEligibility {
    pub eligible: bool,
    pub reasons: Vec<String>,
    /// Composite score 0–10000 (higher is better match)
    pub score: u32,
}

/// Check whether a SupplyListing is eligible to match a TradeIntent.
/// Returns eligibility status, failure reasons, and a match score.
///
/// `seller_reputation_score`: the seller's `ReputationRecord.score` (0–10000).
/// Pass `None` for new sellers with no on-chain history (defaults to 10000).
///
/// `listing_catalog_id`: the catalog entry ID of the lot backing this listing,
/// if the listing is lot-backed. Pass `None` for spec-only listings.
/// When the intent specifies a `catalog_id`, lot-backed listings that don't
/// match that catalog are ineligible.
pub fn check_listing_vs_intent(
    intent: &TradeIntent,
    listing: &SupplyListing,
    now_ms: u64,
    seller_reputation_score: Option<u32>,
    listing_catalog_id: Option<String>,
) -> MatchEligibility {
    let mut reasons: Vec<String> = vec![];

    // 1. Quantity: listing quantity >= intent desired quantity
    if listing.goods.quantity.milliamount < intent.goods.quantity.milliamount {
        reasons.push(format!(
            "Listing quantity ({}) below intent required ({})",
            listing.goods.quantity.milliamount,
            intent.goods.quantity.milliamount
        ));
    }

    // 2. Required certifications: all intent required certs must be in listing
    for required_cert in &intent.goods.required_certifications {
        let has_cert = listing.certifications.iter().any(|c| {
            &c.cert_type == required_cert
                && c.status == crate::types::CertStatus::Active
                && c.expires_at > now_ms
        });
        if !has_cert {
            reasons.push(format!("Missing required certification: {}", required_cert));
        }
    }

    // 3. Price: listing asking price <= intent ceiling
    let listing_price = listing.pricing.asking_price_per_unit;
    let intent_ceiling = intent.pricing.ceiling_price_per_unit;
    if listing_price > intent_ceiling {
        reasons.push(format!(
            "Listing price ({}) exceeds intent ceiling ({})",
            listing_price, intent_ceiling
        ));
    }

    // 4. Delivery window overlap
    if listing.delivery.window_latest < intent.delivery.window_earliest
        || listing.delivery.window_earliest > intent.delivery.window_latest
    {
        reasons.push("Delivery windows do not overlap".to_string());
    }

    // 5. Catalog match: if the intent specifies a catalog_id, a lot-backed listing
    //    must reference the same catalog. Spec-only listings (no lot) remain eligible —
    //    the buyer is expressing a preference, not a hard filter on non-lot listings.
    if let Some(ref intent_catalog) = intent.catalog_id {
        if let Some(ref lot_catalog) = listing_catalog_id {
            if intent_catalog != lot_catalog {
                reasons.push(format!(
                    "Catalog mismatch: intent requires {}, listing lot is {}",
                    intent_catalog, lot_catalog
                ));
            }
        }
    }

    // 6. Not expired
    if listing.expires_at <= now_ms {
        reasons.push("Listing has expired".to_string());
    }
    if intent.expires_at <= now_ms {
        reasons.push("Intent has expired".to_string());
    }

    let eligible = reasons.is_empty();

    // Score (only meaningful if eligible)
    let catalog_matched = intent.catalog_id.is_some()
        && listing_catalog_id.as_ref() == intent.catalog_id.as_ref();
    let score = if eligible {
        compute_match_score(intent, listing, seller_reputation_score.unwrap_or(10000), catalog_matched)
    } else {
        0
    };

    MatchEligibility { eligible, reasons, score }
}

/// Compute a 0–10000 match score for an eligible listing vs intent.
/// Four dimensions, equal weight (2500 each):
///   1. Price alignment (lower listing price vs ceiling = better)
///   2. Delivery timing (more overlap = better)
///   3. Seller reputation (ReputationRecord.score, 0–10000)
///   4. Certification depth + catalog match bonus
fn compute_match_score(intent: &TradeIntent, listing: &SupplyListing, seller_reputation_score: u32, catalog_matched: bool) -> u32 {
    // 1. Price score: how far below the ceiling is the listing price?
    let price_score = {
        let ceiling = intent.pricing.ceiling_price_per_unit;
        let ask = listing.pricing.asking_price_per_unit;
        if ceiling == 0 {
            2500u32
        } else {
            let pct_below = ceiling.saturating_sub(ask) * 10000 / ceiling;
            ((pct_below.min(10000) as u32) * 2500 / 10000).min(2500)
        }
    };

    // 2. Delivery timing score: how centered is the listing window within the intent window?
    let timing_score = {
        let overlap_start = listing.delivery.window_earliest
            .max(intent.delivery.window_earliest);
        let overlap_end = listing.delivery.window_latest
            .min(intent.delivery.window_latest);
        let overlap = if overlap_end > overlap_start {
            overlap_end - overlap_start
        } else {
            0
        };
        let intent_window = intent.delivery.window_latest
            .saturating_sub(intent.delivery.window_earliest)
            .max(1);
        let pct = (overlap * 2500 / intent_window) as u32;
        pct.min(2500)
    };

    // 3. Reputation score: seller's on-chain ReputationRecord.score (0–10000 basis points).
    //    New sellers default to 10000 (no history = no penalty).
    let reputation_score = (seller_reputation_score.min(10000) * 2500 / 10000).min(2500);

    // 4. Certification depth + catalog match bonus.
    //    Catalog match (buyer intent references the exact same product master as
    //    the lot being offered) is the strongest possible goods compatibility signal.
    //    It contributes up to 1500 pts; cert depth fills the remaining 1000.
    let cert_depth_score = {
        let catalog_bonus = if catalog_matched { 1500u32 } else { 0 };
        let required = intent.goods.required_certifications.len() as u32;
        let provided = listing.certifications.len() as u32;
        let extra = provided.saturating_sub(required);
        let cert_bonus = (extra.min(5) * 200).min(1000);
        (catalog_bonus + cert_bonus).min(2500)
    };

    price_score + timing_score + reputation_score + cert_depth_score
}

/// Compute tier comparison: for a given intent and listing, return
/// what prices look like at each listing price tier (for surfacing to buyer).
pub struct TierComparison {
    pub label: String,
    pub price_per_unit: u128,
    pub total_price: u128,
    pub pct_savings_vs_asking: i32,
}

pub fn compute_tier_comparisons(
    intent: &TradeIntent,
    listing: &SupplyListing,
) -> Vec<TierComparison> {
    let _desired_qty = intent.goods.quantity.milliamount;
    let _unit = intent.goods.quantity.unit.clone();
    let mut results = vec![];

    for tier in &listing.pricing.tiers {
        let total = (tier.price_per_unit as u128)
            * (tier.min_quantity.milliamount as u128)
            / 1000;

        let pct_savings = {
            let ask = listing.pricing.asking_price_per_unit as i64;
            let tier_price = tier.price_per_unit as i64;
            if ask == 0 {
                0i32
            } else {
                ((ask - tier_price) * 100 / ask) as i32
            }
        };

        results.push(TierComparison {
            label: tier.label.clone().unwrap_or_else(|| format!(
                "{} {}",
                tier.min_quantity.milliamount / 1000,
                tier.min_quantity.unit
            )),
            price_per_unit: tier.price_per_unit,
            total_price: total,
            pct_savings_vs_asking: pct_savings,
        });
    }

    results
}
