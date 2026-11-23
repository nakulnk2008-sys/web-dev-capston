# Online Examination and Assessment Management System
### Backend Development Capstone Project - Project 2

| | |
|---|---|
| **Team members** | _(Name - Roll No. - contribution)_ |
| **Course** | Backend Development |
| **Technology stack** | Node.js, Express.js, MongoDB, Mongoose |
| **Submitted to / Date** | _(Faculty name)_ / _(date)_ |

## 1. Abstract

This project is a backend for conducting online examinations. Faculty maintain a reusable question bank, create and schedule examinations, and assign them to students or sections. Students attempt assigned examinations inside a permitted time window; the server enforces timing, eligibility and one-submission rules, evaluates objective answers automatically and keeps answer keys hidden. Faculty obtain student-wise, question-wise and section-wise analytics generated with MongoDB aggregation pipelines and can monitor attempts live through Socket.IO. The system is secured with bcrypt, JWT access/refresh tokens and role-based access control, and is verified by 47 automated integration tests and a 62-request Postman collection.

## 2. Problem Statement

Paper-based and informal online tests are hard to schedule, easy to cheat on and slow to grade. A trustworthy online assessment needs the *server* - not the browser - to decide who may attempt an exam, when, for how long, how it is marked, and who may see the results. The goal is to build such a backend with secure authentication, strict authorisation and reliable data modelling.

## 3. Objectives

1. End-to-end workflow: create -> schedule -> attempt -> evaluate -> release results.
2. Reusable question bank with filtering and pagination.
3. Server-side enforcement of access, timing and submission rules.
4. Automatic evaluation of objective questions, with marks computed only on the backend.
5. Student-wise and examination-wise analytics using aggregation.
6. JWT + RBAC protection for questions, answers and results.
7. Real-time monitoring and notifications (Socket.IO) with an internal EventEmitter event bus.

## 4. Scope and Limitations

**In scope:** three roles (admin, faculty, student); single-correct MCQs; assignment to students and groups; random question subsets, shuffling, negative marking, retakes; audit log; analytics; REST API and Socket.IO events.
**Out of scope / limitations:** no frontend; descriptive (manually graded) questions, file upload, proctoring (webcam/tab-switch detection) and email delivery are not implemented; token revocation of *access* tokens is by short expiry plus a per-request user-active check; the expiry sweeper runs inside the API process (a single instance is assumed, though finalisation is idempotent so multiple instances are safe).

## 5. Requirements

**Functional:** authentication (register/login/refresh/logout); user and group management (admin); question CRUD with filters; exam CRUD, scheduling, assignment, publish; attempt start/resume/save/submit; automatic evaluation; result release; faculty results and analytics; live monitoring; notifications; audit log.

**Non-functional:** security (hashed passwords, hashed refresh tokens, no answer-key leakage, rate-limited login, Helmet headers); correctness under concurrency (unique indexes + conditional updates); consistent JSON responses and status codes; maintainability (MVC + service layer); testability; configuration through environment variables.

## 6. System Architecture and Modules

Layered MVC: **Routes** (URL + RBAC + validation chain) -> **Controllers** (HTTP concerns) -> **Services** (business rules: eligibility, attempt construction, evaluation, finalisation) -> **Models** (Mongoose schemas). Cross-cutting: middleware (authentication, authorisation, validation, central error handler, logging with Morgan), an **EventEmitter** bus and a **Socket.IO** layer.

```
Client --HTTP--> Express (helmet, cors, json, morgan)
                   |-- /api routes -> authenticate -> authorize(role) -> validators -> controller -> service -> Mongoose -> MongoDB
                   |-- errorHandler (AppError, Mongoose, JWT, duplicate key -> uniform JSON)
Client --WS----> Socket.IO (JWT handshake, rooms user:<id>, exam:<id>:monitor)
controllers/services --emit--> EventEmitter bus --> listeners --> AuditLog (MongoDB) + Socket.IO notifications
```

| Module | Responsibility |
|---|---|
| Auth & users | register/login/refresh/logout, profile, admin user management |
| Groups | academic sections used for assignment and section analytics |
| Question bank | CRUD, filter, search, pagination, ownership, freezing after publication |
| Exams | scheduling, assignment, selection/shuffle settings, publish, results release |
| Attempts | start/resume, progress saving, submission, expiry, evaluation |
| Reports | exam analytics, student performance, platform overview |
| Real time | live monitor, publish/result notifications |

## 7. Database Design

See `docs/DATABASE.md` for full schemas. Seven collections (`users`, `groups`, `questions`, `exams`, `attempts`, `refreshtokens`, `auditlogs`). Options are embedded in questions; an attempt embeds a snapshot of its questions/option order, answers and evaluation. Key indexes: unique `{exam, student, attemptNumber}`, `{status, deadline}`, compound question-bank filter index, TTL index on refresh tokens, text index on question text.

## 8. REST API

Documented endpoint-by-endpoint in `docs/API.md` (method, auth requirement, body, success and error responses, Socket.IO events).

## 9. Authentication and Authorisation Design

