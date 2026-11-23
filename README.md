# Online Examination and Assessment Management System

Backend Development Capstone - **Project 2**. A REST + real-time backend where faculty build question banks and schedule exams, students attempt them within a server-enforced time window, objective answers are evaluated automatically on the server, and faculty get analytics and live monitoring.

**Stack:** Node.js 20+, Express 5, MongoDB, Mongoose 9, JWT (access + refresh), bcrypt, Socket.IO, EventEmitter, express-validator.

## Features

| Area | What is implemented |
|---|---|
| Auth & RBAC | bcrypt hashing, JWT access token (15 min) + rotating refresh tokens (stored hashed, reuse detection), logout / logout-all, roles `admin`, `faculty`, `student`, protected routes, login rate limit |
| Question bank | CRUD, single-correct MCQ with marks/subject/topic/difficulty, filter + text search + pagination, ownership rules, questions in published exams are frozen |
| Exams | Title, instructions, duration, start/end window, question pool, random subset (`selection.questionCount`), shuffle questions/options, assign to students and/or groups, negative marking, retakes (`maxAttempts`), draft -> published, results release |
| Attempts | Eligibility check, window check, **server-side deadline** = `min(start + duration, exam end)`, resume, save progress, final submit, auto-submit on expiry (also a background sweeper), one submission only, atomic finalisation |
| Evaluation | Marks computed only on the server; client-sent scores ignored; answers validated against the attempt's own questions/options |
| Security of answers | Correct answers never leave the server for students (projection + explicit mapping); students cannot call question-bank routes |
| Analytics | 5 aggregation pipelines: score summary, question-wise performance, section-wise performance, score distribution, student performance across exams (+ admin platform overview) |
| Real time | Socket.IO (JWT-authenticated): live monitoring of active attempts for the exam owner; exam-published and results-released notifications for students |
| EventEmitter | Domain event bus (`exam.published`, `attempt.started`, `attempt.answered`, `attempt.submitted`, `results.released`) decouples workflow from audit logging and socket notifications |
| Audit log | Every exam event is persisted and viewable by the exam owner |

## Prerequisites

- Node.js >= 20
- MongoDB 6+ running locally (or a MongoDB Atlas URI). No replica set is required (no transactions are used; atomicity comes from conditional single-document updates).

## Setup

```bash
npm install
cp .env.example .env        # then set strong JWT secrets
npm run seed                # demo data (clears the target database!)
npm start                   # http://localhost:5000   (npm run dev for auto-reload)
```

### Environment variables (`.env`, never committed)

| Variable | Description | Default |
|---|---|---|
| `MONGO_URI` | MongoDB connection string | required |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Two different secrets, 32+ chars | required |
| `JWT_ACCESS_EXPIRES_IN` | Access-token lifetime | `15m` |
| `JWT_REFRESH_EXPIRES_DAYS` | Refresh-token lifetime (days) | `7` |
| `BCRYPT_SALT_ROUNDS` | bcrypt cost | `10` |
| `SUBMIT_GRACE_SECONDS` | Latency grace after the deadline | `10` |
| `PORT`, `NODE_ENV`, `CORS_ORIGIN` | Server config | `5000`, `development`, `*` |

### Seed data

`npm run seed` creates (password for **all** accounts: `Password@123`):

- `admin@exam.test`, `faculty1@exam.test` (owns the demo exams), `faculty2@exam.test`
- `student1..4@exam.test` in group **CSE-A**, `student5..8@exam.test` in **CSE-B**
- 20 questions; a **LIVE** exam (students can start right away), a **COMPLETED** exam with 8 submitted attempts and released results (for analytics), and a **DRAFT** exam. The exam ids are printed at the end.

## Testing

```bash
npm test                    # 47 integration tests (Vitest + Supertest + socket.io-client)
```
Tests need a running MongoDB; they use a separate database (`TEST_MONGO_URI`, default `mongodb://127.0.0.1:27017/exam_system_test`) which is **dropped** at start and end.

**Postman:** import `postman/Exam_System.postman_collection.json`, set `baseUrl`, run `npm run seed` first, then run the collection top to bottom in the Runner (62 requests, 74 assertions: success, validation failure, 401, 403, 404, 409 and business-rule cases). Headless: `npx newman run postman/Exam_System.postman_collection.json --env-var baseUrl=http://localhost:5000`. Regenerate it with `npm run postman`.

## Project structure

```
src/
  app.js, server.js          Express app / bootstrap (HTTP + Socket.IO + sweeper)
  config/                    env loading (dotenv) and DB connection
  models/                    Mongoose schemas: User, Group, Question, Exam, Attempt, AuditLog, RefreshToken
  routes/                    REST routing + RBAC wiring
  validators/                express-validator rule sets
  controllers/               request handlers (auth, user, group, question, exam, attempt, report)
  services/                  business logic: exam eligibility, attempt building, evaluation, finalisation
  middleware/                authenticate / authorize, validate, central error handler
  events/                    EventEmitter bus + listeners (audit log, socket notifications)
  sockets/                   Socket.IO auth, rooms, events
  utils/                     AppError, asyncHandler, response envelope, pagination, tokens, shuffle
scripts/                     seed.js, generate-postman.js
tests/                       integration tests
docs/                        API.md, DATABASE.md, REPORT.md
postman/                     Postman collection
```

## Documentation

- [`docs/API.md`](docs/API.md) - every endpoint, auth requirement, bodies, responses, errors, Socket.IO events
- [`docs/DATABASE.md`](docs/DATABASE.md) - collections, relationships, indexes
- [`docs/REPORT.md`](docs/REPORT.md) - project report (architecture, design decisions, testing)

## Response format

```json
{ "success": true,  "message": "optional", "data": { }, "meta": { "total": 42, "page": 1, "limit": 10, "totalPages": 5 } }
{ "success": false, "message": "Validation failed", "errors": [ { "field": "email", "message": "Valid email is required" } ] }
```
Status codes: `200/201` success, `400` validation, `401` unauthenticated, `403` forbidden / rule violation (not assigned, window closed, time up), `404` not found, `409` conflict (duplicate, already submitted, wrong state).

## Quick demo with curl

```bash
# log in as a student
TOKEN=$(curl -s localhost:5000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"student1@exam.test","password":"Password@123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')
curl -s localhost:5000/api/exams/assigned -H "Authorization: Bearer $TOKEN"
```
