const router = require('express').Router();
const PDFDocument = require('pdfkit');
const { query } = require('../db');
const { wrap, auth, httpError } = require('../middleware');

const r2 = n => Math.round(Number(n || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const JOINS = 'FROM usage_records u JOIN resources r ON r.id = u.resource_id JOIN projects p ON p.id = r.project_id';
const money = n => '$' + r2(n).toFixed(2);

function scope(req, params) {
  if (req.user.role !== 'developer') return '';
  params.push(req.user.id);
  return ` AND p.owner_id = $${params.length}`;
}

const reports = {
  // 1. Daily Cloud Usage Report
  'daily-usage': async req => {
    const date = req.query.date || today();
    const params = [date];
    const sc = scope(req, params);
    const { rows } = await query(
      `SELECT r.service_type AS service, r.name AS resource, p.name AS project, u.quantity, r.unit, u.cost
       ${JOINS} WHERE u.usage_date = $1${sc} ORDER BY r.service_type, u.cost DESC`, params);
    const data = rows.map(x => ({ ...x, quantity: r2(x.quantity), cost: r2(x.cost) }));
    const total = data.reduce((s, x) => s + x.cost, 0);
    return {
      title: `Daily Cloud Usage Report - ${date}`,
      columns: [
        { key: 'service', label: 'Service' }, { key: 'resource', label: 'Resource' }, { key: 'project', label: 'Project' },
        { key: 'quantity', label: 'Quantity' }, { key: 'unit', label: 'Unit' }, { key: 'cost', label: 'Cost', type: 'money' }],
      rows: data, summary: `Total cost for ${date}: ${money(total)}`,
      chart: { data: data.map(x => ({ name: x.resource, cost: x.cost })), bars: ['cost'] }
    };
  },

  // 2. Monthly Cost Report
  'monthly-cost': async req => {
    const month = req.query.month || today().slice(0, 7);
    const params = [month];
    const sc = scope(req, params);
    const { rows } = await query(
      `SELECT p.name AS project, r.service_type AS service, SUM(u.cost) AS cost
       ${JOINS} WHERE to_char(u.usage_date,'YYYY-MM') = $1${sc}
       GROUP BY p.name, r.service_type ORDER BY p.name, cost DESC`, params);
    const data = rows.map(x => ({ ...x, cost: r2(x.cost) }));
    const total = data.reduce((s, x) => s + x.cost, 0);
    const byService = {};
    data.forEach(x => { byService[x.service] = (byService[x.service] || 0) + x.cost; });
    return {
      title: `Monthly Cost Report - ${month}`,
      columns: [{ key: 'project', label: 'Project' }, { key: 'service', label: 'Service' }, { key: 'cost', label: 'Cost', type: 'money' }],
      rows: data, summary: `Total cost for ${month}: ${money(total)}`,
      chart: { data: Object.entries(byService).map(([name, cost]) => ({ name, cost: r2(cost) })), bars: ['cost'] }
    };
  },

  // 3. Resource-wise Cost Report
  'resource-cost': async req => {
    const from = req.query.from || daysAgo(30);
    const to = req.query.to || today();
    const params = [from, to];
    const sc = scope(req, params);
    const { rows } = await query(
      `SELECT r.name AS resource, p.name AS project, r.service_type AS service, SUM(u.quantity) AS quantity, r.unit, SUM(u.cost) AS cost
       ${JOINS} WHERE u.usage_date BETWEEN $1 AND $2${sc}
       GROUP BY r.id, r.name, p.name, r.service_type, r.unit ORDER BY cost DESC`, params);
    const total = rows.reduce((s, x) => s + x.cost, 0);
    const data = rows.map(x => ({ ...x, quantity: r2(x.quantity), cost: r2(x.cost), share: total ? r2((x.cost / total) * 100) : 0 }));
    return {
      title: `Resource-wise Cost Report - ${from} to ${to}`,
      columns: [
        { key: 'resource', label: 'Resource' }, { key: 'project', label: 'Project' }, { key: 'service', label: 'Service' },
        { key: 'quantity', label: 'Quantity' }, { key: 'unit', label: 'Unit' },
        { key: 'cost', label: 'Cost', type: 'money' }, { key: 'share', label: 'Share of total', type: 'pct' }],
      rows: data, summary: `Total cost: ${money(total)}`,
      chart: { data: data.slice(0, 10).map(x => ({ name: x.resource, cost: x.cost })), bars: ['cost'] }
    };
  },

  // 4. Budget Variance Report
  'budget-variance': async req => {
    const month = req.query.month || today().slice(0, 7);
    const params = [month];
    const sc = scope(req, params);
    const { rows } = await query(
      `SELECT p.name AS project, b.amount AS budget, b.threshold_pct,
         COALESCE((SELECT SUM(u.cost) FROM usage_records u JOIN resources r ON r.id = u.resource_id
                   WHERE r.project_id = p.id AND to_char(u.usage_date,'YYYY-MM') = b.month), 0) AS actual
       FROM budgets b JOIN projects p ON p.id = b.project_id
       WHERE b.month = $1${sc} ORDER BY p.name`, params);
    const data = rows.map(x => {
      const variance = x.budget - x.actual;
      const status = x.actual > x.budget ? 'Over budget' : x.actual >= (x.budget * x.threshold_pct) / 100 ? 'Near limit' : 'Within budget';
      return { project: x.project, budget: r2(x.budget), actual: r2(x.actual), variance: r2(variance),
        variance_pct: r2((variance / x.budget) * 100), status };
    });
    const tb = data.reduce((s, x) => s + x.budget, 0);
    const ta = data.reduce((s, x) => s + x.actual, 0);
    return {
      title: `Budget Variance Report - ${month}`,
      columns: [
        { key: 'project', label: 'Project' }, { key: 'budget', label: 'Budget', type: 'money' }, { key: 'actual', label: 'Actual', type: 'money' },
        { key: 'variance', label: 'Variance', type: 'money' }, { key: 'variance_pct', label: 'Variance %', type: 'pct' }, { key: 'status', label: 'Status' }],
      rows: data, summary: `Total budget ${money(tb)}, actual ${money(ta)}, variance ${money(tb - ta)}`,
      chart: { data: data.map(x => ({ name: x.project, budget: x.budget, actual: x.actual })), bars: ['budget', 'actual'] }
    };
  }
};

const fmt = (v, type) => (type === 'money' ? money(v) : type === 'pct' ? `${v}%` : v ?? '');

function sendCsv(res, rep, name) {
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [rep.columns.map(c => esc(c.label)).join(',')];
  rep.rows.forEach(r => lines.push(rep.columns.map(c => esc(r[c.key])).join(',')));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
  res.send(lines.join('\n'));
}

function sendPdf(res, rep, name) {
  const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
  doc.pipe(res);
  doc.font('Helvetica-Bold').fontSize(16).text(rep.title, 30, 30);
  doc.font('Helvetica').fontSize(9).fillColor('#555555').text(`Generated ${new Date().toLocaleString()}`);
  doc.fillColor('#000000');
  const w = (doc.page.width - 60) / rep.columns.length;
  let y = doc.y + 14;
  const row = (cells, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    cells.forEach((c, i) => doc.text(String(c ?? ''), 30 + i * w, y, { width: w - 6, height: 12, ellipsis: true }));
    y += 16;
  };
  row(rep.columns.map(c => c.label), true);
  for (const r of rep.rows) {
    if (y > doc.page.height - 60) { doc.addPage(); y = 30; }
    row(rep.columns.map(c => fmt(r[c.key], c.type)), false);
  }
  doc.font('Helvetica-Bold').fontSize(10).text(rep.summary || '', 30, y + 10);
  doc.end();
}

router.get('/:name', auth, wrap(async (req, res) => {
  const fn = reports[req.params.name];
  if (!fn) throw httpError(404, 'Unknown report');
  const rep = await fn(req);
  if (req.query.format === 'csv') return sendCsv(res, rep, req.params.name);
  if (req.query.format === 'pdf') return sendPdf(res, rep, req.params.name);
  res.json(rep);
}));

module.exports = router;
