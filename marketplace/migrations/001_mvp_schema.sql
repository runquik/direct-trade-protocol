-- DTP Marketplace MVP schema (applied to Supabase as migration `dtp_marketplace_mvp_schema`).
-- Scope: accounts + trust, supply listings, buy intents, endorsements.
-- Deliberately absent: contracts, escrow, offers, fulfillment, freight, CTEs.

create schema if not exists dtp;

-- Accounts: the identity + trust anchor. Auth is a hashed API key.
create table dtp.accounts (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique check (handle ~ '^[a-z0-9][a-z0-9-]{2,38}$'),
  business_name text not null,
  business_type text not null check (business_type in ('producer','distributor','retailer','cooperative','broker','other')),
  jurisdiction text not null default 'US',
  city text,
  region text,          -- state/province
  country text not null default 'US',
  contact text,         -- email or URL, shown to counterparties
  bio text,
  website text,
  -- self-attested identity fields (MVP trust inputs; verification comes later)
  legal_name text,
  years_in_business int check (years_in_business >= 0),
  certifications text[] not null default '{}',
  api_key_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sell side
create table dtp.listings (
  id text primary key default ('L-' || upper(substr(md5(random()::text), 1, 8))),
  account_id uuid not null references dtp.accounts(id),
  product_name text not null,
  category text not null,
  description text,
  quantity numeric not null check (quantity > 0),
  unit text not null,                     -- lb, kg, case, pallet, each...
  price_per_unit_cents bigint not null check (price_per_unit_cents >= 0),
  currency text not null default 'USD',
  min_order_quantity numeric,
  grade text,
  certifications text[] not null default '{}',
  origin_city text,
  origin_region text,
  origin_country text not null default 'US',
  available_from date,
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active','withdrawn','expired','sold')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index listings_status_category_idx on dtp.listings (status, category);
create index listings_product_trgm_idx on dtp.listings using gin (to_tsvector('english', product_name || ' ' || coalesce(description,'')));

-- Buy side
create table dtp.intents (
  id text primary key default ('I-' || upper(substr(md5(random()::text), 1, 8))),
  account_id uuid not null references dtp.accounts(id),
  product_name text not null,
  category text not null,
  description text,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  ceiling_price_per_unit_cents bigint check (ceiling_price_per_unit_cents >= 0),
  currency text not null default 'USD',
  required_certifications text[] not null default '{}',
  deliver_to_city text,
  deliver_to_region text,
  deliver_to_country text not null default 'US',
  needed_by date,
  expires_at timestamptz,
  status text not null default 'open' check (status in ('open','cancelled','expired','fulfilled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index intents_status_category_idx on dtp.intents (status, category);
create index intents_product_trgm_idx on dtp.intents using gin (to_tsvector('english', product_name || ' ' || coalesce(description,'')));

-- Trust layer: peer endorsements (one per direction per pair)
create table dtp.endorsements (
  id uuid primary key default gen_random_uuid(),
  from_account uuid not null references dtp.accounts(id),
  to_account uuid not null references dtp.accounts(id),
  note text,
  created_at timestamptz not null default now(),
  unique (from_account, to_account),
  check (from_account <> to_account)
);

-- RLS: the schema is only reached through the edge function (service connection),
-- but lock it down anyway so PostgREST/anon can never touch it.
alter table dtp.accounts enable row level security;
alter table dtp.listings enable row level security;
alter table dtp.intents enable row level security;
alter table dtp.endorsements enable row level security;
