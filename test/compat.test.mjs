import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { apply } from '../index.js';

test('Host registers disposable routes and github_api with the current service shape', async () => {
  const routes = [];
  const cleanup = [];
  let tool;
  let removed = 0;
  apply({
    effect(fn) { cleanup.push(fn()); },
    webServer: { getOrigin: () => 'http://localhost:3080', register(route) { routes.push(route); return () => removed++; } },
    get(name) { assert.equal(name, 'tools'); return { register(value) { tool = value; return () => removed++; } }; },
  });
  assert.equal(tool.name, 'github_api');
  assert.equal(routes.length, 6);
  for (const [method, origin, expected] of [['GET', undefined, 405], ['POST', 'https://example.com', 403]]) {
    const req = Readable.from([]);
    req.method = method;
    req.headers = { origin };
    let status;
    let payload;
    await routes[0].handler(req, { writeHead(value) { status = value; }, end(text) { payload = JSON.parse(text); } });
    assert.equal(status, expected);
    assert.equal(payload.ok, false);
  }
  cleanup.forEach(fn => fn());
  assert.equal(removed, 7);
});

test('Client registers the settings.section slot and locale with declared injections', async () => {
  let plugin;
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ factory }) { plugin = factory(name => { assert.equal(name, 'react'); return {}; }); } } },
  });
  const records = [];
  plugin.apply({
    effect: fn => fn(),
    locale: { register(namespace, dictionaries) { assert.equal(namespace, 'githubAuth'); assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort()); }, bind: () => () => 'GitHub' },
    slots: { inject(name, fn) { assert.equal(name, 'settings.section'); fn(); }, register(options) { records.push(options); } },
  });
  assert.equal(records[0].id, 'github-auth');
  assert.equal(records[0].label(), 'GitHub');
});
