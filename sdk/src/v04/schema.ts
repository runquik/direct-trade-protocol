// Language-neutral candidate command shapes; contextual authority is enforced by engine.ts.
type Schema=Record<string,any>;
const str=(maxLength=120):Schema=>({type:"string",minLength:1,maxLength});
const id:Schema={type:"string",pattern:"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"};
const hash:Schema={type:"string",pattern:"^[0-9a-f]{64}$"};
const key:Schema={type:"string",pattern:"^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$"};
const time:Schema={type:"string",pattern:"^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z$"};
const integer=(max=Number.MAX_SAFE_INTEGER,min=0):Schema=>({type:"integer",minimum:min,maximum:max});
const nullable=(s:Schema):Schema=>({anyOf:[s,{type:"null"}]});
const array=(items:Schema,maxItems:number,minItems=0):Schema=>({type:"array",items,maxItems,minItems,uniqueItems:true});
const object=(properties:Record<string,Schema>):Schema=>({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
const token=object({body:{type:"object"},key_id:key,signature:str(110)});
const dataActions=array({enum:["read","write","export"]},3,1);
const grant=object({person_id:id,actions:dataActions,resource_ids:{anyOf:[{const:"*"},array(id,128,1)]},expires_at:time});
const policy=object({policy_id:id,expected_revision:integer(),classification:{enum:["business","personnel"]},stewards:array(id,8,1),threshold:integer(8,1),grants:array(grant,256)});
const page=object({after:integer(),limit:integer(100,1),profile_digests:array(hash,32)});
const migrationId={migration_id:id};
export const PAYLOADS:Record<string,Schema>={
  "person.register":object({keys:array(key,8,1)}),"person.rotate":object({add:array(key,8),revoke:array(key,8)}),
  "organization.create":object({name:str(),nonce:id,controllers:array(id,8,1),threshold:integer(8,1)}),
  "organization.policy":object({controllers:array(id,8,1),threshold:integer(8,1)}),"organizations.list":object({}),
  "membership.invite":object({invitation_id:id,person_id:id,permissions:array(str(),6),expires_at:time}),
  "membership.accept":object({invitation_id:id}),"membership.revoke":object({person_id:id}),
  "policy.create":policy,"policy.update":policy,"policy.get":object({policy_id:id}),
  "profile.publish":object({name:str(80),version:str(),schema:{type:"object"},semantics:{enum:["structural","inventory-v1","invoice-v1"]},dependencies:array(hash,8),visibility:{enum:["private","community"]},readers:array(id,64),digest:hash}),
  "profile.get":object({digest:hash}),
  "release.publish":object({module_id:id,version:str(),artifact_digest:hash,profiles:array(hash,16,1),actions:dataActions,visibility:{enum:["private","community"]},assessment:nullable(token)}),
  "installation.create":object({installation_id:id,release_digest:hash,key_id:key,policy_ids:array(id,32,1),actions:dataActions,mode:{enum:["interactive","automation"]},expires_at:time}),
  "installation.revoke":object({installation_id:id}),
  "record.append":object({id,root_id:id,supersedes:nullable(id),organization_id:id,policy_id:id,resource_id:id,profile_digest:hash,counterparty_ids:array(id,16),body:{type:"object"}}),
  "record.get":object({id,profile_digest:hash}),"records.list":page,"records.export":page,"workspace.view":page,
  "inventory.create":object({policy_id:id,pool_id:id,product_id:id,base_unit:str()}),"inventory.get":object({policy_id:id,pool_id:id}),
  "authority.export":object({}),"authority.import":object({token}),"authority.relocate":object({token,commit:token}),
  "evidence.issue":object({record_ids:array(id,20,1),recipient:object({organization_id:id,audience:str(300),policy_id:id,resource_id:id}),purpose:str(200),expires_at:time}),
  "evidence.inspect":object({token,accepted_profiles:array(hash,32)}),
  "migration.prepare":object({destination:object({audience:str(300),key_id:key})}),
  "migration.chunk":object({...migrationId,index:integer(511)}),"migration.commit":object({...migrationId,ready:token}),
  "migration.receipt":object(migrationId),"migration.status":object(migrationId),"migration.cancel":object(migrationId),
  "migration.abort":object({...migrationId,cancel:token}),"migration.stage":object({manifest:token}),
  "migration.upload":object({...migrationId,index:integer(511),data:str(87384)}),"migration.ready":object(migrationId),"migration.finalize":object({...migrationId,commit:token}),
};
export const COMMAND_SCHEMA:Schema={
  $schema:"https://json-schema.org/draft/2020-12/schema",$id:"urn:dtp:0.4:command",title:"Direct Trade Protocol 0.4 candidate signed command",
  ...object({version:{const:"0.4"},audience:str(300),request_id:id,issued_at:time,expires_at:time,organization_id:nullable(id),actor:object({kind:{enum:["person","installation"]},id,key_id:key}),requested_by:nullable(id),action:{enum:Object.keys(PAYLOADS)},payload:{type:"object"},signatures:array(object({key_id:key,signature:str(110)}),16,1)}),
  allOf:Object.entries(PAYLOADS).map(([action,payload])=>({if:{properties:{action:{const:action}}},then:{properties:{payload}}})),
};
