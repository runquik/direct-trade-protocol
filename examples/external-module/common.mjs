// Shared by the example scripts. Plain JavaScript on the pinned Node runtime; the only dependency is the packed SDK.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { v04Client, v04Wire } from "@dtp/sdk/preview";

/** The synthetic assessor that approves this module's artifact. The host pins it as operator configuration (prepare.mjs writes that file). */
export const ASSESSOR_ISSUER = "https://assessor.example.invalid";

/**
 * The protocol kinds this module understands, pinned to the exact contract digests the protocol registry
 * (spec/profiles/index.json) lists for them. A module names what it understands; a digest that the host has
 * not admitted is an explicit `unsupported_profile` refusal, never a silently empty page.
 */
export const KINDS = {
  "dtp/product@1": "864130d61c38ba6268b0e0f77c75d47ac0772be6cebf2a18da3aca7385a46986",
  "dtp/inventory@2": "01db4c97806f9a34542874a5553f773b465543279508795fb684efa18a79d0cb",
};

/** Where this example keeps its synthetic secrets and the host configuration. Never commit it. */
export const home = resolve(process.env.DTP_EXAMPLE_HOME ?? resolve(dirname(fileURLToPath(import.meta.url)), "synthetic"));
/** The exact HTTP origin the host advertises and signs into every command. */
export const audience = process.env.DTP_AUDIENCE ?? "http://127.0.0.1:8790";

export const credentialsFile = resolve(home, "credentials.json");
export function loadCredentials() { return JSON.parse(readFileSync(credentialsFile, "utf8")); }
export function saveCredentials(credentials) { writeFileSync(credentialsFile, JSON.stringify(credentials, null, 2) + "\n"); }

/** Read the unsigned health response and refuse to continue if the host does not advertise the expected audience. */
export async function connect() {
  const health = await fetch(`${audience}/dtp/v0.4/health`).then(r => r.json());
  if (health.audience !== audience) throw new Error(`host advertises audience ${health.audience}, this example expected ${audience}`);
  return { health, client: new v04Client.DtpClient(audience) };
}

/** A person-signed command: the SDK client prepares, signs and sends. Cosigners prove key possession or make up a quorum. */
export async function asPerson(client, person, action, organization, payload, cosigners = []) {
  const command = await client.prepare(person, action, organization, payload, cosigners);
  return { command, result: await client.send(command) };
}

/** A command by an installed module running unattended: actor kind `installation`, no requesting human, the installation key alone signs. */
export function draftAsInstallation(installation, action, organization, payload, now = Date.now()) {
  const command = v04Wire.draftCommand(audience, installation, action, organization, payload, now);
  command.actor.kind = "installation";
  command.requested_by = null;
  return command;
}
export const sign = (command, keys) => v04Wire.signCommand(command, keys);

/** Send a command and report a protocol refusal as data instead of throwing; transport failures still throw. */
export async function attempt(client, command) {
  try { return { ok: true, result: await client.send(command) }; }
  catch (error) { if (error instanceof v04Client.DtpResponseError) return { ok: false, status: error.status, code: error.code, message: error.message }; throw error; }
}
