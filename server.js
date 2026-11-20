const { initDb, query } = require('./db');   // loads .env first
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { errorHandler } = require('./middleware');
const { checkAll } = require('./analysis');
const { accounts, projects, resources, pricing, budgets } = require('./routes');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/accounts', accounts);
app.use('/api/projects', projects);
app.use('/api/resources', resources);
app.use('/api/pricing', pricing);
app.use('/api/budgets', budgets);
app.use('/api/usage', require('./routes/usage'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found' }));
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

(async () => {
  await initDb();
  const c = await query('SELECT COUNT(*) AS n FROM users');
  if (c.rows[0].n === 0) {
    console.log('Empty database - loading demo data...');
    await require('./seed').seed();
  }
  cron.schedule('0 * * * *', () => checkAll(3).catch(console.error));   // hourly anomaly + budget checks
  app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
})().catch(e => { console.error(e.message); process.exit(1); });
