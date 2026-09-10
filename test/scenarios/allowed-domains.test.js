const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startWith, restoreDefaults, render, exists, cacheKey, lockKey } = require('./compose');

describe('ALLOWED_DOMAINS', { timeout: 240000 }, () => {
    before(() => startWith({ ALLOWED_DOMAINS: 'example.com,www.example.com' }));
    after(() => restoreDefaults());

    it('renders a listed host', async () => {
        const { status } = await render(`http://example.com/?allowed=${Date.now()}`);
        assert.equal(status, 200);
    });

    it('refuses an unlisted host without spending a lock, a slot or a cache lookup', async () => {
        const url = `http://httpbin.org/html?denied=${Date.now()}`;

        const { status } = await render(url);
        assert.equal(status, 404);

        // The filter has to run before deduplication and the cache, or a refused
        // URL still takes a lock and a cached one is served before the refusal
        assert.equal(exists(lockKey(url)), 0, 'no lock should have been taken');
        assert.equal(exists(cacheKey(url)), 0, 'nothing should have been cached');
    });
});
