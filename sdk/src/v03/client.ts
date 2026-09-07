import { draftCommand, signCommand, PbpError, type Command } from "./wire.ts";
import type { KeyPair } from "../keys.ts";
export class PbpClient {
  audience: string;
  accessToken?: string;
  constructor(audience: string, accessToken?: string) { this.audience = audience.replace(/\/$/, ""); this.accessToken = accessToken; }
  async send(command: Command): Promise<any> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.accessToken) headers["x-pbp-dev-token"] = this.accessToken;
    const response = await fetch(this.audience + "/pbp-store/commands", { method: "POST", headers, body: JSON.stringify(command) });
    const value = await response.json() as any;
    if (!response.ok) throw new PbpError(value.error?.code ?? "request_failed", value.error?.message ?? "request failed", response.status);
    return value.result;
  }
  async act(person: { id: string; key: KeyPair }, action: string, organization: string | null, payload: Record<string, any>, cosigners: KeyPair[] = []) {
    return this.send(await signCommand(draftCommand(this.audience, person, action, organization, payload), [person.key, ...cosigners]));
  }
}
