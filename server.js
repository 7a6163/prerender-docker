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

// forwardHeaders is deliberately absent: prerender 5.21.6 never reads it, so
// passing it only suggests the crawler's headers reach the page. They do not.
const server = prerender({
    chromeFlags,
    chromeLocation: '/usr/bin/chromium-browser'
});

// Redis client for distributed locking
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Configuration from environment variables
const MAX_CONCURRENT_RENDERS = parseInt(process.env.MAX_CONCURRENT_RENDERS, 10) || 10;
const LOCK_TTL = parseInt(process.env.LOCK_TTL, 10) || 30;
const WAIT_INTERVAL = 200; // how often a waiting request re-checks the cache
const MAX_WAIT_MS = parseInt(process.env.MAX_WAIT_MS, 10) || 8000;

// Track current rendering count
let currentRenders = 0;

// Release a lock only if this request still holds it. A render that outlives
// LOCK_TTL lets the next request take the lock, and an unconditional DEL would
// release that one - freeing the URL for a third render while the second is
// still going, and leaving its waiters to see "lock gone, cache empty" and 429.
const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;

console.log(`[Prerender Config] MAX_CONCURRENT_RENDERS: ${MAX_CONCURRENT_RENDERS}`);
console.log(`[Prerender Config] LOCK_TTL: ${LOCK_TTL}s`);
console.log(`[Prerender Config] MAX_WAIT_MS: ${MAX_WAIT_MS}ms`);

// Domain filter first, before anything else in the chain: a URL we will not
// serve should not take a lock, spend a render slot, or even be looked up in
// the cache. Registering the whitelist unconditionally would 404 everything
// when ALLOWED_DOMAINS is unset, which takes the service down rather than
// securing it - so an unset list keeps the (empty, permissive) blacklist.
server.use(process.env.ALLOWED_DOMAINS ? prerender.whitelist() : prerender.blacklist());

if (process.env.ALLOWED_DOMAINS) {
    console.log(`[Prerender Config] ALLOWED_DOMAINS: ${process.env.ALLOWED_DOMAINS}`);
} else {
    console.warn('[Prerender Config] ALLOWED_DOMAINS is unset: this service will render ANY URL it is given. Set it, and do not expose port 3000 beyond your own front end.');
}

// Request deduplication middleware
server.use({
    requestReceived: async function(req, res, next) {
        const url = req.prerender.url;
        const cacheKey = url.replace(/^https?:\/\//, ''); // Same format as prerender-redis-cache-ng
        const lockKey = `prerender:lock:${cacheKey}`; // Same granularity as the cache: http/https share a lock

        try {
            // Check if cached (skip lock if cache exists)
            if (await redis.exists(cacheKey)) {
                console.log(`[Prerender] Cache hit, skipping lock: ${url}`);
                next(); // Let cache middleware handle it
                return;
            }

            // Try to acquire lock (NX = only set if not exists). The value is this
            // request's id so the holder can be identified at release time.
            const lockToken = req.prerender.reqId;
            const lockAcquired = await redis.set(lockKey, lockToken, 'EX', LOCK_TTL, 'NX');

            if (lockAcquired) {
                // Only a request that would start a new render is subject to the
                // concurrency limit. Checking it earlier rejected duplicates of
                // URLs already being rendered, which switched deduplication off
                // exactly when load made it worth having.
                if (currentRenders >= MAX_CONCURRENT_RENDERS) {
                    await redis.eval(RELEASE_LOCK, 1, lockKey, lockToken);
                    console.log(`[Prerender] Max concurrent renders reached (${currentRenders}/${MAX_CONCURRENT_RENDERS}), rejecting: ${url}`);
                    res.send(503, `Service busy. Currently rendering ${currentRenders} pages. Please retry in a few seconds.`);
                    return;
                }

                // Lock acquired successfully, proceed with rendering
                currentRenders++;
                console.log(`[Prerender] Lock acquired (${currentRenders}/${MAX_CONCURRENT_RENDERS}), rendering: ${url}`);
                req.prerender.lockKey = lockKey;
                req.prerender.lockToken = lockToken;
                next();
                return;
            }

            // Someone else is already rendering this URL. Wait for their result and
            // serve it from the cache - crawlers throttle themselves when given a 429.
            // The cache is written (pageLoaded) before the lock is released (beforeSend),
            // so a missing lock means that render failed and nothing is coming.
            //
            // Capped by MAX_WAIT_MS rather than the lock's lifetime: nothing here can
            // tell a slow render from a holder that will never write the cache, and a
            // client waiting out a 30s lock is worse than one told to come back. The
            // cache plugin's own Redis client reconnects indefinitely as of
            // prerender-redis-cache-ng 1.1.0, so a stuck cache is no longer permanent,
            // but it can still outlast any single request.
            // ponytail: 200ms polling, switch to Redis pub/sub if waiters pile up
            console.log(`[Prerender] Already rendering, waiting for cache: ${url}`);

            for (let waited = 0; waited < MAX_WAIT_MS; waited += WAIT_INTERVAL) {
                const [[, cached], [, locked]] = await redis.pipeline().exists(cacheKey).exists(lockKey).exec();

                if (cached) {
                    console.log(`[Prerender] Cache filled while waiting (${waited}ms): ${url}`);
                    next(); // Let cache middleware serve it
                    return;
                }

                if (!locked) break; // Holder gave up without caching

                // Nothing to send a response to, so stop polling for one. Checked
                // rather than listened for: only the real req reaches a plugin, and
                // its 'close' also fires on healthy requests.
                if (req.destroyed || req.socket?.destroyed) {
                    console.log(`[Prerender] Client left while waiting (${waited}ms): ${url}`);
                    res.send(499, 'Client closed request while waiting for an in-flight render.');
                    return;
                }

                await new Promise(resolve => setTimeout(resolve, WAIT_INTERVAL));
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
                const released = await redis.eval(RELEASE_LOCK, 1, req.prerender.lockKey, req.prerender.lockToken);
                if (!released) {
                    console.log(`[Prerender] Lock had expired and been taken by another request, left alone: ${url}`);
                }
            } catch (err) {
                console.error(`[Prerender] Failed to release lock for ${url}:`, err.message);
            }
        }

        next();
    }
});

server.use(redisCache);

// Sends X-Prerender: 1 with the page requests this service makes, which is the
// second loop guard in nginx.conf.example - without it that map never fires and
// loop protection rests entirely on the user agent carrying "Prerender".
server.use(prerender.sendPrerenderHeader());

server.use(prerender.httpHeaders());
server.use(prerender.removeScriptTags());

// Restarts Chrome hourly (BROWSER_FORCE_RESTART_PERIOD). Upstream's other
// restart path only fires when no request is in flight, and requests parked in
// the dedup wait loop keep that set non-empty, so on a busy service Chrome
// would never be recycled - it would just grow into mem_limit.
server.use(prerender.browserForceRestart());

server.start();
