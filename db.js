require('dotenv').config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const { Pool, types } = require('pg');
const fs = require('fs');
const path = require('path');

types.setTypeParser(1700, parseFloat);   // NUMERIC -> number
types.setTypeParser(20, parseInt);       // BIGINT (COUNT) -> number
types.setTypeParser(1082, v => v);       // DATE -> 'YYYY-MM-DD' string

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const query = (text, params) => pool.query(text, params);

async function initDb() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  for (let i = 1; i <= 30; i++) {
    try { await pool.query(sql); return; }
    catch (e) {
      console.log(`Waiting for database (${i}/30): ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('Could not connect to the database. Check DATABASE_URL in backend/.env');
}

module.exports = { pool, query, initDb };
