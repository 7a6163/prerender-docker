'use strict';

const prerender = require('prerender');
const redisCache = require('prerender-redis-cache-ng');
const Redis = require('ioredis');

const server = prerender({
    chromeFlags: [
        '--no-sandbox',
        '--headless',
        '--disable-gpu',
        '--remote-debugging-port=9222',
        '--hide-scrollbars',
        '--disable-dev-shm-usage',
        '--disable-features=AutoupgradeMixedContent,HttpsUpgrades'
    ],
    forwardHeaders: true,
    chromeLocation: '/usr/bin/chromium-browser'
});

// Redis client for distributed locking
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Configuration from environment variables
const MAX_CONCURRENT_RENDERS = parseInt(process.env.MAX_CONCURRENT_RENDERS || '10');
const LOCK_TTL = parseInt(process.env.LOCK_TTL || '30');

// Track current rendering count
let currentRenders = 0;

console.log(`[Prerender Config] MAX_CONCURRENT_RENDERS: ${MAX_CONCURRENT_RENDERS}`);
console.log(`[Prerender Config] LOCK_TTL: ${LOCK_TTL}s`);

// Request deduplication middleware
server.use({
    requestReceived: async function(req, res, next) {
        const url = req.prerender.url;
        const lockKey = `prerender:lock:${url}`;
        const cacheKey = url.replace(/^https?:\/\//, ''); // Same format as prerender-redis-cache-ng

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
                req.prerender.isLockHolder = true;
                next();
            } else {
                // Lock already held by another request, return 429
                console.log(`[Prerender] Already rendering, returning 429: ${url}`);

                // Set Retry-After header (fixed value)
                res.setHeader('Retry-After', '5');

                // Send 429 response
                res.send(429, 'Page is being rendered by another request. Please retry after 5 seconds.');

                // Do not call next() - request ends here
            }
        } catch (err) {
            console.error(`[Prerender] Redis error for ${url}:`, err.message);
            // On Redis error, allow the request to proceed
            next();
        }
    },

    beforeSend: async function(req, res, next) {
        const url = req.prerender.url;
        const lockKey = `prerender:lock:${url}`;

        // Release lock if this request holds it
        if (req.prerender.isLockHolder) {
            try {
                await redis.del(lockKey);
                currentRenders--;
                console.log(`[Prerender] Lock released (${currentRenders}/${MAX_CONCURRENT_RENDERS}): ${url}`);
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
