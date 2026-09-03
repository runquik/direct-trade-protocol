-- DTP v0.2 protocol store. Schema `protocol` sits beside the MVP's `dtp` schema.
-- Records are append-only signed envelopes; "update" = a superseding record. Events are one-per-write.
-- Reached only through the dtp-store edge function's service connection (RLS on, no policies = deny-all for anon/PostgREST).

create schema if not exists protocol;

-- ---------------------------------------------------------------------------
-- Identities
-- ---------------------------------------------------------------------------
create table protocol.companies (
  id               text primary key
                   check (id ~ '^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$' and length(id) between 2 and 64),
  display_name     text not null,
  legal_name       text,
  head_record_id   uuid,                       -- latest core.company record
  created_at       timestamptz not null default now()
);

create table protocol.modules (
  id                    text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  publisher_company_id  text not null references protocol.companies(id),
  name                  text not null,
  head_record_id        uuid,                  -- latest core.module record
  created_at            timestamptz not null default now()
);

create table protocol.keys (
  key_id             text primary key check (key_id ~ '^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$'),
  public_key         bytea not null check (octet_length(public_key) = 32),
  owner_kind         text not null check (owner_kind in ('company', 'module')),
  owner_id           text not null,
  role               text not null check (role in ('root', 'delegate')),
  label              text,
  status             text not null default 'active' check (status in ('active', 'revoked')),
  token_hash         text unique,              -- sha256 hex of the bearer token; null = no token issued
  added_by_record_id uuid,
  created_at         timestamptz not null default now(),
  revoked_at         timestamptz
);
create index keys_owner_idx on protocol.keys (owner_kind, owner_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- Records (append-only)
-- ---------------------------------------------------------------------------
create table protocol.records (
  record_id           uuid primary key,
  root_id             uuid not null,
  type                text not null,
  namespace           text not null,
  schema_version      text not null,
  subject_company_id  text not null references protocol.companies(id),
  counterparty_ids    text[] not null default '{}',
  issuer_key_id       text not null references protocol.keys(key_id),
  issuer_company_id   text not null,
  issuer_module_id    text,
  visibility          text not null check (visibility in ('public', 'counterparties', 'granted', 'private')),
  supersedes          uuid references protocol.records(record_id),
  is_head             boolean not null default true,
  status              text,                    -- body.status when the type defines one (denormalized for events/queries)
  created_at          timestamptz not null,    -- client-asserted, inside the signature
  received_at         timestamptz not null default now(),
  body                jsonb not null,
  envelope            jsonb not null,          -- the signed envelope verbatim, for re-verification
  payload_hash        text not null,
  signature           text not null,
  seq                 bigint                   -- events.seq of the creating event
);
create unique index records_one_successor_uidx on protocol.records (supersedes) where supersedes is not null;
create index records_subject_ns_head_idx on protocol.records (subject_company_id, namespace, is_head);
create index records_root_idx on protocol.records (root_id);
create index records_type_head_idx on protocol.records (type, received_at desc) where is_head;
create index records_counterparties_idx on protocol.records using gin (counterparty_ids);
create index records_seq_idx on protocol.records (seq);

-- ---------------------------------------------------------------------------
-- Grants (projection of head core.grant records)
-- ---------------------------------------------------------------------------
create table protocol.grants (
  grant_root_id       uuid primary key,        -- root_id of the core.grant chain
  grant_record_id     uuid not null references protocol.records(record_id),
  grantor_company_id  text not null references protocol.companies(id),
  grantee_module_id   text not null references protocol.modules(id),
  scopes              jsonb not null,
  status              text not null check (status in ('active', 'revoked')),
  expires_at          timestamptz,
  updated_at          timestamptz not null default now()
);
create index grants_lookup_idx on protocol.grants (grantee_module_id, grantor_company_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- Events (append-only, one per accepted write)
-- ---------------------------------------------------------------------------
create table protocol.events (
  seq                 bigserial primary key,
  event_id            uuid not null default gen_random_uuid(),
  kind                text not null default 'record_appended' check (kind in ('record_appended')),
  record_id           uuid not null references protocol.records(record_id),
  root_id             uuid not null,
  type                text not null,
  namespace           text not null,
  schema_version      text not null,
  subject_company_id  text not null,
  counterparty_ids    text[] not null default '{}',
  issuer_key_id       text not null,
  issuer_company_id   text not null,
  issuer_module_id    text,
  visibility          text not null,
  supersedes          uuid,
  status              text,
  created_at          timestamptz not null,
  recorded_at         timestamptz not null default now()
);
create index events_subject_seq_idx on protocol.events (subject_company_id, seq);
create index events_counterparties_idx on protocol.events using gin (counterparty_ids);

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------
create or replace function protocol.reject_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'protocol.% is append-only', tg_table_name;
end $$;

create trigger events_immutable
  before update or delete on protocol.events
  for each row execute function protocol.reject_mutation();

-- records: the only permitted updates are flipping is_head (once, true->false) and setting seq (once, null->value)
create or replace function protocol.records_limited_update() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'protocol.records is append-only';
  end if;
  if (to_jsonb(new) - 'is_head' - 'seq') <> (to_jsonb(old) - 'is_head' - 'seq') then
    raise exception 'protocol.records rows are immutable except is_head/seq';
  end if;
  if old.is_head = false and new.is_head = true then
    raise exception 'a superseded record cannot become head again';
  end if;
  if old.seq is not null and new.seq is distinct from old.seq then
    raise exception 'records.seq is write-once';
  end if;
  return new;
end $$;

create trigger records_immutable
  before update or delete on protocol.records
  for each row execute function protocol.records_limited_update();

-- ---------------------------------------------------------------------------
-- RLS: on, no policies. Only the edge function's service connection reaches these tables.
-- ---------------------------------------------------------------------------
alter table protocol.companies enable row level security;
alter table protocol.modules   enable row level security;
alter table protocol.keys      enable row level security;
alter table protocol.records   enable row level security;
alter table protocol.grants    enable row level security;
alter table protocol.events    enable row level security;
