import type { Command } from "./model.ts";
import type { KeyPair } from "../keys.ts";
import { draftCommand, signCommand } from "./wire.ts";

/** A transport helper, not a credential vault or a replacement for server authorization. */
export class DtpClient {
  readonly audience: string;
  readonly fetcher: typeof fetch;
  constructor(audience: string, fetcher: typeof fetch = fetch) {
    const url = new URL(audience);
    if (url.origin !== audience || !["http:", "https:"].includes(url.protocol)) throw new Error("audience must be an exact HTTP(S) origin");
    this.audience = audience;
    this.fetcher = fetcher;
  }
  async prepare(person: { id: string; key: KeyPair }, action: string, organization: string | null, payload: Record<string, unknown>, cosigners: KeyPair[] = []): Promise<Command> {
    return signCommand(draftCommand(this.audience, person, action, organization, payload), [person.key, ...cosigners]);
  }
  /** Retain and resend the same signed command after an uncertain outcome; never invent a new request ID for a retry. */
  async send<T = unknown>(command: Command, signal?: AbortSignal): Promise<T> {
    if (command.audience !== this.audience) throw new Error("command audience differs from client");
    const response = await this.fetcher(`${this.audience}/dtp/v0.4/commands`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command), signal,
    });
    const data = await response.json() as { result?: T; error?: { code?: string; message?: string } };
    if (!response.ok || data.error) throw new DtpResponseError(response.status, data.error?.code ?? "transport_error", data.error?.message ?? "DTP request failed");
    return data.result as T;
  }
}
export class DtpResponseError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
