import type { KeyPair } from "../keys.ts";

export interface Command {
  version: "0.4"; audience: string; request_id: string; issued_at: string; expires_at: string;
  organization_id: string | null; actor: { kind: "person" | "installation"; id: string; key_id: string };
  requested_by: string | null; action: string; payload: Record<string, any>;
  signatures: { key_id: string; signature: string }[];
}
export interface Person { id: string; keys: string[]; retired_keys: string[]; history: Command[] }
export interface Membership { person_id: string; permissions: string[]; expires_at: string; active: boolean; authorized_by: string }
export interface Invitation extends Membership { id: string; accepted: boolean }
export interface Installation { id: string; module_id: string; release_digest: string; key_id: string;
  policy_ids: string[]; actions: DataAction[]; sponsor_id: string; expires_at: string; active: boolean; mode: "interactive" | "automation" }
export interface Organization { id: string; name: string; controllers: string[]; threshold: number; generation: number;
  status: "active" | "migrated"; members: Record<string, Membership>; invitations: Record<string, Invitation>;
  installations: Record<string, Installation>; history: Command[] }
export type DataAction = "read" | "write" | "export";
export interface Grant { person_id: string; actions: DataAction[]; resource_ids: "*" | string[]; expires_at: string }
export interface Policy { id: string; organization_id: string; revision: number; classification: "business" | "personnel";
  stewards: string[]; threshold: number; grants: Grant[]; history: Command[] }
export interface Profile { id: string; publisher_id: string; name: string; version: string; digest: string;
  schema: Record<string, any>; semantics: "structural" | "inventory-v1" | "invoice-v1"; dependencies: string[];
  visibility: "private" | "community"; readers: string[]; command: Command }
export interface BusinessRecord { id: string; root_id: string; supersedes: string | null; organization_id: string;
  policy_id: string; resource_id: string; profile_digest: string; counterparty_ids: string[];
  body: Record<string, any>; command: Command; seq: number; is_head: boolean; accepted_at: string; validation: any }
export interface Release { module_id: string; publisher_id: string; version: string; digest: string;
  artifact_digest: string; profiles: string[]; actions: DataAction[]; visibility: "private" | "community";
  assessment: SignedToken | null; command: Command }
export interface SignedToken { body: Record<string, any>; key_id: string; signature: string }
export interface RemoteAuthority { token: SignedToken }
export interface Snapshot { version: "0.4"; source: string; organization: Organization; persons: Person[];
  policies: Policy[]; profiles: Profile[]; releases: Release[]; records: BusinessRecord[];
  remote_authorities: SignedToken[]; inventory: Record<string, any> }
export interface MigrationManifest { migration_id: string; organization_id: string; generation: number;
  source: { audience: string; key_id: string }; destination: { audience: string; key_id: string };
  snapshot_hash: string; byte_length: number; chunk_hashes: string[]; expires_at: string }
export interface OutboundMigration { manifest: MigrationManifest; chunks: string[]; manifest_token: SignedToken;
  authorization: Command; commit_token?: SignedToken; cancel_token?: SignedToken }
export interface InboundMigration { manifest: MigrationManifest; manifest_token: SignedToken; chunks: Record<string, string>;
  ready_token?: SignedToken; snapshot?: Snapshot; activated: boolean; aborted?: boolean }
export interface State { persons: Record<string, Person>; organizations: Record<string, Organization>;
  policies: Record<string, Policy>; profiles: Record<string, Profile>; releases: Record<string, Release>;
  records: Record<string, BusinessRecord>; inventory: Record<string, any>; remote_authorities: Record<string, RemoteAuthority>;
  outgoing: Record<string, OutboundMigration>; incoming: Record<string, InboundMigration>;
  receipts: Record<string, { hash: string; result: any; expires_at: number }>;
  next_seq: number }
export const emptyState = (): State => ({ persons: {}, organizations: {}, policies: {}, profiles: {}, releases: {}, records: {}, inventory: {},
  remote_authorities: {}, outgoing: {}, incoming: {}, receipts: {}, next_seq: 1 });
export interface Context { audience: string; storeKey: KeyPair; pins: Record<string, string>; now: number;
  assessmentPins?: Record<string,string>; revokedAssessments?: string[];
  referenceProfiles?: Record<string,string[]> }
