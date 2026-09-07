import { writeFileSync } from "node:fs";
import { COMMAND_SCHEMA } from "../src/v03/schema.ts";
writeFileSync(new URL("../../spec/v0.3/command.schema.json", import.meta.url), JSON.stringify(COMMAND_SCHEMA, null, 2) + "\n");
console.log("Generated PBP 0.3 command schema; no v0.2 artifacts changed.");
