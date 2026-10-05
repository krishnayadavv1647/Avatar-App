# Avatar Studio

Interactive AI avatar platform. Upload a photo or record a video, get a talking
avatar, and hold a real-time voice conversation with it in the browser.

**Status:** accounts, workspaces, avatar creation with a configurable brief,
real calls over LiveKit with LemonSlice or the mock renderer, and per-workspace
usage metering with concurrency limits. Billing is deliberately not
implemented. **LemonSlice is the only real vendor** - see
[docs/PROVIDERS.md](docs/PROVIDERS.md).

## Stack

React 19 + Vite - Express - MongoDB - Redis/BullMQ - LiveKit - Node.

Avatar video comes from third-party vendors (LemonSlice for photo avatars)
for video clones) behind an adapter, so no vendor is load-bearing. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

Node 20+. Everything else is either hosted or optional.

The avatar itself needs no vendor account - the default provider is `mock`, a
real implementation that generates its own video.

## Quick start (hosted services)

Two free accounts, no local database and no Docker:

1. **MongoDB Atlas** - https://www.mongodb.com/cloud/atlas/register
   Create a free M0 cluster, add a database user, allow access from your IP,
   and copy the `mongodb+srv://...` connection string.

2. **LiveKit Cloud** - https://cloud.livekit.io
   Create a project and copy the websocket URL, API key and API secret.

```bash
npm run install:all
cp server/.env.example server/.env
cp client/.env.example client/.env
# fill MONGO_URI and the three LIVEKIT_* values in server/.env
npm --prefix server run check        # confirms what is actually reachable
npm --prefix server run seed         # one workspace and a callable avatar
npm run dev                          # client + api + agent worker
```

`npm --prefix server run check` prints one line per capability, so a wrong
credential is obvious before anything else is started.

`npm --prefix server run check:avatars` checks every avatar the way a call
would - vendor configured, picture reachable, voice and language model known to
the pipeline - without starting one. Every call runs the same check first
(`server/src/agent/preflight.js`), so a bad setting ends the call with its
reason instead of leaving the caller on "Connecting...".

Client on http://localhost:5173, API on http://localhost:4000.

- **http://localhost:5173/avatars** - avatar library, start a call
- **http://localhost:5173/admin** - platform admin: monitor every user, block accounts, create plans and assign them. Only for the emails in `ADMIN_EMAILS` (server `.env`)
- **http://localhost:5173/_design** - design system reference

### Fully local alternative

`docker-compose.yml` runs MongoDB, Redis and a self-hosted LiveKit server if you
prefer local infrastructure:

```bash
npm run infra:up
```

Note that self-hosted LiveKit does **not** provide LiveKit Inference, so speech
is unavailable on that path - see "Speech and language" below.

With no database at all, the API and client still run against an in-process one:

```bash
npm --prefix server run dev:standalone   # in-memory Mongo, auto-seeded
npm --prefix client run dev
```

The UI works and the API is fully exercisable, but calls will not connect
without a LiveKit server.

## Layout

```
client/   React SPA - features/, components/, styles/ (design tokens)
server/   Express API, LiveKit agent worker, queue workers
docs/     Architecture, providers, cost model, design system
```

Inside `server/src`:

| Path | What |
|---|---|
| `avatar/` | Vendor abstraction - capability matrix, adapters, registry |
| `agent/` | LiveKit worker that drives live calls (one long-lived process) |
| `workers/` | BullMQ queue consumers (training polls, usage) |
| `modules/` | Feature modules: controller, service, repository, routes, validation, permissions |
| `models/` | Mongoose schemas |

`agent/` and `workers/` are deliberately separate: the first is realtime and fed
by LiveKit dispatch, the second are queue consumers fed by Redis.

## Documentation

