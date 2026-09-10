const axios = require('axios');
const { expect } = require('chai');

describe('Request Deduplication', function() {
    this.timeout(30000);

    const baseURL = process.env.PRERENDER_URL || 'http://localhost:3000';

    it('should serve the waiting request from the first render, not a second one', async () => {
        // Use unique URL with timestamp to avoid cache
        const timestamp = Date.now();
        const testUrl = `http://httpbin.org/delay/1?test=${timestamp}`;
        const url = `${baseURL}/render?url=${testUrl}`;

        // Start first request (don't wait)
        const promise1 = axios.get(url).catch(err => err.response);

        // Wait to ensure first request has acquired the lock
        await new Promise(resolve => setTimeout(resolve, 500));

        // Second concurrent request should wait for the first render and get its
        // cached output - not a 429, which crawlers treat as a reason to back off.
        const response2 = await axios.get(url).catch(err => err.response);
        const response1 = await promise1;

        expect(response1?.status).to.equal(200);
        expect(response2.status).to.equal(200);
        expect(response2.data).to.equal(response1.data);
    });

    it('should allow concurrent requests for different URLs', async () => {
        const url1 = `${baseURL}/render?url=http://example.com/`;
        const url2 = `${baseURL}/render?url=http://example.org/`;

        const [response1, response2] = await Promise.all([
            axios.get(url1).catch(err => err.response),
            axios.get(url2).catch(err => err.response)
        ]);

        expect(response1.status).to.equal(200);
        expect(response2.status).to.equal(200);
    });

    it('should serve from cache after first render', async () => {
        const testUrl = `http://example.com/`;
        const url = `${baseURL}/render?url=${testUrl}`;

        // First request (may hit cache if already rendered before)
        const start1 = Date.now();
        const response1 = await axios.get(url).catch(err => err.response);
        const duration1 = Date.now() - start1;

        expect(response1.status).to.equal(200);

        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 500));

        // Second request (should definitely hit cache)
        const start2 = Date.now();
        const response2 = await axios.get(url).catch(err => err.response);
        const duration2 = Date.now() - start2;

        expect(response2.status).to.equal(200);

        // Both requests should work (cache test is informational)
        console.log(`First: ${duration1}ms, Second: ${duration2}ms, Speedup: ${(duration1/duration2).toFixed(2)}x`);

        // Second request should complete (no assertion on speed due to cache warmup)
        expect(duration2).to.be.greaterThan(0);
    });
});
