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
  ['the same member named twice','{"a":1,"a":2}','duplicate_member_name'],
  ['the same member named twice, with other members between','{"a":1,"b":2,"a":3}','duplicate_member_name'],
  ['the same member named twice in a nested object','{"x":{"a":1,"a":1}}','duplicate_member_name'],
  ['the same member named twice in an object inside an array','[{"k":true,"k":true}]','duplicate_member_name'],
  ['the same non-ASCII member named twice','{"'+String.fromCharCode(0x65e5)+'":1,"'+String.fromCharCode(0x65e5)+'":2}','duplicate_member_name'],
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
  ['the same name in sibling objects','[{"a":1},{"a":2}]'],
  ['the same name at different depths','{"a":{"a":{"a":1}}}'],
  ['a value equal to a member name','{"a":"a","b":"a"}'],
  ['names differing only in case','{"a":1,"A":2}'],
];
// v0.4 numbers (#97): an integer is written as an optional minus sign and digits, nothing else.
const numberReject=[
  ['a zero fraction','{"threshold":1.0}'],
  ['an exponent','{"threshold":1e0}'],
  ['a capital exponent','{"threshold":1E0}'],
  ['a signed exponent','{"n":1e+2}'],
  ['a negative exponent that still denotes an integer','{"n":10E-1}'],
  ['a decimal that binary64 rounds to an integer, but whose exact value is not one','{"threshold":1.0000000000000001}'],
  ['a negative fraction','{"n":-1.5}'],
  ['zero written with a fraction','{"n":0.0}'],
  ['a fraction inside an array','{"a":[1,2.0]}'],
  ['a fraction at depth','{"a":{"b":[{"c":3.0}]}}'],
  ['a top-level number with a fraction','1.0'],
];
const numberAccept=[
  ['integers','{"a":0,"b":1,"c":-1,"d":42}'],
  ['the largest safe integer, written as digits','{"n":9007199254740991}'],
  ['numbers as array elements','[1,-2,3]'],
  ['decimal and exponent text inside string values','{"price":"1.0","note":"1e0 and 2.5E3"}'],
  ['a member name containing a full stop and the letter e','{"a.e":1}'],
  ['literals, which contain the letter e','[true,false,null]'],
];
const out={
  description:'JSON member-name safety. A receiver MUST refuse every text under "reject" BEFORE handing it to a JSON parser, and MUST accept every text under "accept". Each text is carried here as a string value; none appears as a member name.',
  rule:'An object member name must not be written with an escape sequence, and an object must not name the same member twice.',
  reject:reject.map(([why,text,code='unsafe_member_name'])=>({why,text,code})),accept:accept.map(([why,text])=>({why,text})),
  numbers:{
    description:'v0.4 integer literals (SPEC section 2, #97). A v0.4 receiver MUST refuse every text under "reject" with the given code BEFORE handing it to a JSON parser, and MUST accept every text under "accept". The rule is lexical, so it does not depend on how a parser converts numbers.',
    rule:'A number is written as an optional minus sign followed by digits, with no fraction and no exponent.',
    reject:numberReject.map(([why,text])=>({why,text,code:'non_integer_number'})),accept:numberAccept.map(([why,text])=>({why,text}))}};
const text=JSON.stringify(out,null,2)+'\n';
writeFileSync(new URL('../../spec/vectors/unsafe-json.json',import.meta.url),text);
console.log('vectors:',reject.length,'reject,',accept.length,'accept,',numberReject.length,'number reject,',numberAccept.length,'number accept');
