import assert from "node:assert/strict";
import { generateKeyPair } from "../../src/keys.ts";
import type { KeyPair } from "../../src/keys.ts";
import { digest,draftCommand,organizationId,personId,signCommand } from "../../src/v04/wire.ts";
import type { Command } from "../../src/v04/model.ts";
export type Person={id:string;key:KeyPair};
export const expiry=()=>new Date(Date.now()+86400000).toISOString();
export class Client{
  audience:string;
  constructor(audience:string){this.audience=audience;}
  async send(command:Command){const response=await fetch(this.audience+"/dtp/v0.4/commands",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(command),signal:AbortSignal.timeout(30000)});return{status:response.status,...await response.json()};}
  async act(person:Person,action:string,org:string|null,payload:any,cosign:KeyPair[]=[]){return this.send(await signCommand(draftCommand(this.audience,person,action,org,payload),[person.key,...cosign]));}
  async ok(person:Person,action:string,org:string|null,payload:any,cosign:KeyPair[]=[]){const r=await this.act(person,action,org,payload,cosign);assert.equal(r.status,200,JSON.stringify(r.error));return r.result;}
}
export async function person(client:Client,existing?:Person){const key=existing?.key??await generateKeyPair(),p=existing??{id:await personId(key.keyId),key};await client.ok(p,"person.register",null,{keys:[key.keyId]});return p;}
export async function company(client:Client,owner:Person,name="Synthetic Test Co"){const nonce=crypto.randomUUID(),id=await organizationId(owner.id,nonce);await client.ok(owner,"organization.create",id,{name,nonce,controllers:[owner.id],threshold:1});return id;}
export async function member(client:Client,owner:Person,org:string,target:Person,permissions:string[]=[]){const invitation_id=crypto.randomUUID();await client.ok(owner,"membership.invite",org,{invitation_id,person_id:target.id,permissions,expires_at:new Date(Date.now()+2*86400000).toISOString()});await client.ok(target,"membership.accept",org,{invitation_id});}
export const string=(maxLength=120)=>({type:"string",maxLength});
export const object=(properties:Record<string,any>,required=Object.keys(properties))=>({type:"object",properties,required,additionalProperties:false});
export async function profile(client:Client,owner:Person,org:string,schema=object({note:string(65536)}),semantics="structural",visibility="private"){
  const contract={publisher_id:org,name:"test-"+crypto.randomUUID(),version:"1.0.0",schema,semantics,dependencies:[]};
  const hash=await digest(contract);const{publisher_id:_,...payload}=contract;await client.ok(owner,"profile.publish",org,{...payload,digest:hash,visibility,readers:[]});return hash;
}
export async function policy(client:Client,owner:Person,org:string,grants:any[],stewards=[owner],classification="business"){
  const policy_id=crypto.randomUUID();await client.ok(owner,"policy.create",org,{policy_id,expected_revision:0,classification,stewards:stewards.map(p=>p.id),threshold:stewards.length,grants},stewards.filter(p=>p.id!==owner.id).map(p=>p.key));return policy_id;
}
export const grant=(p:Person,resource_ids:string[]|"*"="*",actions=["read","write","export"])=>({person_id:p.id,actions,resource_ids,expires_at:expiry()});
export function record(org:string,pol:string,resource:string,profile_digest:string,body:any,counterparty_ids:string[]=[]){const id=crypto.randomUUID();return{id,root_id:id,supersedes:null,organization_id:org,policy_id:pol,resource_id:resource,profile_digest,counterparty_ids,body};}
