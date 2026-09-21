/** Indexed, transactional pilot resolver. No public directory or user-reset backdoor. */
import type { Db } from '../../../supabase/functions/dtp-store/db.ts';
import type { KeyPair } from '../keys.ts';
import { canonicalBytes, canonicalize, sha256Hex } from '../canonical.ts';
import { createIdentity, copyIdentityData, issueResolution, transitionIdentity, verifyResolverEnrollment } from './identity.ts';
import type { Genesis, IdentityState, ResolutionRequest, ResolverEnrollment, Signed, Transition } from './identity.ts';
import { buildIdentityLog, recoverGenesisInstant } from './identity-log.ts';
import type { IdentityLog } from './identity-log.ts';

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
`;
interface Row { body:IdentityState; genesis_digest:string; enrollment_digest:string; resolver_audience:string; status:string; revision:string|number }
function need(ok:unknown,why:string):asserts ok{if(!ok)throw new Error(why);}
function id(value:string){need(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value),'invalid identity id');}
const digest=(v:unknown)=>sha256Hex(canonicalBytes(v));
/** A configured instance owns this database's resolver rows. Never expose Db to clients. */
export function createIdentityRegistry(db:Db,config:ResolverConfig){
  id(config.id);const parsed=new URL(config.audience);need(parsed.origin===config.audience&&['http:','https:'].includes(parsed.protocol),'exact resolver audience required');
  const resolver={id:config.id,key_id:config.key.keyId},audience=config.audience,key={...config.key,seed:new Uint8Array(config.key.seed),publicKey:new Uint8Array(config.key.publicKey)};
  async function locked(tx:Db,identity:string):Promise<Row>{
    id(identity);const rows=await tx.query<Row>('select body,genesis_digest,enrollment_digest,resolver_audience,status,revision from dtp_foundation.identities where identity_id=$1 for update',[identity]);
    need(rows.length===1,'identity unavailable');const row=rows[0];need(row.status==='active','identity resolver frozen or transferred');
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
        const rows=await tx.query<{body:IdentityState;resolver_audience:string;genesis_effective_at:string|number|null}>('select body,resolver_audience,genesis_effective_at from dtp_foundation.identities where identity_id=$1 for update',[identity]);
        need(rows.length===1,'identity unavailable');const row=rows[0];
        need(row.body.resolver_id===resolver.id&&row.body.resolver_key===resolver.key_id&&row.resolver_audience===audience,'identity belongs to another resolver');
        const history=await tx.query<{body:any;result:{effective_at:number}|null}>('select body,result from dtp_foundation.identity_history where identity_id=$1 order by sequence',[identity]);
        need(history.length>=1&&history.length===row.body.head.sequence+1,'identity history incomplete');
        const {genesis,enrollment}=history[0].body as {genesis:Signed<Genesis>;enrollment:Signed<ResolverEnrollment>};
        const transitions=history.slice(1).map(h=>{need(h.result!==null,'identity history incomplete');return {command:h.body as Signed<Transition>,effective_at:h.result.effective_at};});
        const recorded=row.genesis_effective_at!==null?Number(row.genesis_effective_at):transitions.length===0?row.body.head.effective_at:null;
        return {genesis,enrollment,recorded,transitions};
      });
      // Rows enrolled before the instant was recorded: recover it from the first owner-signed transition, outside the row lock.
      const genesis_effective_at=parts.recorded??await recoverGenesisInstant(parts.genesis,parts.enrollment,parts.transitions[0].command.body.expected_digest);
      need(genesis_effective_at!==null,'identity history incomplete');
      // buildIdentityLog verifies what it emits, so a damaged store fails here rather than at a verifier.
      return buildIdentityLog({genesis:parts.genesis,enrollment:parts.enrollment,genesis_effective_at,transitions:parts.transitions},key);
    },
  };
}
