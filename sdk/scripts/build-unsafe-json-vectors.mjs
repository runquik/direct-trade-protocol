// Builds spec/vectors/unsafe-json.json. Texts are constructed from code points so that this
// generator, and the file it writes, never contain an escaped member name themselves.
import {writeFileSync} from 'node:fs';
const B=String.fromCharCode(92),Q='"',name=s=>Q+s+Q;
const reject=[
  ['a member named with one reverse solidus','{'+name(B+B)+':1}'],
  ['an escaped newline as a name','{'+name(B+'n')+':1}'],
  ['an escaped tab as a name','{'+name(B+'t')+':1}'],
  ['an escaped quotation mark as a name','{'+name(B+Q)+':1}'],
  ['an escaped solidus as a name','{'+name(B+'/')+':1}'],
  ['a control character written as a unicode escape','{'+name(B+'u0013')+':1}'],
  ['an ordinary letter written as a unicode escape','{'+name(B+'u0041')+':1}'],
  ['an escape inside a longer name','{'+name('x'+B+B+'y')+':1}'],
  ['a second member, after a comma','{"a":1,'+name(B+B)+':2}'],
  ['a nested object','{"a":{'+name(B+'n')+':1}}'],
  ['an object inside an array','[1,{'+name(B+Q)+':1}]'],
  ['a name after a nested array closes','{"a":[1,2],'+name(B+B)+':3}'],
  ['a name after a nested object closes','{"a":{"b":1},'+name(B+B)+':2}'],
  ['insignificant whitespace around tokens','{ "a" : 1 ,\n\t'+name(B+B)+' : 2 }'],
  ['text that is malformed after the unsafe name','{'+name(B+B)+':1'],
];
const accept=[
  ['escapes in a value','{"a":'+name(B+B)+',"b":'+name(B+'n'+B+'t'+B+Q)+'}'],
  ['escaped strings as array elements','['+name(B+B)+','+name(B+'u0013')+']'],
  ['an array of escaped strings as a member value','{"a":['+name(B+B)+']}'],
  ['a value that looks like an unsafe object','{"a":'+name('},{'+B+Q+B+B+B+B+B+Q+':1}')+'}'],
  ['a value ending in an escaped reverse solidus','{"a":'+name('path'+B+B)+',"b":2}'],
  ['non-ASCII names, which need no escape','{"'+String.fromCharCode(0xfc,0x6e,0xef)+'":1,"'+String.fromCharCode(0x65e5,0x672c)+'":2}'],
  ['a top-level string','"'+B+B+'"'],
  ['empty containers and literals','[{},[],null,true,false,0,-1,"",{"a":{}}]'],
];
const out={
  description:'JSON member-name safety. A receiver MUST refuse every text under "reject" BEFORE handing it to a JSON parser, and MUST accept every text under "accept". Each text is carried here as a string value; none appears as a member name.',
  rule:'An object member name must not be written with an escape sequence.',
  reject:reject.map(([why,text])=>({why,text})),accept:accept.map(([why,text])=>({why,text}))};
const text=JSON.stringify(out,null,2)+'\n';
writeFileSync(new URL('../../spec/vectors/unsafe-json.json',import.meta.url),text);
console.log('vectors:',reject.length,'reject,',accept.length,'accept');
