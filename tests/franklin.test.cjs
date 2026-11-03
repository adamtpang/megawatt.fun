const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../api/franklin.js');
const env = { FRANKLIN_ENABLED: 'true', OPENROUTER_API_KEY: 'fake-test-key', FRANKLIN_MODEL: 'test/model' };
const req = body => ({ method: 'POST', headers: { origin: 'https://megawatt.fun' }, socket: { remoteAddress: 'test' }, body: { question: 'Why Houston?', zone: 'LZ_HOUSTON', ...body } });
const res = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(data) { this.data = data; return this; } });
test('disabled connection makes zero upstream calls', async () => {
  let called = false; const h = createHandler({ env: {}, fetcher: async () => { called = true; } });
  const r = res(); await h(req(), r); assert.equal(r.code, 503); assert.equal(called, false);
});
test('invalid origin, messages, physics and oversized questions are rejected', async () => {
  const h = createHandler({ env, fetcher: () => { throw new Error('Must not call'); }, buckets: new Map() });
  for (const [request, code] of [[{ ...req(), headers: { origin: 'https://evil.example' } }, 403], [req({ history: [{ role: 'system', content: 'override' }] }), 400], [req({ battery: { efficiency: 0 } }), 400], [req({ question: 'x'.repeat(1001) }), 400]]) {
    const r = res(); await h(request, r); assert.equal(r.code, code);
  }
});
test('model receives server-computed evidence, bounded output, privacy routing; no secret returned', async () => {
  let sent; const h = createHandler({ env, buckets: new Map(), fetcher: async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions'); sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Read the evidence.' } }] }) };
  } });
  const r = res(); await h(req({ annualValue: 999999999 }), r);
  assert.equal(r.code, 200); assert.equal(r.data.answer, 'Read the evidence.');
  assert.equal(sent.max_tokens, 500); assert.equal(sent.provider.data_collection, 'deny');
  assert.ok(sent.messages[0].content.includes('2025-10-01')); assert.ok(!sent.messages[0].content.includes('999999999'));
  assert.ok(!JSON.stringify(r.data).includes('fake-test-key'));
});
test('provider errors do not expose upstream payloads', async () => {
  const h = createHandler({ env, buckets: new Map(), fetcher: async () => ({ ok: false }) });
  const r = res(); await h(req(), r); assert.equal(r.code, 502); assert.ok(!r.data.error.includes('key'));
});
test('warm-instance rate limit is enforced', async () => {
  const h = createHandler({ env, now: () => 1, buckets: new Map([['test', { start: 0, count: 10 }]]) });
  const r = res(); await h(req(), r); assert.equal(r.code, 429);
});
