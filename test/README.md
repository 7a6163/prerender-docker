# Prerender Tests

This directory contains tests for the Prerender service.

## Structure

```
test/
├── unit/              # Unit tests for individual components
│   └── redis-lock.test.js
├── integration/       # Integration tests for full workflows
│   └── deduplication.test.js
└── load/             # Load and performance tests
```

## Prerequisites

1. Install test dependencies:
```bash
npm install --save-dev mocha chai axios ioredis autocannon sinon
```

2. Start the services:
```bash
docker-compose up -d
```

3. Wait for services to be ready:
```bash
docker-compose logs -f prerender
# Wait until you see "Started Chrome"
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

### Load Tests Only
```bash
npm run test:load
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
- ✅ Request deduplication (429 responses)
- ✅ Concurrent requests for different URLs
- ✅ Cache hit performance
- ✅ Retry-After header validation

### Load Tests
- ⏳ High concurrency stress test
- ⏳ Cache performance under load
- ⏳ Lock contention handling

## Writing New Tests

1. Create test file in appropriate directory:
   - `test/unit/` - Test individual functions/modules
   - `test/integration/` - Test complete workflows
   - `test/load/` - Test performance under load

2. Use Mocha + Chai:
```javascript
const { expect } = require('chai');

describe('Feature Name', () => {
    it('should do something', async () => {
        const result = await someFunction();
        expect(result).to.equal(expectedValue);
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
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '24'
      - run: docker-compose up -d
      - run: sleep 5
      - run: npm install --save-dev mocha chai axios ioredis
      - run: npm test
```

## Troubleshooting

### Tests failing with "Connection refused"
- Ensure services are running: `docker-compose ps`
- Check logs: `docker-compose logs prerender`

### Tests timeout
- Increase timeout in test: `this.timeout(30000)`
- Check service health: `curl http://localhost:3000/render?url=http://example.com`

### Redis connection errors
- Verify Redis is running: `docker-compose ps valkey`
- Check Redis URL: `echo $REDIS_URL`
