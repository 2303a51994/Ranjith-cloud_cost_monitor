const express = require('express');
const { query } = require('../db');
const { wrap, auth, allow, httpError } = require('../middleware');

// Generic CRUD router. `select` must alias the main table as "t".
// `scope` (optional) limits rows for the developer role, e.g. "t.owner_id = $1" ($1 = user id).
function makeCrud({ table, select, fields, required = [], writeRoles, scope }) {
  const r = express.Router();
  r.use(auth);

  r.get('/', wrap(async (req, res) => {
    const params = [];
    let where = '';
    if (scope && req.user.role === 'developer') { params.push(req.user.id); where = `WHERE ${scope}`; }
    const { rows } = await query(`${select} ${where} ORDER BY t.id DESC`, params);
    res.json(rows);
  }));

  r.post('/', allow(...writeRoles), wrap(async (req, res) => {
    for (const f of required) {
      if (req.body[f] === undefined || req.body[f] === '' || req.body[f] === null) throw httpError(400, `${f.replace(/_/g, ' ')} is required`);
    }
    const cols = fields.filter(f => req.body[f] !== undefined && req.body[f] !== '' && req.body[f] !== null);
    const result = await query(
      `INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`,
      cols.map(c => req.body[c]));
    res.status(201).json(result.rows[0]);
  }));

  r.put('/:id', allow(...writeRoles), wrap(async (req, res) => {
    const cols = fields.filter(f => req.body[f] !== undefined);
    if (!cols.length) throw httpError(400, 'Nothing to update');
    const vals = cols.map(c => (req.body[c] === '' ? null : req.body[c]));
    const result = await query(
      `UPDATE ${table} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1} RETURNING id`,
      [...vals, req.params.id]);
    if (!result.rowCount) throw httpError(404, 'Record not found');
    res.json(result.rows[0]);
  }));

  r.delete('/:id', allow(...writeRoles), wrap(async (req, res) => {
    const result = await query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) throw httpError(404, 'Record not found');
    res.json({ message: 'Deleted' });
  }));

  return r;
}

module.exports = { makeCrud };
