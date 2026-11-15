// Core-1 exchange bundles (spec/core-1/README.md, part 5; data-layer security proposal 5.3, S1 and S2): a record
// with everything needed to verify it offline, and the backdating rule (`stale_head`).
//
//   Bundle = { record:         Signed<Record>,                 // DTP-RECORD-1
//              identity_logs:  [ IdentityLog, ... ],           // dtp-identity-log-2: the issuer's, and, for a record
//                                                              // issued for an organisation, every person whose
//                                                              // consent its governance log carries; 1 to 17 logs
//              governance_log: null | GovernanceLog,           // dtp-governance-log-1, exactly when the record is
//                                                              // issued for an organisation
//              receipt:        null | Receipt }                // DTP-LOG-HEAD-1, when a host accepted the record
//
// A recipient verifies it with no network and no host. It supplies the host key it trusts for receipts, its
// attestation policy, and the logs it already admitted (Core-1 part 4: a relying party keeps the last log it admitted
// for an identity), which are compared with the bundle's and also bound backdating. Reference only: no platform
// imports beyond the foundation layer's portable verifiers.

import { compareCheckpoint, verifyIdentityLog, type IdentityLog, type VerifiedIdentityLog } from "../foundation/identity-log.ts";
import { controlFromIdentityLogs, verifyGovernanceLog, type GovernanceLog, type VerifiedGovernanceLog } from "../foundation/organization.ts";
import type { Signed } from "./envelope.ts";
import { checkRecordSigners, RecordError, verifyRecord, type RecordBody } from "./record.ts";
import { ReceiptError, verifyReceipt, type Leaf, type LogHead } from "./receipt.ts";

/** The issuer's log and, for an organisation, at most 16 controllers' logs (the governance log's own bound). */
export const MAX_BUNDLE_LOGS = 17;

export interface Bundle { record: Signed<RecordBody>; identity_logs: IdentityLog[]; governance_log: GovernanceLog | null; receipt: unknown | null }
/** What the recipient already holds: the last log it admitted per identity and per organisation. */
export interface Holdings { identity_logs: IdentityLog[]; governance_logs: GovernanceLog[] }
export interface BundleOptions {
  /** The host key the recipient trusts for this record's receipt, or null when it trusts none. */
  host_key: string | null;
  /** Passed to the identity-log verifier (identity-log.md, rule 8); there is no default. */
  require_attestation: boolean;
  /** The profile digest the recipient expects, if it expects one. */
  profile?: string;
  /** The recipient's own logs, compared with the bundle's; empty when it holds none. */
  held?: Holdings;
}
export interface VerifiedBundle {
  record: RecordBody; digest: string; signers: Set<string>;
  /** The host's receipt, or null for a record exchanged without a host. Without one, the recipient records its own
   *  receipt time as the record's upper bound (S2). */
  receipt: { head: LogHead; leaf: Leaf } | null;
}

export type BundleErrorCode = "invalid_bundle" | "history_conflict" | "stale_head";
export class BundleError extends Error {
  readonly code: BundleErrorCode;
  constructor(code: BundleErrorCode, message: string) {
    super(message);
    this.name = "BundleError";
    this.code = code;
  }
}
const fail = (code: BundleErrorCode, message: string): never => { throw new BundleError(code, message); };
const invalid = (message: string): never => fail("invalid_bundle", message);
const isObject = (value: unknown): value is { [name: string]: unknown } => value !== null && typeof value === "object" && !Array.isArray(value);
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);

async function identityLogs(logs: unknown, policy: { require_attestation: boolean }, what: string): Promise<Map<string, { raw: IdentityLog; verified: VerifiedIdentityLog }>> {
  const out = new Map<string, { raw: IdentityLog; verified: VerifiedIdentityLog }>();
  for (const raw of logs as IdentityLog[]) {
    let verified: VerifiedIdentityLog;
    try { verified = await verifyIdentityLog(raw, policy); } catch (error) { return invalid(`${what}: an identity log does not verify (${reason(error)})`); }
    if (out.has(verified.identity_id)) invalid(`${what}: two identity logs for one identity`);
    out.set(verified.identity_id, { raw, verified });
  }
  return out;
}

/** Of a log the recipient holds and the bundle's, the longer, once the shorter's last head is a head of the longer. */
function longer<T extends { heads: { head_digest: string }[] }>(held: T | undefined, given: T, what: string): T {
  if (held === undefined) return given;
  const [short, long] = held.heads.length <= given.heads.length ? [held, given] : [given, held];
  const last = short.heads.length - 1;
  if (long.heads[last].head_digest !== short.heads[last].head_digest) fail("history_conflict", `${what}: the bundle's log and the one the recipient holds disagree at head ${last}`);
  return long;
}

/**
 * Verifies an exchange bundle offline. In order:
 *  1. its structure (`invalid_bundle`);
 *  2. the record (RecordError, EnvelopeError: part 5's codes, including `unexpected_profile`);
 *  3. every identity log, and the governance log when the record is issued for an organisation, replayed from its
 *     genesis with no clock (`invalid_bundle`); a log that disagrees with one the recipient holds (`history_conflict`);
 *  4. the signers against the heads the record names, in those logs (`wrong_head`, `unauthorized_signer`);
 *  5. the receipt, when present, against the host key the recipient trusts (part 5's receipt codes);
 *  6. backdating (S2, `stale_head`): when the issuer's head after the named one is known, from the bundle or the
 *     recipient's own logs, a receipt must show acceptance before that head took effect, and without a receipt the
 *     record is refused. For an organisation, the first later governance head at which the issuer is no longer a
 *     controller bounds the receipt by its transition's signed `issued_at`, the same way.
 */
