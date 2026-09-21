import {decryptWallet,PassportClient,httpTransport} from '/lib/src/onboarding/client.ts';
const $=id=>document.getElementById(id);let client=null,busy=false;
async function work(fn){if(busy)return;busy=true;try{await fn();}catch(e){$('result').textContent='';$('status').textContent=e.message;}finally{busy=false;}}
async function refresh(){
  $('result').textContent='';$('companies').replaceChildren();$('invitations').replaceChildren();
  const companies=await client.run('companies.list');
  for(const c of companies){const b=document.createElement('button');b.textContent=`${c.name} · ${c.role}`;b.onclick=()=>work(async()=>{$('result').textContent='';$('result').textContent=JSON.stringify(await client.run('company.read',c.organization_id),null,2);});$('companies').append(b);}
  if(!companies.length)$('companies').textContent='No active company access.';
  for(const invitation of await client.run('invitations.list')){const b=document.createElement('button');b.textContent=`Accept ${invitation.name} · ${invitation.role}`;b.onclick=()=>work(async()=>{await client.run('membership.accept',invitation.organization_id,{grant_id:invitation.grant_id});await refresh();});$('invitations').append(b);}
  $('status').textContent='Verified through the public host, without any other client's session.';
}
$('unlock').onclick=()=>work(async()=>{const file=$('file').files[0];if(!file||file.size>40000)throw new Error('Choose an encrypted identity file');const w=await decryptWallet(JSON.parse(await file.text()),$('pass').value);if(w.kind!=='operational')throw new Error('Use an operational identity, not your recovery kit');if(w.resolver.audience!==location.origin)throw new Error('Identity belongs to a different configured host');const api=httpTransport(location.origin),meta=await api('meta');if(meta.resolver_id!==w.resolver.resolver_id||meta.resolver_key!==w.resolver.resolver_key)throw new Error('Resolver pin mismatch');client=new PassportClient(w,api);$('person').textContent=w.person_id;$('pass').value='';$('workspace').hidden=false;await refresh();});
$('refresh').onclick=()=>work(refresh);
$('lock').onclick=()=>{client=null;$('workspace').hidden=true;$('result').textContent='';$('person').textContent='';$('file').value='';$('pass').value='';$('status').textContent='Locked. No identity is saved by this reference client.';};
