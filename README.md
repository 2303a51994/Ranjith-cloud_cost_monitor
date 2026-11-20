# Cloud Resource Usage and Cost Monitoring Platform

Track cloud usage by service, project and date; estimate cost from configurable pricing; set budgets; detect anomalies; raise alerts; export reports.

**Stack:** React (Vite) + Recharts · Node.js/Express REST API · PostgreSQL · JWT auth with role-based access · Docker · Kubernetes

## Roles
| Role | Access |
|---|---|
| Admin | Everything, including user management |
| Cloud Administrator | Accounts, projects, resources, pricing, usage entry, alerts |
| Finance Manager | Budgets, reports, alerts, read-only pricing/accounts |
| Developer | Only the projects they own (usage, costs, alerts, reports) |

Demo users (password `Password@123`): `admin@cloud.com`, `cloudadmin@cloud.com`, `finance@cloud.com`, `dev1@cloud.com`, `dev2@cloud.com`

## Run in VS Code (development)
Requirements: Node.js 18+, and either Docker Desktop or a local PostgreSQL.

1. **Database** (pick one)
   - Docker: `docker compose up -d db`
   - Local PostgreSQL: create a database named `cloudcost`, then edit `DATABASE_URL` in `backend/.env`.
2. **Backend** (terminal 1)
   ```
   cd backend
   npm install
   npm run dev
   ```
   On first start the tables are created and demo data (90 days of usage) is loaded automatically. API: http://localhost:5000/api/health
3. **Frontend** (terminal 2)
   ```
   cd frontend
   npm install
   npm run dev
   ```
   Open http://localhost:5173

Reset demo data any time: `cd backend && npm run seed`

## Tests
With the backend running: `cd backend && npm test` (8 API smoke tests: auth, roles, validation, reports, data scoping).

## Docker (everything in containers)
```
docker compose up --build
```
Open http://localhost:8080 (API on :5000, database on :5432). Stop with `docker compose down`.
Build images only: `docker build -t cloudcost-backend ./backend` and `docker build -t cloudcost-frontend ./frontend`.

## Kubernetes (Docker Desktop Kubernetes or minikube)
```
docker build -t cloudcost-backend:latest ./backend
docker build -t cloudcost-frontend:latest ./frontend
# minikube only: minikube image load cloudcost-backend:latest && minikube image load cloudcost-frontend:latest
kubectl apply -f k8s/
kubectl get pods,svc
kubectl port-forward svc/frontend 8080:80
```
Open http://localhost:8080

## Business rules
- **Cost** = usage quantity × price per unit. A region-specific pricing rule overrides the `ALL` rule.
- **Anomaly**: a resource's daily cost is above (mean + 2 × std-dev) of its previous 14 days and above 1.5 × the mean.
- **Budget alerts**: warning at the budget's threshold %, critical at 100%, plus a forecast alert if projected month-end spend exceeds the budget.
- Checks run hourly (node-cron), after each usage entry, after budget changes, and on demand from the Alerts screen.

## API summary
| Endpoint | Purpose |
|---|---|
| `POST /api/auth/register`, `/login`, `GET /api/auth/me` | Authentication |
| `/api/users` | User CRUD (Admin) |
| `/api/accounts`, `/projects`, `/resources`, `/pricing`, `/budgets` | CRUD (role restricted) |
| `POST /api/pricing/recalculate` | Re-price all usage with current rates |
| `GET /api/usage?service=&project=&from=&to=`, `POST /api/usage` | Usage tracking |
| `GET /api/alerts`, `PATCH /api/alerts/:id`, `POST /api/alerts/run` | Alerts |
| `GET /api/dashboard/summary` | Dashboard data |
| `GET /api/reports/daily-usage \| monthly-cost \| resource-cost \| budget-variance` (`&format=csv\|pdf`) | Reports |

## Database tables
users · cloud_accounts · projects · resources · pricing_rules · usage_records · budgets · alerts (see `backend/src/schema.sql`)