| Document | Read it for |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | The two planes, the two vendor shapes, call lifecycle |
| [PROVIDERS.md](docs/PROVIDERS.md) | Capability matrix, per-vendor notes, adding a vendor |
| [COST_MODEL.md](docs/COST_MODEL.md) | Per-minute economics and margin |
| [DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Tokens, type scale, component rules |

Start with ARCHITECTURE.md - the split between render-only and full-pipeline
vendors explains most of the rest.

## Mock mode

`AVATAR_PROVIDER=mock` (the default) runs the whole product with no vendor
account. Photo avatars resolve instantly; video clones take about ten seconds so
the asynchronous training path, job polling and webhook handling are genuinely
exercised rather than skipped.

To use a real vendor, add its key to `server/.env` and set `AVATAR_PROVIDER`
accordingly - but note the adapters land in Phase 2 and 3.

## Roadmap

| Phase | Scope |
|---|---|
| 0 - done | Architecture, structure, data model, provider contract, design system |
| 1 - done | Core loop: token minting, agent worker, mock renderer, live call UI |
| 2 - done | Photo avatars: LemonSlice adapter, studio upload, storage adapter |
| 3 - done | Video clones: async training, signed webhooks, Daily transport *(Tavus adapter since removed)* |
| 4 - done | Auth, tenancy, usage metering, concurrency limits |
| 5 - done | LemonSlice renderer, direct image upload, session control events |
| later | Billing, if and when it is wanted |

## Verification

```bash
npm --prefix server run check                # what these credentials can actually do
npm --prefix server test                     # boots the real app on in-memory Mongo
npm --prefix server run validate             # compiles every schema, no DB needed
npm --prefix client run build                # build check of the SPA
```

With the API and the agent worker running, one more command covers what the
test suite cannot - a real room on a real LiveKit server:

```bash
npm --prefix server run smoke
```

It joins as a headless participant and reports whether the agent was
dispatched, published video, and spoke. Everything else can pass while this
fails, because dispatch and media only exist outside the test harness.

The integration suite drives the real Express app and models against a
throwaway database: seeding, listing avatars, starting a call, asserting the
join token carries the room grant and agent dispatch, and ending the call.

## Avatar sources

| Source | What happens | Vendors |
|---|---|---|
| Photo | Instant. LemonSlice animates the image at call time with no training. | LemonSlice |
| Video | Trains a face on the vendor. Takes minutes; the avatar is not callable until it finishes. | *none implemented* |

A training avatar resolves by webhook, or by a lazy poll the next time anyone
reads it - so a missed callback costs seconds, not a stuck avatar.

## Accounts

Register at `/register`, or sign in with the seeded account:

```
demo@example.com  /  demo-password-123
```

Access tokens are short-lived and refresh automatically; the client retries a
401 once behind a single shared refresh. Signing out revokes every outstanding
refresh token for that user, not just the current device.

Every workspace-scoped route rejects an unauthenticated request, and a
workspace can only ever read its own avatars, calls and usage.

## Limits and metering

| Limit | Where | Default |
|---|---|---|
| Concurrent calls | `Workspace.settings.concurrencyLimit` | 3 |
| Monthly minutes | `Subscription.includedMinutes` | unmetered while 0 |
| Single call length | `MAX_CALL_SECONDS` | 3600 |

Usage is written to an append-only ledger when a call ends, from the duration
actually observed - never from the planning estimate. `/analytics/usage`
reports the current period by provider.

## Storage

Uploads go through a driver chosen with `STORAGE_DRIVER`:

| Driver | Where | Works with real vendors |
|---|---|---|
| `local` (default) | `./uploads`, served by this API | **no** - localhost URLs |
| `r2` | Cloudflare R2 | yes |

Most vendors fetch images from their own servers, so `local` cannot serve them.
**LemonSlice is the exception** - it accepts the image bytes directly, so it
works with `local` as-is. A vendor that fetches uploads itself would need
`STORAGE_DRIVER=r2` or a tunnel with `PUBLIC_BASE_URL` pointed at it.

The studio names whichever blocker applies rather than failing at the vendor.

## Speech and language

Two independent credentials decide what the agent can do, and neither implies
the other:

| Credential | Unlocks | Without it |
|---|---|---|
| `LIVEKIT_*` (Cloud) | LiveKit Inference: hosted STT and TTS | No speech at all - the avatar renders but does not converse |
| `ANTHROPIC_API_KEY` | Claude as the language model | Falls back to a hosted model via Inference |

LiveKit Inference does **not** carry Claude, which is why the language model is
selected separately from speech. `DEFAULT_LLM_MODEL` is used with the Anthropic
plugin; `FALLBACK_LLM_MODEL` must be a LiveKit Inference id in `provider/model`
form.

The worker logs which path it took on every call, so a mute or unexpectedly
different agent is diagnosable from the logs alone.
