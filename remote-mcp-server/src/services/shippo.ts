/**
 * Shippo REST API client — parcel shipping rates and label purchase.
 */

const SHIPPO_BASE = "https://api.goshippo.com/";

function getToken(): string {
  const token = process.env.SHIPPO_API_KEY;
  if (!token) throw new Error("SHIPPO_API_KEY environment variable is required");
  return token;
}

export interface ShippoAddress {
  name: string;
  street1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface ShippoParcel {
  length: string;
  width: string;
  height: string;
  distance_unit: "in" | "cm";
  weight: string;
  mass_unit: "lb" | "kg" | "oz";
}

export interface ShippoRate {
  object_id: string;
  provider: string;
  servicelevel: { name: string; token: string };
  amount: string;
  currency: string;
  estimated_days: number;
  duration_terms: string;
}

export interface ShippoShipment {
  object_id: string;
  rates: ShippoRate[];
}

export interface ShippoTransaction {
  object_id: string;
  tracking_number: string;
  tracking_url_provider: string;
  label_url: string;
  rate: string;
  status: string;
}

async function shippoFetch(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SHIPPO_BASE}${path}`, {
    ...options,
    headers: {
      "Authorization": `ShippoToken ${getToken()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shippo API error (${res.status}): ${body}`);
  }

  return res.json();
}

/**
 * Create a shipment and get rate quotes from all carriers.
 */
export async function getShippingRates(
  from: ShippoAddress,
  to: ShippoAddress,
  parcels: ShippoParcel[]
): Promise<ShippoShipment> {
  return shippoFetch("shipments/", {
    method: "POST",
    body: JSON.stringify({
      address_from: from,
      address_to: to,
      parcels,
      async: false,
    }),
  });
}

/**
 * Purchase a shipping label for a given rate.
 */
export async function purchaseLabel(rateId: string): Promise<ShippoTransaction> {
  return shippoFetch("transactions/", {
    method: "POST",
    body: JSON.stringify({
      rate: rateId,
      async: false,
    }),
  });
}

/**
 * Estimate parcel dimensions from weight.
 * For MVP: rough box size estimates based on weight in lb.
 */
export function estimateParcelDimensions(weightLb: number): ShippoParcel {
  let length: number, width: number, height: number;

  if (weightLb <= 5) {
    length = 12; width = 10; height = 6;
  } else if (weightLb <= 15) {
    length = 14; width = 12; height = 8;
  } else if (weightLb <= 30) {
    length = 18; width = 14; height = 10;
  } else if (weightLb <= 50) {
    length = 20; width = 16; height = 12;
  } else {
    length = 24; width = 18; height = 16;
  }

  return {
    length: length.toString(),
    width: width.toString(),
    height: height.toString(),
    distance_unit: "in",
    weight: weightLb.toFixed(1),
    mass_unit: "lb",
  };
}

/**
 * Format Shippo rates for display.
 */
export function formatRates(rates: ShippoRate[]): string {
  if (!rates || rates.length === 0) return "No shipping rates available.";

  // Sort by price
  const sorted = [...rates].sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount));

  return sorted.map((r, i) => {
    const days = r.estimated_days ? `${r.estimated_days} day${r.estimated_days > 1 ? "s" : ""}` : "varies";
    return `${i + 1}. ${r.provider} ${r.servicelevel.name} — $${parseFloat(r.amount).toFixed(2)} (${days})\n   Rate ID: ${r.object_id}`;
  }).join("\n");
}
