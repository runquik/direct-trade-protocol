// Builds spec/v0.4/fixtures/health-capabilities.json: the `capabilities` member of `GET /dtp/v0.4/health` for a host
// started on the repository registry (spec/profiles/index.json). Discovery only: a module verifies any digest it
// reads here against the contract digest it pins (#42).
import { writeFileSync } from 'node:fs';
import { createDtpStore } from './dtp-v04-dev-server.ts';

const store = await createDtpStore();
try {
  const health = await (await fetch(store.audience + '/dtp/v0.4/health')).json();
  const out = {
    description: 'The capabilities member of GET /dtp/v0.4/health for a host loaded with the repository registry. protocol_kind_digests maps each protocol kind the host supports to the sorted digests its registry lists for it. Health is unsigned discovery: a module never adopts a digest because health lists it, and verifies every digest against the contract it pins.',
    capabilities: health.capabilities,
  };
  writeFileSync(new URL('../../spec/v0.4/fixtures/health-capabilities.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
} finally { await store.close(); }
