const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { wrap, auth, allow, httpError } = require('../middleware');

const ROLES = ['admin', 'cloud_admin', 'finance', 'developer'];
router.use(auth);

// dropdown list for project owners (admin + cloud administrator)
router.get('/options', allow('admin', 'cloud_admin'), wrap(async (req, res) => {
  res.json((await query('SELECT id, name, role FROM users ORDER BY name')).rows);
}));

router.use(allow('admin'));

router.get('/', wrap(async (req, res) => {
  res.json((await query('SELECT id, name, email, role, created_at FROM users ORDER BY id')).rows);
}));

router.post('/', wrap(async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) throw httpError(400, 'Name, email, password and role are required');
  if (!ROLES.includes(role)) throw httpError(400, 'Invalid role');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw httpError(400, 'Enter a valid email address');
  if (password.length < 6) throw httpError(400, 'Password must be at least 6 characters');
  const r = await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',
    [name.trim(), email.toLowerCase().trim(), await bcrypt.hash(password, 10), role]);
  res.status(201).json(r.rows[0]);
}));

router.put('/:id', wrap(async (req, res) => {
  const { name, email, password, role } = req.body;
  if (role && !ROLES.includes(role)) throw httpError(400, 'Invalid role');
  if (password && password.length < 6) throw httpError(400, 'Password must be at least 6 characters');
  const hash = password ? await bcrypt.hash(password, 10) : null;
  const r = await query(
    `UPDATE users SET name = COALESCE($1,name), email = COALESCE($2,email), role = COALESCE($3,role),
       password_hash = COALESCE($4,password_hash) WHERE id = $5 RETURNING id`,
    [name || null, email ? email.toLowerCase().trim() : null, role || null, hash, req.params.id]);
  if (!r.rowCount) throw httpError(404, 'User not found');
  res.json(r.rows[0]);
}));

router.delete('/:id', wrap(async (req, res) => {
  if (Number(req.params.id) === req.user.id) throw httpError(400, 'You cannot delete your own account');
  const r = await query('DELETE FROM users WHERE id = $1', [req.params.id]);
  if (!r.rowCount) throw httpError(404, 'User not found');
  res.json({ message: 'Deleted' });
}));

module.exports = router;
