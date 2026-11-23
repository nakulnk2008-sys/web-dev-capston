# Database Design

MongoDB database accessed through Mongoose. IDs are ObjectIds; all collections use `timestamps`.

## Entity relationships

```
Group 1 ──< User (User.groups[]  many-to-many)
User(faculty) 1 ──< Question            (createdBy)
User(faculty) 1 ──< Exam                (createdBy)
Exam  >──< Question                     (Exam.questions[]  - the question pool)
Exam  >──< User(student) / Group        (Exam.assignedStudents[], Exam.assignedGroups[])
Exam  1 ──< Attempt >── 1 User(student) (Attempt.exam, Attempt.student)
Attempt embeds: questions[] (snapshot + option order), answers[], evaluation[]
User 1 ──< RefreshToken ; Exam 1 ──< AuditLog
```

Design choices: **references** for entities with their own lifecycle (users, questions, exams); **embedding** for data that only makes sense inside its parent and is always read with it (options inside a question; the frozen question set, answers and evaluation inside an attempt). The attempt stores a snapshot of question ids, marks and option order so shuffling is stable and later edits can never change an attempt's meaning.

## Collections

### users
| Field | Type | Notes |
|---|---|---|
| name | String | 2-80 chars |
| email | String | unique, lowercase, regex-validated |
| password | String | bcrypt hash, `select: false` |
| role | String | `admin` \| `faculty` \| `student` |
| groups | [ObjectId -> Group] | sections the user belongs to |
| rollNumber, isActive | String, Boolean | |

Indexes: `email` (unique), `role`, `{groups, role}`.

### groups
`name` (unique), `description`.

### questions
| Field | Notes |
|---|---|
| text | 3-2000 chars |
| options[] | `{ _id, text, isCorrect }` - 2 to 6 options, **exactly one** correct (schema validator) |
| marks | 0.25-100 |
| subject, topic, difficulty | `easy`/`medium`/`hard` |
| createdBy | -> User |

Indexes: `subject`; compound `{createdBy, subject, topic, difficulty}` (the question-bank filter); text index on `text` (search).

### exams
`title`, `instructions`, `durationMinutes`, `startTime`, `endTime`, `createdBy`, `questions[]`, `selection{questionCount, shuffleQuestions, shuffleOptions}`, `assignedStudents[]`, `assignedGroups[]`, `negativeMarking` (0-1 fraction of marks deducted for a wrong answer), `maxAttempts` (>1 = permitted retake), `status` (`draft`/`published`), `resultsReleased`, `showCorrectAnswers`.
Validation: `endTime > startTime`; `durationMinutes <= window length`.

Indexes: `{createdBy, startTime}`, `{status, startTime, endTime}`, `assignedStudents`, `assignedGroups`.

### attempts
`exam`, `student`, `attemptNumber`, `questions[{question, marks, optionOrder[]}]`, `answers[{question, selectedOption, answeredAt}]`, `startedAt`, `deadline`, `submittedAt`, `status` (`in_progress`/`submitted`/`auto_submitted`), `evaluation[{question, selectedOption, correctOption, isCorrect, marksAwarded}]`, `totalMarks`, `score`, `correctCount`.

Indexes: **unique** `{exam, student, attemptNumber}` (prevents duplicate attempts under concurrent "start" calls); `{status, deadline}` (expiry sweeper); `{exam, status, score}` (results/analytics); `{student, submittedAt}`.

### refreshtokens
`user`, `tokenHash` (SHA-256 of the token, unique), `expiresAt` (**TTL index** - documents expire automatically).

### auditlogs
`action`, `actor`, `exam`, `attempt`, `meta`, `createdAt`. Indexes: `action`, `{exam, createdAt}`.

## Aggregation pipelines

| # | Endpoint | Pipeline |
|---|---|---|
| 1 | `GET /exams/:id/analytics` -> `summary` | `$match` finished attempts -> `$sort` -> `$group` (best attempt per student) -> `$addFields` percentage -> `$group` avg/max/min -> `$project` |
| 2 | `-> questionWise` | `$match` -> `$unwind evaluation` -> `$group` by question (attempts/answered/correct) -> `$lookup questions` -> `$project` correct-rate -> `$sort` |
| 3 | `-> sectionWise` | best-per-student -> `$lookup users` -> `$unwind groups` -> `$lookup groups` -> `$group` by section |
| 4 | `-> scoreDistribution` | best-per-student -> `$bucket` on percentage |
| 5 | `GET /reports/students/:id/performance` | `$match` student -> `$lookup exams` -> access filter -> `$group` best per exam -> `$group` overall average |
| 6 | `GET /reports/platform`, `GET /groups` | `$group` counts; `$lookup` member counts |
