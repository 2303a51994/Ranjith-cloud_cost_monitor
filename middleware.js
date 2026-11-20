const jwt = require('jsonwebtoken');

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, message) => { const e = new Error(message); e.status = status; return e; };

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission for this action' });

function errorHandler(err, req, res, next) {
  console.error(err.message);
  const map = {
    '23505': [409, 'That record already exists (duplicate value)'],
    '23503': [400, 'Invalid reference, or the record is still in use'],
    '23502': [400, 'A required field is missing'],
    '23514': [400, 'A value is outside the allowed range'],
    '22P02': [400, 'A value has the wrong format'],
    '22007': [400, 'Invalid date'],
    '22008': [400, 'Invalid date']
  };
  if (map[err.code]) return res.status(map[err.code][0]).json({ error: map[err.code][1] });
  if (err.status) return res.status(err.status).json({ error: err.message });
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { wrap, httpError, auth, allow, errorHandler };
