# Prerender Tests

This directory contains tests for the Prerender service.

## Structure

```
test/
├── unit/              # Pure logic and raw Redis semantics
│   ├── redis-lock.test.js
│   └── url-normalize.test.js
├── integration/       # Full workflows against a running service
│   └── deduplication.test.js
└── scenarios/         # Paths that need their own service configuration
    ├── compose.js             # recreates the container with an override
    ├── concurrency-limit.test.js
    ├── allowed-domains.test.js
    └── waiting.test.js
```

`unit` and `integration` run against whatever is already up. `scenarios` drive
`docker compose` themselves: each suite recreates the **prerender** container
with a temporary override (a render limit of 1, a domain whitelist, a 2s wait),
and puts it back on `compose.yml`'s environment afterwards. They reach Redis
through `valkey-cli` inside the container, so valkey is never reconfigured and
never has to publish a port. They must run one file at a time - hence
`--test-concurrency=1` in the script - because they share one compose project.

Tests use Node's built-in test runner (`node:test` + `node:assert`) and
`fetch`, so there are no test dependencies to install - `npm install` alone is
enough. Requires Node 22+; the image and CI run 26.

## Prerequisites

1. Start the services:
```bash
docker compose up -d
```

2. Wait for services to be ready:
```bash
docker compose logs -f prerender
# Wait until you see "Started Chrome"
```

The integration tests render `httpbin.org` and `example.org`, so they fail
against a deployment that sets `ALLOWED_DOMAINS`. Run them against a service
without it.

Unit tests talk to Redis directly, but `compose.yml` does not publish valkey's
port. Either publish it, or point the tests at another Redis:
```bash
REDIS_URL=redis://localhost:6380 npm run test:unit
```

## Running Tests

### All Tests
```bash
npm test
```

### Unit Tests Only
```bash
npm run test:unit
```

### Integration Tests Only
```bash
npm run test:integration
```

### Scenario Tests (recreates the prerender container ~3 times, takes ~30s)
```bash
npm run test:scenarios
```

### Coverage
```bash
npm run test:coverage
```
Covers the modules the tests load in-process. `server.js` is not among them: it
starts Chrome on require, so its logic is exercised through the integration and
scenario suites instead.

### Watch Mode (re-run on file changes)
```bash
npm run test:watch
```

## Environment Variables

- `PRERENDER_URL`: Prerender service URL (default: `http://localhost:3000`)
- `REDIS_URL`: Redis connection URL (default: `redis://localhost:6379`)

Example:
```bash
PRERENDER_URL=http://prerender.internal:3000 npm test
```

## Test Coverage

### Unit Tests
- ✅ Redis lock acquisition
- ✅ Lock release
- ✅ Lock expiration (TTL)
- ✅ Concurrent lock attempts

### Integration Tests
- ✅ Duplicate concurrent requests wait for the in-flight render and get its output
- ✅ Concurrent requests for different URLs
- ✅ Cache hits are much faster than renders, and return the same body

### Scenario Tests
- ✅ `MAX_CONCURRENT_RENDERS` refuses a new URL with `503` but still serves a duplicate of a render already in flight
- ✅ `ALLOWED_DOMAINS` renders a listed host and `404`s an unlisted one without taking a lock or writing a cache entry
- ✅ A waiting request gives up with `429` + `Retry-After` after `MAX_WAIT_MS`, not after `LOCK_TTL`
- ✅ A waiting request stops polling when its client disconnects

## Writing New Tests

1. Create test file in appropriate directory:
   - `test/unit/` - Test individual functions/modules
   - `test/integration/` - Test complete workflows

2. Use `node:test` + `node:assert`:
```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Feature Name', () => {
    it('should do something', async () => {
        assert.equal(await someFunction(), expectedValue);
    });
});
```

3. Clean up resources:
```javascript
afterEach(async () => {
    // Clean up test data
});
```

## Reproducing a page that never finishes loading

`BLOCK_HOSTS` has no automated test, because the interesting behaviour belongs
to Chrome. This recipe reproduces it in about a minute:

```bash
# A host that accepts connections and never answers, like a long-polling widget
docker run -d --name blackhole --network prerender-docker_default node:26-alpine \
  node -e "require('net').createServer(s => s.on('data',()=>{})).listen(8080)"

# A page whose blocking script points at it, served on the same network,
# then render it with and without BLOCK_HOSTS=blackhole and compare
```

Unblocked the render takes the full `PAGE_LOAD_TIMEOUT` and the page's own
JavaScript never runs; blocked it finishes in well under a second with the
content intact.

## Continuous Integration

Add to your CI pipeline (GitHub Actions example):

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '26'
      - run: docker compose up -d
      - run: sleep 5
      - run: npm install
      - run: npm test
```

## Troubleshooting

### Tests failing with "Connection refused"
- Ensure services are running: `docker compose ps`
- Check logs: `docker compose logs prerender`

### Tests timeout
- Increase the per-test timeout: `it('name', { timeout: 30000 }, async () => {})`
- Check service health: `curl http://localhost:3000/render?url=http://example.com`

### Redis connection errors
- Verify Redis is running: `docker compose ps valkey`
- Check Redis URL: `echo $REDIS_URL`
