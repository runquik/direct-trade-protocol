// Builds spec/core-1/vectors/text.json: received Core-1 wire texts (part 1). Every text is the exact UTF-8 text of a
// signed envelope taken from record.json or envelope.json. Each one under "reject" re-spells one integer with a fraction
// or an exponent; its signature still verifies after a binary64 parse, so only the lexical pre-parse check refuses it
// (#217). Derived from the committed vectors, so the file is reproducible byte for byte.
// Run from sdk/: node scripts/build-core1-text-vectors.ts
import { readFileSync, writeFileSync } from "node:fs";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../spec/core-1/vectors/${name}`, import.meta.url), "utf8"));
const records = read("record.json"), envelopes = read("envelope.json");
const record = records.accept[0], genesis = envelopes.accept[1];
const recordText = JSON.stringify(record.envelope), genesisText = JSON.stringify(genesis.envelope);

const respell = (text: string, from: string, to: string): string => {
  if (text.split(from).length !== 2) throw new Error(`${from} must occur exactly once`);
  return text.replace(from, to);
};

const asRecord = { domain: "DTP-RECORD-1", profile: record.profile };
const asGenesis = { domain: genesis.domain };
const accept = [
  { why: "a record, as signed: every integer is digits only, and the decimal amount is a string", text: recordText, ...asRecord, digest: record.digest, signers: record.signers },
  { why: "a person genesis, as signed", text: genesisText, ...asGenesis, signers: genesis.signers },
];
const reject = [
  { why: "the record sequence written 1.0000000000000001, which binary64 reads as 1 and an exact-decimal reader does not", text: respell(recordText, '"sequence":1,', '"sequence":1.0000000000000001,'), ...asRecord },
  { why: "issued_at written with an exponent, 1.7620001e12, which denotes the signed integer exactly", text: respell(recordText, '"issued_at":1762000100000', '"issued_at":1.7620001e12'), ...asRecord },
  { why: "the issuer head sequence written with a zero fraction, 2.0", text: respell(recordText, '"sequence":2,', '"sequence":2.0,'), ...asRecord },
  { why: "a key-set threshold written with a zero fraction, 1.0", text: respell(genesisText, '"threshold":1}', '"threshold":1.0}'), ...asGenesis },
  { why: "created_at written with a capital exponent and a signed power, 1.76E+12", text: respell(genesisText, '"created_at":1760000000000', '"created_at":1.76E+12'), ...asGenesis },
].map(v => ({ ...v, code: "non_integer_number" }));

const out = {
  description: "Received Core-1 wire texts (spec/core-1/README.md, part 1). A Core-1 receiver MUST refuse every text under \"reject\" with the given code on the raw text, BEFORE handing it to a JSON parser, and MUST accept every text under \"accept\": parse it, then verify the envelope under the given domain (and, for a record, as a DTP-RECORD-1 record of the given profile, with the given record digest). Each reject text is an accept text with one integer re-spelled; its signature still verifies after a binary64 parse, so an implementation that checks numbers only after parsing fails these vectors.",
  rule: "A number is written as an optional minus sign followed by digits, with no fraction and no exponent.",
  accept,
  reject,
};
writeFileSync(new URL("../../spec/core-1/vectors/text.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("vectors:", accept.length, "accept,", reject.length, "reject");
