const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startWith, restoreDefaults, logsSince, render, sleep, valkey, lockKey } = require('./compose');

// Both paths a waiting request can end on, other than being served the render
// it was waiting for.
describe('waiting for an in-flight render', { timeout: 240000 }, () => {
    let mark;

    before(async () => {
        mark = await startWith({ MAX_WAIT_MS: 2000 });
    });

    after(() => restoreDefaults());

    it('gives up with 429 and Retry-After when the render never fills the cache', async () => {
        const url = `http://httpbin.org/html?stuck=${Date.now()}`;

        // A lock nobody will release, and no cache entry to wait for: the same
        // shape as a render that died, or one slower than MAX_WAIT_MS
        valkey('set', lockKey(url), 'someone-else', 'EX', '30');

        const started = Date.now();
        const { status, headers, body } = await render(url);
        const waited = Date.now() - started;

        assert.equal(status, 429);
        assert.equal(headers.get('retry-after'), '5');
        assert.match(body, /Please retry/);
        assert.ok(waited >= 2000, `should wait out MAX_WAIT_MS, waited ${waited}ms`);
        assert.ok(waited < 10000, `should not wait for LOCK_TTL, waited ${waited}ms`);

        valkey('del', lockKey(url));
    });

    it('stops polling when the client disconnects', async () => {
        const url = `http://httpbin.org/delay/3?gone=${Date.now()}`;

        const holder = render(url);
        await sleep(1000);

        const abort = new AbortController();
        const abandoned = render(url, { signal: abort.signal });
        await sleep(400);
        abort.abort();
        await assert.rejects(abandoned, { name: 'AbortError' });

        await holder;

        // Nothing else can observe a request that stopped early, so the log is
        // the assertion: without the check it would poll on to MAX_WAIT_MS and
        // then write to a closed socket
        assert.match(logsSince(mark), /Client left while waiting/);
    });
});
