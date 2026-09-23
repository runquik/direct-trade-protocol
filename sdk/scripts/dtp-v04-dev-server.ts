// Disposable local candidate host; never reads shared-backend environment values.
// Operator configuration (pins, assessors, capacity, persistence) comes from one local JSON file
// named on the command line or in DTP_V04_DEV_CONFIG, so a builder never edits this source.
import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { generateKeyPair, keyPairFromSecret } from "../src/keys.ts";
import type { KeyPair } from "../src/keys.ts";
import { parseUntrustedJson } from "../src/safe-json.ts";
import { pgliteDb } from "../../supabase/functions/dtp-store/db.ts";
import type { Db } from "../../supabase/functions/dtp-store/db.ts";
import { handle, MAX_REQUEST_BYTES } from "../src/v04/router.ts";
import { parseKindRegistry, profileContract } from "../src/v04/profiles.ts";
import { digest } from "../src/v04/wire.ts";
import type { ProfileContract } from "../src/v04/model.ts";
/** The protocol kind registry and every registered contract, read from spec/profiles as an operator would pin them. */
export async function loadProtocolProfiles(): Promise<{ kinds: Record<string,string[]>; protocolProfiles: Record<string,ProfileContract> }> {
  const base=new URL("../../spec/profiles/",import.meta.url), kinds=parseKindRegistry(JSON.parse(readFileSync(new URL("index.json",base),"utf8"))), protocolProfiles: Record<string,ProfileContract>={};
  for(const name of readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name)) for(const major of readdirSync(new URL(`${name}/`,base),{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name)){
    const file=new URL(`${name}/${major}/profile.json`,base); if(!existsSync(file))continue;
    const contract=profileContract(JSON.parse(readFileSync(file,"utf8"))), hash=await digest(contract);
    if(Object.values(kinds).some(ds=>ds.includes(hash)))protocolProfiles[hash]=contract;
  }
  return {kinds,protocolProfiles};
}
/** Operator configuration of the disposable host. Every member is optional; an unknown member is refused. `data_dir` is resolved against the file's directory. */
export interface DevHostConfig { port?:number; data_dir?:string; pins?:Record<string,string>; assessment_pins?:Record<string,string>; revoked_assessments?:string[]; reference_profiles?:Record<string,string[]>; max_state_bytes?:number }
const CONFIG_MEMBERS=["port","data_dir","pins","assessment_pins","revoked_assessments","reference_profiles","max_state_bytes"];
export function parseDevHostConfig(text:string,baseDir:string):DevHostConfig{
  const raw=parseUntrustedJson(text) as any;
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("dev host config must be a JSON object");
  for(const k of Object.keys(raw))if(!CONFIG_MEMBERS.includes(k))throw new Error(`unknown dev host config member: ${k}`);
  const isRecord=(v:any)=>!!v&&typeof v==="object"&&!Array.isArray(v);
  const strings=(v:any)=>Array.isArray(v)&&v.every(x=>typeof x==="string");
  const cfg:DevHostConfig={};
  if(raw.port!==undefined){if(!Number.isInteger(raw.port)||raw.port<0||raw.port>65535)throw new Error("port must be an integer from 0 to 65535");cfg.port=raw.port;}
  if(raw.data_dir!==undefined){if(typeof raw.data_dir!=="string"||!raw.data_dir)throw new Error("data_dir must be a path");cfg.data_dir=resolve(baseDir,raw.data_dir);}
  for(const name of ["pins","assessment_pins"] as const)if(raw[name]!==undefined){if(!isRecord(raw[name])||!Object.values(raw[name]).every(x=>typeof x==="string"))throw new Error(`${name} must map issuer origins to key ids`);cfg[name]={...raw[name]};}
  if(raw.revoked_assessments!==undefined){if(!strings(raw.revoked_assessments))throw new Error("revoked_assessments must be a list of token digests");cfg.revoked_assessments=[...raw.revoked_assessments];}
  if(raw.reference_profiles!==undefined){if(!isRecord(raw.reference_profiles)||!Object.values(raw.reference_profiles).every(strings))throw new Error("reference_profiles must map reference types to lists of profile digests");cfg.reference_profiles=Object.fromEntries(Object.entries(raw.reference_profiles).map(([k,v])=>[k,[...(v as string[])]]));}
  if(raw.max_state_bytes!==undefined){if(!Number.isInteger(raw.max_state_bytes)||raw.max_state_bytes<=0)throw new Error("max_state_bytes must be a positive integer");cfg.max_state_bytes=raw.max_state_bytes;}
  return cfg;
}
export function readDevHostConfig(path:string):DevHostConfig{const file=resolve(path);return parseDevHostConfig(readFileSync(file,"utf8"),dirname(file));}
/** The host key of a persistent development host, kept beside its data so the audience keeps one key across restarts. A synthetic secret: never reuse it. */
export async function persistentHostKey(dataDir:string):Promise<KeyPair>{
  mkdirSync(dataDir,{recursive:true});const file=resolve(dataDir,"host-key.json");
  if(existsSync(file)){const saved=parseUntrustedJson(readFileSync(file,"utf8")) as any;if(typeof saved?.secret_key!=="string")throw new Error(`${file} does not hold a host key`);return keyPairFromSecret(saved.secret_key);}
  const key=await generateKeyPair();writeFileSync(file,JSON.stringify({warning:"SYNTHETIC development host key; delete the data directory to reset the host",key_id:key.keyId,secret_key:key.secretKey},null,2)+"\n");return key;
}
export async function createDtpStore(options:{port?:number;key?:KeyPair;pins?:Record<string,string>;assessmentPins?:Record<string,string>;revokedAssessments?:string[];referenceProfiles?:Record<string,string[]>;kinds?:Record<string,string[]>;protocolProfiles?:Record<string,ProfileContract>;db?:Db;dataDir?:string;now?:()=>number;maxStateBytes?:number}={}){
  const pg=options.db?null:new PGlite(options.dataDir?resolve(options.dataDir,"pglite"):undefined);const db=options.db??pgliteDb(pg!);
  if(pg)await pg.exec(readFileSync(new URL("../../spec/v0.4/store.sql",import.meta.url),"utf8"));
  const key=options.key??await generateKeyPair();const pins=options.pins??{};let audience="";
  const protocol=options.kinds||options.protocolProfiles?{kinds:options.kinds??{},protocolProfiles:options.protocolProfiles??{}}:await loadProtocolProfiles();
  const server=createServer(async(req,res)=>{
    try{
      const chunks:Buffer[]=[];let total=0;let oversized=false;
      for await(const part of req){total+=part.length;if(total>MAX_REQUEST_BYTES){oversized=true;break;}chunks.push(Buffer.from(part));}
      if(oversized){res.writeHead(413,{"connection":"close","content-type":"application/json"});res.end(JSON.stringify({error:{code:"payload_too_large",message:"request exceeds 1 MiB"}}));return;}
      const request=new Request(audience+(req.url??"/"),{method:req.method,headers:{"content-type":"application/json"},...(["GET","HEAD"].includes(req.method??"GET")?{}:{body:Buffer.concat(chunks)})});
      const result=await handle(request,{audience,storeKey:key,pins,db,now:options.now,maxStateBytes:options.maxStateBytes,assessmentPins:options.assessmentPins,revokedAssessments:options.revokedAssessments,referenceProfiles:options.referenceProfiles,kinds:protocol.kinds,protocolProfiles:protocol.protocolProfiles});res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());
    }catch{if(!res.headersSent)res.writeHead(500);res.end(JSON.stringify({error:{code:"internal",message:"local adapter error"}}));}
  });
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(options.port??0,"127.0.0.1",resolve);});
  audience=`http://127.0.0.1:${(server.address() as any).port}`;
  return{audience,keyId:key.keyId,pins,close:async()=>{await new Promise<void>(r=>server.close(()=>r()));if(pg)await pg.close();}};
}
if(process.argv[1]?.endsWith("dtp-v04-dev-server.ts")){
  const path=process.argv[2]??process.env.DTP_V04_DEV_CONFIG, cfg=path?readDevHostConfig(path):{};
  const key=cfg.data_dir?await persistentHostKey(cfg.data_dir):undefined;
  const server=await createDtpStore({port:cfg.port??8790,key,dataDir:cfg.data_dir,pins:cfg.pins,assessmentPins:cfg.assessment_pins,revokedAssessments:cfg.revoked_assessments,referenceProfiles:cfg.reference_profiles,maxStateBytes:cfg.max_state_bytes});
  console.log(`DTP v0.4 candidate: ${server.audience}/dtp/v0.4/health (synthetic data only; host key ${server.keyId}; ${cfg.data_dir?`state persists in ${cfg.data_dir}, delete that directory to reset`:"state is lost on exit"})`);
}
