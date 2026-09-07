import { draftCommand, signCommand, PbpError, type Command } from "./wire.ts";
import type { KeyPair } from "../keys.ts";
export class PbpClient {
  audience: string;
  constructor(audience: string) { this.audience = audience.replace(/\/$/, ""); }
  async send(command: Command): Promise<any> {
    const response = await fetch(this.audience + "/pbp-store/commands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
    const value = await response.json() as any;
    if (!response.ok) throw new PbpError(value.error?.code ?? "request_failed", value.error?.message ?? "request failed", response.status);
    return value.result;
  }
  async act(person: { id: string; key: KeyPair }, action: string, organization: string | null, payload: Record<string, any>, cosigners: KeyPair[] = []) {
    return this.send(await signCommand(draftCommand(this.audience, person, action, organization, payload), [person.key, ...cosigners]));
  }
}
