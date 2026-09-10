# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Docker packaging of the upstream `prerender` service (headless Chromium renderer for crawlers) with Redis/Valkey caching plus a custom request-deduplication layer. All application code lives in a single file: `server.js`.

## Commands

```bash
docker compose up -d --build       # run service (prerender + valkey) on :3000
docker compose logs -f prerender   # logs; "Started Chrome" = ready
curl http://localhost:3000/render?url=http://example.com
docker compose exec valkey redis-cli del 'example.com'   # invalidate cache; DELETE /render is NOT routed upstream

npm test                  # all tests (node:test runner)
npm run test:unit         # needs Redis reachable at REDIS_URL
npm run test:integration  # needs the service running on PRERENDER_URL (default localhost:3000)
node --test test/unit/redis-lock.test.js                      # single file
node --test --test-name-pattern="cache" 'test/**/*.test.js'   # single test by name
```

Tests use Node's built-in runner (`node:test` + `node:assert` + `fetch`) - there are no devDependencies, no build step and no linter. Note the test globs must stay quoted in `package.json`, since `node --test <dir>` treats a directory as a module to load rather than a path to search. Integration tests hit the live service and public `httpbin.org`, so they fail offline; unit tests need Redis reachable, which `compose.yml` does not publish.

`PRERENDER_URL` and `REDIS_URL` steer the tests; runtime config is in `.env.example` / `compose.yml` (`REDIS_URL`, `PAGE_TTL`, `MAX_CONCURRENT_RENDERS`, `LOCK_TTL`, `DISABLE_IMAGES`, plus upstream's `WAIT_AFTER_LAST_REQUEST` / `PAGE_DONE_CHECK_INTERVAL`, which `compose.yml` lowers to 100ms).

## Architecture

Request flow through `server.js` middleware, in registration order (order is load-bearing):

1. **Dedup middleware** (`requestReceived`): if the cache key exists in Redis → `next()` immediately, no lock. Else `SET lockKey NX EX LOCK_TTL`. The winner checks `currentRenders >= MAX_CONCURRENT_RENDERS` — *after* taking the lock, releasing it and returning `503` if over — so the limit only ever rejects a request that would start a new render; gating earlier made every duplicate of an in-flight URL 503 instead of waiting, i.e. deduplication turned itself off under load. Losers poll cache+lock in one pipelined round trip every 200ms and `next()` into the cache middleware once the winner fills it, so they return 200 rather than 429 (crawlers cut their crawl rate on 429s). They stop early if the lock disappears with the cache still empty, if the client disconnects (`req.destroyed`, polled rather than listened for — only the real `req` reaches a plugin and its `close` fires on healthy requests too), and after `MAX_WAIT_MS` (8s, deliberately far below `LOCK_TTL`) return `429` + `Retry-After: 5`. Any Redis error falls through to `next()` (fail-open).
2. `prerender-redis-cache-ng` — serves/stores the rendered HTML.
3. `blacklist` → `httpHeaders` → `removeScriptTags`.

The lock is released in the same middleware's `beforeSend`, via a Lua compare-and-delete against the token stored at acquire time (`req.prerender.reqId`) — a render that outlives `LOCK_TTL` must not delete the lock the *next* request has since taken. It decrements `currentRenders` *before* the Redis call — a throw there must not leak the render slot. The cache write happens in the cache plugin's `pageLoaded`, i.e. before `beforeSend`, which is why "lock gone but cache empty" reliably means the render failed.

Things that bite:

- **Cache key duplication.** The dedup middleware computes the key as `url.replace(/^https?:\/\//, '')` to match `prerender-redis-cache-ng`'s protocol-agnostic scheme, and derives the lock key from it so both have the same granularity. If that library changes its key format, the cache-hit shortcut and the waiting path silently stop working.
- **`currentRenders` is per-process.** The per-URL lock is in Redis (cluster-wide), but the concurrency limit is a local counter — with multiple replicas the real limit is `MAX_CONCURRENT_RENDERS × replicas`.
- **Locks only release in `beforeSend`.** A request that dies before that leaves the lock until `LOCK_TTL` expires, during which the URL 429s. Keep `LOCK_TTL` above worst-case page load time.
- **The Dockerfile copies only `package.json` and `server.js`.** Adding a source file or a `require` of a local module means editing the `COPY` lines, or it breaks only inside the container. `npm install --no-package-lock` also means the committed `package-lock.json` does not pin the image's deps.

## Versioning / release

`package.json` version used to mirror the pinned upstream `prerender` version, which stopped being possible at 5.22.0: upstream's last release was 5.21.6 and its repository is gone, so the mirror could no longer express "same renderer, new image". Versions are now this image's own, still inside `5.x` so published `:5` and `:5.21`/`:5.22` tags keep resolving for existing users; which `prerender` is inside is recorded in `package.json` (pinned exactly) and the CHANGELOG. Pushing a `v*.*.*` tag triggers `.github/workflows/docker-build-and-push.yml`, which builds linux/amd64+arm64 and pushes to GHCR and Docker Hub.
