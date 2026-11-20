const router = require('express').Router();
const { query } = require('../db');
const { wrap, auth } = require('../middleware');

router.get('/summary', auth, wrap(async (req, res) => {
  const dev = req.user.role === 'developer';
  const sc = dev ? ' AND p.owner_id = $1' : '';
  const params = dev ? [req.user.id] : [];
  const q = sql => query(sql, params);
  const J = 'FROM usage_records u JOIN resources r ON r.id = u.resource_id JOIN projects p ON p.id = r.project_id';
  const THIS = `to_char(u.usage_date,'YYYY-MM') = to_char(CURRENT_DATE,'YYYY-MM')`;
  const LAST = `to_char(u.usage_date,'YYYY-MM') = to_char(CURRENT_DATE - INTERVAL '1 month','YYYY-MM')`;

  const [thisM, lastM, resCount, alertCount, series, byService, top, alerts] = await Promise.all([
    q(`SELECT COALESCE(SUM(u.cost),0) AS v ${J} WHERE ${THIS}${sc}`),
    q(`SELECT COALESCE(SUM(u.cost),0) AS v ${J} WHERE ${LAST}${sc}`),
    q(`SELECT COUNT(*) AS v FROM resources r JOIN projects p ON p.id = r.project_id WHERE true${sc}`),
    q(`SELECT COUNT(*) AS v FROM alerts a LEFT JOIN projects p ON p.id = a.project_id WHERE a.status = 'open'${sc}`),
    q(`SELECT u.usage_date AS date, SUM(u.cost) AS cost ${J} WHERE u.usage_date >= CURRENT_DATE - 29${sc} GROUP BY u.usage_date ORDER BY u.usage_date`),
    q(`SELECT r.service_type AS service, SUM(u.cost) AS cost ${J} WHERE ${THIS}${sc} GROUP BY r.service_type ORDER BY cost DESC`),
    q(`SELECT r.name, SUM(u.cost) AS cost ${J} WHERE ${THIS}${sc} GROUP BY r.id, r.name ORDER BY cost DESC LIMIT 5`),
    q(`SELECT a.id, a.type, a.severity, a.message, a.status, a.created_at FROM alerts a LEFT JOIN projects p ON p.id = a.project_id
       WHERE a.status <> 'resolved'${sc} ORDER BY a.created_at DESC, a.id DESC LIMIT 5`)
  ]);
  res.json({
    thisMonth: thisM.rows[0].v, lastMonth: lastM.rows[0].v,
    resources: resCount.rows[0].v, openAlerts: alertCount.rows[0].v,
    series: series.rows, byService: byService.rows, topResources: top.rows, recentAlerts: alerts.rows
  });
}));

module.exports = router;
