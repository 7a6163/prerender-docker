# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
