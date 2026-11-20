const bcrypt = require('bcryptjs');
const { pool, initDb } = require('./db');
const { checkAll } = require('./analysis');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const dstr = d => d.toISOString().slice(0, 10);

async function seed() {
  await initDb();
  await pool.query('TRUNCATE alerts, budgets, usage_records, pricing_rules, resources, projects, cloud_accounts, users RESTART IDENTITY CASCADE');

  // Users (all demo passwords: Password@123)
  const hash = await bcrypt.hash('Password@123', 10);
  const users = [
    ['Admin User', 'admin@cloud.com', 'admin'], ['Carl Cloud', 'cloudadmin@cloud.com', 'cloud_admin'],
    ['Fiona Finance', 'finance@cloud.com', 'finance'], ['Dev One', 'dev1@cloud.com', 'developer'], ['Dev Two', 'dev2@cloud.com', 'developer']
  ];
  for (const u of users) await pool.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)', [u[0], u[1], hash, u[2]]);

  // Cloud accounts and projects
  const accounts = [['AWS', 'AWS Production', '123456789012'], ['Azure', 'Azure Dev/Test', 'sub-7a1c-22'], ['GCP', 'GCP Analytics', 'proj-analytics-01']];
  for (const a of accounts) await pool.query('INSERT INTO cloud_accounts(provider,account_name,account_ref) VALUES($1,$2,$3)', a);
  const projects = [['E-Commerce Website', 1, 4], ['Mobile App Backend', 1, 4], ['Data Analytics', 3, 5], ['Internal Tools', 2, 5], ['ML Research', 3, 4]];
  for (const p of projects) await pool.query('INSERT INTO projects(name,account_id,owner_id) VALUES($1,$2,$3)', p);

  // Pricing rules (configurable on the Pricing screen)
  const pricing = [
    ['Compute', 'ALL', 'hours', 0.48], ['Compute', 'ap-south-1', 'hours', 0.44], ['Compute', 'us-central1', 'hours', 1.75],
    ['Database', 'ALL', 'hours', 0.90], ['Storage', 'ALL', 'GB', 0.004], ['Network', 'ALL', 'GB', 0.09], ['Serverless', 'ALL', 'M requests', 3.5]
  ];
  for (const p of pricing) await pool.query('INSERT INTO pricing_rules(service_type,region,unit,price_per_unit) VALUES($1,$2,$3,$4)', p);
  const priceOf = (s, r) => (pricing.find(p => p[0] === s && p[1] === r) || pricing.find(p => p[0] === s && p[1] === 'ALL'))[3];

  // Resources: [project, name, service, region, unit, daily base quantity]
  const resources = [
    [1, 'web-server-cluster', 'Compute', 'us-east-1', 'hours', 72], [1, 'orders-db', 'Database', 'us-east-1', 'hours', 24],
    [1, 'product-images', 'Storage', 'us-east-1', 'GB', 800], [1, 'cdn-traffic', 'Network', 'us-east-1', 'GB', 150],
    [2, 'api-servers', 'Compute', 'ap-south-1', 'hours', 48], [2, 'push-lambda', 'Serverless', 'ap-south-1', 'M requests', 6],
    [2, 'users-db', 'Database', 'ap-south-1', 'hours', 24], [2, 'app-assets', 'Storage', 'ap-south-1', 'GB', 300],
    [3, 'etl-compute', 'Compute', 'europe-west1', 'hours', 40], [3, 'data-lake', 'Storage', 'europe-west1', 'GB', 2500],
    [3, 'etl-functions', 'Serverless', 'europe-west1', 'M requests', 12], [3, 'warehouse-db', 'Database', 'europe-west1', 'hours', 24],
    [4, 'jenkins-vm', 'Compute', 'centralindia', 'hours', 24], [4, 'wiki-storage', 'Storage', 'centralindia', 'GB', 120],
    [4, 'tools-db', 'Database', 'centralindia', 'hours', 24], [4, 'vpn-gateway', 'Network', 'centralindia', 'GB', 60],
    [5, 'gpu-training', 'Compute', 'us-central1', 'hours', 30], [5, 'dataset-bucket', 'Storage', 'us-central1', 'GB', 1500],
    [5, 'model-api', 'Serverless', 'us-central1', 'M requests', 4], [5, 'experiment-db', 'Database', 'us-central1', 'hours', 24]
  ];
  for (const r of resources) await pool.query('INSERT INTO resources(project_id,name,service_type,region,unit) VALUES($1,$2,$3,$4,$5)', r.slice(0, 5));

  // 90 days of usage; a few deliberate spikes so anomaly detection has something to find
  const rand = mulberry32(42);
  const spikes = { 0: [1, 20], 5: [8], 10: [3], 16: [12], 18: [0] };   // resource index -> days ago
  const ids = [], dates = [], qtys = [], costs = [];
  for (let d = 89; d >= 0; d--) {
    const date = new Date(Date.now() - d * 864e5);
    const weekend = [0, 6].includes(date.getUTCDay());
    resources.forEach((r, i) => {
      let q = r[5] * (0.9 + 0.2 * rand()) * (1 + (89 - d) * 0.002);
      if (weekend && ['Compute', 'Network'].includes(r[2])) q *= 0.8;
      if ((spikes[i] || []).includes(d)) q *= 3.2;
      q = Math.round(q * 100) / 100;
      ids.push(i + 1); dates.push(dstr(date)); qtys.push(q);
      costs.push(Math.round(q * priceOf(r[2], r[3]) * 10000) / 10000);
    });
  }
  await pool.query(
    'INSERT INTO usage_records(resource_id,usage_date,quantity,cost) SELECT * FROM unnest($1::int[],$2::date[],$3::numeric[],$4::numeric[])',
    [ids, dates, qtys, costs]);

  // Budgets for last month and this month, based on last month's actual spend
  const now = new Date();
  const cur = now.toISOString().slice(0, 7);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const sp = await pool.query(
    `SELECT r.project_id, to_char(u.usage_date,'YYYY-MM') AS m, SUM(u.cost) AS s
     FROM usage_records u JOIN resources r ON r.id = u.resource_id GROUP BY 1, 2`);
  const spend = (pid, m) => (sp.rows.find(x => x.project_id === pid && x.m === m) || { s: 1000 }).s;
  const prevF = [1.1, 0.95, 1.2, 1.3, 1.05];
  const curF = [1.15, 0.92, 1.1, 1.4, 0.85];
  for (let i = 0; i < 5; i++) {
    const base = spend(i + 1, prev);
    await pool.query('INSERT INTO budgets(project_id,month,amount,threshold_pct) VALUES($1,$2,$3,80)', [i + 1, prev, Math.round(base * prevF[i])]);
    await pool.query('INSERT INTO budgets(project_id,month,amount,threshold_pct) VALUES($1,$2,$3,80)', [i + 1, cur, Math.round(base * curF[i])]);
  }

  const result = await checkAll(90);
  console.log(`Seeded demo data: ${users.length} users, ${resources.length} resources, ${ids.length} usage records, ${result.created} alerts.`);
}

module.exports = { seed };

if (require.main === module) {
  seed().then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
}
