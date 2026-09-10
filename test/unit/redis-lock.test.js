const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Redis = require('ioredis');

describe('Redis Lock Mechanism', () => {
    let redis;

    before(() => {
        redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    });

    after(async () => {
        await redis.quit();
    });

    afterEach(async () => {
        // Clean up test keys
        const keys = await redis.keys('prerender:lock:test*');
        if (keys.length > 0) {
            await redis.del(...keys);
        }
    });

    it('should acquire lock for unique key', async () => {
        const result = await redis.set('prerender:lock:test-unique', Date.now(), 'EX', 30, 'NX');

        assert.equal(result, 'OK');
    });

    it('should fail to acquire lock if already held', async () => {
        const lockKey = 'prerender:lock:test-duplicate';

        assert.equal(await redis.set(lockKey, Date.now(), 'EX', 30, 'NX'), 'OK');

        // Second acquisition should fail
        assert.equal(await redis.set(lockKey, Date.now(), 'EX', 30, 'NX'), null);
    });

    it('should release lock when deleted', async () => {
        const lockKey = 'prerender:lock:test-release';

        await redis.set(lockKey, Date.now(), 'EX', 30, 'NX');
        await redis.del(lockKey);

        // Should be able to acquire again
        assert.equal(await redis.set(lockKey, Date.now(), 'EX', 30, 'NX'), 'OK');
    });

    it('should expire lock after TTL', { timeout: 10000 }, async () => {
        const lockKey = 'prerender:lock:test-expire';

        // Acquire lock with 2 second TTL
        await redis.set(lockKey, Date.now(), 'EX', 2, 'NX');
        assert.equal(await redis.set(lockKey, Date.now(), 'EX', 2, 'NX'), null);

        await new Promise(resolve => setTimeout(resolve, 2500));

        // Should be able to acquire after expiration
        assert.equal(await redis.set(lockKey, Date.now(), 'EX', 30, 'NX'), 'OK');
    });
});
