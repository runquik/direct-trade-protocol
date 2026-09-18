import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { dependencies, evaluate, fingerprint, safeFile, validate } from '../../scripts/foundation-gates.ts';
import type { Graph, Evidence, Observation } from '../../scripts/foundation-gates.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dtp-foundation-gates-'));
  writeFileSync(join(root, 'source.txt'), 'source'); writeFileSync(join(root, 'proof.txt'), 'test/review fixture');
  writeFileSync(join(root, 'fixture.test.ts'), 'synthetic executable input');
  const graph: Graph = { format: 1, release_target: '0.1.0', participants: [{id:'author',kind:'agent'},{id:'reviewer',kind:'agent'},{id:'builder',kind:'external'}],
    gates: Object.entries(dependencies).map(([id,deps]) => ({id, required:true, authors:['author'], depends_on:[...deps], inputs:['source.txt','fixture.test.ts'],checks:[
      {id:`${id}-tests`,kind:'test',title:'test',command:['--test','fixture.test.ts']},
      {id:`${id}-review`,kind:'review',title:'review'},
      ...(id==='F10'?[{id:'F10-external',kind:'external' as const,title:'cold integration'}]:[]),
    ]})),
  };
  const evidence: Evidence = {format:1,observations:[],findings:[]};
  for(const g of graph.gates)for(const c of g.checks)evidence.observations.push({
    check:c.id,status:'passed',fingerprint:fingerprint(graph,g.id,root),actor:c.kind==='external'?'builder':c.kind==='review'?'reviewer':'author',summary:'synthetic fixture only',
    artifacts:{'proof.txt':createHash('sha256').update('test/review fixture').digest('hex')},
    ...(c.kind==='test'?{command:['node','--test','fixture.test.ts'],runtime:'v22.23.2',exit_code:0,tests:1,skipped:0}:{}),
  });
  return {root,graph,evidence,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('foundation graph requires all mandatory packages and an external builder',()=>{
  const f=fixture();try{
    assert.equal(evaluate(f.graph,{format:1,observations:[],findings:[]},f.root).ready,false);
    assert.equal(evaluate(f.graph,f.evidence,f.root).ready,true);
    f.graph.gates.pop();assert.throws(()=>validate(f.graph),/mandatory/);
  }finally{f.cleanup();}
});
test('foundation graph rejects weakened dependencies, missing reviews and missing external gate',()=>{
  const f=fixture();try{
    const altered=structuredClone(f.graph);altered.gates.find(g=>g.id==='F2')!.depends_on=[];
    assert.throws(()=>validate(altered),/dependency/);
    const missing=structuredClone(f.graph);missing.gates[0].checks=missing.gates[0].checks.filter(c=>c.kind!=='review');
    assert.throws(()=>validate(missing),/review required/);
    f.graph.gates.at(-1)!.checks=f.graph.gates.at(-1)!.checks.filter(c=>c.kind!=='external');
    assert.throws(()=>validate(f.graph),/external builder/);
  }finally{f.cleanup();}
});
test('no agent reviews their own work and no agent counts as an external builder',()=>{
  const f=fixture();try{
    f.evidence.observations.find(o=>o.check==='F0-review')!.actor='author';
    assert.equal(evaluate(f.graph,f.evidence,f.root).ready,false);
    f.evidence.observations.find(o=>o.check==='F0-review')!.actor='reviewer';
    f.evidence.observations.find(o=>o.check==='F10-external')!.actor='reviewer';
    assert.equal(evaluate(f.graph,f.evidence,f.root).ready,false);
    f.evidence.observations.find(o=>o.check==='F10-external')!.actor='made-up-builder';
    assert.equal(evaluate(f.graph,f.evidence,f.root).ready,false);
  }finally{f.cleanup();}
});
test('a CI runner can execute tests but cannot author or approve work or replace an external builder',()=>{
  const f=fixture();try{
    f.graph.participants.push({id:'ci',kind:'runner'});
    for(const o of f.evidence.observations){const gate=f.graph.gates.find(g=>g.checks.some(c=>c.id===o.check))!;o.fingerprint=fingerprint(f.graph,gate.id,f.root);}
    f.evidence.observations.find(o=>o.check==='F0-tests')!.actor='ci';
    assert.equal(evaluate(f.graph,f.evidence,f.root).ready,true);
    f.evidence.observations.find(o=>o.check==='F0-review')!.actor='ci';
    assert.equal(evaluate(f.graph,f.evidence,f.root).ready,false);
    f.evidence.observations.find(o=>o.check==='F0-review')!.actor='reviewer';
    f.evidence.observations.find(o=>o.check==='F10-external')!.actor='ci';
    assert.equal(evaluate(f.graph,f.evidence,f.root).ready,false);
    f.graph.gates[0].authors=['ci'];assert.throws(()=>validate(f.graph),/runner cannot be an implementer/);
  }finally{f.cleanup();}
});
test('source and evidence artifact changes invalidate passes',()=>{
  const f=fixture();try{
    writeFileSync(join(f.root,'source.txt'),'changed');
    assert.equal(evaluate(f.graph,f.evidence,f.root).ready,false);
    writeFileSync(join(f.root,'source.txt'),'source');writeFileSync(join(f.root,'proof.txt'),'changed');
    assert.equal(evaluate(f.graph,f.evidence,f.root).ready,false);
  }finally{f.cleanup();}
});
test('last failed or started attempt invalidates previous success',()=>{
  const f=fixture();try{
    for(const status of ['failed','blocked','pending'] as const){
      const ev=structuredClone(f.evidence);ev.observations.push({...ev.observations[0],status});
      assert.equal(evaluate(f.graph,ev,f.root).ready,false);
    }
  }finally{f.cleanup();}
});
test('skips, wrong commands, runtimes and zero tests cannot qualify a gate',()=>{
  const f=fixture();try{
    for(const patch of [{skipped:1},{runtime:'v25.4.0'},{tests:0},{exit_code:1},{command:['node','--version']}] satisfies Partial<Observation>[]){
      const ev=structuredClone(f.evidence);Object.assign(ev.observations[0],patch);assert.equal(evaluate(f.graph,ev,f.root).ready,false);
    }
  }finally{f.cleanup();}
});
test('findings require closure evidence including independent review',()=>{
  const f=fixture();try{
    f.evidence.findings.push({id:'bug',gate:'F0',author:'reviewer',status:'open',closure_checks:[]});
    assert.equal(evaluate(f.graph,f.evidence,f.root).ready,false);
    Object.assign(f.evidence.findings[0],{status:'closed',closure_checks:['F0-tests']});
    assert.equal(evaluate(f.graph,f.evidence,f.root).ready,false);
    f.evidence.findings[0].closure_checks.push('F0-review');assert.equal(evaluate(f.graph,f.evidence,f.root).ready,true);
  }finally{f.cleanup();}
});
test('planned files remain pending even with matching claimed pass fingerprints',()=>{
  const f=fixture();try{
    f.graph.gates[0].inputs.push('not-implemented.ts');
    for(const o of f.evidence.observations){const g=f.graph.gates.find(g=>g.checks.some(c=>c.id===o.check))!;o.fingerprint=fingerprint(f.graph,g.id,f.root);}
    assert.equal(evaluate(f.graph,f.evidence,f.root).ready,false);
  }finally{f.cleanup();}
});
test('portable path validation rejects traversal and absolute paths',()=>{
  const f=fixture();try{for(const p of ['../escape','/root','C:/root','a/../x','a\\x'])assert.throws(()=>safeFile(f.root,p));}finally{f.cleanup();}
});
