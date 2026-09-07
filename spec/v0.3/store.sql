-- PBP v0.3 isolated reference store. Explicitly apply to a disposable/local DB.
-- Never changes the v0.2 protocol schema or enables a v0.2 root-key bypass.
create schema pbp_v03;
create table pbp_v03.state (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0,
  body jsonb not null
);
insert into pbp_v03.state (body) values ('{"persons":{},"organizations":{},"modules":{},"records":{},"receipts":{},"transfers":{},"next_seq":1}');
alter table pbp_v03.state enable row level security;
-- No public/PostgREST policies. Only the reference service database role accesses this state.
revoke all on schema pbp_v03 from public;
revoke all on all tables in schema pbp_v03 from public;
