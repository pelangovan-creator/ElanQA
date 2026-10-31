const { test } = require('node:test');
const assert = require('node:assert');
process.env.DEMO_BUGS = '1';
const { app } = require('./server');

async function withServer(fn) {
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;
  try { await fn(base); } finally { srv.close(); }
}
const post = (base, path, body, cookie) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(body), redirect: 'manual' });

test('deliberate bugs behave as documented', async () => {
  await withServer(async (base) => {
    const r1 = await post(base, '/registration', { email: 'a@example.com', password: 'Aa1!aaaaaaaaaaaaa' }); // 17 chars
    assert.match(await r1.text(), /Account created/, 'BUG-2: 17 chars accepted');
    const r2 = await post(base, '/checkout', { amount: '5000', card: '4111111111111111' });
    assert.match(await r2.text(), /Discount applied/, 'BUG-3: discount at 5000');
    const first = await fetch(base + '/login');
    const cookie = first.headers.get('set-cookie').split(';')[0];
    let last;
    for (let i = 0; i < 3; i++) last = await post(base, '/login', { email: 'qapilot.tester@example.com', password: 'wrong' }, cookie);
    assert.doesNotMatch(await last.text(), /locked/, 'BUG-1: not locked after 3');
  });
});

test('correct behaviour is correct', async () => {
  await withServer(async (base) => {
    assert.match(await (await post(base, '/registration', { email: 'bad', password: 'Aa1!aaaa' })).text(), /valid email/);
    assert.match(await (await post(base, '/checkout', { amount: '6000', card: '4111111111111112' })).text(), /not valid/);
    assert.match(await (await post(base, '/login', { email: 'qapilot.tester@example.com', password: 'Demo!2345' })).text(), /logged in/);
  });
});
