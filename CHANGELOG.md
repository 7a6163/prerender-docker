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
- Upgraded to Node.js 24-alpine base image
- Enhanced Redis cache with request deduplication
- Improved error handling with Redis fallback
- **Performance optimization**: Cache-hit requests now skip lock acquisition (2-4ms response time)
- **Rendering speed**: Optional image loading disable for SEO/crawler use cases

### Fixed
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
