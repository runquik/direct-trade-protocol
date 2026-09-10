import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPassportWeb } from '../scripts/passport-web.ts';

test('Passport browser demo: real authority, isolated companies and revocable modules', { timeout: 120000 }, async t => {
  const demo = await createPassportWeb(0);
  t.after(() => demo.close());
  async function browser() {
    const response = await fetch(demo.origin + '/api/session');
    const initial = await response.json();
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    let persona: string | null = null;
    return {
      async post(path: string, data: any = {}, status = 200, headers: Record<string,string> = {}) {
        const result = await fetch(demo.origin + path, { method: 'POST', headers: {cookie, 'content-type':'application/json', 'x-demo-csrf':initial.csrf,...headers}, body: JSON.stringify({demo_persona:persona,...data}) });
        const body = await result.json();
        assert.equal(result.status, status, `${path}: ${JSON.stringify(body)}`);
        assert.doesNotMatch(JSON.stringify(body), /"(?:secretKey|privateKey|secret_key|private_key)"/);
        if(path === '/api/login' && status === 200) persona = data.persona;
        return body;
      },
      async home() { return (await fetch(demo.origin+'/api/session',{headers:{cookie}})).json(); }
    };
  }
  const alex = await browser(), jamie = await browser(), sam = await browser();
  await t.test('assets and local request protections', async () => {
    for(const path of ['/', '/app.js', '/style.css']) {
      const r = await fetch(demo.origin+path); assert.equal(r.status,200); assert.equal(r.headers.get('cache-control'),'no-store');
      assert.ok(r.headers.get('content-security-policy')?.includes("script-src 'self'"));
    }
    assert.equal((await fetch(demo.origin+'/api/session',{headers:{origin:'https://attacker.example'}})).status,403);
    await alex.post('/api/workspace',{},401);
    await alex.post('/api/login',{persona:'root'},400);
    await alex.post('/api/login',{persona:'alex'},403,{'x-demo-csrf':'wrong'});
  });
  const ah = await alex.post('/api/login',{persona:'alex'});
  const acme = ah.companies.find((c:any)=>c.name==='Acme Sauce').id;
  const blue = ah.companies.find((c:any)=>c.name==='Bluestem Foods').id;
  const north = ah.invitations[0].id;
  await jamie.post('/api/login',{persona:'jamie'});
  await sam.post('/api/login',{persona:'sam'});
  const workspace = (client:any,id:string,status=200)=>client.post('/api/workspace',{organization_id:id},status);
  await t.test('invitation acceptance and company-specific scope',async()=>{
    assert.equal(ah.companies.length,2); assert.equal(ah.invitations.length,1);
    await workspace(alex,north,403);
    const accepted = await alex.post('/api/accept',{organization_id:north});
    assert.equal(accepted.companies.length,3); assert.equal(accepted.invitations.length,0);
    const a = await workspace(alex,acme), b = await workspace(alex,blue);
    assert.equal(a.records.filter((r:any)=>r.type==='finance.invoice').length,3);
    assert.equal(b.records.length,1); assert.equal(b.records[0].type,'trade.contract');
    assert.ok(a.records.every((r:any)=>r.subject_company_id===acme));
    assert.equal((await workspace(sam,acme)).records.length,1);
    await workspace(sam,blue,403);
    await workspace(alex,'not-a-company',400);
  });
  await t.test('module installation and human permissions intersect; revocation stops access',async()=>{
    const p = {organization_id:acme,module:'books'};
    await alex.post('/api/module/connect',p,403);
    await jamie.post('/api/module/connect',p);
    await jamie.post('/api/module/connect',p,409);
    const records = await alex.post('/api/module/read',p);
    assert.equal(records.records.length,3); assert.ok(records.records.every((r:any)=>r.type==='finance.invoice'));
    const narrow = await sam.post('/api/module/read',p);
    assert.equal(narrow.records.length,0);
    await alex.post('/api/module/revoke',p,403);
    await jamie.post('/api/module/revoke',p);
    await alex.post('/api/module/read',p,403);
    assert.equal((await workspace(alex,acme)).records.length,5);
    await jamie.post('/api/module/connect',p);
    assert.equal((await alex.post('/api/module/read',p)).records.length,3);
  });
  await t.test('membership revocation, separate sessions, re-invitation and stale persona protection',async()=>{
    await sam.post('/api/member/revoke',{organization_id:acme},403);
    await jamie.post('/api/member/revoke',{organization_id:acme});
    await workspace(alex,acme,403);
    await alex.post('/api/module/read',{organization_id:acme,module:'books'},403);
    assert.equal((await alex.home()).companies.length,2);
    assert.equal((await workspace(alex,blue)).records.length,1);
    assert.equal((await workspace(sam,acme)).records.length,1);
    await jamie.post('/api/member/invite',{organization_id:acme});
    await workspace(alex,acme,403);
    await alex.post('/api/accept',{organization_id:acme});
    assert.equal((await workspace(alex,acme)).records.length,5);
    await alex.post('/api/login',{persona:'jamie'});
    await alex.post('/api/module/revoke',{organization_id:acme,module:'books',demo_persona:'alex'},409);
  });
});
