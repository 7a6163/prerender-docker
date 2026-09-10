const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startWith, restoreDefaults, render, sleep } = require('./compose');

// MAX_CONCURRENT_RENDERS used to be checked before the lock was attempted, so a
// full service rejected duplicates of the URLs it was already rendering - the
// deduplication switched itself off under exactly the load that motivates it.
describe('MAX_CONCURRENT_RENDERS', { timeout: 240000 }, () => {
    before(() => startWith({ MAX_CONCURRENT_RENDERS: 1, MAX_WAIT_MS: 20000 }));
    after(() => restoreDefaults());

    it('rejects a new URL but still serves a duplicate of the one in flight', async () => {
        const stamp = Date.now();
        const busy = `http://httpbin.org/delay/3?busy=${stamp}`;
        const other = `http://httpbin.org/delay/1?other=${stamp}`;

        // Takes the only render slot
        const holder = render(busy);
        await sleep(1000);

        const [duplicate, fresh] = await Promise.all([render(busy), render(other)]);
        const first = await holder;

        assert.equal(first.status, 200, 'the render holding the slot should succeed');
        assert.equal(fresh.status, 503, 'a new URL with no slot left should be refused');
        assert.match(fresh.body, /Service busy/);

        assert.equal(duplicate.status, 200, 'a duplicate of an in-flight render must not be refused');
        assert.equal(duplicate.body, first.body, 'the duplicate should be served the first render');
    });
});
