/** Local, synthetic onboarding reference host. Not the production foundation gateway. */
import type { Db } from '../../../supabase/functions/dtp-store/db.ts';
import { canonicalBytes, canonicalize, sha256Hex } from '../canonical.ts';
import { decodeSignature, verifyBytes } from '../keys.ts';
import { copyIdentityData } from '../foundation/identity.ts';
import type { IdentityState, Signature } from '../foundation/identity.ts';
import { createIdentityRegistry } from '../foundation/identity-registry.ts';
import type { ResolverConfig } from '../foundation/identity-registry.ts';
import { createAuthorityState, issueGrant, revokeGrant, authorizeAndCharge } from '../foundation/authority.ts';
import type { AuthorityState, CapabilityGrant } from '../foundation/authority.ts';
import { organizationGenesisDigest, organizationGovernance } from '../foundation/organization.ts';
import type { OrganizationGenesis } from '../foundation/organization.ts';

export const COMMAND_DOMAIN = 'DTP-ONBOARDING-PREVIEW-COMMAND-1';
export const PROFILE = '1'.repeat(64); // Reserved synthetic profile; not an admitted accounting profile.
export interface Command { request_id:string; action:string; organization_id:string|null; parameters:Record<string,any> }
export interface Challenge { person_id:string; audience:string; nonce:string; command_digest:string; expires_at:number }
export interface Request { command:Command; challenge:Challenge; signatures:Signature[] }
interface Company { organization_id:string; name:string; controller_id:string; authority:AuthorityState }
interface Member { organization_id:string; person_id:string; grant_id:string; status:string; role:string; invited_by:string }
export const ONBOARDING_SCHEMA = `
create schema if not exists dtp_onboarding;
create table if not exists dtp_onboarding.challenges (
 nonce text primary key, person_id uuid not null, body jsonb not null, expires_at bigint not null, consumed boolean not null default false
);
create index if not exists onboarding_challenge_person on dtp_onboarding.challenges(person_id);
create table if not exists dtp_onboarding.companies (
 organization_id uuid primary key, name text not null, controller_id uuid not null, authority jsonb not null
);
-- The full genesis is retained so the organization can be re-presented elsewhere. Rows created before these columns have none.
alter table dtp_onboarding.companies add column if not exists genesis jsonb;
alter table dtp_onboarding.companies add column if not exists genesis_digest text check (genesis_digest ~ '^[0-9a-f]{64}$');
create table if not exists dtp_onboarding.memberships (
 organization_id uuid not null references dtp_onboarding.companies(organization_id), person_id uuid not null,
 grant_id uuid not null, status text not null check(status in ('pending','active','revoked')), role text not null,
 invited_by uuid not null, primary key(organization_id,person_id)
);
create index if not exists onboarding_member_person on dtp_onboarding.memberships(person_id,status);
create table if not exists dtp_onboarding.notes (
 organization_id uuid not null references dtp_onboarding.companies(organization_id), note_id uuid not null,
 body text not null, author_id uuid not null, primary key(organization_id,note_id)
);
create table if not exists dtp_onboarding.receipts (
 person_id uuid not null, request_id uuid not null, digest text not null, result jsonb not null,
 primary key(person_id,request_id)
);
create table if not exists dtp_onboarding.audit (
 sequence bigint generated always as identity primary key, organization_id uuid not null,
 person_id uuid not null, action text not null, request_id uuid not null, at_ms bigint not null
);
`;
function need(ok:unknown, why:string):asserts ok { if(!ok) throw new Error(why); }
function uuid(x:unknown):asserts x is string { need(typeof x==='string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(x),'UUID required'); }
function exact(x:any, fields:string[]) { need(x && typeof x==='object' && !Array.isArray(x) && Object.keys(x).length===fields.length && fields.every(k=>Object.hasOwn(x,k)),'Exact command fields required'); }
function text(x:unknown,max:number):asserts x is string { need(typeof x==='string' && x.trim().length>0 && x.length<=max,'Bounded nonempty text required'); }
const digest=(v:unknown)=>sha256Hex(canonicalBytes(v));
const person=(id:string)=>({kind:'person' as const,id,organization_id:null});
const actions = ['company.create','companies.list','invitations.list','membership.accept','company.read','membership.invite','membership.revoke','note.create','audit.read'];
function validate(c:Command) {
  exact(c,['request_id','action','organization_id','parameters']); uuid(c.request_id); need(actions.includes(c.action),'Unknown command');
  if(['company.create','companies.list','invitations.list'].includes(c.action)) need(c.organization_id===null,'No organization expected'); else uuid(c.organization_id);
  const p=c.parameters;
  if(c.action==='company.create'){exact(p,['nonce','name']);uuid(p.nonce);text(p.name,120);}
  else if(c.action==='membership.invite'){exact(p,['person_id','role']);uuid(p.person_id);need(['viewer','editor'].includes(p.role),'Only viewer or editor can be invited');}
  else if(c.action==='membership.revoke'){exact(p,['person_id']);uuid(p.person_id);}
  else if(c.action==='membership.accept'){exact(p,['grant_id']);uuid(p.grant_id);}
  else if(c.action==='note.create'){exact(p,['note_id','body']);uuid(p.note_id);text(p.body,2000);}
  else exact(p,[]);
}
export function createOnboardingHost(db:Db, config:ResolverConfig) {
  const registry=createIdentityRegistry(db,config);
  async function liveIdentity(tx:Db,id:string) {
    const rows=await tx.query<{body:IdentityState;status:string;resolver_audience:string}>('select body,status,resolver_audience from dtp_foundation.identities where identity_id=$1 for update',[id]);
    need(rows.length===1 && rows[0].status==='active','Identity unavailable'); const s=rows[0].body;
    need(s.resolver_id===config.id && s.resolver_key===config.key.keyId && rows[0].resolver_audience===config.audience,'Resolver binding mismatch');
    need(config.now()>=s.head.effective_at && config.now()>=s.last_update,'Identity transition pending'); return s;
  }
  async function saveCompany(tx:Db,c:Company) { await tx.query('update dtp_onboarding.companies set authority=$1::jsonb where organization_id=$2',[JSON.stringify(c.authority),c.organization_id]); }
  async function member(tx:Db,org:string,id:string) { return (await tx.query<Member>('select * from dtp_onboarding.memberships where organization_id=$1 and person_id=$2',[org,id]))[0]; }
  function makeGrant(org:string,id:string,role:string,now:number):CapabilityGrant {
    return {id:crypto.randomUUID(),parent_id:null,subject:person(id),scope:{organization_id:org,operations:role==='viewer'?['company.read']:['company.read','note.create'],profiles:[PROFILE],resource_ids:[org]},not_before:now,expires_at:now+365*86400000,delegation_depth:0,limits:[],approval:null};
  }
  return {
    registry,
    metadata:()=>({preview:'synthetic-only',audience:config.audience,resolver_id:config.id,resolver_key:config.key.keyId}),
    async challenge(id:string,command:Command):Promise<Challenge> {
      uuid(id);command=copyIdentityData(command);validate(command);
      return db.transaction(async tx=>{
        await liveIdentity(tx,id); const now=config.now();
        await tx.query('delete from dtp_onboarding.challenges where expires_at <= $1',[now]);
        const count=(await tx.query<{n:number}>('select count(*)::int as n from dtp_onboarding.challenges where person_id=$1',[id]))[0].n;
        need(count<64,'Too many outstanding challenges');
        const body={person_id:id,audience:config.audience,nonce:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),command_digest:await digest(command),expires_at:now+60000};
        await tx.query('insert into dtp_onboarding.challenges(nonce,person_id,body,expires_at) values($1,$2,$3::jsonb,$4)',[body.nonce,id,JSON.stringify(body),body.expires_at]);return body;
      });
    },
    async execute(input:Request) {
      input=copyIdentityData(input);exact(input,['command','challenge','signatures']);validate(input.command);
      const {command:c,challenge:ch,signatures}=input;exact(ch,['person_id','audience','nonce','command_digest','expires_at']);uuid(ch.person_id);
      need(typeof ch.nonce==='string'&&/^[0-9a-f]{64}$/.test(ch.nonce),'Invalid challenge');
      need(Array.isArray(signatures)&&signatures.length>0&&signatures.length<=8,'Signature quorum required');
      const id=ch.person_id,hash=await digest(c);
      return db.transaction(async tx=>{
        // Lock the SAME identity row used by rotation/recovery; no stale session authority.
        const s=await liveIdentity(tx,id);
        const challenge=(await tx.query<{body:Challenge;consumed:boolean}>('select body,consumed from dtp_onboarding.challenges where nonce=$1 for update',[ch.nonce]))[0];
        need(challenge&&!challenge.consumed&&canonicalize(challenge.body)===canonicalize(ch)&&ch.audience===config.audience&&ch.command_digest===hash&&ch.expires_at>config.now(),'Challenge unavailable or expired');
        const signed=new Set<string>(),bytes=canonicalBytes({domain:COMMAND_DOMAIN,body:{command:c,challenge:ch}});
        for(const sig of signatures){exact(sig,['key_id','signature']);need(!signed.has(sig.key_id)&&s.head.operational.keys.includes(sig.key_id),'Not a distinct current operational key');need(await verifyBytes(sig.key_id,bytes,decodeSignature(sig.signature)),'Invalid signature');signed.add(sig.key_id);}
        need(signed.size>=s.head.operational.threshold,'Operational quorum required');
        let company:Company|undefined, membership:Member|undefined;
        if(c.organization_id){
          company=(await tx.query<Company>('select * from dtp_onboarding.companies where organization_id=$1 for update',[c.organization_id]))[0];
          membership=await member(tx,c.organization_id,id);
          need(company&&membership,'Company unavailable');
          if(c.action==='membership.accept') need((membership.status==='pending'||membership.status==='active')&&membership.grant_id===c.parameters.grant_id,'Invitation unavailable');
          else {
            need(membership.status==='active','Company unavailable');
            // Re-check live grant even before returning a historical receipt.
            const op=c.action==='note.create'?'note.create':'company.read';
            const auth=authorizeAndCharge(company.authority,{actor:person(id),grant_id:membership.grant_id,scope:{organization_id:company.organization_id,operations:[op],profiles:[PROFILE],resource_ids:[company.organization_id]},operation_id:c.request_id,intent_digest:hash,plan_digest:hash,usage:[],approvals:[]},config.now());
            company.authority=auth.state;
            if(['membership.invite','membership.revoke','audit.read'].includes(c.action)) need(company.controller_id===id,'Controller required');
          }
        }
        const prior=(await tx.query<{digest:string;result:unknown}>('select digest,result from dtp_onboarding.receipts where person_id=$1 and request_id=$2',[id,c.request_id]))[0];
        need(!prior||prior.digest===hash,'Request ID conflict');
        let result:unknown;
        // Reads are always fresh; never replay a stale company list or data snapshot.
        if(prior&&!['company.read','companies.list','invitations.list','audit.read'].includes(c.action)) result=prior.result;
        else if(c.action==='company.create') {
          // This preview creates one controller. The signed command is that sole controller's consent to the genesis.
          const genesis:OrganizationGenesis={nonce:c.parameters.nonce,founder:id,controllers:[id],threshold:1};
          const governance=await organizationGovernance(genesis),org=governance.organization_id,grant=makeGrant(org,id,'controller',config.now());
          const authority=issueGrant(createAuthorityState([governance]),grant,[{principal:person(id)}],config.now());
          await tx.query('insert into dtp_onboarding.companies(organization_id,name,controller_id,authority,genesis,genesis_digest) values($1,$2,$3,$4::jsonb,$5::jsonb,$6)',[org,c.parameters.name,id,JSON.stringify(authority),JSON.stringify(genesis),await organizationGenesisDigest(genesis)]);
          await tx.query("insert into dtp_onboarding.memberships values($1,$2,$3,'active','controller',$2)",[org,id,grant.id]);
          result={organization_id:org,name:c.parameters.name,role:'controller'};
        } else if(c.action==='companies.list') {
          result=await tx.query("select c.organization_id,c.name,m.role from dtp_onboarding.companies c join dtp_onboarding.memberships m using(organization_id) where m.person_id=$1 and m.status='active' and exists(select 1 from jsonb_array_elements(c.authority->'grants') g where g->'grant'->>'id'=m.grant_id::text and g->>'revoked'='false' and (g->'grant'->>'expires_at')::bigint > $2) order by c.name,c.organization_id",[id,config.now()]);
        } else if(c.action==='invitations.list') {
          result=await tx.query("select m.organization_id,m.grant_id,c.name,m.role from dtp_onboarding.memberships m join dtp_onboarding.companies c using(organization_id) where m.person_id=$1 and m.status='pending' and exists(select 1 from jsonb_array_elements(c.authority->'grants') g where g->'grant'->>'id'=m.grant_id::text and g->>'revoked'='false' and (g->'grant'->>'expires_at')::bigint > $2) order by c.name",[id,config.now()]);
        } else if(c.action==='membership.accept') {
          need(company!.controller_id===membership!.invited_by,'Inviter authority changed');
          const grant=company!.authority.grants.find(x=>x.grant.id===membership!.grant_id);
          need(grant&&!grant.revoked&&grant.grant.expires_at>config.now(),'Invitation unavailable');
          await tx.query("update dtp_onboarding.memberships set status='active' where organization_id=$1 and person_id=$2",[c.organization_id,id]);result={accepted:true};
        } else if(c.action==='membership.invite') {
          const target=c.parameters.person_id;need(target!==company!.controller_id,'Controller already enrolled');
          need((await tx.query('select identity_id from dtp_foundation.identities where identity_id=$1 and status=$2',[target,'active'])).length===1,'Invite a registered identity');
          const old=await member(tx,company!.organization_id,target);need(!old||old.status==='revoked','Membership already exists');
          const grant=makeGrant(company!.organization_id,target,c.parameters.role,config.now());
          company!.authority=issueGrant(company!.authority,grant,[{principal:person(id)}],config.now());
          await tx.query("insert into dtp_onboarding.memberships values($1,$2,$3,'pending',$4,$5) on conflict(organization_id,person_id) do update set grant_id=excluded.grant_id,status='pending',role=excluded.role,invited_by=excluded.invited_by",[c.organization_id,target,grant.id,c.parameters.role,id]);result={invited:true};
        } else if(c.action==='membership.revoke') {
          need(c.parameters.person_id!==company!.controller_id,'Cannot revoke the sole controller');
          const target=await member(tx,company!.organization_id,c.parameters.person_id);need(target,'Membership unavailable');
          company!.authority=revokeGrant(company!.authority,target.grant_id,[{principal:person(id)}]);
          await tx.query("update dtp_onboarding.memberships set status='revoked' where organization_id=$1 and person_id=$2",[c.organization_id,c.parameters.person_id]);result={revoked:true};
        } else if(c.action==='note.create') {
          await tx.query('insert into dtp_onboarding.notes values($1,$2,$3,$4)',[c.organization_id,c.parameters.note_id,c.parameters.body,id]);result={note_id:c.parameters.note_id};
        } else if(c.action==='company.read') {
          result={organization_id:company!.organization_id,name:company!.name,role:membership!.role,
            notes:await tx.query('select note_id,body,author_id from dtp_onboarding.notes where organization_id=$1 order by note_id',[c.organization_id]),
            members:company!.controller_id===id?await tx.query('select person_id,status,role from dtp_onboarding.memberships where organization_id=$1 order by person_id',[c.organization_id]):[]};
        } else if(c.action==='audit.read') {
          result=await tx.query('select sequence,person_id,action,request_id,at_ms from dtp_onboarding.audit where organization_id=$1 order by sequence desc limit 100',[c.organization_id]);
        }
        if(company) await saveCompany(tx,company);
        if(!prior){
          await tx.query('insert into dtp_onboarding.receipts values($1,$2,$3,$4::jsonb)',[id,c.request_id,hash,JSON.stringify(result)]);
          if(c.organization_id)await tx.query('insert into dtp_onboarding.audit(organization_id,person_id,action,request_id,at_ms) values($1,$2,$3,$4,$5)',[c.organization_id,id,c.action,c.request_id,config.now()]);
        }
        need(ch.expires_at>config.now(),'Challenge expired during execution');
        await tx.query('update dtp_onboarding.challenges set consumed=true where nonce=$1',[ch.nonce]);
        return result;
      });
    },
  };
}
