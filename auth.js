const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { wrap, auth, httpError } = require('../middleware');

const sign = u => jwt.sign({ id: u.id, name: u.name, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role });

router.post('/register', wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) throw httpError(400, 'Name, email and password are required');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw httpError(400, 'Enter a valid email address');
  if (password.length < 6) throw httpError(400, 'Password must be at least 6 characters');
  const hash = await bcrypt.hash(password, 10);
  const r = await query(
    `INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'developer') RETURNING id,name,email,role`,
    [name.trim(), email.toLowerCase().trim(), hash]);
  res.status(201).json({ token: sign(r.rows[0]), user: r.rows[0] });
}));

router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw httpError(400, 'Email and password are required');
  const r = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) throw httpError(401, 'Incorrect email or password');
  res.json({ token: sign(u), user: publicUser(u) });
}));

router.get('/me', auth, (req, res) => res.json(req.user));

module.exports = router;
