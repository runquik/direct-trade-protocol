import { PGlite } from '@electric-sql/pglite';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { pgliteDb } from '../../supabase/functions/dtp-store/db.ts';
import { generateKeyPair,keyPairFromSecret } from '../src/keys.ts';
import { IDENTITY_REGISTRY_SCHEMA } from '../src/foundation/identity-registry.ts';
import { createOnboardingHost,ONBOARDING_SCHEMA } from '../src/onboarding/host.ts';
import { onboardingServer } from '../src/onboarding/http.ts';

const sdk=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.DTP_ONBOARDING_PORT||8790),origin=`http://127.0.0.1:${port}`;
const data=resolve(process.env.DTP_ONBOARDING_DATA||resolve(sdk,'.onboarding-data'));
await mkdir(data,{recursive:true});
const configPath=resolve(data,'resolver.json');let config:{id:string;secret_key:string;audience:string};
try {config=JSON.parse(await readFile(configPath,'utf8'));}
catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;config={id:crypto.randomUUID(),secret_key:(await generateKeyPair()).secretKey,audience:origin};await writeFile(configPath,JSON.stringify(config),{flag:'wx',mode:0o600});}
if(config.audience!==origin)throw new Error('Existing resolver is bound to a different origin; restore the original port, do not silently reseed');
const pg=new PGlite(resolve(data,'database'));await pg.exec(IDENTITY_REGISTRY_SCHEMA);await pg.exec(ONBOARDING_SCHEMA);
const host=createOnboardingHost(pgliteDb(pg),{id:config.id,audience:origin,key:await keyPairFromSecret(config.secret_key),now:Date.now});
// Explicit allowlist, never expose the repository or private files via a generic file server.
const modules=new Set(['src/onboarding/client.ts','src/keys.ts','src/base58.ts','src/canonical.ts','src/foundation/identity.ts']);
const cache=new Map<string,string>();
const server=onboardingServer(host,{origin,allowedOrigins:[origin,'http://127.0.0.1:8791'],asset:async path=>{
  if(path==='/'||path==='/reference.js'||path==='/reference.css'){
    const file=path==='/'?'index.html':path.slice(1);return {body:await readFile(resolve(sdk,'../modules/passport/reference',file),'utf8'),type:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'};
  }
  if(path.startsWith('/lib/')&&modules.has(path.slice(5))){const file=path.slice(5);if(!cache.has(file))cache.set(file,ts.transpileModule(await readFile(resolve(sdk,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,verbatimModuleSyntax:true}}).outputText);return {body:cache.get(file)!,type:'text/javascript'};}
  return null;
}});
server.requestTimeout=10000;server.headersTimeout=10000;server.maxConnections=32;
server.listen(port,'127.0.0.1',()=>console.log(`DTP synthetic onboarding host and independent reference client: ${origin}`));
let closing=false;async function close(){if(closing)return;closing=true;server.close();server.closeAllConnections();await pg.close();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
process.on('message',message=>{if(message==='shutdown')void close();});
