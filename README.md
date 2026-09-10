# Containerization of the Prerender Service

This repository contains the configuration and setup to containerize the Prerender service using Docker. The service leverages **prerender** with **Redis-backed caching** (prerender-redis-cache-ng) to efficiently render JavaScript content for web crawlers.

## Features

- 🚀 **High Performance**: Chrome 152 with optimized flags for Docker
- 💾 **Redis Cache**: Persistent caching with Valkey/Redis (cache hits are ~1000x faster than a render)
- 🔄 **Protocol-Agnostic**: HTTP and HTTPS URLs share the same cache
- 🛡️ **Certificate Handling**: Configured to handle SSL certificate issues
- 🐳 **Production Ready**: Docker Compose setup with Valkey included

## Prerequisites

- Docker and Docker Compose installed on your system
- Download from [here](https://www.docker.com/)

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/7a6163/prerender-docker
cd prerender-docker

# Start services (Prerender + Valkey/Redis)
docker-compose up -d

# Test the service
curl http://localhost:3000/render?url=http://example.com
```

### Using Docker Image Only

Pull and run the image:

```bash
docker pull ghcr.io/7a6163/prerender
docker run -p 3000:3000 -e REDIS_URL=redis://your-redis-host:6379 ghcr.io/7a6163/prerender
```

**Note:** Without Redis, caching will not work. Use Docker Compose or provide a Redis instance.

## Usage

To use the Prerender service, access it on localhost at port 3000:

```bash
# First request (will render and cache)
curl http://localhost:3000/render?url=http://example.com

# Second request (served from cache, ~2ms)
curl http://localhost:3000/render?url=http://example.com
```

## Configuration

### Environment Variables

- `REDIS_URL`: Redis connection URL (default: `redis://localhost:6379`)
- `PAGE_TTL`: Cache expiration time in seconds (default: `86400` = 1 day, set to `0` for no expiration)
- `MAX_CONCURRENT_RENDERS`: Maximum concurrent rendering processes (default: `10`)
- `LOCK_TTL`: Lock timeout in seconds for preventing duplicate renders, and how long a duplicate request waits before giving up (default: `30`; keep it above `PAGE_LOAD_TIMEOUT`, which defaults to 20s)
- `DISABLE_IMAGES`: Disable image loading (default: `false`). Measured no effect on real pages - see below
- `WAIT_AFTER_LAST_REQUEST`: Milliseconds to wait after the last network request before capturing (upstream default: `500`; `compose.yml` sets `100`)
- `PAGE_DONE_CHECK_INTERVAL`: Page-done polling interval in milliseconds (upstream default: `500`; `compose.yml` sets `100`)

### Concurrency Control

The service implements intelligent request deduplication and concurrency management:

- **Per-URL Locking**: Only one request renders a specific URL at a time. Concurrent requests for the same URL wait for that render to finish and are then served from the cache, so crawlers get a `200` instead of an error
- **Protocol-Agnostic Locking**: `http://` and `https://` variants of a URL share one lock, matching the shared cache key
- **Global Concurrency Limit**: Maximum concurrent renders across all URLs (configurable via `MAX_CONCURRENT_RENDERS`). Requests over the limit receive `503`
- **Give-up Path**: If the in-flight render fails or exceeds `LOCK_TTL`, the waiting request receives `429` with a `Retry-After: 5` header

**Example:**
```
10 concurrent requests for https://example.com/product/123
  ↓
Request 1: Renders (1-2s) → Caches → Returns 200
Request 2-10: Wait (polling the cache every 200ms)
  ↓
Request 1 finishes and fills the cache
  ↓
Request 2-10: Served from cache (50ms) → 200 (one render total)
```

### Performance Optimization

#### What actually costs time

Measured on this setup (Wikipedia `/wiki/Cat`, repeated runs):

| Setting | Render time |
|---|---|
| Cache hit | **0.002-0.003s** |
| Cold render, defaults | 2.9-3.7s |
| Cold render, `DISABLE_IMAGES=true` | 2.9-3.4s (no measurable change) |
| Cold render, `WAIT_AFTER_LAST_REQUEST=100` + `PAGE_DONE_CHECK_INTERVAL=100` | **2.3-2.7s** |

Two things follow:

- **Cache hit rate dominates everything else.** A hit is ~1000x faster than a
  render, so anything that improves hit rate beats anything that speeds up
  rendering.
- **`DISABLE_IMAGES` does not help.** It blocks image decoding, but the time
  goes to the upstream site's response and the page's own JavaScript. It is
  left `false` in `compose.yml`. Try it on your own pages before believing any
  number, including this one.

Trimming the two fixed waits saves ~400ms per render with no truncated
content (verified: same page, 1.93MB of HTML either way).

#### Memory

Idle is ~300MB once Chrome has settled, plus ~90MB per concurrent render
(measured: 5 concurrent renders peaked at 767MB). `MAX_CONCURRENT_RENDERS=10`
therefore implies a ceiling around 1.2GB, which is what `mem_limit` in
`compose.yml` is sized for.

### Redis Cache

The service uses **prerender-redis-cache-ng** for caching:

- **Cache Keys**: Protocol-agnostic (HTTP and HTTPS share same cache)
  - Example: Both `http://example.com` and `https://example.com` use key `example.com`
- **Cache Invalidation**: The upstream `prerender` server only registers `GET`
  and `POST` routes (`app.get('*')` / `app.post('*')` in `prerender/lib/index.js`),
  so a `DELETE /render?url=...` returns `Cannot DELETE /render` and never reaches
  the cache plugin. Invalidate directly in Redis instead:

  ```bash
  # Clear single URL (note: keys have no protocol prefix)
  docker compose exec valkey redis-cli del 'example.com/path'

  # Clear a pattern
  docker compose exec valkey redis-cli --scan --pattern 'example.com/*' \
    | xargs -r docker compose exec -T valkey redis-cli del
  ```

### Chrome Flags

Configured with flags optimized for Docker and Chrome 152:
- `--no-sandbox`: Required for Docker
- `--disable-dev-shm-usage`: Avoid Docker's small /dev/shm
- `--disable-features=AutoupgradeMixedContent,HttpsUpgrades`: Prevent automatic HTTPS upgrade

Passing `chromeFlags` replaces upstream's default list entirely, so
`--remote-debugging-port=9222` has to stay in `server.js`.

## Architecture

```
Web Crawler → Prerender Service (Port 3000) → Chromium
                       ↓
                  Redis Cache (Valkey)
```

## Performance

**Cache Performance** (measured, see Performance Optimization above):
- First request (no cache): 1.1-3.7s depending on the page
- Second request (cached): 0.002-0.003s
- Cache hits are ~1000x faster, and cost no Chrome memory at all

## Docker Compose Services

The `compose.yml` includes:

1. **prerender**: The main Prerender service
   - Node.js 26-alpine
   - Chromium 152
   - Port: 3000

2. **valkey**: Redis-compatible cache
   - Valkey 9-alpine (Redis fork)
   - Port: 6379
   - Persistent storage with AOF

## Development

```bash
# Build locally
docker-compose build

# View logs
docker-compose logs -f prerender

# Stop services
docker-compose down
```
