const { query } = require('./db');

async function getPrice(service, region) {
  const r = await query(
    `SELECT price_per_unit FROM pricing_rules
     WHERE service_type = $1 AND region IN ($2, 'ALL')
     ORDER BY (region = $2) DESC LIMIT 1`, [service, region]);
  return r.rowCount ? r.rows[0].price_per_unit : null;
}

async function recalculateCosts() {
  const r = await query(
    `UPDATE usage_records u SET cost = ROUND(u.quantity * pr.price_per_unit, 4)
     FROM resources r
     JOIN LATERAL (
       SELECT p.price_per_unit FROM pricing_rules p
       WHERE p.service_type = r.service_type AND p.region IN (r.region, 'ALL')
       ORDER BY (p.region = r.region) DESC LIMIT 1
     ) pr ON true
     WHERE u.resource_id = r.id`);
  return r.rowCount;
}

async function addAlert({ type, severity, project_id, resource_id = null, message, key }) {
  const r = await query(
    `INSERT INTO alerts(type, severity, project_id, resource_id, message, dedupe_key)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (dedupe_key) DO NOTHING`,
    [type, severity, project_id, resource_id, message, key]);
  return r.rowCount;
}

// Anomaly rule: cost > mean + 2*stddev of the previous 14 days AND > 1.5x the mean
async function detectAnomalies(days = 30) {
  const { rows } = await query(
    `WITH s AS (
       SELECT u.resource_id, u.usage_date, u.cost,
              AVG(u.cost) OVER w AS mean, STDDEV_POP(u.cost) OVER w AS sd, COUNT(*) OVER w AS n
       FROM usage_records u
       WINDOW w AS (PARTITION BY u.resource_id ORDER BY u.usage_date ROWS BETWEEN 14 PRECEDING AND 1 PRECEDING)
     )
     SELECT s.*, r.name, r.project_id
     FROM s JOIN resources r ON r.id = s.resource_id
     WHERE s.usage_date >= CURRENT_DATE - $1::int
       AND s.n >= 5 AND s.cost > s.mean + 2 * s.sd AND s.cost > 1.5 * s.mean`, [days]);
  let created = 0;
  for (const a of rows) {
    created += await addAlert({
      type: 'anomaly',
      severity: a.cost > 3 * a.mean ? 'critical' : 'warning',
      project_id: a.project_id, resource_id: a.resource_id,
      message: `Cost spike on ${a.name}: $${a.cost.toFixed(2)} on ${a.usage_date} (14-day average $${a.mean.toFixed(2)})`,
      key: `anom:${a.resource_id}:${a.usage_date}`
    });
  }
  return created;
}

// Budget rules: warning at threshold %, critical at 100%, forecast if projected month-end > budget
async function checkBudgets() {
  const { rows } = await query(
    `SELECT b.id, b.project_id, b.month, b.amount, b.threshold_pct, p.name,
       COALESCE((SELECT SUM(u.cost) FROM usage_records u JOIN resources r ON r.id = u.resource_id
                 WHERE r.project_id = b.project_id AND to_char(u.usage_date,'YYYY-MM') = b.month), 0) AS spend
     FROM budgets b JOIN projects p ON p.id = b.project_id`);
  const now = new Date();
  const curMonth = now.toISOString().slice(0, 7);
  const day = now.getUTCDate();
  const dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  let created = 0;
  for (const b of rows) {
    const pct = (b.spend / b.amount) * 100;
    const spent = `$${b.spend.toFixed(2)} of $${b.amount.toFixed(2)}`;
    if (pct >= 100) {
      created += await addAlert({ type: 'budget', severity: 'critical', project_id: b.project_id,
        message: `${b.name} exceeded its ${b.month} budget: ${spent} (${pct.toFixed(0)}%)`, key: `bud-crit:${b.id}:${b.amount}` });
    } else if (pct >= b.threshold_pct) {
      created += await addAlert({ type: 'budget', severity: 'warning', project_id: b.project_id,
        message: `${b.name} has used ${pct.toFixed(0)}% of its ${b.month} budget: ${spent}`, key: `bud-warn:${b.id}:${b.amount}` });
    }
    if (b.month === curMonth && pct < 100) {
      const projected = (b.spend / day) * dim;
      if (projected > b.amount) {
        created += await addAlert({ type: 'forecast', severity: 'warning', project_id: b.project_id,
          message: `${b.name} is forecast to reach $${projected.toFixed(2)} by month end, above its $${b.amount.toFixed(2)} budget`,
          key: `fc:${b.id}:${b.amount}` });
      }
    }
  }
  return created;
}

async function checkAll(days = 30) {
  const a = await detectAnomalies(days);
  const b = await checkBudgets();
  return { created: a + b };
}

module.exports = { getPrice, recalculateCosts, detectAnomalies, checkBudgets, checkAll };
