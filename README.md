# Containerization of the Prerender Service

This repository contains the configuration and setup to containerize the Prerender service using Docker. The service leverages **prerender** with **Redis-backed caching** (prerender-redis-cache-ng) to efficiently render JavaScript content for web crawlers.

## Features

- 🚀 **High Performance**: Chrome 142 with optimized flags for Docker
- 💾 **Redis Cache**: Persistent caching with Valkey/Redis for faster response times (24x faster on cache hits!)
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

# Second request (served from cache, ~24x faster!)
curl http://localhost:3000/render?url=http://example.com
```

## Configuration

### Environment Variables

- `REDIS_URL`: Redis connection URL (default: `redis://localhost:6379`)
- `PAGE_TTL`: Cache expiration time in seconds (default: `86400` = 1 day, set to `0` for no expiration)

### Redis Cache

The service uses **prerender-redis-cache-ng** for caching:

- **Cache Keys**: Protocol-agnostic (HTTP and HTTPS share same cache)
  - Example: Both `http://example.com` and `https://example.com` use key `example.com`
- **Cache Invalidation**: Supports DELETE requests to clear cache
  ```bash
  # Clear single URL
  curl -X DELETE http://localhost:3000/render?url=http://example.com

  # Clear pattern (all URLs matching wildcard)
  curl -X DELETE http://localhost:3000/render?url=http://example.com/*
  ```

### Chrome Flags

Configured with flags optimized for Docker and Chrome 142:
- `--no-sandbox`: Required for Docker
- `--ignore-certificate-errors`: Handle SSL certificate issues
- `--disable-features=AutoupgradeMixedContent,HttpsUpgrades`: Prevent automatic HTTPS upgrade

## Architecture

```
Web Crawler → Prerender Service (Port 3000) → Chromium
                       ↓
                  Redis Cache (Valkey)
```

## Performance

**Cache Performance:**
- First request (no cache): ~1.5 seconds
- Second request (cached): ~0.06 seconds
- **~24x faster** with cache!

## Docker Compose Services

The `compose.yml` includes:

1. **prerender**: The main Prerender service
   - Node.js 24-alpine
   - Chromium 142
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