export async function verifyBundle(bundle: unknown, options: BundleOptions): Promise<VerifiedBundle> {
  if (!isObject(bundle)) invalid("a bundle is an object");
  const b = bundle as { [name: string]: unknown }, members = ["record", "identity_logs", "governance_log", "receipt"];
  if (Object.keys(b).length !== members.length || !members.every(m => Object.hasOwn(b, m))) invalid(`a bundle has exactly the members ${members.join(", ")}`);
  if (!Array.isArray(b.identity_logs) || b.identity_logs.length < 1 || b.identity_logs.length > MAX_BUNDLE_LOGS) invalid(`identity_logs is a list of 1 to ${MAX_BUNDLE_LOGS} identity logs`);
  if (b.governance_log !== null && !isObject(b.governance_log)) invalid("governance_log is null or a governance log");
  if (b.receipt !== null && !isObject(b.receipt)) invalid("receipt is null or a receipt");

  const { record, signers, digest } = await verifyRecord(b.record, options.profile === undefined ? {} : { profile: options.profile });
  const policy = { require_attestation: options.require_attestation };

  const given = await identityLogs(b.identity_logs, policy, "the bundle");
  const held = await identityLogs(options.held?.identity_logs ?? [], { require_attestation: false }, "the recipient's logs");
  if (!given.has(record.issuer.identity)) invalid("the bundle does not carry the issuer's identity log");
  const people = new Map<string, VerifiedIdentityLog>();
  for (const [id, entry] of held) people.set(id, entry.verified);
  for (const [id, entry] of given) people.set(id, longer(held.get(id)?.verified, entry.verified, `identity ${id}`));
  const issuerLog = people.get(record.issuer.identity)!, n = record.issuer.head.sequence;
  const named = issuerLog.heads[n];
  if (named === undefined || compareCheckpoint(given.get(record.issuer.identity)!.verified, { sequence: n, head_digest: record.issuer.head.digest }) !== "consistent") {
    throw new RecordError("wrong_head", "the bundle's identity log does not carry the head the record names");
  }

  let governance: { log: VerifiedGovernanceLog; raw: GovernanceLog } | null = null;
  if (record.organization === null) {
    if (b.governance_log !== null) invalid("a record issued by a person alone carries no governance log");
  } else {
    if (b.governance_log === null) invalid("a record issued for an organisation carries its governance log");
    const lookup = controlFromIdentityLogs([...people.values()]);
    const replay = async (raw: GovernanceLog, what: string) => {
      try { return await verifyGovernanceLog(raw, lookup); } catch (error) { return invalid(`${what}: the governance log does not verify (${reason(error)})`); }
    };
    const raw = b.governance_log as GovernanceLog, mine = await replay(raw, "the bundle");
    if (mine.organization_id !== record.organization.id) throw new RecordError("wrong_head", "the governance log is another organisation's");
    governance = { log: mine, raw };
    for (const heldRaw of options.held?.governance_logs ?? []) {
      const other = await replay(heldRaw, "the recipient's logs");
      if (other.organization_id !== mine.organization_id) continue;
      const winner = longer(other, mine, `organisation ${mine.organization_id}`);
      if (winner === other) governance = { log: other, raw: heldRaw };
    }
    const m = record.organization.head.sequence;
    if (m >= mine.heads.length || mine.heads[m].head_digest !== record.organization.head.digest) throw new RecordError("wrong_head", "the bundle's governance log does not carry the head the record names");
  }

  const gov = record.organization === null ? null : governance!.log.heads[record.organization.head.sequence];
  checkRecordSigners(record, signers, { head: named.head, head_digest: named.head_digest }, gov === null ? null : { head: gov.head, head_digest: gov.head_digest });

  let receipt: VerifiedBundle["receipt"] = null;
  if (b.receipt !== null) {
    if (options.host_key === null) throw new ReceiptError("unauthorized_host", "the recipient trusts no host key for this receipt");
    receipt = await verifyReceipt(b.receipt, digest, options.host_key!);
  }

  // S2: the issuer's next head, from the bundle or the recipient's own log.
  const next = issuerLog.heads[n + 1];
  if (next !== undefined) {
    if (receipt === null) fail("stale_head", `the issuer's head ${n + 1} is known and the record has no receipt`);
    if (receipt!.leaf.accepted_at >= next.head.effective_at) fail("stale_head", `the host accepted the record at or after the issuer's head ${n + 1} took effect`);
  }
  if (record.organization !== null) {
    const { log, raw } = governance!, m = record.organization.head.sequence;
    const removed = log.heads.findIndex((h, i) => i > m && !h.head.controllers.includes(record.issuer.identity));
    if (removed !== -1) {
      if (receipt === null) fail("stale_head", `the issuer is no longer a controller at governance head ${removed} and the record has no receipt`);
      if (receipt!.leaf.accepted_at >= raw.entries[removed - 1].transition.issued_at) fail("stale_head", `the host accepted the record at or after the transition to governance head ${removed} was issued`);
    }
  }
  return { record, digest, signers, receipt };
}

export { RecordError, ReceiptError };
