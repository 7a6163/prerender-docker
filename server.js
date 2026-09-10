'use strict';

const prerender = require('prerender');
const redisCache = require('prerender-redis-cache-ng');
const Redis = require('ioredis');

// Build Chrome flags based on configuration
const chromeFlags = [
    '--no-sandbox',
    '--headless',
    '--disable-gpu',
    '--remote-debugging-port=9222',
    '--hide-scrollbars',
    '--disable-dev-shm-usage',
    '--disable-features=AutoupgradeMixedContent,HttpsUpgrades'
];

// Optionally disable images for faster rendering
const DISABLE_IMAGES = process.env.DISABLE_IMAGES === 'true';
if (DISABLE_IMAGES) {
    chromeFlags.push('--blink-settings=imagesEnabled=false');
    console.log('[Prerender Config] Images disabled for faster rendering');
}

const server = prerender({
    chromeFlags,
    forwardHeaders: true,
    chromeLocation: '/usr/bin/chromium-browser'
});

// Redis client for distributed locking
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Configuration from environment variables
const MAX_CONCURRENT_RENDERS = parseInt(process.env.MAX_CONCURRENT_RENDERS, 10) || 10;
const LOCK_TTL = parseInt(process.env.LOCK_TTL, 10) || 30;
const WAIT_INTERVAL = 200; // how often a waiting request re-checks the cache

// Track current rendering count
let currentRenders = 0;

console.log(`[Prerender Config] MAX_CONCURRENT_RENDERS: ${MAX_CONCURRENT_RENDERS}`);
console.log(`[Prerender Config] LOCK_TTL: ${LOCK_TTL}s`);

// Request deduplication middleware
server.use({
    requestReceived: async function(req, res, next) {
        const url = req.prerender.url;
        const cacheKey = url.replace(/^https?:\/\//, ''); // Same format as prerender-redis-cache-ng
        const lockKey = `prerender:lock:${cacheKey}`; // Same granularity as the cache: http/https share a lock

        try {
            // Check if cached (skip lock if cache exists)
            const cached = await redis.exists(cacheKey);
            if (cached) {
                console.log(`[Prerender] Cache hit, skipping lock: ${url}`);
                next(); // Let cache middleware handle it
                return;
            }

            // Check global concurrent limit
            if (currentRenders >= MAX_CONCURRENT_RENDERS) {
                console.log(`[Prerender] Max concurrent renders reached (${currentRenders}/${MAX_CONCURRENT_RENDERS}), rejecting: ${url}`);
                res.send(503, `Service busy. Currently rendering ${currentRenders} pages. Please retry in a few seconds.`);
                return;
            }

            // Try to acquire lock (NX = only set if not exists)
            const lockAcquired = await redis.set(lockKey, Date.now(), 'EX', LOCK_TTL, 'NX');

            if (lockAcquired) {
                // Lock acquired successfully, proceed with rendering
                currentRenders++;
                console.log(`[Prerender] Lock acquired (${currentRenders}/${MAX_CONCURRENT_RENDERS}), rendering: ${url}`);
                req.prerender.lockKey = lockKey;
                next();
                return;
            }

            // Someone else is already rendering this URL. Wait for their result and
            // serve it from the cache - crawlers throttle themselves when given a 429.
            // The cache is written (pageLoaded) before the lock is released (beforeSend),
            // so a missing lock means that render failed and nothing is coming.
            // ponytail: 200ms polling, switch to Redis pub/sub if waiters pile up
            console.log(`[Prerender] Already rendering, waiting for cache: ${url}`);

            for (let waited = 0; waited < LOCK_TTL * 1000; waited += WAIT_INTERVAL) {
                await new Promise(resolve => setTimeout(resolve, WAIT_INTERVAL));

                if (await redis.exists(cacheKey)) {
                    console.log(`[Prerender] Cache filled while waiting (${waited + WAIT_INTERVAL}ms): ${url}`);
                    next(); // Let cache middleware serve it
                    return;
                }

                if (!(await redis.exists(lockKey))) break; // Holder gave up without caching
            }

            console.log(`[Prerender] Gave up waiting for the in-flight render: ${url}`);
            res.setHeader('Retry-After', '5');
            res.send(429, 'Page is being rendered by another request. Please retry after 5 seconds.');
        } catch (err) {
            console.error(`[Prerender] Redis error for ${url}:`, err.message);
            // On Redis error, allow the request to proceed
            next();
        }
    },

    beforeSend: async function(req, res, next) {
        const url = req.prerender.url;

        // Release lock if this request holds it. Decrement first: a Redis failure here
        // must not leak the render slot, or the counter drifts up until every
        // request gets a 503.
        if (req.prerender.lockKey) {
            currentRenders--;
            console.log(`[Prerender] Lock released (${currentRenders}/${MAX_CONCURRENT_RENDERS}): ${url}`);
            try {
                await redis.del(req.prerender.lockKey);
            } catch (err) {
                console.error(`[Prerender] Failed to release lock for ${url}:`, err.message);
            }
        }

        next();
    }
});

server.use(redisCache);
server.use(prerender.blacklist());
server.use(prerender.httpHeaders());
server.use(prerender.removeScriptTags());

server.start();
