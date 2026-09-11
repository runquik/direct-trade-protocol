// Disposable local candidate host; never reads shared-backend environment values.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { generateKeyPair } from "../src/keys.ts";
import type { KeyPair } from "../src/keys.ts";
import { pgliteDb } from "../../supabase/functions/dtp-store/db.ts";
import type { Db } from "../../supabase/functions/dtp-store/db.ts";
import { handle, MAX_REQUEST_BYTES } from "../src/v04/router.ts";
export async function createDtpStore(options:{port?:number;key?:KeyPair;pins?:Record<string,string>;assessmentPins?:Record<string,string>;revokedAssessments?:string[];referenceProfiles?:Record<string,string[]>;db?:Db;now?:()=>number;maxStateBytes?:number}={}){
  const pg=options.db?null:new PGlite();const db=options.db??pgliteDb(pg!);
  if(pg)await pg.exec(readFileSync(new URL("../../spec/v0.4/store.sql",import.meta.url),"utf8"));
  const key=options.key??await generateKeyPair();const pins=options.pins??{};let audience="";
  const server=createServer(async(req,res)=>{
    try{
      const chunks:Buffer[]=[];let total=0;let oversized=false;
      for await(const part of req){total+=part.length;if(total>MAX_REQUEST_BYTES){oversized=true;break;}chunks.push(Buffer.from(part));}
      if(oversized){res.writeHead(413,{"connection":"close","content-type":"application/json"});res.end(JSON.stringify({error:{code:"payload_too_large",message:"request exceeds 1 MiB"}}));return;}
      const request=new Request(audience+(req.url??"/"),{method:req.method,headers:{"content-type":"application/json"},...(["GET","HEAD"].includes(req.method??"GET")?{}:{body:Buffer.concat(chunks)})});
      const result=await handle(request,{audience,storeKey:key,pins,db,now:options.now,maxStateBytes:options.maxStateBytes,assessmentPins:options.assessmentPins,revokedAssessments:options.revokedAssessments,referenceProfiles:options.referenceProfiles});res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());
    }catch{if(!res.headersSent)res.writeHead(500);res.end(JSON.stringify({error:{code:"internal",message:"local adapter error"}}));}
  });
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(options.port??0,"127.0.0.1",resolve);});
  audience=`http://127.0.0.1:${(server.address() as any).port}`;
  return{audience,keyId:key.keyId,pins,close:async()=>{await new Promise<void>(r=>server.close(()=>r()));if(pg)await pg.close();}};
}
if(process.argv[1]?.endsWith("dtp-v04-dev-server.ts")){const server=await createDtpStore({port:8790});console.log(`DTP v0.4 candidate: ${server.audience}/dtp/v0.4/health (synthetic data only)`);}
