CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin','cloud_admin','finance','developer')),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS cloud_accounts (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('AWS','Azure','GCP','Other')),
  account_name VARCHAR(100) NOT NULL,
  account_ref VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  account_id INT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  owner_id INT REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS resources (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  service_type VARCHAR(30) NOT NULL,
  region VARCHAR(30) NOT NULL,
  unit VARCHAR(30) NOT NULL
);
CREATE TABLE IF NOT EXISTS pricing_rules (
  id SERIAL PRIMARY KEY,
  service_type VARCHAR(30) NOT NULL,
  region VARCHAR(30) NOT NULL DEFAULT 'ALL',
  unit VARCHAR(30) NOT NULL,
  price_per_unit NUMERIC(12,6) NOT NULL CHECK (price_per_unit >= 0),
  UNIQUE (service_type, region)
);
CREATE TABLE IF NOT EXISTS usage_records (
  id SERIAL PRIMARY KEY,
  resource_id INT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  quantity NUMERIC(14,4) NOT NULL CHECK (quantity >= 0),
  cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  UNIQUE (resource_id, usage_date)
);
CREATE TABLE IF NOT EXISTS budgets (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  month CHAR(7) NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  threshold_pct INT NOT NULL DEFAULT 80 CHECK (threshold_pct BETWEEN 1 AND 100),
  UNIQUE (project_id, month)
);
CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL,
  severity VARCHAR(10) NOT NULL,
  project_id INT REFERENCES projects(id) ON DELETE CASCADE,
  resource_id INT REFERENCES resources(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  status VARCHAR(15) NOT NULL DEFAULT 'open',
  dedupe_key VARCHAR(100) UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_records(usage_date);
