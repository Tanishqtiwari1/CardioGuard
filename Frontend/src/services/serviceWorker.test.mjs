// Run with: node --test Frontend/src/services/serviceWorker.test.mjs
// Loads the real public/sw.js with a fake network and cache to check page-load behaviour.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

function loadWorker({ network, cachedPage }) {
  const listeners = {};
  const store = new Map(cachedPage ? [['./index.html', cachedPage]] : []);
  const cache = { put: async (key, value) => { store.set(key, value); }, addAll: async () => {} };
  const self = {
    location: { origin: 'https://example.test' },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {}, clients: { claim: () => {} },
  };
  const context = vm.createContext({
    self, setTimeout, Promise, URL, console,
    caches: { open: async () => cache, match: async (key) => store.get(key), keys: async () => [] },
    fetch: () => network(),
    Response: { error: () => ({ type: 'error' }) },
  });
  vm.runInContext(SOURCE, context);

  const navigate = async () => {
    let responded; const waits = [];
    listeners.fetch({
      request: { method: 'GET', url: 'https://example.test/CardioGuard/', mode: 'navigate' },
      respondWith: (p) => { responded = p; },
      waitUntil: (p) => waits.push(p),
    });
    const started = Date.now();
    const response = await responded;
    return { response, ms: Date.now() - started, settled: Promise.all(waits), store };
  };
  return { navigate };
}

const page = (body) => ({ ok: true, body, clone() { return page(body); } });
const never = () => new Promise(() => {});
const after = (ms, value) => () => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test('fast network: serves the fresh page and updates the cache', async () => {
  const sw = loadWorker({ network: after(20, page('fresh')), cachedPage: page('old') });
  const { response, ms, settled, store } = await sw.navigate();
  assert.equal(response.body, 'fresh');
  assert.ok(ms < 1000);
  await settled;
  assert.equal(store.get('./index.html').body, 'fresh');
});

test('stalled network: serves the cached page within about 3 seconds', async () => {
  const sw = loadWorker({ network: never, cachedPage: page('cached') });
  const { response, ms } = await sw.navigate();
  assert.equal(response.body, 'cached');
  assert.ok(ms >= 2900 && ms < 4000, `took ${ms}ms`);
});

test('network down: serves the cached page immediately', async () => {
  const sw = loadWorker({ network: () => Promise.reject(new Error('offline')), cachedPage: page('cached') });
  const { response, ms } = await sw.navigate();
  assert.equal(response.body, 'cached');
  assert.ok(ms < 500);
});

test('first visit with a slow network: waits for the network rather than failing', async () => {
  const sw = loadWorker({ network: after(3500, page('fresh')), cachedPage: null });
  const { response } = await sw.navigate();
  assert.equal(response.body, 'fresh');
});

test('the retire worker at /Frontend/dist/ unregisters itself and reloads open pages', async () => {
  const source = readFileSync(new URL('../../public/Frontend/dist/sw.js', import.meta.url), 'utf8');
  const listeners = {}; const calls = [];
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => calls.push('skipWaiting'),
    registration: { unregister: async () => { calls.push('unregister'); return true; } },
    clients: { matchAll: async () => [{ url: 'https://example.test/CardioGuard/Frontend/dist/#/sos', navigate: (u) => calls.push(`navigate ${u}`) }] },
  };
  vm.runInContext(source, vm.createContext({ self, Promise, console }));
  listeners.install({});
  let done; listeners.activate({ waitUntil: (p) => { done = p; } });
  await done;
  assert.deepEqual(calls, ['skipWaiting', 'unregister', 'navigate https://example.test/CardioGuard/Frontend/dist/#/sos']);
  assert.ok(!/caches\.delete/.test(source), 'must not delete caches shared with the current worker');
});
