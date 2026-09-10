const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const baseURL = process.env.PRERENDER_URL || 'http://localhost:3000';

const render = async (url) => {
    const res = await fetch(`${baseURL}/render?url=${url}`);
    return { status: res.status, body: await res.text(), headers: res.headers };
};

describe('Request Deduplication', () => {
    it('should serve the waiting request from the first render, not a second one', { timeout: 30000 }, async () => {
        // Use unique URL with timestamp to avoid cache
        const testUrl = `http://httpbin.org/delay/1?test=${Date.now()}`;

        // Start first request (don't wait)
        const first = render(testUrl);

        // Wait to ensure first request has acquired the lock
        await new Promise(resolve => setTimeout(resolve, 500));

        // Second concurrent request should wait for the first render and get its
        // cached output - not a 429, which crawlers treat as a reason to back off.
        const second = await render(testUrl);
        const response1 = await first;

        assert.equal(response1.status, 200);
        assert.equal(second.status, 200);
        assert.equal(second.body, response1.body);
    });

    it('should allow concurrent requests for different URLs', { timeout: 30000 }, async () => {
        const [response1, response2] = await Promise.all([
            render('http://example.com/'),
            render('http://example.org/')
        ]);

        assert.equal(response1.status, 200);
        assert.equal(response2.status, 200);
    });

    it('should serve from cache after first render', { timeout: 30000 }, async () => {
        const testUrl = `http://example.com/?cache=${Date.now()}`;

        const start1 = Date.now();
        const response1 = await render(testUrl);
        const duration1 = Date.now() - start1;

        assert.equal(response1.status, 200);

        const start2 = Date.now();
        const response2 = await render(testUrl);
        const duration2 = Date.now() - start2;

        assert.equal(response2.status, 200);
        assert.equal(response2.body, response1.body);

        // A cache hit is orders of magnitude faster than a render, so this is a
        // real assertion rather than an informational log.
        console.log(`render: ${duration1}ms, cache hit: ${duration2}ms`);
        assert.ok(duration2 < duration1 / 5, `cache hit (${duration2}ms) should be much faster than render (${duration1}ms)`);
    });
});
