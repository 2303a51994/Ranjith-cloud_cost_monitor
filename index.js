const { makeCrud } = require('./crud');
const { allow, wrap } = require('../middleware');
const { recalculateCosts, checkAll } = require('../analysis');

const WRITE = ['admin', 'cloud_admin'];

const accounts = makeCrud({
  table: 'cloud_accounts', select: 'SELECT t.* FROM cloud_accounts t',
  fields: ['provider', 'account_name', 'account_ref'], required: ['provider', 'account_name'], writeRoles: WRITE
});

const projects = makeCrud({
  table: 'projects',
  select: `SELECT t.*, a.account_name, a.provider, u.name AS owner_name
           FROM projects t JOIN cloud_accounts a ON a.id = t.account_id LEFT JOIN users u ON u.id = t.owner_id`,
  fields: ['name', 'account_id', 'owner_id'], required: ['name', 'account_id'], writeRoles: WRITE, scope: 't.owner_id = $1'
});

const resources = makeCrud({
  table: 'resources',
  select: 'SELECT t.*, p.name AS project_name FROM resources t JOIN projects p ON p.id = t.project_id',
  fields: ['project_id', 'name', 'service_type', 'region', 'unit'],
  required: ['project_id', 'name', 'service_type', 'region', 'unit'], writeRoles: WRITE, scope: 'p.owner_id = $1'
});

const pricing = makeCrud({
  table: 'pricing_rules', select: 'SELECT t.* FROM pricing_rules t',
  fields: ['service_type', 'region', 'unit', 'price_per_unit'],
  required: ['service_type', 'region', 'unit', 'price_per_unit'], writeRoles: WRITE
});
pricing.post('/recalculate', allow(...WRITE), wrap(async (req, res) => {
  const updated = await recalculateCosts();
  await checkAll(30);
  res.json({ message: `Recalculated cost for ${updated} usage records using current pricing` });
}));

const budgets = makeCrud({
  table: 'budgets',
  select: `SELECT t.*, p.name AS project_name,
             COALESCE((SELECT SUM(u.cost) FROM usage_records u JOIN resources r ON r.id = u.resource_id
                       WHERE r.project_id = t.project_id AND to_char(u.usage_date,'YYYY-MM') = t.month), 0) AS actual
           FROM budgets t JOIN projects p ON p.id = t.project_id`,
  fields: ['project_id', 'month', 'amount', 'threshold_pct'], required: ['project_id', 'month', 'amount'],
  writeRoles: ['admin', 'finance'], scope: 'p.owner_id = $1'
});
// re-evaluate alerts whenever a budget is created/changed
budgets.use((req, res, next) => {
  if (req.method !== 'GET') res.on('finish', () => checkAll(30).catch(console.error));
  next();
});

module.exports = { accounts, projects, resources, pricing, budgets };
