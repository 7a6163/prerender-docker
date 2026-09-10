# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.23.0] - 2026-09-10

### Added
- `ALLOWED_DOMAINS`: comma-separated hostnames this service may render; everything else gets a `404` before any lock, render slot or cache lookup is spent. Unset keeps the previous permissive behaviour, because upstream's whitelist plugin `404`s everything when the list is empty - which would take a service down rather than secure it. Startup now warns when it is unset
- `prerender.sendPrerenderHeader()`: sends `X-Prerender: 1` with the page requests this service makes, which is the second loop guard in `nginx.conf.example` (without it that map never fires and loop protection rests entirely on the user agent carrying "Prerender")
- `prerender.browserForceRestart()`: recycles Chrome hourly. Upstream's other restart path only fires when no request is in flight, and requests parked in the dedup wait loop keep that set non-empty, so on a busy service Chrome was never recycled and simply grew into `mem_limit`

### Changed
- Port 3000 is published on `127.0.0.1` instead of every interface. The endpoint renders whatever URL it is handed, so anything that could reach it could read internal HTTP services through it and have the result cached for `PAGE_TTL` (demonstrated against a container with no published ports)
- The domain filter now runs first in the plugin chain. It sat after deduplication and the cache, so a rejected URL still took a lock and a render slot, and a rejected URL that was already cached was served before the filter could refuse it
- Valkey runs with `--maxmemory 1gb --maxmemory-policy allkeys-lru` and its own `mem_limit`. Cache entries are whole rendered pages (~2MB for a large article) kept for `PAGE_TTL`, and the default unbounded/`noeviction` pair ends with writes failing, which stops the cache being written at all - the exact state `MAX_WAIT_MS` exists to bound
- Valkey has a healthcheck and `prerender` waits for it, instead of starting alongside it and serving the first requests through the dedup layer's fail-open path
- Valkey is started with `valkey-server` rather than the `redis-server` compatibility symlink

## [5.22.1] - 2026-09-10

### Changed
- Upgraded `prerender-redis-cache-ng` to 1.1.0: its Redis client now reconnects indefinitely instead of giving up after 10 attempts (which left the process permanently cacheless, so every deduplicated request waited out `MAX_WAIT_MS` and then 429'd), bodyless responses such as 204/301/410 are cached instead of throwing in `pageLoaded`, and pattern invalidation deletes per `SCAN` batch with `UNLINK`. The cache key format is unchanged, which matters because `server.js` derives its lock key from the same normalisation

## [5.22.0] - 2026-09-10

### Added
- `nginx.conf.example`: a working crawler-detecting front end, with the user-agent list generated from `prerender-node` 3.8.3 (107 crawlers, including GPTBot/ClaudeBot/PerplexityBot), asset paths excluded from rendering, the render-loop guard, Docker-aware upstream resolution and timeouts matched to `MAX_WAIT_MS` + `PAGE_LOAD_TIMEOUT`
- Request deduplication with Redis-based distributed locking
- Concurrent rendering limit with configurable `MAX_CONCURRENT_RENDERS`
- Environment variable configuration support
- Duplicate concurrent requests for the same URL wait for the render already in flight and are served its cached output (200), configurable via `MAX_WAIT_MS` (default 8s). A `429` with `Retry-After` is returned only if that render fails or outlasts the wait
- Lock timeout configuration via `LOCK_TTL` environment variable
- Real-time rendering progress logging
- Test suite on Node's built-in runner (unit + integration)
- `DISABLE_IMAGES` environment variable to skip image loading (measured no effect on real pages; see README)

### Changed
- Removed `package.test.json` and the `test:load` script (duplicate/dead)
- Removed the `forwardHeaders: true` option, which prerender 5.21.6 does not read (the crawler's headers were never reaching the rendered page)
- Pinned patched transitive dependencies via `overrides` (`ws` 7.5.13, `path-to-regexp` 0.1.13, `qs` 6.16.0, `body-parser` 1.20.8, `uuid` 14.0.2), clearing every `npm audit` finding
- Upgraded to Node.js 26-alpine base image
- Image installs from `package-lock.json` with `npm ci --omit=dev` instead of an unpinned `npm install --no-package-lock`, and copies dependency manifests before `server.js` so editing the server no longer invalidates the install layer
- Replaced Mocha/Chai/axios with Node's built-in test runner (`node:test` + `node:assert` + `fetch`), removing all five devDependencies (`mocha`, `chai`, `axios`, `autocannon`, `sinon`). `sinon` and `autocannon` were never imported by any test. This takes `npm audit` from 14 findings (7 high) to 0 (with the dependency overrides below), and the lockfile from 225 packages to 104
- Enhanced Redis cache with request deduplication
- Improved error handling with Redis fallback
- **Performance optimization**: Cache-hit requests now skip lock acquisition (2-4ms response time)
- Trimmed `PAGE_DONE_CHECK_INTERVAL` to 100ms and `WAIT_AFTER_LAST_REQUEST` to 300ms in `compose.yml` (upstream defaults are 500ms; 100ms was measured to save ~400ms per render but risks capturing a page mid-load)
- Added `mem_limit` sized for `MAX_CONCURRENT_RENDERS=10` (~300MB idle + ~90MB per concurrent render)
- Replaced unverified performance claims in README with measured numbers; documented that `DISABLE_IMAGES` has no measurable effect and that `DELETE` cache invalidation never worked (upstream registers no DELETE route)

### Fixed
- Render slot counter no longer leaks when Redis fails during lock release (previously drifted up until every request returned 503)
- Lock key now uses the protocol-agnostic cache key, so `http://` and `https://` variants of a URL no longer render twice
- Invalid `MAX_CONCURRENT_RENDERS` / `LOCK_TTL` values now fall back to defaults instead of silently disabling the limit
- Locks now carry the holder's request id and are released with a Lua compare-and-delete, so a render that outlives `LOCK_TTL` can no longer release the lock a later request has taken (which freed the URL for a third render and made the second one's waiters give up with 429)
- `MAX_CONCURRENT_RENDERS` no longer rejects requests that could wait for an in-flight render of the same URL, which disabled deduplication under load - the limit is now checked only after the lock is won
- Waiting requests stop polling when the client disconnects, instead of polling to the timeout and writing to a dead socket
- Waiting requests check cache and lock in one pipelined Redis round trip, and check before sleeping rather than after (was a fixed 200ms penalty on every deduplicated request)
- Prevented duplicate rendering of the same URL by concurrent requests
- Added resource protection against excessive concurrent renders
- **Cache optimization**: Eliminated unnecessary lock checks for cached content, preventing false 429 responses

## [5.21.6] - Previous Release

### Features
- Redis-backed prerender cache using prerender-redis-cache-ng
- Protocol-agnostic caching (HTTP and HTTPS share same cache)
- Chrome 142 with optimized flags for Docker
- Docker Compose setup with Valkey/Redis
- Multi-architecture support (amd64, arm64)

### Configuration
- `REDIS_URL`: Redis connection URL
- `PAGE_TTL`: Cache expiration time (default: 7 days)
