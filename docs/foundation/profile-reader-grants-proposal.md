# Private profile readers: design proposal

November 9, 2026, revised November 10 after the red team's review. Status: **proposed, not decided, not implemented.** Nothing here is normative. It answers the owner decision of November 8, 2026 on [#110](https://github.com/runquik/direct-trade-protocol/issues/110) and is folded into [Core-1](../../spec/core-1/README.md) step 4 (records and exchange bundles, [#157](https://github.com/runquik/direct-trade-protocol/issues/157)). Section 8 lists the decisions asked of the owner; nothing is built before they are taken.

## 1. The problem

A v0.4 private profile names its readers in its signed publication. `profile.publish` signs `{contract, digest, visibility, readers}`, and that signed command is what `profile.get` returns and what every `business-evidence` token carries for each profile in its closure, because `evidence.inspect` verifies the profile against it (SPEC v0.4 §5 and §7, engine `evidence.issue` and `evidence.inspect`). So every reader, and every evidence recipient, learns:

- the full `readers` list, which is the publisher's set of counterparties for that document kind;
- the person ID and key ID of the member who published it.

The multi-reader test `sdk/tests/v04/profile-readers-visibility.test.ts` pins this today. The rework of #164 states it as a known limitation.

## 2. The owner's direction (November 8, 2026)

1. A private profile's reader list is **private by default**. A reader learns that it is a reader and never receives the other readers.
2. A publisher may **opt in, per publication**, to showing the reader list to its readers.
3. `community` visibility is unchanged.
4. The mechanism separates **one signed profile contract**, which every reader receives, from **one signed access grant per reader**. Each reader receives only its own grant. Evidence carries only the issuer's grant.
5. The proposal also covers: hiding the publishing member's person ID, revoking one grant, and the vectors and conformance tests.

## 3. Two signed objects

Both are Core-1 records (`DTP-RECORD-1`, part 5), so this adds **no signing domain**: Core-1 stays at nine. Each is a record under a new protocol kind, registered with fixtures like every other kind.

**The publication** (kind `dtp/profile-publication@1`), issued by the publishing organisation:

```
payload = { "profile":     <hex digest of the profile contract>,
            "contract":    { name, version, schema, semantics, dependencies },
            "visibility":  "private" | "community",
            "reader_list": "private" | "shared" }
```

It carries no reader. `reader_list` is the opt-in of section 2, item 2, and is signed, so a reader can prove which choice the publisher made. For `community` it is always `"private"` and there are no grants. Changing `reader_list` is a new publication of the same contract (it supersedes the old one, Core-1 part 5).

**Superseding a publication reissues its grants.** A grant names one publication version by record digest, so it is valid against that version only. When the publisher supersedes a publication (to change `reader_list`, or for any other reason), it issues a fresh grant, sequence 1, naming the new version, to every reader it keeps; a reader it does not reissue to is no longer a reader of the new version. A recipient that holds the newer publication refuses a bundle that carries a grant for an older version (`profile_not_granted`, section 5). The alternative, grants naming the publication's first version and staying valid across the chain, saves the reissue but makes every grant verifier walk the publication chain and lets a grant outlive a change of `reader_list` the reader never saw; it is not proposed.

**Switching `reader_list` cannot recall a disclosure.** A switch from `"shared"` to `"private"` stops sending other readers' grants from then on, but readers that already held them keep what they received, as with evidence (SPEC §7). A switch from `"private"` to `"shared"` discloses every current grant to every reader from then on.

**The grant** (kind `dtp/profile-grant@1`), issued by the same organisation, one per reader:

```
payload = { "publication": <record digest of the publication>,
            "reader":      <organisation id>,
            "status":      "granted" | "revoked" }
```

A grant names exactly one reader. Its first version has `status: "granted"` and sequence 1. Revocation is the next version (section 6).

**Who receives what.**

| Holder | Receives |
| --- | --- |
| The publisher | the publication and every grant |
| A reader, `reader_list: "private"` | the publication and its own grant |
| A reader, `reader_list: "shared"` | the publication and every current grant, as of its last `profile.get` |
| An evidence recipient | the publication and, when the issuer is not the publisher, the issuer's grant (section 5) |

