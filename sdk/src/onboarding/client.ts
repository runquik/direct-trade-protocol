/** Client-side Passport primitives. Private identity keys never enter host requests. */
import { canonicalBytes } from '../canonical.ts';
import { generateKeyPair, keyPairFromSecret, encodeSignature, signBytes, verifyBytes } from '../keys.ts';
import { createIdentity, signIdentity, verifyResolution } from '../foundation/identity.ts';
import type { Genesis, Rehome, ResolverEnrollment, Signed, Transition } from '../foundation/identity.ts';
import { IDENTITY_LOG_PUSH_FORMAT, parseIdentityLogPushAck, verifyIdentityLog } from '../foundation/identity-log.ts';
import type { IdentityLog, IdentityLogPushAck } from '../foundation/identity-log.ts';
import type { KeyPair } from '../keys.ts';
import type { Command, Challenge, Request } from './host.ts';
import { parseUntrustedJson, parseUntrustedResponse } from '../safe-json.ts';
/** resolver_epoch is per identity, not per host: absent means 0, the epoch of initial enrollment. */
export interface ResolverMetadata { audience:string;resolver_id:string;resolver_key:string;resolver_epoch?:number }
const epochOf=(r:ResolverMetadata)=>r.resolver_epoch??0;
export interface Wallet { format:'dtp-passport-preview-1'; kind:'operational'|'recovery'; person_id:string; secret_key:string; resolver:ResolverMetadata }
export interface EncryptedWallet { format:'dtp-encrypted-passport-1'; kdf:'PBKDF2-SHA256';iterations:600000;salt:string;iv:string;ciphertext:string }
export type Transport = (path:string,body?:unknown)=>Promise<any>;
/** Every change to an identity returns the host's acknowledgment AND the fresh control history, already verified
 *  against the wallet's pinned resolver. Save the log with the recovery kit every time: an owner whose only copy
 *  is on a host that later disappears keeps their keys and loses their identity. */
export interface Changed<A> { ack:A; log:IdentityLog }
const hex=(b:Uint8Array)=>Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');
function bytes(s:string,max:number) { if(typeof s!=='string'||s.length>max*2||s.length%2||!/^[0-9a-f]+$/.test(s))throw new Error('Invalid encrypted bundle');return new Uint8Array(s.match(/../g)!.map(x=>parseInt(x,16))); }
/** The same keys, pinned to another resolver. Valid only once that resolver has adopted the identity. */
export function rehomeWallet(wallet:Wallet,resolver:ResolverMetadata):Wallet { httpTransport(resolver.audience);return {...wallet,resolver:{audience:resolver.audience,resolver_id:resolver.resolver_id,resolver_key:resolver.resolver_key,resolver_epoch:epochOf(wallet.resolver)+1}}; }
export function httpTransport(audience:string):Transport {
  const url=new URL(audience);if(url.origin!==audience||!['http:','https:'].includes(url.protocol))throw new Error('Exact host origin required');
  return async(path,body)=>{const response=await fetch(`${audience}/api/${path}`,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});const value=await parseUntrustedResponse(response) as any;if(!response.ok)throw new Error(value.error||'Host request failed');return value;};
}
/** Owner push: hand a relying party the log after a move, so that it stops trusting the former resolver now rather
 *  than at the next sign-in. The message is the log and nothing else; the relying party's transport is the caller's
 *  (an origin's `POST /api/identity-log` with httpTransport). Safe to repeat: an admitted log answers `unchanged`. */
