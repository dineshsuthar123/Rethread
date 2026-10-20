# Security boundaries

The Express API and Python worker are trusted control processes. They never
import, install or execute target repository code. GitHub archives are fetched
using scoped installation credentials, bounded in memory, and transferred as
files to E2B. Credentials are never added to Git remotes or sandbox files/env.
Archives reject traversal, symlinks, hard links, special files, Git metadata,
embedded environment files and submodules. Source limits: 30 MiB compressed,
25 MiB expanded, 5,000 files and 1 MiB/file.

E2B is a required boundary. There is no Docker/host fallback. The configured
template and root-owned evaluator are outside the candidate's writable tree.
Binary-wheel installation uses exact hashed requirements and registry egress;
test egress is denied. The evaluator starts through `unshare --net` in a fresh
Linux network namespace and verifies that it differs from the guest init
namespace. An isolated system Python disables site initialization. Target
commands and HTTP probes run as `user` with no-new-privileges and a small
explicit env; they cannot alter the evaluator or inherit worker keys. Checks
require zero response bytes from metadata, private, public IPv4/IPv6, and the
formerly allowed package registry. A missing namespace, failed probe, or absent
isolation report blocks execution. Evaluator stdout is bounded at 2 MiB, with
a process-group timeout.

Live diagnostics on 2026-10-21 found that the guest metadata service still
returned `Server: Firecracker API` under the provider deny-all rule. The old
probe correctly blocked the Case. The additional kernel namespace prevents
target access to that service; no response allowlist or host fallback is used.
The original pytest failure and an independent unprivileged/network/secret
absence check ran inside actual E2B sandboxes. See
[live diagnostic evidence](artifacts/network-isolation-live.json).
Shared-CDN domain allowlists are not a perfect destination boundary, as
[E2B documents](https://docs.e2b.dev/network/internet-access) explain.

The planner receives bounded redacted evidence and source excerpts. It has no
tools. Pydantic rejects extra capabilities and malformed fields. Trusted code
owns permissions, state transitions, budgets and publishing. Candidates apply
only to existing Python source at exact hashes; original tests, configuration,
CI, dependency files, skip/xfail and lint suppressions are protected. Behavior
contracts come from the developer and an existing executable oracle. Generated
tests alone do not establish intended behavior.

GitHub identity uses state, a browser-bound temporary cookie, PKCE and encrypted
server-side tokens. Sessions are HttpOnly, Secure in production, SameSite=Lax,
8-hour expiry, with Origin plus CSRF checks for mutations. Every object query
is tenant-qualified. Composite foreign keys prevent cross-tenant relations.
Runtime roles are restricted by deploy/roles.sql. RLS is not enabled on the new
schema; query-level authorization and tested foreign-key boundaries provide
tenant isolation. Existing Supabase public RLS/role definitions are untouched.
No claim is made that a service-role credential alone provides isolation.

Webhooks validate the exact raw body with constant-time HMAC comparison, permit
known event types, deduplicate delivery IDs, and commit jobs before acknowledging.
Same-repository PR heads only are admitted for guard replay; fork PR support is
explicitly excluded. Repair branches are excluded to avoid bot loops. Preflight
runs every retained guard; missing/changed tests are stale/needs_review.

Queue claims use SKIP LOCKED, tenant admission locks, short leases, heartbeats,
three attempts and fencing tokens. Case → job lock order matches cancellation.
Fenced writes reject cancelled/expired/reclaimed work. Persisted transitions
are checked in API/worker and by a database trigger. Cancellation revokes the
job fence and the worker kills its sandbox. A remote GitHub request already in
flight may complete before cancellation is observed; retries reconcile those
effects. No distributed transaction with GitHub is claimed.

Publication requires owner approval of the current digest and a fresh branch
head. It never forks, force-pushes or merges. The publisher saves intent and
commit identity, checks existing refs/PRs after ambiguous timeouts and preserves
explicit push/PR failures. Tests cover ambiguous PR creation and stale heads.
Source/guard integrity is revalidated before uploading blobs.

Logs are redacted before storage and rendered as text. Artifacts are compressed
in PostgreSQL through Store.artifact, with separate payload/metadata tables:
2 MiB logs, 10 MiB other artifacts, 25 MiB/Case, 500 MiB/tenant by default,
30-day expiry. API accesses always check Case ownership. Exports exclude keys
and source archives. Atomic global/tenant budget reservations prevent concurrent
over-admission; ambiguous LLM calls charge their reserved upper bound. Configure
conservative model prices and external provider spend limits as a second ceiling.

Local emulators test outcomes, not production network or account boundaries.
CI dependency/image scanning and SBOMs are useful evidence, not a complete
security audit. Hosted release remains gated on live provider acceptance.
