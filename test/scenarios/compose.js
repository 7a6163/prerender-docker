'use strict';

// Scenario tests need environment that compose.yml deliberately does not set: a
// tiny render limit, a domain whitelist, a short wait. Each one recreates the
// prerender container with a temporary override, so compose.yml stays a
// deployable example rather than a test fixture.
//
// Redis is reached through `valkey-cli` inside the container rather than a TCP
// port, so valkey is never reconfigured and never has to be exposed. These
// files must run one at a time (`--test-concurrency=1`): they drive one shared
// compose project, and two of them recreating a container at once collide.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const READY = 'Started Chrome';
const BASE_URL = process.env.PRERENDER_URL || 'http://localhost:3000';

const docker = (...args) =>
    execFileSync('docker', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const writeOverride = (env) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prerender-scenario-'));
    const file = path.join(dir, 'override.yml');
    fs.writeFileSync(file, [
        'services:',
        '  prerender:',
        '    environment:',
        ...Object.entries(env).map(([k, v]) => `      - ${k}=${v}`),
        ''
    ].join('\n'));
    return file;
};

const readLogs = () => docker('compose', 'logs', '--no-log-prefix', 'prerender');
const logsSince = (mark) => readLogs().slice(mark);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Recreates the prerender container with the given environment and waits for
 * Chrome. Returns the log length at that point, so a test can read only what
 * its own requests produced.
 */
const startWith = async (env, timeoutMs = 120000) => {
    docker('compose', '-f', 'compose.yml', '-f', writeOverride(env), 'up', '-d', '--force-recreate', 'prerender');

    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const logs = readLogs();
        if (logs.includes(READY)) return logs.length;
        if (Date.now() > deadline) throw new Error(`prerender did not log "${READY}" within ${timeoutMs}ms`);
        await sleep(500);
    }
};

/** Puts the container back on the environment from compose.yml alone. */
const restoreDefaults = () => docker('compose', 'up', '-d', '--force-recreate', 'prerender');

const valkey = (...args) => docker('compose', 'exec', '-T', 'valkey', 'valkey-cli', ...args).trim();
const exists = (key) => Number(valkey('exists', key));

const render = async (url, options) => {
    const res = await fetch(`${BASE_URL}/render?url=${url}`, options);
    return { status: res.status, headers: res.headers, body: await res.text() };
};

// Same normalisation prerender-redis-cache-ng uses, which is also what the
// service derives its lock key from
const cacheKey = (url) => url.replace(/^https?:\/\//, '');
const lockKey = (url) => `prerender:lock:${cacheKey(url)}`;

module.exports = { startWith, restoreDefaults, logsSince, render, sleep, valkey, exists, cacheKey, lockKey };
