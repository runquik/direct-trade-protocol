# Replayable authorized change views

Internal foundation draft, September 12, 2026. `sdk/src/foundation/changes.ts`
implements a bounded, synchronous, pure state-machine oracle. It does not own a
database, expose HTTP, authenticate a requester, issue an authorization grant,
verify record signatures or execute a business operation. Independent review is
required; the implementer does not approve this slice or mark F5 complete.

## Host contract

One authoritative resource owner commits a business effect, its stable receipt and
outbox entry in one transaction. Snapshot data and its source checkpoint come from
one consistent authorized database boundary. The host then projects that outbox
into each authorized view and persists the resulting view with compare-and-set on
`version`. `expected_version` checks a supplied snapshot, not concurrent database
state. A database adapter must enforce the same CAS atomically at commit.

`ViewBinding` is exactly:

```ts
{
  view_id, subject, audience, organization_id,
  authority_id, authority_epoch, policy_epoch
}
```

IDs and epochs are opaque lowercase UUIDs. `subject` is the shared typed person
or company-local service reference; `audience` is an exact HTTP(S) origin.
An agency worker's subject need not belong to the represented company. The host
must supply a current authenticated binding after intersecting person/service,
installation, mandate, profile and record permissions. A client cannot assert its
own policy epoch. View bindings are not access credentials or resolver proofs.

The host changes the policy epoch whenever the authorized projection changes,
including record-level revocation, membership or mandate termination, installation
revocation and access expansion. The authority epoch changes on host replacement
or authority discontinuity. An epoch cannot silently be reused after rollback.
The caller must revalidate authority before releasing each page; this library
cannot detect a revoked grant if the host keeps supplying an old binding.

## API and example flow

All functions return detached ordinary data. Caller-supplied states are trusted
persisted outputs of this oracle, not client-submitted serialized credentials.

| Function | Inputs and result |
|---|---|
| `createChangeView(input)` | Exact `ViewInput`: binding, authorized snapshot items, private source checkpoint, initial public checkpoint, snapshot continuation tokens, as-of and expiry. Returns host-only `ChangeView` at version zero. |
| `appendChangeBatch(state,batch)` | Exact expected version, private from/to source checkpoints, up to 64 authorized events and an authoritative scan watermark. Returns next view; does not commit it. |
| `snapshotPage(state,currentBinding,cursor,now)` | Null cursor starts the immutable snapshot. Continuations use the host-provided token. Returns up to 64 items or uniform resnapshot response. |
| `pullChanges(state,currentBinding,checkpoint,limit,now)` | Up to 64 contiguous visible events after a recognized public checkpoint, with an exact next checkpoint and completeness metadata. |
| `retainChanges(state,expectedVersion,keep)` | Explicitly prunes delivery history to at most 256 entries. Older cursors require resnapshot; stable event dedup identities remain. |
| `consumeSnapshotPage(consumerOrNull,page)` | Stages snapshot pages, rejects missing/reordered/conflicting pages and deduplicates exact snapshot retries. |
| `consumeChangePage(consumer,response)` | Applies contiguous revisions/tombstones or deduplicates prior deliveries; invalidation clears the returned active projection. No external effects are executed. |

The minimal reader flow is:

```ts
let consumer = null;
let cursor = null;
do {
  const page = snapshotPage(view, authenticatedBinding, cursor, now);
  if (page.kind === 'resnapshot_required') throw new Error('start a new view');
  consumer = consumeSnapshotPage(consumer, page);
  cursor = page.next;
} while (cursor !== null);
const response = pullChanges(view, authenticatedBinding, consumer.checkpoint, 64, now);
consumer = consumeChangePage(consumer, response);
// Atomically persist consumer.items AND its checkpoints before acknowledging delivery.
```

Actual transport adapters use these functions at the authority, not by trusting a
client copy of `view`. Only page results cross that transport. Never serialize the
host-only state: it contains source continuity, retained history and internal CAS.

### Snapshot boundary and opaque tokens

The host generates cryptographically random UUIDs for `initial_checkpoint`, each
event's public checkpoint and each snapshot continuation token. This helper checks
shape/uniqueness, not randomness. A snapshot of N items needs
`max(0,ceil(N/64)-1)` continuation tokens. Tokens are stored against this exact view
and fixed page positions; the client does not choose an arbitrary numeric offset.
They are not bearer authorization and cannot be reused under another binding.

The original snapshot never changes while the view exists. Accepted changes are
retained after its initial checkpoint even if the consumer is still fetching its
second snapshot page. After the final snapshot page the reader pulls from that
initial checkpoint, eliminating the snapshot/subscription gap when the host meets
the atomic-boundary and retention contract. If retention has passed that boundary,
even snapshot pages return `resnapshot_required` instead of completing an unusable
old snapshot. A replacement app can reconstruct current records and unfinished
business work from snapshot plus changes without reexecuting business commands.

