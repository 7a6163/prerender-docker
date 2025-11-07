'use strict';

const prerender = require('prerender');
const redisCache = require('prerender-redis-cache-ng');

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

server.use(redisCache);
server.use(prerender.blacklist());
server.use(prerender.httpHeaders());
server.use(prerender.removeScriptTags());

server.start();
