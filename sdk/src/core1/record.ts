// Core-1 signed records (spec/core-1/README.md, part 5): a Signed<RecordBody> under DTP-RECORD-1. No platform imports.
//
//   Record = { issuer:       { identity: <uuid>, head: { sequence, digest } },
//              organization: null | { id: <uuid>, head: { sequence, digest } },
//              profile:      <sha256 hex of the profile document>,
//              sequence:     1 for a first record, the superseded record's sequence + 1 otherwise,
//              supersedes:   null | <record digest of the record it replaces>,
//              issued_at:    <integer ms, the issuer's own claim>,
//              payload:      <object, the profile's business> }
//
// The record digest is SHA-256 over the canonical Signed<RecordBody>, signatures included, in lower-case hex: the
// digest a log leaf commits to (data-layer security proposal, 5.2). Core-1 checks the structure and the profile
// digest; whether the signers held the issuer's keys at the named head is checked against that head
// (checkRecordSigners), which an exchange bundle carries. What a payload means is the profile's business.

import { canonicalBytes, sha256Hex } from "../canonical.ts";
import { EnvelopeError, meetsQuorum, signEnvelope, verifyEnvelope, type KeySet, type Signed } from "./envelope.ts";

export const RECORD_DOMAIN = "DTP-RECORD-1";

export interface HeadRef { sequence: number; digest: string }
export interface RecordBody {
  issuer: { identity: string; head: HeadRef };
  organization: { id: string; head: HeadRef } | null;
  profile: string;
  sequence: number;
  supersedes: string | null;
  issued_at: number;
  payload: { [name: string]: unknown };
}

/** The part of an identity-log head a record is checked against (the foundation layer's Control). */
export interface PersonHead { identity_id: string; sequence: number; operational: KeySet }
/** The part of a governance head a record issued for an organisation is checked against. */
export interface GovernanceHeadRef { organization_id: string; sequence: number; controllers: string[] }

export type RecordErrorCode = "invalid_record" | "unexpected_profile" | "wrong_head" | "unauthorized_signer" | "broken_supersession";
export class RecordError extends Error {
  readonly code: RecordErrorCode;
  constructor(code: RecordErrorCode, message: string) {
    super(message);
    this.name = "RecordError";
    this.code = code;
  }
}

