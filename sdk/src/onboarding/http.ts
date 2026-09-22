import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { createOnboardingHost } from './host.ts';
import { parseUntrustedJson } from '../safe-json.ts';
export type Host=ReturnType<typeof createOnboardingHost>;
export type Asset={body:string;type:string};
export function onboardingServer(host:Host,options:{origin:string;allowedOrigins:string[];asset?:(path:string)=>Promise<Asset|null>}) {
  const expectedHost=new URL(options.origin).host;
  return createServer(async(req:IncomingMessage,res:ServerResponse)=>{
    const origin=req.headers.origin;
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    const send=(status:number,value:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
    if(req.headers.host!==expectedHost) return send(403,{error:'Host not allowed'});
    if(origin&&!options.allowedOrigins.includes(origin))return send(403,{error:'Origin not allowed'});
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.statusCode=204;res.end();return;}
    try {
      const path=new URL(req.url||'/',options.origin).pathname;
      if(req.method==='GET'&&path==='/api/meta')return send(200,host.metadata());
      if(req.method==='GET'&&options.asset){const asset=await options.asset(path);if(asset){res.setHeader('Content-Type',asset.type);res.end(asset.body);return;}}
      if(req.method!=='POST'||!path.startsWith('/api/'))return send(404,{error:'Not found'});
      if(req.headers['content-type']!=='application/json')return send(415,{error:'JSON required'});
      const chunks:Buffer[]=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>32768){send(413,{error:'Request too large'});return;}chunks.push(chunk);}
      const input=parseUntrustedJson(Buffer.concat(chunks).toString('utf8')) as any;
      if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Object required');
      let result:unknown;
      if(path==='/api/enroll')result=await host.registry.enroll(input.genesis,input.enrollment);
      else if(path==='/api/resolve')result=await host.registry.resolve(input);
      else if(path==='/api/transition')result=await host.registry.transition(input.person_id,input.command);
      else if(path==='/api/log')result=await host.registry.exportLog(input.person_id);
      else if(path==='/api/challenge')result=await host.challenge(input.person_id,input.command);
      else if(path==='/api/execute')result=await host.execute(input);
      else return send(404,{error:'Not found'});
      send(200,result);
    }catch(e){
      const message=e instanceof Error?e.message:'Request rejected';
      // No stack traces, SQL, keys, or parameter values over the wire.
      const safe=/^(Identity transition pending|identity control barrier pending or clock regressed|Company unavailable|Controller required|Cannot revoke the sole controller|Membership already exists|Invitation unavailable|Too many outstanding challenges|Challenge unavailable or expired|Not a distinct current operational key|scope widens authority|grant inactive|Request ID conflict)$/.test(message);
      send(400,{error:safe?message:'Request rejected; check identity, permission, and input'});
    }
  });
}
