# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Request deduplication with Redis-based distributed locking
- Concurrent rendering limit with configurable `MAX_CONCURRENT_RENDERS`
- Environment variable configuration support
- Automatic 429 response for duplicate concurrent requests
- Lock timeout configuration via `LOCK_TTL` environment variable
- `Retry-After: 5` header for 429 responses
- Real-time rendering progress logging
- Comprehensive test suite (unit + integration tests)
- **Image disable option**: `DISABLE_IMAGES` environment variable for 2-5x faster rendering
- Performance testing script and documentation

### Changed
- Duplicate concurrent requests now wait for the in-flight render and are served from the cache (200) instead of receiving 429 immediately; 429 is now only returned if that render fails or exceeds `LOCK_TTL`
- Removed `package.test.json` and the `test:load` script (duplicate/dead)
- Pinned patched transitive dependencies via `overrides` (`ws` 7.5.13, `path-to-regexp` 0.1.13, `qs` 6.16.0, `body-parser` 1.20.8), clearing every production `npm audit` finding except a non-exploitable `uuid` advisory
- Upgraded to Node.js 26-alpine base image
- Replaced Mocha/Chai/axios with Node's built-in test runner (`node:test` + `node:assert` + `fetch`), removing all five devDependencies (`mocha`, `chai`, `axios`, `autocannon`, `sinon`). `sinon` and `autocannon` were never imported by any test. This takes `npm audit` from 14 findings (7 high) to 2, and the lockfile from 225 packages to 104
- Enhanced Redis cache with request deduplication
- Improved error handling with Redis fallback
- **Performance optimization**: Cache-hit requests now skip lock acquisition (2-4ms response time)
- Trimmed `WAIT_AFTER_LAST_REQUEST` and `PAGE_DONE_CHECK_INTERVAL` to 100ms in `compose.yml` (~400ms saved per render, measured)
- Added `mem_limit` sized for `MAX_CONCURRENT_RENDERS=10` (~300MB idle + ~90MB per concurrent render)
- Replaced unverified performance claims in README with measured numbers; documented that `DISABLE_IMAGES` has no measurable effect and that `DELETE` cache invalidation never worked (upstream registers no DELETE route)
- **Rendering speed**: Optional image loading disable for SEO/crawler use cases

### Fixed
- Render slot counter no longer leaks when Redis fails during lock release (previously drifted up until every request returned 503)
- Lock key now uses the protocol-agnostic cache key, so `http://` and `https://` variants of a URL no longer render twice
- Invalid `MAX_CONCURRENT_RENDERS` / `LOCK_TTL` values now fall back to defaults instead of silently disabling the limit
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