Private `from_source_checkpoint` and `to_source_checkpoint` enforce outbox scan
continuity only inside host state. They never appear in page responses. A source
batch containing no authorized events advances the private source position but
does not advance any visible checkpoint, expose a global sequence, or add hidden
event counts. `as_of` is a consistent scan watermark, not the time of the last
private event; hosts should advance it when scanning, including empty scans.

### Event meaning, retry and ordering

A `ChangeItem` carries an exact shared `RevisionReference`, profile digest and
bounded body. Record and resource entities must belong to the view's company.
The reference digest's preimage remains the underlying record contract; this
helper does not falsely rehash only the body as if it were that signed envelope.

Each `ChangeEvent` carries a stable random `event_id`, public `checkpoint`, typed
entity, exact `previous` revision or null, replacement `value` or null, and
`accepted_at`. Null previous means addition. A value with a new revision ID means
revision/correction. Null value with a previous revision means tombstone. The exact
current predecessor must match. Correcting a record does not reverse a commitment,
payment or inventory reservation; those require their own authorized operations.

An event ID cannot acquire different body, reference, checkpoint or provenance.
Identical events in later contiguous source scans are deduplicated. The immediately
preceding exact source batch is retryable without another version increment. An
older batch whose private source position is no longer current gets a conflict or
source-gap error rather than reapplying effects. The durable host adapter must
resolve uncertain older source acknowledgements from its stored checkpoint; this
is not an unbounded operation receipt database.

Delivered events additionally carry `previous_checkpoint`. Consumers require an
unbroken chain, preserve exact stable-identity evidence for duplicate delivery and
reject conflicting, missing or reordered events. Persisting a consumer's projection
without its progress, or acknowledging before persistence, breaks this contract.
No global exactly-once external payment or cross-host atomicity is promised.

## Privacy, freshness and relocation

An unknown/expired/retention-lost cursor or mismatched current view binding returns
only `{kind:'resnapshot_required'}`. There are no removed IDs, hidden counts or
different authorization-versus-retention reasons in that response. A tombstone is
appropriate for an authorized withdrawal, **not** as a notification that access to
a previously visible private record was revoked. For access change, invalidate the
whole old view and create a newly authorized snapshot. This intentionally favors
privacy and deterministic recovery over incremental per-record permission repair.

Consumer invalidation clears the returned active items and checkpoints and changes
mode to `invalidated`; the caller must persist that replacement. Previously received
copies, backups, screenshots and independently derived caches cannot be recalled
or guaranteed erased. An application must not keep serving an invalidated cache.

Snapshot pages distinguish `snapshot_as_of` from `current_as_of`. Completing the
snapshot only means all pages from its original boundary arrived; the consumer
stays partial until catch-up reaches a complete current watermark. Changes pages
say whether their visible checkpoint reaches the host's scanned head. Consumer
`as_of` means its last complete projection boundary; `current_as_of` is the latest
observed host scan watermark, which can be ahead during partial catch-up. Neither
means real-time truth. Read-only cached availability cannot authorize a stock hold,
promise service capacity or release money: commands recheck at their authority.

After a cooperative authority move, a new view with a new authority epoch and new
tokens starts from the preserved authoritative records. Old tokens fail and a
replacement consumer reconstructs the same logical work. This helper models the
view reset; it does not implement source freeze, host transfer proofs, writable
authority exclusivity, backup recovery or discovery relocation itself.

## Bounds and remaining integration work

- Maximum 1,024 current/snapshot items, 64 items/events per page or source batch,
  256 retained delivered events, 4,096 lifetime dedup identities and 16 snapshot pages.
- Each item is at most 16 KiB canonical UTF-8. All copied inputs/results are at most
  8 MiB, depth 20, 262,144 visited nodes, arrays 4,096 elements, objects 256 fields,
  and strings 65,536 code units. Aggregate limits can be reached before entry counts.
  These are oracle bounds, not a measured production capacity envelope.
- Views expire within 24 hours of their original snapshot. Expiry is absolute,
  never refreshed by a pull or change. Pruning is explicit and can force resnapshot.
  Exhausted version or dedup capacity fails closed and requires a fresh view.
- Inputs reject undeclared envelope fields, getters, sparse arrays, unsafe property
  names and unsupported values. The copier is not a hostile in-process Proxy sandbox.
  Request size/rate limits and cheap authentication must precede state loading.

Required outside this helper: indexed transactional outbox and snapshot capture,
resource/current-authorization CAS, per-view durable storage, cursor randomness,
tenant quotas, endpoint authentication, policy-epoch propagation, retention policy,
PostgreSQL races, crash/restore rehearsal, actual independent app integration and
CI evidence. Optional signed webhooks are **not implemented**. If added, they must
be bounded notifications pointing back to this replayable feed, with endpoint
validation, SSRF protection, authentication and backoff, not a second source of truth.

Implementation checks: `node --test tests/foundation/changes.test.ts`. Twelve tests
cover positive reconstruction, deterministic negative behavior and declared bounds.
This count is implementation evidence, not independent approval or F5 completion.
