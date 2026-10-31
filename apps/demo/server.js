/**
 * ShopEasy Demo - application under test for QA Pilot.
 *
 * Implements docs/demo-srs.md. Deliberate bugs (set DEMO_BUGS=0 to fix them all):
 *   BUG-1 Login locks the account after 4 failed attempts (spec: 3).
 *   BUG-2 Registration accepts passwords longer than 16 characters (spec: 8-16).
 *   BUG-3 Checkout gives the 10% discount at exactly 5000 (spec: above 5000).
 *
 * State is kept per browser session (cookie), so every Playwright test context starts clean.
 */
const express = require('express');
const crypto = require('node:crypto');

const BUGS = process.env.DEMO_BUGS !== '0';
const PORT = Number(process.env.DEMO_PORT ?? 4600);
const USERS = { 'qapilot.tester@example.com': process.env.DEMO_TESTER_PASSWORD ?? 'Demo!2345' };
const LOCK_AFTER = BUGS ? 4 : 3;

const sessions = new Map(); // sid -> { failures: {email: n}, user }
const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const sid = /(?:^|;\s*)sid=([a-f0-9]{32})/.exec(req.headers.cookie ?? '')?.[1];
  if (sid && sessions.has(sid)) req.session = sessions.get(sid);
  else {
    const id = crypto.randomBytes(16).toString('hex');
    req.session = { failures: {}, user: null };
    sessions.set(id, req.session);
    res.setHeader('Set-Cookie', `sid=${id}; HttpOnly; SameSite=Lax; Path=/`);
  }
  next();
});

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} – ShopEasy</title><style>
*{box-sizing:border-box}html,body{overflow-x:hidden}body{font-family:system-ui,Arial,sans-serif;margin:0;color:#111;background:#f8fafc}header{background:#0f3d63;color:#fff;padding:12px 20px;overflow-wrap:anywhere}
header a{color:#fff;margin-right:16px}main{max-width:560px;margin:24px auto;width:calc(100% - 24px);background:#fff;padding:24px;border-radius:8px;box-shadow:0 1px 3px #0002}
label{display:block;font-weight:600;margin-top:12px}input{width:100%;box-sizing:border-box;padding:8px;font-size:16px;border:1px solid #64748b;border-radius:4px}
input[aria-invalid=true]{border-color:#b91c1c}.err{color:#b91c1c;font-size:14px;margin-top:4px}button{margin-top:16px;padding:10px 16px;font-size:16px;background:#0f3d63;color:#fff;border:0;border-radius:4px}
.ok{background:#dcfce7;padding:10px;border-radius:4px}.alert{background:#fee2e2;color:#7f1d1d;padding:10px;border-radius:4px}:focus-visible{outline:3px solid #f59e0b}
</style></head><body><header><nav aria-label="Main"><a href="/">ShopEasy</a><a href="/login">Login</a><a href="/registration">Registration</a><a href="/checkout">Checkout</a></nav></header>
<main id="main"><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

function field(id, label, type, value, error, extra = '') {
  return `<label for="${id}">${esc(label)}</label><input id="${id}" name="${id}" type="${type}" value="${esc(value)}" ${error ? `aria-invalid="true" aria-describedby="${id}-error"` : ''} ${extra}>
${error ? `<p class="err" id="${id}-error">${esc(error)}</p>` : ''}`;
}

app.get('/', (req, res) => res.send(layout('Welcome to ShopEasy', `<p>${req.session.user ? `Signed in as ${esc(req.session.user)}.` : 'Demo store for QA Pilot.'}</p><ul><li><a href="/login">Log in</a></li><li><a href="/registration">Create an account</a></li><li><a href="/checkout">Checkout</a></li></ul>`)));

// ── Login (REQ: log in with email/password; lock after 3 consecutive failures)
const loginPage = (msg = '', email = '') => layout('Login', `${msg}<form method="post" action="/login" novalidate>
${field('email', 'Email', 'email', email, '', 'autocomplete="username"')}${field('password', 'Password', 'password', '', '', 'autocomplete="current-password"')}
<button type="submit">Log in</button></form>`);
app.get('/login', (req, res) => res.send(loginPage()));
app.post('/login', (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const f = req.session.failures;
  if ((f[email] ?? 0) >= LOCK_AFTER) return res.status(423).send(loginPage('<p role="alert" class="alert">Your account is locked. Contact an administrator to unlock it.</p>', email));
  if (USERS[email] && USERS[email] === req.body.password) {
    f[email] = 0;
    req.session.user = email;
    return res.send(layout('Dashboard', `<p class="ok" role="status">Welcome, ${esc(email)}. You are logged in.</p>`));
  }
  f[email] = (f[email] ?? 0) + 1;
  if (f[email] >= LOCK_AFTER) return res.status(423).send(loginPage('<p role="alert" class="alert">Your account is locked. Contact an administrator to unlock it.</p>', email));
  res.status(401).send(loginPage('<p role="alert" class="alert">Invalid email or password.</p>', email));
});

// ── Registration (REQ: email mandatory & valid; password 8-16 chars with a digit)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const regPage = (v = {}, e = {}, msg = '') => layout('Registration', `${msg}<form method="post" action="/registration" novalidate>
${field('email', 'Email', 'email', v.email, e.email)}${field('password', 'Password', 'password', v.password ?? '', e.password)}
<button type="submit">Create account</button></form>`);
app.get('/registration', (req, res) => res.send(regPage()));
app.post('/registration', (req, res) => {
  const email = String(req.body.email ?? '').trim();
  const password = String(req.body.password ?? '');
  const e = {};
  if (!email) e.email = 'Email is required.';
  else if (!EMAIL.test(email)) e.email = 'Enter a valid email address.';
  const maxLen = BUGS ? Infinity : 16;
  if (!password) e.password = 'Password is required.';
  else if (password.length < 8 || password.length > maxLen) e.password = 'Password must be 8 to 16 characters long.';
  else if (!/\d/.test(password)) e.password = 'Password must contain at least one digit.';
  if (Object.keys(e).length) return res.status(400).send(regPage({ email }, e, '<p role="alert" class="alert">Please correct the errors below.</p>'));
  res.send(layout('Registration', `<p class="ok" role="status">Account created for ${esc(email)}.</p>`));
});

// ── Checkout (REQ: card 16 digits; orders above 5000 get 10% discount)
const luhn = (n) => [...n].reverse().reduce((s, d, i) => s + (i % 2 ? ((d * 2) % 10) + Math.floor((d * 2) / 10) : Number(d)), 0) % 10 === 0;
const coPage = (v = {}, e = {}, msg = '') => layout('Checkout', `${msg}<form method="post" action="/checkout" novalidate>
${field('amount', 'Order amount (Rs.)', 'text', v.amount ?? '', e.amount, 'inputmode="decimal"')}${field('card', 'Card number', 'text', v.card ?? '', e.card, 'inputmode="numeric" autocomplete="cc-number"')}
<button type="submit">Pay now</button></form>`);
app.get('/checkout', (req, res) => res.send(coPage()));
app.post('/checkout', (req, res) => {
  const amountRaw = String(req.body.amount ?? '').trim();
  const card = String(req.body.card ?? '').replace(/\s+/g, '');
  const e = {};
  const amount = Number(amountRaw);
  if (!amountRaw || !Number.isFinite(amount) || amount <= 0) e.amount = 'Enter a valid order amount.';
  if (!/^\d{16}$/.test(card)) e.card = 'Card number must be 16 digits.';
  else if (!luhn(card)) e.card = 'Card number is not valid.';
  if (Object.keys(e).length) return res.status(400).send(coPage({ amount: amountRaw, card }, e, '<p role="alert" class="alert">Please correct the errors below.</p>'));
  const eligible = BUGS ? amount >= 5000 : amount > 5000;
  const total = eligible ? amount * 0.9 : amount;
  res.send(layout('Checkout', `<div role="status" class="ok"><p>Payment successful.</p>${eligible ? '<p>Discount applied: 10%</p>' : '<p>No discount.</p>'}<p>Total charged: Rs. ${total.toFixed(2)}</p></div>`));
});

app.get('/health', (req, res) => res.json({ status: 'ok', bugs: BUGS }));

if (require.main === module) app.listen(PORT, () => console.log(`ShopEasy demo on http://localhost:${PORT} (deliberate bugs ${BUGS ? 'ON' : 'OFF'})`));
module.exports = { app };
