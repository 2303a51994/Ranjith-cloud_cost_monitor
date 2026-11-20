const router = require('express').Router();
const { query } = require('../db');
const { wrap, auth, allow, httpError } = require('../middleware');
const { getPrice, checkAll } = require('../analysis');

router.use(auth);

// GET /api/usage?service=&project=&from=&to=
router.get('/', wrap(async (req, res) => {
  const { service, project, from, to } = req.query;
  const params = [];
  const w = [];
  const add = (sql, v) => { params.push(v); w.push(sql.replace('?', '$' + params.length)); };
  if (service) add('r.service_type = ?', service);
  if (project) add('r.project_id = ?', project);
  if (from) add('u.usage_date >= ?', from);
  if (to) add('u.usage_date <= ?', to);
  if (req.user.role === 'developer') add('p.owner_id = ?', req.user.id);
  const base = `FROM usage_records u JOIN resources r ON r.id = u.resource_id JOIN projects p ON p.id = r.project_id
                ${w.length ? 'WHERE ' + w.join(' AND ') : ''}`;
  const [rows, series, byService] = await Promise.all([
    query(`SELECT u.id, u.usage_date, u.quantity, u.cost, r.name AS resource, r.service_type, r.unit, p.name AS project
           ${base} ORDER BY u.usage_date DESC, u.id DESC LIMIT 300`, params),
    query(`SELECT u.usage_date AS date, SUM(u.cost) AS cost ${base} GROUP BY u.usage_date ORDER BY u.usage_date`, params),
    query(`SELECT r.service_type AS service, SUM(u.cost) AS cost ${base} GROUP BY r.service_type ORDER BY cost DESC`, params)
  ]);
  res.json({
    rows: rows.rows, series: series.rows, byService: byService.rows,
    totalCost: series.rows.reduce((s, x) => s + x.cost, 0)
  });
}));

// POST /api/usage  { resource_id, usage_date, quantity }  -> cost is calculated from pricing rules
router.post('/', allow('admin', 'cloud_admin'), wrap(async (req, res) => {
  const { resource_id, usage_date, quantity } = req.body;
  if (!resource_id || !usage_date || quantity === undefined || quantity === '') throw httpError(400, 'Resource, date and quantity are required');
  const qty = Number(quantity);
  if (Number.isNaN(qty) || qty < 0) throw httpError(400, 'Quantity must be a number, zero or more');
  const rr = await query('SELECT * FROM resources WHERE id = $1', [resource_id]);
  if (!rr.rowCount) throw httpError(404, 'Resource not found');
  const resource = rr.rows[0];
  const price = await getPrice(resource.service_type, resource.region);
  if (price === null) throw httpError(400, `No pricing is configured for ${resource.service_type}. Add it on the Pricing screen first.`);
  const cost = Math.round(qty * price * 10000) / 10000;
  await query(
    `INSERT INTO usage_records(resource_id, usage_date, quantity, cost) VALUES($1,$2,$3,$4)
     ON CONFLICT (resource_id, usage_date) DO UPDATE SET quantity = EXCLUDED.quantity, cost = EXCLUDED.cost`,
    [resource_id, usage_date, qty, cost]);
  await checkAll(30);
  res.status(201).json({ message: 'Usage recorded', cost });
}));

module.exports = router;
