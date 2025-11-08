const Redis = require('ioredis');
const { expect } = require('chai');

describe('Redis Lock Mechanism', function() {
    this.timeout(10000);

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
        const lockKey = 'prerender:lock:test-unique';
        const result = await redis.set(lockKey, Date.now(), 'EX', 30, 'NX');

        expect(result).to.equal('OK');
    });

    it('should fail to acquire lock if already held', async () => {
        const lockKey = 'prerender:lock:test-duplicate';

        // First acquisition
        const first = await redis.set(lockKey, Date.now(), 'EX', 30, 'NX');
        expect(first).to.equal('OK');

        // Second acquisition should fail
        const second = await redis.set(lockKey, Date.now(), 'EX', 30, 'NX');
        expect(second).to.be.null;
    });

    it('should release lock when deleted', async () => {
        const lockKey = 'prerender:lock:test-release';

        // Acquire lock
        await redis.set(lockKey, Date.now(), 'EX', 30, 'NX');

        // Release lock
        await redis.del(lockKey);

        // Should be able to acquire again
        const reacquire = await redis.set(lockKey, Date.now(), 'EX', 30, 'NX');
        expect(reacquire).to.equal('OK');
    });

    it('should expire lock after TTL', async function() {
        this.timeout(5000);

        const lockKey = 'prerender:lock:test-expire';

        // Acquire lock with 2 second TTL
        await redis.set(lockKey, Date.now(), 'EX', 2, 'NX');

        // Should be locked
        const immediate = await redis.set(lockKey, Date.now(), 'EX', 2, 'NX');
        expect(immediate).to.be.null;

        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 2500));

        // Should be able to acquire after expiration
        const afterExpiry = await redis.set(lockKey, Date.now(), 'EX', 30, 'NX');
        expect(afterExpiry).to.equal('OK');
    });
});
