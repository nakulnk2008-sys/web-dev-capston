# REST API Documentation

Base URL: `http://localhost:5000/api`. All bodies are JSON. Protected routes need `Authorization: Bearer <accessToken>`.
**Auth** column: `-` public, `any` any logged-in user, otherwise the allowed roles.

Common error body: `{ "success": false, "message": "...", "errors": [{ "field": "...", "message": "..." }] }`
Common errors on protected routes: `401` missing/invalid/expired token, `403` role not permitted, `400` invalid id/body, `404` not found.

## 1. Authentication

| Method & path | Auth | Body | Success | Errors |
|---|---|---|---|---|
| `POST /auth/register` | - | `name`, `email`, `password` (8-72), `rollNumber?` | `201` `{ user, accessToken, refreshToken }` - always role **student** | `400` validation, `409` email exists |
| `POST /auth/login` | - | `email`, `password` | `200` `{ user, accessToken, refreshToken }` | `400`, `401` invalid credentials (same message for unknown email/wrong password), `403` deactivated |
| `POST /auth/refresh` | - | `refreshToken` | `200` `{ accessToken, refreshToken }` - the old refresh token is consumed (rotation) | `401` invalid/expired/already used (reuse revokes all the user's refresh tokens) |
| `POST /auth/logout` | - | `refreshToken` | `200` token revoked | `400` |
| `POST /auth/logout-all` | any | - | `200` all sessions revoked | `401` |

Sample login response:
```json
{ "success": true, "message": "Login successful",
  "data": { "user": { "_id": "...", "name": "Aarav", "email": "student1@exam.test", "role": "student" },
            "accessToken": "eyJ...", "refreshToken": "eyJ..." } }
```

## 2. Users & groups

| Method & path | Auth | Notes |
|---|---|---|
| `GET /users/me` | any | own profile with group names |
| `PATCH /users/me` | any | `name`, `rollNumber`, or `currentPassword` + `newPassword`. Role/groups/status cannot be changed (ignored). Password change revokes refresh tokens. |
| `GET /users` | admin, faculty | filters `role`, `group`, `isActive`, `q`; `page`, `limit` |
| `POST /users` | admin | `name`, `email`, `password`, `role`, `groups?` -> `201`; `409` duplicate email |
| `GET /users/:id` | admin | `404` if missing |
| `PATCH /users/:id` | admin | `name`, `role`, `groups`, `rollNumber`, `isActive`; cannot demote/deactivate self (`409`); deactivation takes effect immediately |
| `DELETE /users/:id` | admin | cannot delete self (`409`) |
| `GET /groups` | admin, faculty | with `memberCount` (aggregation) |
| `POST /groups` | admin | `name` (unique -> `409`), `description?` |
| `GET /groups/:id` | admin, faculty | with members |
| `PATCH /groups/:id`, `DELETE /groups/:id` | admin | delete blocked (`409`) if assigned to an exam |
| `POST /groups/:id/members` | admin | `{ "userIds": [...] }` (students only) |
| `DELETE /groups/:id/members/:userId` | admin | |

## 3. Question bank (faculty owns their questions, admin sees all; students: `403`)

| Method & path | Notes |
|---|---|
| `POST /questions` | `text`, `options[{text,isCorrect}]` (2-6, **exactly one** correct), `subject`, `topic`, `marks?` (default 1), `difficulty?` -> `201` |
| `GET /questions` | filters `subject`, `topic`, `difficulty`, `q` (text search); `page`, `limit` (max 100). Response `meta`: `total, page, limit, totalPages` |
| `GET /questions/:id` | `403` if not yours (admin excepted), `404` |
| `PATCH /questions/:id` | `409` if the question is used by a **published** exam |
| `DELETE /questions/:id` | `409` if used by a published exam; otherwise removed from draft exams too |

## 4. Exams

| Method & path | Auth | Notes |
|---|---|---|
| `POST /exams` | faculty, admin | `title`, `durationMinutes`, `startTime`, `endTime` (ISO-8601), `questions[]`, `assignedStudents[]`, `assignedGroups[]`, `selection{questionCount, shuffleQuestions, shuffleOptions}`, `negativeMarking` (0-1), `maxAttempts` (1-5), `instructions`, `showCorrectAnswers`. `400` if end <= start, duration > window, or any referenced id does not exist (faculty may only use their own questions) |
| `GET /exams` | faculty, admin | own exams (admin: all); `status`, `page`, `limit` |
| `GET /exams/assigned` | student | published exams assigned directly or via group, with `state` (`upcoming`/`open`/`closed`) and `attemptsUsed`. **No questions.** |
| `GET /exams/:id` | any | staff (owner/admin): full exam with question summaries (no option data). Student: safe subset, `403` if not assigned |
| `PATCH /exams/:id` | owner, admin | drafts only (`409` otherwise) |
| `DELETE /exams/:id` | owner, admin | `409` if attempts exist |
| `POST /exams/:id/publish` | owner, admin | needs >=1 question and an assignment, end in the future; emits `exam.published` -> students notified over Socket.IO |
| `POST /exams/:id/release-results` | owner, admin | `409` while the window is open, while attempts are in progress, or if already released |
| `GET /exams/:id/attempts` | owner, admin | live/all attempts with `answeredCount`; filter `status` |
| `GET /exams/:id/results` | owner, admin | submitted attempts, best score first (student, score, totalMarks) |
| `GET /exams/:id/analytics` | owner, admin | see below |
| `GET /exams/:id/audit-log` | owner, admin | persisted exam events |

Analytics response (aggregation output; values below are illustrative):
```json
{ "data": {
  "summary": { "students": 8, "totalMarks": 12, "averageScore": 7.5, "highestScore": 11, "lowestScore": 4, "averagePercentage": 62.5 },
  "questionWise": [ { "questionId": "...", "text": "...", "topic": "Express.js", "difficulty": "medium", "attempts": 8, "answered": 8, "correct": 3, "correctRate": 37.5 } ],
  "sectionWise": [ { "groupId": "...", "section": "CSE-A", "students": 4, "averageScore": 6.5, "highestScore": 9, "lowestScore": 4, "averagePercentage": 54.17 } ],
  "scoreDistribution": [ { "range": "40-59%", "students": 3 } ] } }
```
(Retakes: the best attempt per student is used.)

## 5. Attempts (students)

| Method & path | Auth | Behaviour |
|---|---|---|
| `POST /exams/:id/start` | student | Checks: published, assigned (`403`), window open (`403` before start / after end), attempts left (`409`). Returns `201` with questions **without answer keys**, `deadline`, `remainingSeconds`. An existing in-progress attempt is **resumed** (`200`); concurrent starts create only one attempt. |
| `GET /attempts/mine` | student | own attempts; scores only shown for released results |
| `GET /attempts/:id` | any | Student: in progress -> questions + saved answers; finished -> status only until results are released, then score, percentage, per-question correctness (and correct option only if `showCorrectAnswers`). Someone else's attempt -> `404`. Staff: full attempt (owner/admin) |
| `PUT /attempts/:id/answers` | student | `{ "answers": [{ "question", "selectedOption" }] }` - saves progress. `400` if a question is not in this attempt or an option does not belong to the question; `403` after the deadline; `409` if already submitted |
| `POST /attempts/:id/submit` | student | optional `answers`; evaluates on the server. After deadline+grace the body answers are ignored and the saved answers are auto-evaluated (`auto_submitted`). `409` if already submitted (exactly-once, even for simultaneous requests). Response never contains marks. |

Example question payload on start:
```json
{ "attemptId": "...", "deadline": "2026-11-23T10:20:00.000Z", "remainingSeconds": 1200,
  "questions": [ { "_id": "...", "text": "...", "marks": 2, "options": [ { "_id": "...", "text": "app.use()" } ] } ] }
```

## 6. Reports

| Method & path | Auth | Notes |
|---|---|---|
| `GET /reports/students/:studentId/performance` | any | student: own only (`403` otherwise) and only released results; faculty: exams they own; admin: all. Returns `examsTaken`, `averagePercentage`, per-exam best score |
| `GET /reports/platform` | admin | counts of users by role, exams by status, attempts by status, questions by difficulty |

## 7. Socket.IO

Connect with `io(url, { auth: { token: "<accessToken>" } })`. Connections without a valid token are rejected (`connect_error: Authentication required/failed`). Each socket joins the private room `user:<userId>`.

| Direction | Event | Payload | Who |
|---|---|---|---|
| client -> server | `monitor:join` `{ examId }` (+ ack) | ack `{ success, activeAttempts[] }` | exam owner / admin only |
| client -> server | `monitor:leave` `{ examId }` | | |
| server -> client | `exam:published` | `{ examId, title, startTime, endTime }` | assigned students |
| server -> client | `results:released` | `{ examId, title }` | assigned students |
| server -> client | `attempt:submitted` | `{ attemptId, status, submittedAt }` (no marks) | the student |
| server -> client | `attempt:started` | `{ attemptId, studentId, startedAt, deadline }` | monitors of that exam |
| server -> client | `attempt:progress` | `{ attemptId, studentId, answeredCount, total }` | monitors |
| server -> client | `attempt:submitted` | `{ attemptId, studentId, status, submittedAt, score, totalMarks }` | monitors |

Purpose: faculty can watch a live exam (who started, progress, who submitted) and students are told immediately when an exam is published or results are out - without polling.

## 8. EventEmitter

`src/events/appEvents.js` is a shared `EventEmitter`. Controllers emit `exam.published`, `attempt.started`, `attempt.answered`, `attempt.submitted`, `results.released`; `src/events/listeners.js` subscribes and (a) writes an `AuditLog` document and (b) pushes the Socket.IO events above. Listener failures are caught so they can never fail the HTTP request.
