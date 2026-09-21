import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runFoundationCheck } from '../../scripts/foundation-run.ts';
import { dependencies } from '../../scripts/foundation-gates.ts';
function fixture(source:string){
  const root=mkdtempSync(join(tmpdir(),'dtp-foundation-run-'));mkdirSync(join(root,'docs/foundation'),{recursive:true});
  writeFileSync(join(root,'fixture.test.ts'),source);
  const graph={format:1,release_target:'0.1.0',participants:[{id:'builder',kind:'agent'},{id:'reviewer',kind:'agent'}],gates:Object.entries(dependencies).map(([id,depends_on])=>({id,required:true,authors:['builder'],depends_on,inputs:['fixture.test.ts'],checks:[{id:`${id}-tests`,kind:'test',title:'test',command:['--test','fixture.test.ts']},{id:`${id}-review`,kind:'review',title:'review'},...(id==='F10'?[{id:'F10-external',kind:'external',title:'external'}]:[])]}))};
  writeFileSync(join(root,'docs/foundation/gates.json'),JSON.stringify(graph));writeFileSync(join(root,'docs/foundation/evidence.json'),JSON.stringify({format:1,observations:[],findings:[]}));return root;
}
test('runner records pending then exact command execution and a source-bound artifact',async()=>{
  const root=fixture("import {test} from 'node:test';import assert from 'node:assert/strict';test('positive',()=>assert.equal(2+2,4));");
  try{const observation=await runFoundationCheck(root,'F0-tests','builder');assert.equal(observation.status,'passed');assert.equal(observation.tests,1);assert.equal(observation.skipped,0);
    const evidence=JSON.parse(readFileSync(join(root,'docs/foundation/evidence.json'),'utf8'));assert.deepEqual(evidence.observations.map((o:any)=>o.status),['pending','passed']);assert.ok(Object.keys(observation.artifacts).every(path=>existsSync(join(root,path))));assert.ok(!existsSync(join(root,'docs/foundation/run.lock')));
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('runner does not convert failure skip or todo into acceptance',async()=>{
  for(const source of ["import {test} from 'node:test';test('fails',()=>{throw Error('no');});","import {test} from 'node:test';test.skip('skip',()=>{});","import {test} from 'node:test';test.todo('unfinished');"]){
    const root=fixture(source);try{assert.equal((await runFoundationCheck(root,'F0-tests','builder')).status,'failed');}finally{rmSync(root,{recursive:true,force:true});}
  }
});
test('runner refuses source changes during test and never executes reviews as tests',async()=>{
  const root=fixture("import {test} from 'node:test';import {appendFileSync} from 'node:fs';test('source changes',()=>appendFileSync('fixture.test.ts','\\n//changed')); ");
  try{assert.equal((await runFoundationCheck(root,'F0-tests','builder')).status,'failed');await assert.rejects(runFoundationCheck(root,'F0-review','reviewer'),/executable/);}finally{rmSync(root,{recursive:true,force:true});}
});
test('runner excludes inherited deployment secrets and node hooks from children',async()=>{
  const root=fixture("import {test} from 'node:test';import assert from 'node:assert/strict';test('environment',()=>{for(const key of ['STORE_URL','DTP_TEST_DATABASE_URL','NODE_OPTIONS'])assert.equal(process.env[key],undefined);});");
  const previous={STORE_URL:process.env.STORE_URL,DTP_TEST_DATABASE_URL:process.env.DTP_TEST_DATABASE_URL,NODE_OPTIONS:process.env.NODE_OPTIONS};
  try{process.env.STORE_URL='https://must-not-connect.example';process.env.DTP_TEST_DATABASE_URL='postgres://must-not-connect.example';process.env.NODE_OPTIONS='--invalid-do-not-inherit';assert.equal((await runFoundationCheck(root,'F0-tests','builder')).status,'passed');}
  finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(root,{recursive:true,force:true});}
});