In v0.4 terms, `profile.publish` would carry the signed publication and grants in place of today's `readers` member; the host keeps the reader set as publisher-side state (it needs it for access checks) and `profile.get` returns the publication plus the caller's own grant, or all grants when shared.

**When readers learn of a new reader (shared mode).** The host pushes nothing. A reader added later receives its grant when the publisher adds it; existing readers see the new grant on their next `profile.get`, and a revocation the same way. So "every current grant" means current at the time of that call, and a conformance test checks it by calling `profile.get` after the last grant is issued. That changes the v0.4 `profile.publish` payload, the `Profile` state shape and the snapshot format, which step 5 (v0.4 on Core-1) reworks anyway.

## 4. The publishing member's person ID

A Core-1 record issued for an organisation names the person who signed it, and its bundle carries that person's identity log and the organisation's governance log showing the signer was a controller at the named head (part 5). So the question is whether the publication and grants can be verified offline without naming a person.

- **Option A, a controller signs (recommended).** The publication and grants are ordinary organisation records, signed by a controller. The only person disclosed is a controller, and every recipient of any record of that organisation already receives the governance log listing all controllers. Nothing new leaks. The member who asked for the publication inside the company (any member with `profiles.publish` today) stays internal: the host or the company's own tooling has a controller sign. Cost: in v0.4, a non-controller member can no longer publish a profile visible to other companies on their own key.
- **Option B, the host signs.** The publication is signed only by the host's log head (`DTP-LOG-HEAD-1`). No person is named, but verification needs trust in the host, which Core-1 removes from the path ("no host token is needed to know who signed what, and for whom").
- **Option C, an organisation key.** The governance log gains an organisation signing key. That is a new identity format and a new signing domain, against Core-1's measures, for a gain Option A already gives.

## 5. Evidence and redistribution

Today, `evidence.issue` refuses to include a third party's private profile unless the **recipient** may read it (engine `evidence.issue`: the publisher is the issuer, or the profile is accessible to the recipient). The owner's direction says evidence carries the **issuer's** grant, "enough to prove that the issuer may redistribute the profile". These are different rules, so the proposal asks which one holds:

- **Option A, keep today's limit (recommended).** The bundle or evidence carries the publication and, when the issuer is not the publisher, the issuer's grant, which proves the issuer was a reader when it wrote the record. A recipient that is neither the publisher nor a reader is still refused a third party's private profile; it checks this with its own grant, which it already holds, so nothing more travels. No reader learns of another reader except an issuer it is already exchanging records with.
- **Option B, the issuer's grant is enough.** Any reader may pass the contract to any recipient. That widens who sees a private schema from the publisher's chosen readers to anyone a reader trades with.
- **Option C, a flag on the grant.** The grant gains `redistribute: true|false`; with `true`, Option B for that reader, otherwise Option A. More choice, one more member to specify and test.

In Core-1 the same rule applies to the exchange bundle: a bundle for a record under a private profile carries the publication and, if the issuer is not the publisher, the issuer's grant, and a recipient refuses it unless Option A's check passes, with a new bundle reason (proposed: `profile_not_granted`), since `unexpected_profile` means something else.

## 6. Revoking one grant

The publisher issues the grant's next version with `status: "revoked"` (Core-1 supersession: same profile kind, same issuing organisation, next sequence, naming the previous grant's digest).

- **Option A, revocation stops future use (recommended).** From then on: the reader's host refuses new records under the profile and new evidence carrying it; `profile.get` returns not-found to that reader; the reader's records already written stay its own and stay verifiable against the grant version that was current when they were accepted (their receipt time, S1 and S2). Disclosed copies cannot be recalled, as SPEC §7 already says of evidence. An offline recipient learns of the revocation only if it receives the newer grant; the publisher SHOULD send it to the reader, and a recipient that holds a revoked version refuses a bundle carrying an older one, as with identity logs.
- **Option B, revocation also withdraws past records.** Third parties would refuse the reader's earlier records under the profile. Offline verifiers cannot enforce this, and it rewrites history the reader legitimately signed.

