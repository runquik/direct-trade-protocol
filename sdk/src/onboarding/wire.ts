/** Onboarding preview wire shapes shared by the client and the host. Types only: nothing here runs, so the portable client never depends on a host module. */
import type { Signature } from '../foundation/identity.ts';
export interface Command { request_id:string; action:string; organization_id:string|null; parameters:Record<string,any> }
export interface Challenge { person_id:string; audience:string; nonce:string; command_digest:string; expires_at:number }
export interface Request { command:Command; challenge:Challenge; signatures:Signature[] }