export async function pushIdentityLog(relyingParty:Transport,log:IdentityLog):Promise<IdentityLogPushAck> {
  return parseIdentityLogPushAck(await relyingParty('identity-log',{format:IDENTITY_LOG_PUSH_FORMAT,log}));
}
export async function prepareIdentity(resolver:ResolverMetadata,now=Date.now()) {
  const [operational,recovery]=await Promise.all([generateKeyPair(),generateKeyPair()]);
  const genesis=await signIdentity<Genesis>('DTP-PERSON-GENESIS-1',{nonce:crypto.randomUUID(),operational:{keys:[operational.keyId],threshold:1},recovery:{keys:[recovery.keyId],threshold:1}},[operational,recovery]);
  const initial=await createIdentity(genesis,{id:resolver.resolver_id,key_id:resolver.resolver_key},now);
  const enrollment=await signIdentity('DTP-IDENTITY-ENROLLMENT-1',{identity_id:initial.head.identity_id,genesis_digest:initial.genesis_digest,resolver_id:resolver.resolver_id,resolver_key:resolver.resolver_key,audience:resolver.audience,nonce:hex(crypto.getRandomValues(new Uint8Array(32))),issued_at:now,expires_at:now+300000},[operational,recovery]);
  const wallet=(kind:Wallet['kind'],key:KeyPair):Wallet=>({format:'dtp-passport-preview-1',kind,person_id:initial.head.identity_id,secret_key:key.secretKey,resolver:{...resolver}});
  return {genesis,enrollment,operational:wallet('operational',operational),recovery:wallet('recovery',recovery)};
}
async function encryptionKey(passphrase:string,salt:Uint8Array) {
  if(typeof passphrase!=='string'||passphrase.length<14||passphrase.length>1024)throw new Error('Use a passphrase of at least 14 characters');
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:salt as BufferSource,iterations:600000},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptWallet(wallet:Wallet,passphrase:string):Promise<EncryptedWallet> {
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await encryptionKey(passphrase,salt);
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('dtp-encrypted-passport-1')},key,new TextEncoder().encode(JSON.stringify(wallet))));
  return {format:'dtp-encrypted-passport-1',kdf:'PBKDF2-SHA256',iterations:600000,salt:hex(salt),iv:hex(iv),ciphertext:hex(ciphertext)};
}
export async function decryptWallet(bundle:EncryptedWallet,passphrase:string):Promise<Wallet> {
  if(!bundle||bundle.format!=='dtp-encrypted-passport-1'||bundle.kdf!=='PBKDF2-SHA256'||bundle.iterations!==600000||Object.keys(bundle).length!==6)throw new Error('Unsupported encrypted bundle');
  const salt=bytes(bundle.salt,16),iv=bytes(bundle.iv,12),ciphertext=bytes(bundle.ciphertext,16384);
  if(salt.length!==16||iv.length!==12)throw new Error('Invalid encrypted bundle');
  let wallet:Wallet;
  try { wallet=parseUntrustedJson(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:iv as BufferSource,additionalData:new TextEncoder().encode('dtp-encrypted-passport-1')},await encryptionKey(passphrase,salt),ciphertext as BufferSource))) as Wallet; }
  catch {throw new Error('Wrong passphrase or damaged identity file');}
  if(wallet.format!=='dtp-passport-preview-1'||!['operational','recovery'].includes(wallet.kind)||typeof wallet.person_id!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(wallet.person_id))throw new Error('Invalid identity file');
  const key=await keyPairFromSecret(wallet.secret_key),probe=crypto.getRandomValues(new Uint8Array(32));
  if(!await verifyBytes(key.keyId,probe,await signBytes(key.secretKey,probe)))throw new Error('Identity key mismatch');
  httpTransport(wallet.resolver.audience);return wallet;
}
export async function signCommand(command:Command,challenge:Challenge,keys:KeyPair[]):Promise<Request> {
  const body=structuredClone({command,challenge});const data=canonicalBytes({domain:'DTP-ONBOARDING-PREVIEW-COMMAND-1',body});
  return {...body,signatures:await Promise.all(keys.map(async k=>({key_id:k.keyId,signature:encodeSignature(await signBytes(k.secretKey,data))})))};
}
export class PassportClient {
  wallet:Wallet;
  transport:Transport;
  constructor(wallet:Wallet,transport:Transport=httpTransport(wallet.resolver.audience)) {this.wallet=wallet;this.transport=transport;}
  async request(command:Command) {
    if(this.wallet.kind!=='operational')throw new Error('Recovery keys cannot perform business commands');
    const ch:Challenge=await this.transport('challenge',{person_id:this.wallet.person_id,command});
    if(ch.person_id!==this.wallet.person_id||ch.audience!==this.wallet.resolver.audience)throw new Error('Challenge binding mismatch');
    return signCommand(command,ch,[await keyPairFromSecret(this.wallet.secret_key)]);
  }
  async run(action:string,organization_id:string|null=null,parameters:Record<string,any>={},request_id=crypto.randomUUID()):Promise<any> {
    return this.transport('execute',await this.request({request_id,action,organization_id,parameters}));
  }
  async prepareTransition(now?:number):Promise<{next:Wallet;command:Signed<Transition>}> {
    const expected={identity_id:this.wallet.person_id,audience:this.wallet.resolver.audience,challenge:hex(crypto.getRandomValues(new Uint8Array(32)))};
    const proof=await this.transport('resolve',expected);
    // A network response may be issued after the call started. Sample after receipt.
    const verifiedAt=now??Date.now();
    const head=await verifyResolution(proof,{...expected,resolver_id:this.wallet.resolver.resolver_id,resolver_key:this.wallet.resolver.resolver_key,resolver_epoch:epochOf(this.wallet.resolver),minimum_sequence:0,minimum_digest:null},verifiedAt);
    const key=await generateKeyPair(),old=await keyPairFromSecret(this.wallet.secret_key);
    const command=await signIdentity<Transition>('DTP-IDENTITY-TRANSITION-1',{identity_id:this.wallet.person_id,expected_digest:proof.body.head_digest,sequence:head.sequence+1,kind:this.wallet.kind==='recovery'?'recover':'rotate',operational:{keys:[key.keyId],threshold:1},recovery:head.recovery,issued_at:verifiedAt,expires_at:verifiedAt+300000},[old,key]);
    return {next:{...this.wallet,kind:'operational',secret_key:key.secretKey},command};
  }
  /** First registration at the pinned resolver. */
  async enroll(genesis:Signed<Genesis>,enrollment:Signed<ResolverEnrollment>):Promise<Changed<any>> { return this.changed(this.transport('enroll',{genesis,enrollment})); }
  async applyTransition(command:Signed<Transition>):Promise<Changed<{identity_id:string;head_digest:string;sequence:number;effective_at:number}>> { return this.changed(this.transport('transition',{person_id:this.wallet.person_id,command})); }
  private async changed<A>(pending:Promise<A>):Promise<Changed<A>> { const ack=await pending;return {ack,log:await this.exportLog()}; }
  /** Signs a move of this identity to another resolver with the recovery key, from the current head of a verified log.
   *  Needs nothing from the current host. Returns the rehome and this wallet re-pinned to the destination. */
  async prepareRehome(log:IdentityLog,to:ResolverMetadata,now=Date.now()):Promise<{rehome:Signed<Rehome>;next:Wallet}> {
    if(this.wallet.kind!=='recovery')throw new Error('Only recovery authority can move an identity');
    const v=await verifyIdentityLog(log,{require_attestation:false}),pinned=this.wallet.resolver;
    if(v.identity_id!==this.wallet.person_id||v.resolver.id!==pinned.resolver_id||v.resolver.key_id!==pinned.resolver_key||v.resolver.audience!==pinned.audience||v.resolver.epoch!==epochOf(pinned))throw new Error('Identity log binding mismatch');
    const rehome=await signIdentity<Rehome>('DTP-IDENTITY-REHOME-1',{identity_id:v.identity_id,expected_digest:v.head_digest,sequence:v.head.sequence+1,from:{resolver_id:v.resolver.id,resolver_epoch:v.resolver.epoch},
      to:{resolver_id:to.resolver_id,resolver_key:to.resolver_key,audience:to.audience,resolver_epoch:v.resolver.epoch+1},issued_at:now,expires_at:now+300000},[await keyPairFromSecret(this.wallet.secret_key)]);
    return {rehome,next:rehomeWallet(this.wallet,to)};
  }
  /** Destination side: this client must already be pinned to the destination. */
  async adopt(log:IdentityLog,rehome:Signed<Rehome>):Promise<Changed<{identity_id:string;head_digest:string;sequence:number;effective_at:number;resolver_epoch:number}>> { return this.changed(this.transport('adopt',{log,rehome})); }
  /** Former-host side, cooperative case: hand the old host the log that leaves it. */
  async release(log:IdentityLog) { return this.transport('transfer',{log}); }
  /** The portable control history, to keep somewhere the host cannot reach. Verified against this wallet's pinned resolver before it is returned. */
  async exportLog():Promise<IdentityLog> {
    const log:IdentityLog=await this.transport('log',{person_id:this.wallet.person_id}),checked=await verifyIdentityLog(log,{require_attestation:true}),pinned=this.wallet.resolver;
    if(checked.identity_id!==this.wallet.person_id||checked.resolver.id!==pinned.resolver_id||checked.resolver.key_id!==pinned.resolver_key||checked.resolver.audience!==pinned.audience||checked.resolver.epoch!==epochOf(pinned))throw new Error('Identity log binding mismatch');
    return log;
  }
}
