import type { Db } from "../../../supabase/functions/dtp-store/db.ts";
import type { Context, State } from "./model.ts";
import { DtpError } from "./wire.ts";
import { execute } from "./engine.ts";
import { CanonicalizationError, FloatNotAllowedError } from "../canonical.ts";
export const MAX_REQUEST_BYTES=1024*1024;
export interface Dependencies extends Omit<Context,"now"> { db: Db; now?:()=>number; maxStateBytes?:number }
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"}});
export async function handle(req:Request,deps:Dependencies):Promise<Response>{
  try{
    const path=new URL(req.url).pathname;
    if(req.method==="GET"&&path==="/dtp/v0.4/health")return json({protocol_version:"0.4",status:"reference-candidate",audience:deps.audience,store_key_id:deps.storeKey.keyId,
      capabilities:{bounded_schema:"dtp.schema/1",semantics:["structural","inventory-v1","invoice-v1"],migration_chunk_bytes:65536,migration_max_bytes:33554432,max_request_bytes:MAX_REQUEST_BYTES}});
    if(req.method!=="POST"||path!=="/dtp/v0.4/commands")return json({error:{code:"not_found",message:"route unavailable"}},404);
    const reader=req.body?.getReader();if(!reader)throw new DtpError("invalid","empty body",400);
    const chunks:Uint8Array[]=[];let total=0;
    try{for(;;){const r=await reader.read();if(r.done)break;total+=r.value.length;if(total>MAX_REQUEST_BYTES){void reader.cancel().catch(()=>{});throw new DtpError("payload_too_large","request exceeds 1 MiB",413);}chunks.push(r.value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let input:any;try{input=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw new DtpError("invalid","invalid UTF-8 JSON",400);}
    const queue=[{value:input,depth:0}];let nodes=0;
    while(queue.length){const {value,depth}=queue.pop()!;if(depth>48||++nodes>100000)throw new DtpError("invalid","request complexity exceeded",400);if(value&&typeof value==="object")for(const child of Object.values(value))queue.push({value:child,depth:depth+1});}
    const result=await deps.db.transaction(async tx=>{
      await tx.query("select pg_advisory_xact_lock(1346523188)");
      const rows=await tx.query<{body:State}>("select body from dtp_v04.state where singleton=true for update");if(!rows[0])throw new Error("uninitialized candidate store");
      const state=structuredClone(rows[0].body);const result=await execute(state,input,{...deps,now:deps.now?.()??Date.now()});
      // A ready destination promises space for the final receipt/cutover too.
      // Finalize atomically replaces staged snapshot+chunks with active state;
      // all intervening writes must preserve this per-handoff safety margin.
      const readyStages=Object.values(state.incoming).filter(stage=>stage.ready_token&&!stage.activated&&!stage.aborted);
      const reserved=readyStages.length*65536;
      const reservedSequences=readyStages.reduce((n,stage)=>n+(stage.snapshot?.records.length??0),0);
      if(!Number.isSafeInteger(state.next_seq)||state.next_seq<1||reservedSequences>Number.MAX_SAFE_INTEGER-state.next_seq)throw new DtpError("capacity","record sequence capacity reserved for migration",507);
      const serialized=JSON.stringify(state);if(new TextEncoder().encode(serialized).length+reserved>(deps.maxStateBytes??128*1024*1024))throw new DtpError("capacity","candidate storage capacity or migration reservation exceeded",507);
      // Bind the already serialized value as text. postgres.js otherwise infers
      // JSONB and JSON.stringify's the string again, storing a JSON scalar.
      await tx.query("update dtp_v04.state set body=$1::text::jsonb,revision=revision+1 where singleton=true",[serialized]);return result;
    });return json({result});
  }catch(error){
    if(error instanceof DtpError)return json({error:{code:error.code,message:error.message}},error.status);
    if(error instanceof CanonicalizationError||error instanceof FloatNotAllowedError)return json({error:{code:"invalid",message:"command is not canonical integer-only JSON"}},400);
    return json({error:{code:"internal",message:"internal error"}},500);
  }
}
