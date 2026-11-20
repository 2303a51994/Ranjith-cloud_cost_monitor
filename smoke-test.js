// Run with the API started:  npm test
const base = process.env.API || 'http://localhost:5000/api';
let token = null, pass = 0, fail = 0;

async function call(path, opts = {}) {
  const r = await fetch(base + path, {
    ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}
async function test(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '-', e.message); fail++; }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const login = (email) => call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'Password@123' }) });

(async () => {
  await test('Rejects request without token (401)', async () => { token = null; expect((await call('/projects')).status === 401, 'expected 401'); });
  await test('Rejects wrong password (401)', async () => {
    const r = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@cloud.com', password: 'bad' }) });
    expect(r.status === 401, 'expected 401');
  });
  await test('Admin can log in', async () => { const r = await login('admin@cloud.com'); expect(r.status === 200, 'status ' + r.status); token = r.body.token; });
  await test('Dashboard summary loads', async () => { const r = await call('/dashboard/summary'); expect(r.status === 200 && r.body.series.length > 0, 'no data'); });
  await test('All 4 reports return rows', async () => {
    for (const n of ['daily-usage', 'monthly-cost', 'resource-cost', 'budget-variance']) {
      const r = await call('/reports/' + n); expect(r.status === 200 && Array.isArray(r.body.rows), n + ' failed');
    }
  });
  await test('Validation error returns 400', async () => {
    const r = await call('/accounts', { method: 'POST', body: JSON.stringify({ provider: 'AWS' }) }); expect(r.status === 400, 'status ' + r.status);
  });
  await test('Developer cannot manage users (403)', async () => {
    token = (await login('dev1@cloud.com')).body.token; expect((await call('/users')).status === 403, 'expected 403');
  });
  await test('Developer sees only own projects', async () => {
    const r = await call('/projects'); expect(r.body.length === 3 && r.body.every(p => p.owner_name === 'Dev One'), 'scope broken');
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
