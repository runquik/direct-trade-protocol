// Source of the language-neutral command schema (npm run build:pbp).
// Contextual permission, key possession and business invariants are in the specification/engine.
type Schema = Record<string, any>;
const str = (maxLength = 120): Schema => ({ type: "string", minLength: 1, maxLength });
const id: Schema = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
const key: Schema = { type: "string", pattern: "^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$" };
const time: Schema = { type: "string", pattern: "^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z$" };
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: "null" }] });
const array = (items: Schema, maxItems: number, minItems = 0): Schema => ({ type: "array", items, maxItems, minItems, uniqueItems: true });
const object = (properties: Record<string, Schema>): Schema => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const rights = array(str(), 64);
const policy = { controllers: array(id, 8, 1), threshold: { type: "integer", minimum: 1, maximum: 8 } };
const manifest = object({ version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" }, name: str(), permissions: rights });
const page = object({ after: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, limit: { type: "integer", minimum: 1, maximum: 100 } });
export const PAYLOADS: Record<string, Schema> = {
  "person.register": object({ keys: array(key, 8, 1) }),
  "person.rotate": object({ add: array(key, 8), revoke: array(key, 8) }),
  "organization.create": object({ name: str(), nonce: id, ...policy }),
  "organization.policy": object(policy),
  "organizations.list": object({}),
  "membership.invite": object({ invitation_id: id, person_id: id, permissions: rights, expires_at: time }),
  "membership.accept": object({ invitation_id: id }),
  "membership.revoke": object({ person_id: id }),
  "module.publish": object({ module_id: id, manifest }),
  "installation.create": object({ installation_id: id, module_id: id, manifest_version: str(), key_id: key,
    permissions: rights, mode: { enum: ["interactive", "automation"] }, expires_at: time }),
  "installation.revoke": object({ installation_id: id }),
  "workspace.view": object({}),
  "record.append": object({ record_id: id, root_id: id, supersedes: nullable(id), type: { type: "string", pattern: "^[a-z]+\\.[a-z_]+$" },
    subject_company_id: id, counterparty_ids: array(id, 16), visibility: { enum: ["public", "counterparties", "granted", "private"] }, body: { type: "object" } }),
  "records.list": page,
  "records.export": page,
  "organization.export": object({}),
  "migration.preview": object({}),
  "migration.commit": object({ destination: object({ audience: str(300), key_id: key }), snapshot_hash: { type: "string", pattern: "^[0-9a-f]{64}$" } }),
  "migration.receipt": object({}),
  // The nested transfer is authenticated by the pinned source receipt and controller signatures;
  // full structure is checked in verifyTransfer before import.
  "migration.import": object({ transfer: object({ snapshot: { type: "object" }, handoff: { type: "object" }, source_key_id: key, signature: str(110) }) }),
};
export const COMMAND_SCHEMA: Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:pbp:0.3:command",
  title: "Portable Business Protocol 0.3 signed command",
  ...object({ version: { const: "0.3" }, audience: str(300), request_id: id, issued_at: time, expires_at: time,
    organization_id: nullable(id), actor: object({ kind: { enum: ["person", "installation"] }, id, key_id: key }), requested_by: nullable(id),
    action: { enum: Object.keys(PAYLOADS) }, payload: { type: "object" }, signatures: array(object({ key_id: key, signature: str(110) }), 16, 1) }),
  allOf: Object.entries(PAYLOADS).map(([action, payload]) => ({ if: { properties: { action: { const: action } } }, then: { properties: { payload } } })),
};
