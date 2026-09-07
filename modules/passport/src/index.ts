// Passport core: personal identity and company entry over PBP 0.3.
// Keys are returned to the trusted caller only. Do not expose these functions or
// their results directly as model/MCP tools; a custody adapter must mediate signing.
import { PbpClient } from "../../../sdk/src/v03/client.ts";
import { generateKeyPair, type KeyPair } from "../../../sdk/src/keys.ts";
import { personId, organizationId } from "../../../sdk/src/v03/wire.ts";
export interface PassportIdentity { id: string; key: KeyPair }
export class Passport {
  client: PbpClient;
  constructor(audience: string) { this.client = new PbpClient(audience); }
  async createIdentity(): Promise<PassportIdentity> {
    const key = await generateKeyPair(); const identity = { id: await personId(key.keyId), key };
    await this.client.act(identity, "person.register", null, { keys: [key.keyId] }); return identity;
  }
  async createCompany(identity: PassportIdentity, name: string) {
    const nonce = crypto.randomUUID(), id = await organizationId(identity.id, nonce);
    await this.client.act(identity, "organization.create", id, { name, nonce, controllers: [identity.id], threshold: 1 }); return id;
  }
  organizations(identity: PassportIdentity) { return this.client.act(identity, "organizations.list", null, {}); }
  enter(identity: PassportIdentity, organization: string) { return this.client.act(identity, "workspace.view", organization, {}); }
  async invite(identity: PassportIdentity, organization: string, person: string, permissions: string[], expires_at: string) {
    const invitation_id = crypto.randomUUID();
    await this.client.act(identity, "membership.invite", organization, { invitation_id, person_id: person, permissions, expires_at }); return invitation_id;
  }
  accept(identity: PassportIdentity, organization: string, invitation_id: string) { return this.client.act(identity, "membership.accept", organization, { invitation_id }); }
  revoke(identity: PassportIdentity, organization: string, person_id: string) { return this.client.act(identity, "membership.revoke", organization, { person_id }); }
}
