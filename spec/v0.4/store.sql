-- Isolated candidate storage. No existing protocol tables are replaced.
create schema if not exists dtp_v04;
create table if not exists dtp_v04.state (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0,
  body jsonb not null
);
insert into dtp_v04.state(singleton,body) values (true,'{"persons":{},"organizations":{},"policies":{},"profiles":{},"releases":{},"records":{},"inventory":{},"remote_authorities":{},"outgoing":{},"incoming":{},"receipts":{},"next_seq":1}'::jsonb) on conflict(singleton) do nothing;
revoke all on schema dtp_v04 from public;
revoke all on all tables in schema dtp_v04 from public;
