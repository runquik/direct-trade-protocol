/** Execute a declared test check and record source-bound evidence. Not a review author. */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint, safeFile, validate } from './foundation-gates.ts';
import type { Graph, Evidence, Observation } from './foundation-gates.ts';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
function need(ok:unknown,why:string):asserts ok{if(!ok)throw new Error(why);}
function atomic(path:string,value:unknown){const temporary=`${path}.${randomUUID()}.tmp`;try{writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});renameSync(temporary,path);}finally{if(existsSync(temporary))unlinkSync(temporary);}}
export async function runFoundationCheck(root:string,checkId:string,actor:string){
  const graphPath=safeFile(root,'docs/foundation/gates.json'),evidencePath=safeFile(root,'docs/foundation/evidence.json');
  const graph:Graph=JSON.parse(readFileSync(graphPath,'utf8'));validate(graph);
  const gate=graph.gates.find(g=>g.checks.some(c=>c.id===checkId)),check=gate?.checks.find(c=>c.id===checkId);
  need(gate&&check?.kind==='test'&&check.command,'declared executable test check required');
  need(graph.participants.some(p=>p.id===actor&&['agent','runner'].includes(p.kind)),'registered test actor required');
  for(const p of check.command.slice(1))need(existsSync(safeFile(root,p)),'planned test is not implemented');
  const lock=safeFile(root,'docs/foundation/run.lock');let descriptor:number;
  try{descriptor=openSync(lock,'wx');}catch{throw new Error('another run is active or a stale run lock needs inspection');}
  let logPath:string|undefined;
  try{
    const evidence:Evidence=JSON.parse(readFileSync(evidencePath,'utf8'));
    need(evidence.format===1&&Array.isArray(evidence.observations)&&Array.isArray(evidence.findings),'invalid evidence file');
    const source=fingerprint(graph,gate.id,root),started=new Date().toISOString();
    const base:Observation={check:checkId,status:'pending',fingerprint:source,actor,summary:`Started ${started}`,artifacts:{},command:[process.execPath,...check.command],runtime:process.version};
    evidence.observations.push(base);atomic(evidencePath,evidence);
    need(process.version==='v22.23.2','use pinned Node v22.23.2');
    const env:NodeJS.ProcessEnv={};
    for(const name of ['SystemRoot','SYSTEMROOT','WINDIR','PATH','Path','COMSPEC','ComSpec','TEMP','TMP','HOME','USERPROFILE'])if(process.env[name]!==undefined)env[name]=process.env[name];
    const result=await new Promise<{code:number|null;signal:string|null;stdout:string;stderr:string}>((finish,reject)=>{
      const child=spawn(process.execPath,check.command!,{cwd:root,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']}),out:Buffer[]=[],err:Buffer[]=[];let bytes=0,killed=false;
      const capture=(chunks:Buffer[],chunk:Buffer)=>{bytes+=chunk.length;if(bytes>16*1024*1024){killed=true;child.kill();}else chunks.push(chunk);};
      child.stdout.on('data',chunk=>capture(out,chunk));child.stderr.on('data',chunk=>capture(err,chunk));
      const timer=setTimeout(()=>{killed=true;child.kill();},120000);timer.unref();
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.on('close',(code,signal)=>{clearTimeout(timer);finish({code:killed?null:code,signal:killed?'limit_exceeded':signal,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')});});
    });
    const count=(name:string)=>{const matches=[...result.stdout.matchAll(new RegExp(`^# ${name} ([0-9]+)\\r?$`,'gm'))];return matches.length?Number(matches.at(-1)![1]):undefined;};
    const tests=count('tests'),skipped=count('skipped'),fail=count('fail'),cancelled=count('cancelled'),todo=count('todo');
    const afterGraph:Graph=JSON.parse(readFileSync(graphPath,'utf8')),unchanged=fingerprint(afterGraph,gate.id,root)===source;
    const passed=result.code===0&&result.signal===null&&tests!==undefined&&tests>0&&skipped===0&&fail===0&&cancelled===0&&todo===0&&unchanged;
    const directory=safeFile(root,'docs/foundation/runs');mkdirSync(directory,{recursive:true});
    logPath=`docs/foundation/runs/${checkId}-${randomUUID()}.json`;
    const log=JSON.stringify({started,finished:new Date().toISOString(),fingerprint:source,source_unchanged:unchanged,command:base.command,runtime:process.version,...result,tests,skipped,fail,cancelled,todo},null,2)+'\n';
    writeFileSync(safeFile(root,logPath),log,{flag:'wx'});
    const latest:Evidence=JSON.parse(readFileSync(evidencePath,'utf8'));
    need(JSON.stringify(latest)===JSON.stringify(evidence),'evidence changed during run; refusing to overwrite');
    const observation:Observation={...base,status:passed?'passed':'failed',summary:passed?`${tests} tests passed, zero skips; ${started}`:`Check failed or source changed; ${started}`,artifacts:{[logPath]:hash(log)},exit_code:result.code??-1,tests,skipped};
    evidence.observations.push(observation);atomic(evidencePath,evidence);return observation;
  }finally{closeSync(descriptor);unlinkSync(lock);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [root,check,actor]=process.argv.slice(2);need(root&&check&&actor,'usage: foundation-run.ts <repository-root> <test-check> <actor>');
  try{const result=await runFoundationCheck(resolve(root),check,actor);console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='passed'?0:1;}catch(error){console.error(error);process.exitCode=1;}
}
