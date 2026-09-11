import type { Command } from "./wire.ts";
export interface Person { id: string; keys: string[]; retired_keys: string[]; history: Command[] }
export interface Membership { person_id: string; permissions: string[]; expires_at: string; active: boolean; authorized_by: string }
export interface Invitation extends Membership { id: string; accepted: boolean }
export interface Manifest { version: string; name: string; permissions: string[] }
export interface Module { id: string; publisher_id: string; manifests: Record<string, Manifest> }
export interface Installation { id: string; organization_id: string; module_id: string; manifest_version: string; key_id: string;
  permissions: string[]; mode: "interactive" | "automation"; expires_at: string; active: boolean }
export interface Organization { id: string; name: string; controllers: string[]; threshold: number; generation: number;
  status: "active" | "migrated"; members: Record<string, Membership>; invitations: Record<string, Invitation>;
  installations: Record<string, Installation>; audit: Audit[]; imported_from: string | null; disclosures?: Record<string, Disclosure> }
export interface Disclosure { id: string; recipient: string; record_ids: string[]; purpose: string; summary: string;
  expires_at: string; active: boolean; command: Command }
export interface BusinessRecord { record_id: string; root_id: string; supersedes: string | null; type: string;
  subject_company_id: string; counterparty_ids: string[]; visibility: "public" | "counterparties" | "granted" | "private";
  body: Record<string, any>; command: Command; seq: number; is_head: boolean; accepted_at: string }
export interface Audit { seq: number; command: Command; accepted_at: string }
export interface State { persons: Record<string, Person>; organizations: Record<string, Organization>; modules: Record<string, Module>;
  records: Record<string, BusinessRecord>; receipts: Record<string, { hash: string; result: unknown; expires_at: number }>;
  transfers: Record<string, Transfer>; next_seq: number }
export const emptyState = (): State => ({ persons: {}, organizations: {}, modules: {}, records: {}, receipts: {}, transfers: {}, next_seq: 1 });
export interface Snapshot { version: "0.3"; source: string; organization: Organization; persons: Person[]; modules: Module[]; records: BusinessRecord[] }
export interface Transfer { snapshot: Snapshot; handoff: Command; source_key_id: string; signature: string }