const fail = (code: RecordErrorCode, message: string): never => { throw new RecordError(code, message); };
const invalid = (message: string): never => fail("invalid_record", message);
const isObject = (value: unknown): value is { [name: string]: unknown } => value !== null && typeof value === "object" && !Array.isArray(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const exactly = (value: unknown, members: string[], what: string): { [name: string]: unknown } => {
  if (!isObject(value)) invalid(`${what} is an object`);
  const object = value as { [name: string]: unknown };
  const names = Object.keys(object);
  if (names.length !== members.length || !members.every(m => Object.hasOwn(object, m))) invalid(`${what} must have exactly the members ${members.join(", ")}`);
  return object;
};
const count = (value: unknown, min: number, what: string) => {
  if (!Number.isSafeInteger(value) || (value as number) < min) invalid(`${what} is an integer of at least ${min}`);
};
const headRef = (value: unknown, what: string) => {
  const head = exactly(value, ["sequence", "digest"], what);
  count(head.sequence, 0, `${what}.sequence`);
  if (typeof head.digest !== "string" || !HEX.test(head.digest)) invalid(`${what}.digest is lower-case SHA-256 hex`);
};

/** Checks that `body` is a RecordBody, member by member. Refuses anything else as `invalid_record`. */
export function parseRecord(body: unknown): RecordBody {
  const record = exactly(body, ["issuer", "organization", "profile", "sequence", "supersedes", "issued_at", "payload"], "a record");
  const issuer = exactly(record.issuer, ["identity", "head"], "issuer");
  if (typeof issuer.identity !== "string" || !UUID.test(issuer.identity)) invalid("issuer.identity is an identity id (lower-case UUID)");
  headRef(issuer.head, "issuer.head");
  if (record.organization !== null) {
    const organization = exactly(record.organization, ["id", "head"], "organization");
    if (typeof organization.id !== "string" || !UUID.test(organization.id)) invalid("organization.id is an organisation id (lower-case UUID)");
    headRef(organization.head, "organization.head");
  }
  if (typeof record.profile !== "string" || !HEX.test(record.profile)) invalid("profile is the profile's lower-case SHA-256 hex digest");
  count(record.sequence, 1, "sequence");
  if (record.supersedes === null) {
    if (record.sequence !== 1) invalid("a record that supersedes nothing has sequence 1");
  } else {
    if (typeof record.supersedes !== "string" || !HEX.test(record.supersedes)) invalid("supersedes is null or a record digest");
    if (record.sequence === 1) invalid("a record that supersedes another has a sequence above 1");
  }
  count(record.issued_at, 0, "issued_at");
  if (!isObject(record.payload)) invalid("payload is an object");
  return record as unknown as RecordBody;
}

/**
 * The record digest: SHA-256 over the canonical Signed<RecordBody>, signatures included, with the signatures array
 * taken in ascending order of key_id (compared by UTF-16 code unit, as JCS orders member names). The envelope sets no
 * order for its signatures, so a threshold record arrives in any order; the digest depends only on the body and the
 * set of signatures, never on the order they were assembled or stored in (#188).
 */
export async function recordDigest(signed: Signed<RecordBody>): Promise<string> {
  const signatures = [...signed.signatures].sort((a, b) => (a.key_id < b.key_id ? -1 : a.key_id > b.key_id ? 1 : 0));
  return sha256Hex(canonicalBytes({ body: signed.body, signatures }));
}

/** Signs a record under DTP-RECORD-1. Refuses a body that is not a RecordBody, so nothing unverifiable is produced. */
export async function signRecord(body: RecordBody, secretKeys: string[]): Promise<Signed<RecordBody>> {
  parseRecord(structuredClone(body));
  return signEnvelope(RECORD_DOMAIN, body, secretKeys);
}

/**
 * Verifies a Signed<RecordBody>: the envelope under DTP-RECORD-1 (EnvelopeError: `invalid_envelope`, `invalid_signature`),
 * then the body's structure (`invalid_record`), then, when the caller names the profile it expects, the profile
 * digest (`unexpected_profile`). Returns the record, the key ids that signed and the record digest.
 */
export async function verifyRecord(signed: unknown, expected: { profile?: string } = {}, limits: { maxBytes?: number } = {}): Promise<{ record: RecordBody; signers: Set<string>; digest: string }> {
  const { body, signers } = await verifyEnvelope(RECORD_DOMAIN, signed, limits);
  const record = parseRecord(body);
  if (expected.profile !== undefined && record.profile !== expected.profile) fail("unexpected_profile", `the record is of profile ${record.profile}, not ${expected.profile}`);
  return { record, signers, digest: await recordDigest(signed as Signed<RecordBody>) };
}

/**
 * Checks the signers against the heads the record names, which the caller has already verified (from an identity
 * log and, for an organisation, a governance log). The heads must be the ones the record names (`wrong_head`); every
 * signer must be an operational key of the issuer's head, and they must meet its threshold; for an organisation, the
 * issuer must be one of its controllers at the named governance head (`unauthorized_signer`).
 */
export function checkRecordSigners(record: RecordBody, signers: Set<string>, person: { head: PersonHead; head_digest: string }, organization: { head: GovernanceHeadRef; head_digest: string } | null = null): void {
  const named = record.issuer;
  if (person.head.identity_id !== named.identity || person.head.sequence !== named.head.sequence || person.head_digest !== named.head.digest) fail("wrong_head", "the identity head given is not the one the record names");
  const operational = person.head.operational;
  for (const key of signers) if (!operational.keys.includes(key)) fail("unauthorized_signer", `${key} is not an operational key of the issuer at the named head`);
  if (!meetsQuorum(operational, signers)) fail("unauthorized_signer", "the signers do not meet the issuer's operational threshold at the named head");
  if (record.organization === null) {
    if (organization !== null) fail("wrong_head", "the record is not issued for an organisation");
    return;
  }
  if (organization === null) fail("wrong_head", "the record is issued for an organisation; its governance head is needed");
  const org = organization!, ref = record.organization;
  if (org.head.organization_id !== ref.id || org.head.sequence !== ref.head.sequence || org.head_digest !== ref.head.digest) fail("wrong_head", "the governance head given is not the one the record names");
  if (!org.head.controllers.includes(named.identity)) fail("unauthorized_signer", "the issuer is not a controller of the organisation at the named governance head");
}

/**
 * Checks that `next` supersedes `previous`: it names the previous record's digest, takes the next sequence, and keeps
 * the profile and the party it is issued by (the organisation when there is one, otherwise the person).
 */
export function checkSupersession(previous: { record: RecordBody; digest: string }, next: RecordBody): void {
  if (next.supersedes !== previous.digest) fail("broken_supersession", "the record does not name the previous record's digest");
  if (next.sequence !== previous.record.sequence + 1) fail("broken_supersession", "the record does not take the next sequence");
  if (next.profile !== previous.record.profile) fail("broken_supersession", "a record cannot supersede a record of another profile");
  const party = (r: RecordBody) => r.organization === null ? `person:${r.issuer.identity}` : `organization:${r.organization.id}`;
  if (party(next) !== party(previous.record)) fail("broken_supersession", "a record is superseded only by its own issuing party");
}

export { EnvelopeError };
