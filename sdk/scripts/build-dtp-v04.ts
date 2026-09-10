import { writeFileSync,mkdirSync } from "node:fs";
import { createPrivateKey,createPublicKey } from "node:crypto";
import { COMMAND_SCHEMA } from "../src/v04/schema.ts";
import { keyPairFromSecret, encodeSecretKey } from "../src/keys.ts";
import { draftCommand,personId,signCommand,commandBytes,digest } from "../src/v04/wire.ts";
const dir=new URL("../../spec/v0.4/",import.meta.url);mkdirSync(dir,{recursive:true});
writeFileSync(new URL("command.schema.json",dir),JSON.stringify(COMMAND_SCHEMA,null,2)+"\n");
// Deliberately public test-only seed; NEVER use this deterministic fixture key in an identity.
const seed=new Uint8Array(32).fill(4);
const native=createPrivateKey({key:Buffer.concat([Buffer.from("302e020100300506032b657004220420","hex"),Buffer.from(seed)]),format:"der",type:"pkcs8"});
const publicKey=new Uint8Array(createPublicKey(native).export({format:"der",type:"spki"}).subarray(-32));
const key=await keyPairFromSecret(encodeSecretKey(seed,publicKey));
const person={id:await personId(key.keyId),key};
const cmd=draftCommand("https://store.example.test",person,"person.register",null,{keys:[key.keyId]},Date.parse("2026-09-10T00:00:00.000Z"));
cmd.request_id="00000000-0000-4000-8000-000000000004";
const command=await signCommand(cmd,[key]);
writeFileSync(new URL("signing-vector.json",dir),JSON.stringify({description:"Public test-only seed: 32 bytes of 0x04. Never use for a real identity.",person_id:person.id,command,signing_input_utf8:new TextDecoder().decode(commandBytes(command)),request_hash:await digest(command)},null,2)+"\n");
console.log("Generated isolated v0.4 schema and public test vector.");