- **Passwords:** bcrypt (cost 10) in a pre-save hook; `password` is `select:false` and stripped from JSON.
- **Tokens:** 15-minute access JWT (`sub`, `role`); 7-day refresh JWT. Refresh tokens are persisted **only as SHA-256 hashes** and rotated on every use; presenting an already-used token revokes the user's entire token set (theft detection).
- **Registration:** public sign-up can only create students; faculty/admin accounts are created by an admin, preventing privilege escalation.
- **Middleware:** `authenticate` verifies the token and re-loads the user (deactivated users lose access immediately); `authorize(...roles)` implements RBAC. Resource-level checks (exam/question ownership, "own attempt only") are in controllers.
- **Information hiding:** other students' attempts return 404 (not 403) so ids cannot be probed; login returns one message for unknown email and wrong password.
- **Sockets:** JWT is validated in the Socket.IO handshake; monitor rooms can be joined only by the exam owner or admin.

## 10. Implementation Details (key rules)

| Rule | Implementation |
|---|---|
| Students never see answer keys | Student APIs build responses from a projection (`options._id`, `options.text`) and an explicit mapping; students cannot reach question-bank routes; verified by a test that scans the whole start response for `isCorrect`/`correctOption` |
| Time enforced on the server | `deadline = min(startedAt + duration, exam.endTime)` stored at start; saves after the deadline get 403; submits after deadline + grace are auto-submitted using only previously saved answers; a 30-second sweeper auto-submits abandoned attempts |
| Single submission | `findOneAndUpdate({_id, status:'in_progress'}, ...)` - three simultaneous submits give exactly one 200 and two 409 |
| No duplicate attempts | unique compound index; concurrent starts yield one attempt; an existing in-progress attempt is resumed |
| Marks computed on the backend | `evaluate()` compares chosen option ids with the stored correct option; any `score` in the request is ignored; negative marking and score floor at 0 |
| Answer validation | each answer must reference a question that belongs to *this attempt* and an option that belongs to *that question* |
| Question freezing | questions used by a published exam cannot be edited or deleted (409) |
| Results visibility | students see marks only after the faculty releases results (and only after the window closes and no attempt is in progress) |

**EventEmitter:** the exam workflow emits domain events; listeners write the audit trail and push Socket.IO messages, keeping controllers free of side-effect code.
**Aggregation pipelines:** six pipelines (score summary, question-wise, section-wise with `$lookup`/`$unwind`, `$bucket` distribution, student performance, platform/group counts).

## 11. Testing Strategy and Test Cases

Automated: **47 Vitest + Supertest integration tests** against a real MongoDB, plus **62 Postman requests / 74 assertions** (run headless with newman). Both cover the required minimum: successful requests, validation failures, missing resources, missing tokens (401), insufficient role (403), duplicates/conflicts (409) and business-rule boundaries.

| Category | Examples |
|---|---|
| Auth | bcrypt hash stored; role escalation on register ignored; refresh rotation and reuse detection; logout revokes; deactivated user locked out |
| Validation | bad email/password, exam end before start, duration longer than window, question without exactly one correct option, invalid ObjectIds |
| RBAC / ownership | student -> admin route 403; other faculty cannot publish/edit/see results 403; student cannot call question APIs |
| Exam rules | not-assigned student 403; start before/after the window 403; second attempt 409; retake allowed when `maxAttempts` > 1; negative marking |
| Server-side integrity | no answer keys in payloads; forged option/question ids 400; client `score` ignored; late save 403; late submit auto-evaluated with saved answers only; sweeper |
| Concurrency | simultaneous submits -> one winner; simultaneous starts -> one attempt |
| Results | hidden until release; release rejected while window is open; correct answers shown only if enabled |
| Analytics | summary, question-wise, section-wise, distribution verified against known data |
| Real time | unauthenticated sockets rejected; students cannot join monitor rooms; faculty receive `attempt:started/progress/submitted`; student receives `exam:published`; student's submit event has no marks |

Debugging evidence: during testing, an Express 5 behaviour (`req.body` undefined for body-less POST) caused a 500 on submit; it was found through the failing concurrency test, traced with the central error logger and fixed with a body-normalising middleware. Mongoose 9 hook semantics (no `next` callback) and the deprecated `new:true` option were also corrected.

## 12. Screenshots / Demonstration Evidence

_(Insert: Postman Runner result screenshot, `npm test` output, Socket.IO monitor demo, MongoDB Compass collections/indexes.)_

Suggested demo script: (1) `npm run seed`, `npm start`; (2) log in as faculty1, show question filters and the exam; (3) log in as student1, start the LIVE exam, save answers, submit; (4) show faculty live monitor events; (5) try forbidden/late/duplicate actions; (6) release results on the COMPLETED exam and show analytics.

## 13. Conclusion and Future Enhancements

The system delivers a secure, rule-enforcing examination backend that meets the Project 2 requirements, with the integrity rules (timing, eligibility, hidden answer keys, backend marking) proven by automated tests. Future work: descriptive questions with manual grading, multi-select and numeric question types, proctoring signals (tab-switch/IP logging), CSV/PDF result export, email notifications, Redis-backed rate limiting and Socket.IO scaling adapter, question import, and a React front end.

## 14. References

1. Express.js documentation - https://expressjs.com
2. Mongoose documentation - https://mongoosejs.com
3. MongoDB Manual: Aggregation, Indexes - https://www.mongodb.com/docs/manual
4. Socket.IO documentation - https://socket.io/docs
5. RFC 7519 - JSON Web Token (JWT)
6. OWASP Cheat Sheets: Password Storage, JWT, Authentication
