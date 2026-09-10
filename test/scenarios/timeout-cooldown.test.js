const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startWith, restoreDefaults, render, valkey, exists, blackhole, cacheKey } = require('./compose');

// A page that never reaches network idle returns whatever it had at
// PAGE_LOAD_TIMEOUT. That capture is not cacheable (TIMEOUT_STATUS_CODE), so
// nothing would stop the next crawler hit from rendering it again and holding a
// render slot for another full timeout - which is what the cool-down is for.
describe('a render that times out', { timeout: 240000 }, () => {
    const url = 'http://prerender-blackhole:8080/';

    before(async () => {
        blackhole.start();
        await startWith({ PAGE_LOAD_TIMEOUT: 4000, TIMEOUT_STATUS_CODE: 503, TIMEOUT_COOLDOWN: 30 });
        valkey('del', cacheKey(url), `prerender:timeout:${cacheKey(url)}`);
    });

    after(async () => {
        valkey('del', `prerender:timeout:${cacheKey(url)}`);
        blackhole.stop();
        await restoreDefaults();
    });

    it('returns 503 with Retry-After, caches nothing, and refuses the retry without rendering again', async () => {
        const started = Date.now();
        const first = await render(url);
        const rendered = Date.now() - started;

        // 503 from TIMEOUT_STATUS_CODE when only the page load timed out, 504
        // from upstream's render-error code when the parse timed out too - as
        // here, where the host never sends a response at all. Neither is a
        // cacheable status, which is the property that matters
        assert.ok([503, 504].includes(first.status), `expected a 5xx, got ${first.status}`);
        assert.equal(first.headers.get('retry-after'), '30');
        assert.ok(rendered >= 4000, `should have waited out PAGE_LOAD_TIMEOUT, took ${rendered}ms`);
        assert.equal(exists(cacheKey(url)), 0, 'the partial capture must not be cached');

        // The second request must be refused from the cool-down, not by rendering
        // again: same status, but without paying another PAGE_LOAD_TIMEOUT
        const retried = Date.now();
        const second = await render(url);
        const refused = Date.now() - retried;

        assert.equal(second.status, 503, 'the cool-down refuses with 503, not another render error');
        assert.equal(second.headers.get('retry-after'), '30');
        assert.ok(refused < 1000, `should be refused immediately, took ${refused}ms`);
    });
});
