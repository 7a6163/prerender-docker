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
- `LOCK_TTL`: Lock timeout in seconds for preventing duplicate renders (default: `30`; keep it above `PAGE_LOAD_TIMEOUT`, which defaults to 20s)
- `MAX_WAIT_MS`: How long a duplicate request waits for the in-flight render before returning `429` (default: `8000`)
- `ALLOWED_DOMAINS`: Comma-separated hostnames this service may render; everything else gets `404` (default: unset, meaning any URL is rendered - see Security)
- `STRIP_QUERY_PARAMS`: Query parameters removed before the URL becomes a lock, a cache key and a render (default: a built-in tracking-parameter list; set to empty to strip nothing)
- `BROWSER_FORCE_RESTART_PERIOD`: How often Chrome is recycled regardless of in-flight requests, in milliseconds (upstream default: `3600000`)
- `DISABLE_IMAGES`: Disable image loading (default: `false`). Measured no effect on real pages - see below
- `WAIT_AFTER_LAST_REQUEST`: Milliseconds to wait after the last network request before capturing (upstream default: `500`; `compose.yml` sets `300`)
- `PAGE_DONE_CHECK_INTERVAL`: Page-done polling interval in milliseconds (upstream default: `500`; `compose.yml` sets `100`)

### Security

This service renders whatever URL it is given, so anything that can reach port
3000 can use it to fetch arbitrary hosts - including internal services that are
not otherwise reachable - and have the result cached for `PAGE_TTL`. Two
settings keep that closed:

- `compose.yml` publishes the port on `127.0.0.1` only. If your front end is a
  container, put it on this compose network and drop the `ports` block entirely.
- `ALLOWED_DOMAINS=example.com,www.example.com` restricts rendering to your own
  hostnames; everything else gets a `404` before a lock, a render slot or a
  cache lookup is spent. Startup warns when it is unset.

Note that `prerender.blacklist()` - which this service used on its own before -
does nothing at all unless `BLACKLISTED_DOMAINS` is set, so it was never a
restriction.

### URL Canonicalisation

The lock, the cache entry and the render are all per-URL, so the same page
arriving with different click ids is that many renders and that many cache
entries - one shared link on Facebook or LINE is enough to start it. Tracking
parameters are stripped before any of that: `?id=7&fbclid=abc&utm_source=fb`
becomes `?id=7`, and the two URLs share one render and one cache entry.

The default list covers `utm_*`, `gclid`/`gbraid`/`wbraid`, `fbclid`, `igshid`,
`ttclid`, `twclid`, `msclkid`, `yclid`, `li_fat_id`, `mc_cid`/`mc_eid`,
`mkt_tok`, `_hsenc` and similar. Override it with `STRIP_QUERY_PARAMS`, or set
that to empty to disable stripping. Parameter names are matched
case-insensitively; parameter order and fragments (including `#!` routes) are
preserved.

### Concurrency Control

The service implements intelligent request deduplication and concurrency management:

- **Per-URL Locking**: Only one request renders a specific URL at a time. Concurrent requests for the same URL wait for that render to finish and are then served from the cache, so crawlers get a `200` instead of an error
- **Protocol-Agnostic Locking**: `http://` and `https://` variants of a URL share one lock, matching the shared cache key
- **Global Concurrency Limit**: `MAX_CONCURRENT_RENDERS` caps renders across all URLs. It applies only to requests that would start a new render - a request that can wait for an in-flight render of the same URL is never rejected by it, or deduplication would switch off under exactly the load that motivates it. Requests that would exceed the limit receive `503`
- **Give-up Path**: A waiting request gives up with `429` and `Retry-After: 5` after `MAX_WAIT_MS` (default 8s), or as soon as the in-flight render fails without writing the cache. It also stops polling if the client disconnects

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

`compose.yml` settles on `WAIT_AFTER_LAST_REQUEST=300` rather than the 100 that
was measured. A page whose JavaScript chains a request more than the grace
period after the previous one settles gets captured mid-load, still returns
`200`, and is therefore cached for `PAGE_TTL` - a week by default - with nothing
detecting it. The measurement above is one page; the failure mode is per-site,
so buy the last 200ms only after checking your own pages.

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
Web Crawler → nginx (detects crawlers) → Prerender Service (Port 3000) → Chromium
                                                   ↓
                                            Redis Cache (Valkey)
```

The service renders whatever URL it is given; deciding *which* requests are
crawlers and should be rendered belongs to the layer in front of it.
`nginx.conf.example` is a working front end for that: the crawler list is
generated from `prerender-node` (the only part of upstream still maintained,
and the list that keeps up with LLM crawlers such as GPTBot, ClaudeBot and
PerplexityBot), assets are excluded from rendering, and the timeouts match this
service's `MAX_WAIT_MS` and `PAGE_LOAD_TIMEOUT`.

Two entries in it are load-bearing:

- `"~*Prerender" 0` must stay first in the user-agent map. This service's own
  Chromium requests pages as `<chrome ua> Prerender (+https://github.com/prerender/prerender)`,
  so without it the render fetches the page, nginx sees a crawler again, and the
  request loops until `MAX_CONCURRENT_RENDERS` is exhausted.
- The URL is passed in path form (`rewrite .* /$scheme://$host$request_uri?`),
  not as `/render?url=...`. Building the query form by hand breaks on the first
  `&` in the original query string.

Verified end to end with nginx in front of this service: a Googlebot,
ClaudeBot, GPTBot or facebookexternalhit user agent receives JavaScript-rendered
HTML, a browser user agent receives the raw SPA shell, the service's own user
agent is not re-rendered, and `data.json` is served by nginx without reaching
the renderer.

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
