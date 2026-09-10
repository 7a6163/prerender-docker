# Prerender Tests

This directory contains tests for the Prerender service.

## Structure

```
test/
├── unit/              # Unit tests for individual components
│   └── redis-lock.test.js
└── integration/       # Integration tests for full workflows
    └── deduplication.test.js
```

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

### Watch Mode (re-run on file changes)
```bash
npm run test:watch
```

## Environment Variables

- `PRERENDER_URL`: Prerender service URL (default: `http://localhost:3000`)
- `REDIS_URL`: Redis connection URL (default: `redis://localhost:6379`)

Example:
```bash
PRERENDER_URL=http://10.240.0.11:3000 npm test
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