Revoking one grant reveals nothing to other readers: with `reader_list: "private"` they never held that grant.

**The limit of revocation in private mode.** With `reader_list: "private"`, no one but the publisher and the reader ever holds that reader's grant, so no third party holds a revoked version to compare against. Telling a third party of the revocation means sending it the revoked grant, which discloses that the revoked organisation was a reader. So, under Option A, after a revocation in private mode:

- the revoked reader's own host enforces it (it holds the publisher's state, or receives the revoked grant from the publisher);
- a third party enforces it only if the publisher sends it the revoked grant, accepting that disclosure;
- an offline third party that has not received it **accepts** new evidence the revoked reader issues with its old grant, for as long as it holds nothing newer.

In shared mode, every reader receives the revocation on its next `profile.get` and can refuse from then on. If the owner wants the private-mode window bounded without disclosure, **Option C** below does that.

- **Option C, revocation plus expiring grants.** As Option A, and the grant payload gains `valid_until` (integer ms); a recipient refuses a grant past it, by the bundle's receipt time (S1, S2), and the publisher reissues grants before they lapse. This bounds how long an offline third party can be misled to the grant's lifetime, at the cost of one more member, periodic reissue, and readers whose evidence fails if the publisher stops reissuing.

## 7. Vectors and conformance tests

**Vectors** (new `spec/core-1/vectors/profile-grant.json`, with a builder and `--check`, like the record vectors):

- accepted: a publication with `reader_list` private and shared; a grant; a revocation; a superseding publication with its reissued grants; a bundle carrying the publication only (issuer is the publisher); a bundle carrying the publication and the issuer's grant;
- refused: a grant naming another publication; a grant or publication signed by a non-controller (if 4A); a grant issued by an organisation other than the publication's; a revocation that is not the next version; a bundle under a private profile with no grant when the issuer is not the publisher; a bundle carrying a grant superseded by a revocation the recipient holds; a bundle carrying a grant for a publication version older than one the recipient holds; a grant past `valid_until` (if 5C); a bundle to a non-reader recipient of a third party's private profile (if 5A);
- the registered kinds `dtp/profile-publication@1` and `dtp/profile-grant@1` with fixtures, as every kind has.

**Conformance tests** (v0.4, when step 5 lands):

- the multi-reader test of #164 flips: with two readers and `reader_list: "private"`, each reader receives only its own grant and no `readers` list; with `"shared"`, each receives both grants;
- `profile.get` for a revoked reader is not-found, and its earlier records still verify;
- in shared mode, a reader added after another sees the earlier reader's grant on its first `profile.get`, and the earlier reader sees the new grant on its next one;
- `business-evidence` for a reader's record carries the publication and the issuer's grant and no other reader;
- the publication names a controller, not the member who requested it (if 4A);
- snapshot export and import keep the reader set on the publisher's side only.

## 8. Decisions asked

| # | Question | Recommendation |
| --- | --- | --- |
| R1 | Publication and grants as two `DTP-RECORD-1` kinds, `dtp/profile-publication@1` and `dtp/profile-grant@1`, adding no signing domain (section 3) | Yes |
| R2 | The opt-in as a signed `reader_list: "private" \| "shared"` member of the publication; shared means each reader receives every current grant on its next `profile.get`; a superseding publication reissues its grants, and a switch of `reader_list` cannot recall what readers already hold (section 3) | Yes |
| R3 | Who signs: a controller (A), the host (B) or an organisation key (C) (section 4) | A |
| R4 | Redistribution: keep today's recipient limit with the issuer's grant carried (A), the issuer's grant alone (B), or a per-grant flag (C) (section 5) | A |
| R5 | Revocation: stops future use (A), withdraws past records (B), or stops future use with expiring grants (C). Under A, in private mode an offline third party is not told of a revocation unless the publisher discloses the revoked reader to it (section 6) | A |
| R6 | The vectors and tests of section 7, built in Core-1 step 4 after the exchange bundle, with the v0.4 conformance changes in step 5 | Yes |

Until these are decided, SPEC v0.4 §5 and §7 describe today's disclosure as a known limitation (#164), and #110 stays open.
