/** Indexed, transactional pilot resolver. No public directory or user-reset backdoor. */
import type { Db } from '../../../supabase/functions/dtp-store/db.ts';
import type { KeyPair } from '../keys.ts';
import { canonicalBytes, canonicalize, sha256Hex } from '../canonical.ts';
import { createIdentity, copyIdentityData, issueResolution, rehomeIdentity, transitionIdentity, verifyResolverEnrollment } from './identity.ts';
import type { Genesis, IdentityState, Rehome, ResolutionRequest, ResolverEnrollment, Signed, Transition } from './identity.ts';
import { attestHead, buildIdentityLog, recoverGenesisInstant, refuseRehome, rehomeDigest, verifyIdentityLog } from './identity-log.ts';
import type { IdentityLog, IdentityLogEntry, RehomeRefusal } from './identity-log.ts';

export interface ResolverConfig { id:string; audience:string; key:KeyPair; now:()=>number }
export const IDENTITY_REGISTRY_SCHEMA = `
create schema if not exists dtp_foundation;
create table if not exists dtp_foundation.identities (
 identity_id uuid primary key,
 genesis_digest text not null check (genesis_digest ~ '^[0-9a-f]{64}$'),
 enrollment_digest text not null check (enrollment_digest ~ '^[0-9a-f]{64}$'),
 resolver_audience text not null,
 body jsonb not null,
 status text not null default 'active' check (status in ('active','frozen','transferred')),
 revision bigint not null default 0 check (revision >= 0)
);
create table if not exists dtp_foundation.identity_history (
 identity_id uuid not null references dtp_foundation.identities(identity_id),
 sequence bigint not null check (sequence >= 0),
 command_digest text not null check (command_digest ~ '^[0-9a-f]{64}$'),
 body jsonb not null,
 result jsonb,
 primary key(identity_id, sequence), unique(identity_id, command_digest)
);
alter table dtp_foundation.identity_history add column if not exists result jsonb;
-- When head 0 took effect. It is in no signed document, and the first transition overwrites the only other copy.
alter table dtp_foundation.identities add column if not exists genesis_effective_at bigint check (genesis_effective_at >= 0);
-- Resolver head attestations, including those of former resolvers, which this host cannot re-issue.
alter table dtp_foundation.identity_history add column if not exists attestation jsonb;
-- Rehomes this resolver signed a refusal for. A refused rehome is never adopted here: the refusal says never.
create table if not exists dtp_foundation.identity_refusals (
 rehome_digest text primary key check (rehome_digest ~ '^[0-9a-f]{64}$'),
 identity_id uuid not null, body jsonb not null
);
`;
interface Row { body:IdentityState; genesis_digest:string; enrollment_digest:string; resolver_audience:string; status:string; revision:string|number; genesis_effective_at:string|number|null }
interface HistoryRow { sequence:string|number; body:unknown; result:{effective_at:number}|null; attestation:IdentityLogEntry['attestation'] }
const isRehome=(body:unknown):body is {rehome:Signed<Rehome>}=>typeof body==='object'&&body!==null&&'rehome' in body;
function entry(h:HistoryRow):IdentityLogEntry{ return {effective_at:h.result!.effective_at,transition:isRehome(h.body)?null:h.body as Signed<Transition>,rehome:isRehome(h.body)?h.body.rehome:null,attestation:h.attestation??null}; }
function need(ok:unknown,why:string):asserts ok{if(!ok)throw new Error(why);}
function id(value:string){need(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value),'invalid identity id');}
const digest=(v:unknown)=>sha256Hex(canonicalBytes(v));
/** A configured instance owns this database's resolver rows. Never expose Db to clients. */
export function createIdentityRegistry(db:Db,config:ResolverConfig){
  id(config.id);const parsed=new URL(config.audience);need(parsed.origin===config.audience&&['http:','https:'].includes(parsed.protocol),'exact resolver audience required');
  const resolver={id:config.id,key_id:config.key.keyId},audience=config.audience,key={...config.key,seed:new Uint8Array(config.key.seed),publicKey:new Uint8Array(config.key.publicKey)};
  async function anyRow(tx:Db,identity:string):Promise<Row>{
    id(identity);const rows=await tx.query<Row>('select body,genesis_digest,enrollment_digest,resolver_audience,status,revision,genesis_effective_at from dtp_foundation.identities where identity_id=$1 for update',[identity]);
    need(rows.length===1,'identity unavailable');return rows[0];
  }
  async function locked(tx:Db,identity:string):Promise<Row>{
    const row=await anyRow(tx,identity);need(row.status==='active','identity resolver frozen or transferred');
    need(row.body.resolver_id===resolver.id&&row.body.resolver_key===resolver.key_id&&row.resolver_audience===audience,'identity belongs to another resolver');return row;
  }
  async function save(tx:Db,row:Row,state:IdentityState){
    const changed=await tx.query('update dtp_foundation.identities set body=$1::text::jsonb,revision=revision+1 where identity_id=$2 and revision=$3 and status=$4 returning identity_id',[JSON.stringify(state),state.head.identity_id,row.revision,'active']);
    need(changed.length===1,'identity concurrent update');
  }
  return {
    async enroll(genesis:Signed<Genesis>,enrollment:Signed<ResolverEnrollment>){
      genesis=copyIdentityData(genesis);enrollment=copyIdentityData(enrollment);
      // Verification precedes every DB write. Enrollment is owner-signed and time-limited.
      const now=config.now(),candidate=await createIdentity(genesis,resolver,now);
      await verifyResolverEnrollment(candidate,enrollment,audience,now);
      const enrollment_digest=await digest(enrollment.body),genesis_digest=candidate.genesis_digest;
      return db.transaction(async tx=>{
        await tx.query('insert into dtp_foundation.identities(identity_id,genesis_digest,enrollment_digest,resolver_audience,body,genesis_effective_at) values($1,$2,$3,$4,$5::text::jsonb,$6) on conflict(identity_id) do nothing',[candidate.head.identity_id,genesis_digest,enrollment_digest,audience,JSON.stringify(candidate),candidate.head.effective_at]);
        const row=await locked(tx,candidate.head.identity_id);
        need(row.genesis_digest===genesis_digest&&row.enrollment_digest===enrollment_digest,'identity enrollment conflict');
        await tx.query('insert into dtp_foundation.identity_history(identity_id,sequence,command_digest,body) values($1,0,$2,$3::text::jsonb) on conflict(identity_id,sequence) do nothing',[candidate.head.identity_id,enrollment_digest,JSON.stringify({genesis,enrollment})]);
        // Do not expose current keys/history through a replayed initial enrollment.
        return {identity_id:candidate.head.identity_id,genesis_digest,enrollment_digest,resolver_id:resolver.id,resolver_key:resolver.key_id,audience};
      });
    },
    async transition(identity:string,command:Signed<Transition>){
      command=copyIdentityData(command);
      id(identity);
      return db.transaction(async tx=>{
        const row=await locked(tx,identity),now=config.now();
        const command_digest=await digest(command.body);
        const existing=await tx.query<{body:Signed<Transition>;result:unknown}>('select body,result from dtp_foundation.identity_history where identity_id=$1 and command_digest=$2',[identity,command_digest]);
        if(existing.length){
          need(existing[0].result!==null&&canonicalize(existing[0].body)===canonicalize(command),'transition replay envelope conflict');
          // Historical acknowledgment only: no fresh authority proof and no new mutation.
          return copyIdentityData(existing[0].result) as {identity_id:string;head_digest:string;sequence:number;effective_at:number};
        }
        // transitionIdentity validates signature, full closed shape and current exact head.
        const next=await transitionIdentity(row.body,command,now);
        const result={identity_id:identity,head_digest:next.head_digest,sequence:next.head.sequence,effective_at:next.head.effective_at};
        await save(tx,row,next);
        await tx.query('insert into dtp_foundation.identity_history(identity_id,sequence,command_digest,body,result) values($1,$2,$3,$4::text::jsonb,$5::text::jsonb)',[identity,next.head.sequence,command_digest,JSON.stringify(command),JSON.stringify(result)]);
        return result;
      });
    },
    async resolve(request:ResolutionRequest){
      request=copyIdentityData(request);
      // Parsing occurs in issueResolution; only the primitive ID reaches a parameterized query first.
      const identity=Object.getOwnPropertyDescriptor(request,'identity_id');need(identity&&'value'in identity,'resolution identity data field required');id(identity.value);
      return db.transaction(async tx=>{
        const row=await locked(tx,identity.value),issued=await issueResolution(row.body,request,key,config.now());
        await save(tx,row,issued.state);
        // The transaction promise must commit before this signed proof reaches the caller.
        return issued.proof;
      });
    },
    /** The portable, resolver-attested control history. Public keys and signatures only. A frozen or
     *  transferred identity stays exportable: leaving must not depend on remaining in good standing. */
    async exportLog(identity:string):Promise<IdentityLog>{
      id(identity);
      const parts=await db.transaction(async tx=>{
        const row=await anyRow(tx,identity);
        const history=await tx.query<HistoryRow>('select sequence,body,result,attestation from dtp_foundation.identity_history where identity_id=$1 order by sequence',[identity]);
        need(history.length>=1&&history.length===row.body.head.sequence+1&&history.every((h,i)=>Number(h.sequence)===i),'identity history incomplete');
        const {genesis,enrollment}=history[0].body as {genesis:Signed<Genesis>;enrollment:Signed<ResolverEnrollment>};
        // Our binding, or a history that leaves us: a transferred identity is served up to and including its rehome.
        const tail=history[history.length-1].body;
        const leaving=row.status==='transferred'&&isRehome(tail)&&tail.rehome.body.from.resolver_id===resolver.id;
        need(leaving||(row.body.resolver_id===resolver.id&&row.body.resolver_key===resolver.key_id&&row.resolver_audience===audience),'identity belongs to another resolver');
        const later=history.slice(1).map(h=>{need(h.result!==null,'identity history incomplete');return entry(h);});
        const recorded=row.genesis_effective_at!==null?Number(row.genesis_effective_at):later.length===0?row.body.head.effective_at:null;
        return {genesis,enrollment,recorded,first:history[0].attestation??null,later};
      });
      // Rows enrolled before the instant was recorded: recover it from the first owner-signed transition, outside the row lock.
      const genesis_effective_at=parts.recorded??(parts.later[0].transition!==null?await recoverGenesisInstant(parts.genesis,parts.enrollment,parts.later[0].transition.body.expected_digest):null);
      need(genesis_effective_at!==null,'identity history incomplete');
      // buildIdentityLog verifies what it emits, so a damaged store fails here rather than at a verifier.
      return buildIdentityLog({genesis:parts.genesis,enrollment:parts.enrollment,entries:[{effective_at:genesis_effective_at,transition:null,rehome:null,attestation:parts.first},...parts.later]},key);
    },
    /** Destination side of a move. Verifies the whole log from genesis and the owner-signed rehome naming this
     *  resolver, stores the entire history so this host can export a complete log later, and continues from the
     *  new head. Unattested heads are accepted: the former host may be gone or hostile, and the rehome's
     *  expected_digest pins the last head anyway. Returning to a former host extends the stored prefix. */
    async adopt(log:IdentityLog,rehome:Signed<Rehome>){
      log=copyIdentityData(log);rehome=copyIdentityData(rehome);
      const now=config.now(),verified=await verifyIdentityLog(log,{require_attestation:false}),identity=verified.identity_id;
      const next=await rehomeIdentity(verified.state,rehome,now);
      need(next.resolver_id===resolver.id&&next.resolver_key===resolver.key_id&&rehome.body.to.audience===audience,'rehome names another resolver');
      const refused=await rehomeDigest(rehome);
      const result={identity_id:identity,head_digest:next.head_digest,sequence:next.head.sequence,effective_at:next.head.effective_at,resolver_epoch:next.resolver_epoch};
      const rows:{sequence:number;command_digest:string;body:unknown;result:unknown|null;attestation:unknown|null}[]=[];
      for(let n=0;n<log.entries.length;n++){
        const e=log.entries[n],body=n===0?{genesis:log.genesis,enrollment:log.enrollment}:e.transition!==null?e.transition:{rehome:e.rehome!};
        const signed=n===0?log.enrollment.body:e.transition!==null?e.transition.body:e.rehome!.body;
        rows.push({sequence:n,command_digest:await digest(signed),body,result:n===0?null:{identity_id:identity,head_digest:verified.heads[n].head_digest,sequence:n,effective_at:e.effective_at},attestation:e.attestation});
      }
      rows.push({sequence:rows.length,command_digest:await digest(rehome.body),body:{rehome},result,attestation:await attestHead(next.head,{id:resolver.id,epoch:next.resolver_epoch},key)});
      return db.transaction(async tx=>{
        need((await tx.query('select 1 from dtp_foundation.identity_refusals where rehome_digest=$1',[refused])).length===0,'rehome refused by this resolver');
        await tx.query('insert into dtp_foundation.identities(identity_id,genesis_digest,enrollment_digest,resolver_audience,body,genesis_effective_at) values($1,$2,$3,$4,$5::text::jsonb,$6) on conflict(identity_id) do nothing',[identity,verified.genesis_digest,rows[0].command_digest,audience,JSON.stringify(next),log.entries[0].effective_at]);
        const row=await anyRow(tx,identity);
        need(row.genesis_digest===verified.genesis_digest,'identity enrollment conflict');
        const stored=await tx.query<HistoryRow>('select sequence,body,result,attestation from dtp_foundation.identity_history where identity_id=$1 order by sequence',[identity]);
        // Whatever this host already holds must be a prefix of the presented history; an exact replay acknowledges.
        need(stored.length<=rows.length&&stored.every((h,i)=>Number(h.sequence)===i),'identity history incomplete');
        for(let i=0;i<stored.length;i++)need(canonicalize(stored[i].body)===canonicalize(rows[i].body)&&(i===0||stored[i].result?.effective_at===(rows[i].result as {effective_at:number}).effective_at),'identity already held with a different history');
        if(stored.length===rows.length){need(row.body.head_digest===next.head_digest,'identity already held with a different history');return copyIdentityData(stored[rows.length-1].result) as typeof result;}
        need(row.status!=='frozen','identity resolver frozen');
        for(const r of rows.slice(stored.length))await tx.query('insert into dtp_foundation.identity_history(identity_id,sequence,command_digest,body,result,attestation) values($1,$2,$3,$4::text::jsonb,$5::text::jsonb,$6::text::jsonb)',[identity,r.sequence,r.command_digest,JSON.stringify(r.body),r.result===null?null:JSON.stringify(r.result),r.attestation===null?null:JSON.stringify(r.attestation)]);
        const changed=await tx.query("update dtp_foundation.identities set body=$1::text::jsonb,resolver_audience=$2,status='active',revision=revision+1 where identity_id=$3 and revision=$4 returning identity_id",[JSON.stringify(next),audience,identity,row.revision]);
        need(changed.length===1,'identity concurrent update');
        return result;
      });
    },
    /** Destination side, declining: a signed statement that this rehome, which names this resolver, was not and will
     *  never be adopted here. Durable: a later adoption of the same rehome is refused, so the refusal cannot become
     *  an equivocation. A rehome already adopted here cannot be refused. Replaying a refusal returns the stored one. */
    async refuse(rehome:Signed<Rehome>):Promise<Signed<RehomeRefusal>>{
      rehome=copyIdentityData(rehome);
      const to=rehome.body?.to;need(to&&to.resolver_id===resolver.id&&to.resolver_key===resolver.key_id&&to.audience===audience,'rehome names another resolver');
      const identity=rehome.body.identity_id;id(identity);const rehome_digest=await rehomeDigest(rehome);
      return db.transaction(async tx=>{
        const stored=await tx.query<{body:Signed<RehomeRefusal>}>('select body from dtp_foundation.identity_refusals where rehome_digest=$1',[rehome_digest]);
        if(stored.length)return copyIdentityData(stored[0].body);
        need((await tx.query('select 1 from dtp_foundation.identity_history where identity_id=$1 and command_digest=$2',[identity,await digest(rehome.body)])).length===0,'rehome already adopted');
        const refusal=await refuseRehome(rehome,key,config.now());
        await tx.query('insert into dtp_foundation.identity_refusals(rehome_digest,identity_id,body) values($1,$2,$3::text::jsonb)',[rehome_digest,identity,JSON.stringify(refusal)]);
        return refusal;
      });
    },
    /** Former-host side of a cooperative move. Verifies a log that leaves this resolver, records the rehome and stops
     *  serving the identity. From then on this host answers with the log ending in the rehome: a forwarding address
     *  that needs no trust in this host. Optional courtesy; the move is valid without it. */
    async transfer(log:IdentityLog){
      log=copyIdentityData(log);
      const verified=await verifyIdentityLog(log,{require_attestation:false}),identity=verified.identity_id;
      return db.transaction(async tx=>{
        const row=await anyRow(tx,identity),held=row.body;
        // The rehome that leaves the binding this host holds, or held until it transferred, wherever it sits in the verified log.
        const epoch=row.status==='transferred'?held.resolver_epoch-1:held.resolver_epoch;
        const n=log.entries.findIndex(e=>e.rehome!==null&&e.rehome.body.from.resolver_id===resolver.id&&e.rehome.body.from.resolver_epoch===epoch);
        need(n>0&&row.resolver_audience===audience,'log does not leave this resolver');
        const move=log.entries[n],rehome_digest=await digest(move.rehome!.body);
        const existing=await tx.query<HistoryRow>('select sequence,body,result,attestation from dtp_foundation.identity_history where identity_id=$1 and command_digest=$2',[identity,rehome_digest]);
        if(existing.length){need(row.status==='transferred'&&canonicalize((existing[0].body as {rehome:unknown}).rehome)===canonicalize(move.rehome),'transfer replay envelope conflict');return copyIdentityData(existing[0].result) as {identity_id:string;head_digest:string;sequence:number;effective_at:number;resolver_epoch:number};}
        need(row.status==='active'&&held.resolver_id===resolver.id&&held.resolver_key===resolver.key_id,'identity resolver frozen or transferred');
        need(n===held.head.sequence+1&&move.rehome!.body.expected_digest===held.head_digest,'stale control head');
        // Recompute the head after the rehome from what this host holds; it must be the head the log proves.
        const next=await rehomeIdentity({...held,last_update:held.head.effective_at},move.rehome!,move.effective_at);
        need(next.head_digest===verified.heads[n].head_digest,'stale control head');
        const result={identity_id:identity,head_digest:next.head_digest,sequence:n,effective_at:move.effective_at,resolver_epoch:next.resolver_epoch};
        await tx.query('insert into dtp_foundation.identity_history(identity_id,sequence,command_digest,body,result,attestation) values($1,$2,$3,$4::text::jsonb,$5::text::jsonb,$6::text::jsonb)',[identity,n,rehome_digest,JSON.stringify({rehome:move.rehome}),JSON.stringify(result),move.attestation===null?null:JSON.stringify(move.attestation)]);
        const changed=await tx.query("update dtp_foundation.identities set body=$1::text::jsonb,status='transferred',revision=revision+1 where identity_id=$2 and revision=$3 and status='active' returning identity_id",[JSON.stringify(next),identity,row.revision]);
        need(changed.length===1,'identity concurrent update');
        return result;
      });
    },
  };
}
