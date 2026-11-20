const router = require('express').Router();
const { query } = require('../db');
const { wrap, auth, allow, httpError } = require('../middleware');
const { checkAll } = require('../analysis');

router.use(auth);

router.get('/', wrap(async (req, res) => {
  const params = [];
  let where = 'WHERE true';
  if (req.query.status) { params.push(req.query.status); where += ` AND a.status = $${params.length}`; }
  if (req.user.role === 'developer') { params.push(req.user.id); where += ` AND p.owner_id = $${params.length}`; }
  const { rows } = await query(
    `SELECT a.*, p.name AS project_name, r.name AS resource_name
     FROM alerts a LEFT JOIN projects p ON p.id = a.project_id LEFT JOIN resources r ON r.id = a.resource_id
     ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT 200`, params);
  res.json(rows);
}));

router.post('/run', allow('admin', 'cloud_admin', 'finance'), wrap(async (req, res) => {
  res.json(await checkAll(90));
}));

router.patch('/:id', allow('admin', 'cloud_admin', 'finance'), wrap(async (req, res) => {
  const { status } = req.body;
  if (!['open', 'acknowledged', 'resolved'].includes(status)) throw httpError(400, 'Invalid status');
  const r = await query('UPDATE alerts SET status = $1 WHERE id = $2 RETURNING id', [status, req.params.id]);
  if (!r.rowCount) throw httpError(404, 'Alert not found');
  res.json(r.rows[0]);
}));

module.exports = router;
