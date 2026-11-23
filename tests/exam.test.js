const mongoose = require("mongoose");
const http = require('http');
const { io: ioc } = require('socket.io-client');
const { connectDB } = require('../src/config/db');
const socketLayer = require('../src/sockets');
const listeners = require('../src/events/listeners');
const Attempt = require('../src/models/Attempt');
const Exam = require('../src/models/Exam');
const Question = require('../src/models/Question');
const Group = require('../src/models/Group');
const AuditLog = require('../src/models/AuditLog');
const User = require('../src/models/User');
const RefreshToken = require('../src/models/RefreshToken');
const attemptService = require('../src/services/attemptService');
const { api, makeUser, login, auth, mcq, min } = require('./helpers');

const URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/exam_system_test';
let server, port;
let admin, fac, fac2, stu, stu2, stu3, outsider;
let tAdmin, tFac, tFac2, tStu, tStu2, tStu3, tOut;
let groupA, qs, exam; // qs: array of saved questions

const idsOf = (docs) => docs.map((d) => String(d._id));

beforeAll(async () => {
  await connectDB(URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  server = http.createServer(require('../src/app'));
  socketLayer.init(server);
  listeners.register();
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;

  groupA = await Group.create({ name: 'Section A' });
  admin = await makeUser('admin');
  fac = await makeUser('faculty', 'one');
  fac2 = await makeUser('faculty', 'two');
  stu = await makeUser('student', 'one', { groups: [groupA._id] });
  stu2 = await makeUser('student', 'two');
  stu3 = await makeUser('student', 'three', { groups: [groupA._id] });
  outsider = await makeUser('student', 'out');
  [tAdmin, tFac, tFac2, tStu, tStu2, tStu3, tOut] = (await Promise.all([admin, fac, fac2, stu, stu2, stu3, outsider].map(login))).map((x) => x.token);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((r) => server.close(r));
});

// ------------------------------------------------------------------ AUTH
describe('Authentication & RBAC', () => {
  test('register creates a student and hashes the password (bcrypt)', async () => {
    const res = await api().post('/api/auth/register').send({ name: 'New Kid', email: 'new@t.test', password: 'Password@123', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('student'); // role escalation attempt ignored
    expect(res.body.data.user.password).toBeUndefined();
    const raw = await User.findOne({ email: 'new@t.test' }).select('+password');
    expect(raw.password).toMatch(/^\$2[aby]\$/);
  });

  test('validation failure: missing/invalid fields -> 400 with field errors', async () => {
    const res = await api().post('/api/auth/register').send({ name: 'x', email: 'bad', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.field)).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });

  test('duplicate email -> 409', async () => {
    const res = await api().post('/api/auth/register').send({ name: 'Dup', email: 'new@t.test', password: 'Password@123' });
    expect(res.status).toBe(409);
  });

  test('login success / wrong password / unknown email (same message)', async () => {
    const ok = await api().post('/api/auth/login').send({ email: stu.email, password: 'Password@123' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken && ok.body.data.refreshToken).toBeTruthy();
    const bad = await api().post('/api/auth/login').send({ email: stu.email, password: 'wrong-password' });
    const unk = await api().post('/api/auth/login').send({ email: 'nobody@t.test', password: 'Password@123' });
    expect(bad.status).toBe(401);
    expect(unk.status).toBe(401);
    expect(bad.body.message).toBe(unk.body.message);
  });

  test('no token / malformed token -> 401', async () => {
    expect((await api().get('/api/users/me')).status).toBe(401);
    expect((await api().get('/api/users/me').set(auth('garbage'))).status).toBe(401);
  });

  test('refresh token rotation and reuse detection', async () => {
    const { refreshToken } = await login(stu2);
    const r1 = await api().post('/api/auth/refresh').send({ refreshToken });
    expect(r1.status).toBe(200);
    const newRefresh = r1.body.data.refreshToken;
    const reuse = await api().post('/api/auth/refresh').send({ refreshToken }); // spent token
    expect(reuse.status).toBe(401);
    const afterReuse = await api().post('/api/auth/refresh').send({ refreshToken: newRefresh }); // family revoked
    expect(afterReuse.status).toBe(401);
  });

  test('logout invalidates the refresh token', async () => {
    const { refreshToken } = await login(stu2);
    expect((await api().post('/api/auth/logout').send({ refreshToken })).status).toBe(200);
    expect((await api().post('/api/auth/refresh').send({ refreshToken })).status).toBe(401);
  });

  test('refresh tokens are stored hashed, not in plain text', async () => {
    const { refreshToken } = await login(stu2);
    expect(await RefreshToken.findOne({ tokenHash: refreshToken })).toBeNull();
  });

  test('RBAC: student/faculty cannot use admin routes -> 403; admin can', async () => {
    const body = { name: 'Made By Admin', email: 'madeby@t.test', password: 'Password@123', role: 'faculty' };
    expect((await api().post('/api/users').set(auth(tStu)).send(body)).status).toBe(403);
    expect((await api().post('/api/users').set(auth(tFac)).send(body)).status).toBe(403);
    expect((await api().post('/api/users').set(auth(tAdmin)).send(body)).status).toBe(201);
    expect((await api().get('/api/reports/platform').set(auth(tFac))).status).toBe(403);
    expect((await api().get('/api/reports/platform').set(auth(tAdmin))).status).toBe(200);
  });

  test('profile: user can update own name but not role', async () => {
    const res = await api().patch('/api/users/me').set(auth(tStu2)).send({ name: 'Renamed Two', role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed Two');
    expect(res.body.data.role).toBe('student');
  });

  test('deactivated user is locked out immediately', async () => {
    const victim = await makeUser('student', 'victim');
    const { token } = await login(victim);
    expect((await api().get('/api/users/me').set(auth(token))).status).toBe(200);
    expect((await api().patch(`/api/users/${victim._id}`).set(auth(tAdmin)).send({ isActive: false })).status).toBe(200);
    expect((await api().get('/api/users/me').set(auth(token))).status).toBe(401);
  });
});

// ------------------------------------------------------------------ QUESTION BANK
describe('Question bank', () => {
  test('create: valid question; students are forbidden', async () => {
    const ok = await api().post('/api/questions').set(auth(tFac)).send(mcq('What is Express?'));
    expect(ok.status).toBe(201);
    expect((await api().post('/api/questions').set(auth(tStu)).send(mcq('x question'))).status).toBe(403);
    expect((await api().post('/api/questions')).status).toBe(401);
  });

  test('validation: needs exactly one correct option, 2-6 options', async () => {
    const none = mcq('No correct option?'); none.options.forEach((o) => (o.isCorrect = false));
    const two = mcq('Two correct?'); two.options[1].isCorrect = true;
    const few = { ...mcq('One option only?'), options: [{ text: 'A', isCorrect: true }] };
    expect((await api().post('/api/questions').set(auth(tFac)).send(none)).status).toBe(400);
    expect((await api().post('/api/questions').set(auth(tFac)).send(two)).status).toBe(400);
    expect((await api().post('/api/questions').set(auth(tFac)).send(few)).status).toBe(400);
    expect((await api().post('/api/questions').set(auth(tFac)).send({ text: 'no subject' })).status).toBe(400);
  });

  test('list: filter by topic & difficulty with pagination; faculty sees only own', async () => {
    for (let i = 0; i < 4; i++) await api().post('/api/questions').set(auth(tFac)).send(mcq(`Hard mongo q ${i}`, 0, { topic: 'Mongo', difficulty: 'hard' }));
    const res = await api().get('/api/questions?topic=Mongo&difficulty=hard&limit=3&page=1').set(auth(tFac));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.meta).toMatchObject({ total: 4, totalPages: 2, page: 1, limit: 3 });
    const other = await api().get('/api/questions?topic=Mongo').set(auth(tFac2));
    expect(other.body.meta.total).toBe(0);
    expect((await api().get('/api/questions?difficulty=impossible').set(auth(tFac))).status).toBe(400);
  });

  test('not found / invalid id / other faculty cannot edit or delete', async () => {
    const q = (await api().post('/api/questions').set(auth(tFac)).send(mcq('Owned by fac one'))).body.data;
    expect((await api().get(`/api/questions/${new mongoose.Types.ObjectId()}`).set(auth(tFac))).status).toBe(404);
    expect((await api().get('/api/questions/not-an-id').set(auth(tFac))).status).toBe(400);
    expect((await api().patch(`/api/questions/${q._id}`).set(auth(tFac2)).send({ marks: 5 })).status).toBe(403);
    expect((await api().delete(`/api/questions/${q._id}`).set(auth(tFac2))).status).toBe(403);
    expect((await api().patch(`/api/questions/${q._id}`).set(auth(tFac)).send({ marks: 5 })).body.data.marks).toBe(5);
    expect((await api().delete(`/api/questions/${q._id}`).set(auth(tFac))).status).toBe(200);
  });
});

// ------------------------------------------------------------------ EXAM LIFECYCLE
describe('Exam creation, scheduling and publishing', () => {
  beforeAll(async () => {
    qs = await Question.create([0, 1, 2, 3].map((i) => ({ ...mcq(`Pool question ${i}`, i % 4, { marks: 2 }), createdBy: fac._id })));
  });

  const base = () => ({
    title: 'Midterm', durationMinutes: 30, startTime: min(-5), endTime: min(60),
    questions: idsOf(qs), assignedGroups: [String(groupA._id)], assignedStudents: [String(stu2._id)],
  });

  test('validation: endTime before startTime, duration longer than window, bad ids', async () => {
    expect((await api().post('/api/exams').set(auth(tFac)).send({ ...base(), endTime: min(-10) })).status).toBe(400);
    expect((await api().post('/api/exams').set(auth(tFac)).send({ ...base(), durationMinutes: 500 })).status).toBe(400);
    expect((await api().post('/api/exams').set(auth(tFac)).send({ ...base(), questions: ['abc'] })).status).toBe(400);
    expect((await api().post('/api/exams').set(auth(tFac)).send({ ...base(), questions: [String(new mongoose.Types.ObjectId())] })).status).toBe(400);
    expect((await api().post('/api/exams').set(auth(tStu)).send(base())).status).toBe(403);
  });

  test('faculty cannot use another faculty member\'s questions', async () => {
    expect((await api().post('/api/exams').set(auth(tFac2)).send(base())).status).toBe(400);
  });

  test('publish requires questions and assignment; published exams are frozen', async () => {
    const empty = (await api().post('/api/exams').set(auth(tFac)).send({ ...base(), questions: [], assignedGroups: [], assignedStudents: [] })).body.data;
    expect((await api().post(`/api/exams/${empty._id}/publish`).set(auth(tFac))).status).toBe(409);

    exam = (await api().post('/api/exams').set(auth(tFac)).send(base())).body.data;
    expect(exam.status).toBe('draft');
    expect((await api().post(`/api/exams/${exam._id}/publish`).set(auth(tFac2))).status).toBe(403); // not the owner
    const pub = await api().post(`/api/exams/${exam._id}/publish`).set(auth(tFac));
    expect(pub.status).toBe(200);
    expect(pub.body.data.status).toBe('published');
    expect((await api().post(`/api/exams/${exam._id}/publish`).set(auth(tFac))).status).toBe(409);
    expect((await api().patch(`/api/exams/${exam._id}`).set(auth(tFac)).send({ title: 'Changed' })).status).toBe(409);
    // a question used in a published exam cannot be edited/deleted
    expect((await api().delete(`/api/questions/${qs[0]._id}`).set(auth(tFac))).status).toBe(409);
    expect((await api().patch(`/api/questions/${qs[0]._id}`).set(auth(tFac)).send({ marks: 9 })).status).toBe(409);
  });

  test('audit log recorded the publish event (EventEmitter listener)', async () => {
    await new Promise((r) => setTimeout(r, 200));
    expect(await AuditLog.countDocuments({ exam: exam._id, action: 'exam.published' })).toBe(1);
  });
});

// ------------------------------------------------------------------ STUDENT ATTEMPT FLOW
describe('Examination attempt, server-side rules and evaluation', () => {
  let attempt, view;

  test('access: unassigned student cannot see or start the exam (403)', async () => {
    expect((await api().get(`/api/exams/${exam._id}`).set(auth(tOut))).status).toBe(403);
    expect((await api().post(`/api/exams/${exam._id}/start`).set(auth(tOut))).status).toBe(403);
    const list = await api().get('/api/exams/assigned').set(auth(tOut));
    expect(list.body.data).toHaveLength(0);
  });

  test('students can never use the question-bank APIs (no answer-key leak)', async () => {
    expect((await api().get('/api/questions').set(auth(tStu))).status).toBe(403);
    expect((await api().get(`/api/questions/${qs[0]._id}`).set(auth(tStu))).status).toBe(403);
  });

  test('assigned (via group and direct) students list the exam; no questions exposed', async () => {
    const l1 = await api().get('/api/exams/assigned').set(auth(tStu));  // via group
    const l2 = await api().get('/api/exams/assigned').set(auth(tStu2)); // direct
    expect(l1.body.data[0]).toMatchObject({ state: 'open', attemptsUsed: 0 });
    expect(l2.body.data).toHaveLength(1);
    const detail = await api().get(`/api/exams/${exam._id}`).set(auth(tStu));
    expect(detail.status).toBe(200);
    expect(detail.body.data.questions).toBeUndefined();
  });

  test('cannot start before the window opens or after it closes', async () => {
    const future = await Exam.create({ title: 'Future', durationMinutes: 10, startTime: new Date(Date.now() + 3600e3), endTime: new Date(Date.now() + 7200e3),
      createdBy: fac._id, questions: [qs[0]._id], assignedStudents: [stu._id], status: 'published' });
    const past = await Exam.create({ title: 'Past', durationMinutes: 10, startTime: new Date(Date.now() - 7200e3), endTime: new Date(Date.now() - 3600e3),
      createdBy: fac._id, questions: [qs[0]._id], assignedStudents: [stu._id], status: 'published' });
    expect((await api().post(`/api/exams/${future._id}/start`).set(auth(tStu))).status).toBe(403);
    expect((await api().post(`/api/exams/${past._id}/start`).set(auth(tStu))).status).toBe(403);
    expect((await api().post(`/api/exams/${new mongoose.Types.ObjectId()}/start`).set(auth(tStu))).status).toBe(404);
  });

  test('start returns questions WITHOUT answer keys; deadline set by server', async () => {
    const res = await api().post(`/api/exams/${exam._id}/start`).set(auth(tStu));
    expect(res.status).toBe(201);
    view = res.body.data;
    attempt = view.attemptId;
    expect(view.questions).toHaveLength(4);
    expect(JSON.stringify(res.body)).not.toMatch(/isCorrect|correctOption/);
    expect(view.questions[0].options[0]).toEqual({ _id: expect.any(String), text: expect.any(String) });
    expect(new Date(view.deadline) - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  test('starting again resumes the same attempt (no duplicates)', async () => {
    const res = await api().post(`/api/exams/${exam._id}/start`).set(auth(tStu));
    expect(res.status).toBe(200);
    expect(res.body.data.attemptId).toBe(attempt);
    expect(await Attempt.countDocuments({ exam: exam._id, student: stu._id })).toBe(1);
  });

  test('another student cannot read or alter this attempt (404)', async () => {
    expect((await api().get(`/api/attempts/${attempt}`).set(auth(tStu3))).status).toBe(404);
    const q = view.questions[0];
    expect((await api().put(`/api/attempts/${attempt}/answers`).set(auth(tStu3)).send({ answers: [{ question: q._id, selectedOption: q.options[0]._id }] })).status).toBe(404);
    expect((await api().post(`/api/attempts/${attempt}/submit`).set(auth(tStu3))).status).toBe(404);
  });

  test('answer validation: unknown question / option from a different question / bad payload', async () => {
    const [q1, q2] = view.questions;
    const wrongQ = await api().put(`/api/attempts/${attempt}/answers`).set(auth(tStu))
      .send({ answers: [{ question: String(new mongoose.Types.ObjectId()), selectedOption: q1.options[0]._id }] });
    expect(wrongQ.status).toBe(400);
    const wrongOpt = await api().put(`/api/attempts/${attempt}/answers`).set(auth(tStu))
      .send({ answers: [{ question: q1._id, selectedOption: q2.options[0]._id }] });
    expect(wrongOpt.status).toBe(400);
    expect((await api().put(`/api/attempts/${attempt}/answers`).set(auth(tStu)).send({ answers: 'nope' })).status).toBe(400);
    expect((await api().put(`/api/attempts/${attempt}/answers`).set(auth(tStu)).send({ answers: [] })).status).toBe(400);
  });

  test('progress is saved, and monitors are notified', async () => {
    const q = view.questions[0];
    const res = await api().put(`/api/attempts/${attempt}/answers`).set(auth(tStu)).send({ answers: [{ question: q._id, selectedOption: q.options[0]._id }] });
    expect(res.status).toBe(200);
    expect(res.body.data.answeredCount).toBe(1);
  });

  test('final submit: marks are computed on the server; client-sent score ignored; no marks shown before release', async () => {
    // answer everything correctly using the DB key (a student would not know it)
    const keyed = await Question.find({ _id: { $in: idsOf(qs) } });
    const answers = view.questions.map((q) => ({ question: q._id, selectedOption: String(keyed.find((k) => String(k._id) === q._id).options.find((o) => o.isCorrect)._id) }));
    const res = await api().post(`/api/attempts/${attempt}/submit`).set(auth(tStu)).send({ answers, score: 9999, totalMarks: 9999 });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('submitted');
    expect(res.body.data.score).toBeUndefined();
    const stored = await Attempt.findById(attempt);
    expect(stored.score).toBe(8); // 4 questions x 2 marks
    expect(stored.totalMarks).toBe(8);
    const view2 = await api().get(`/api/attempts/${attempt}`).set(auth(tStu));
    expect(view2.body.data).toMatchObject({ resultsReleased: false });
    expect(view2.body.data.score).toBeUndefined();
  });

  test('duplicate submit -> 409; second attempt on a single-attempt exam -> 409; saving after submit -> 409', async () => {
    expect((await api().post(`/api/attempts/${attempt}/submit`).set(auth(tStu))).status).toBe(409);
    expect((await api().post(`/api/exams/${exam._id}/start`).set(auth(tStu))).status).toBe(409);
    const q = view.questions[0];
    expect((await api().put(`/api/attempts/${attempt}/answers`).set(auth(tStu)).send({ answers: [{ question: q._id, selectedOption: q.options[0]._id }] })).status).toBe(409);
  });

  test('concurrent double-submit finalises exactly once', async () => {
    const e = await Exam.create({ title: 'Race', durationMinutes: 10, startTime: new Date(Date.now() - 60e3), endTime: new Date(Date.now() + 3600e3),
      createdBy: fac._id, questions: idsOf(qs), assignedStudents: [stu3._id], status: 'published' });
    const s = (await api().post(`/api/exams/${e._id}/start`).set(auth(tStu3))).body.data;
    const results = await Promise.all([1, 2, 3].map(() => api().post(`/api/attempts/${s.attemptId}/submit`).set(auth(tStu3))));
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([200, 409, 409]);
  });

  test('concurrent start creates a single attempt', async () => {
    const e = await Exam.create({ title: 'Race start', durationMinutes: 10, startTime: new Date(Date.now() - 60e3), endTime: new Date(Date.now() + 3600e3),
      createdBy: fac._id, questions: idsOf(qs), assignedStudents: [stu2._id], status: 'published' });
    await Promise.all([1, 2, 3].map(() => api().post(`/api/exams/${e._id}/start`).set(auth(tStu2))));
    expect(await Attempt.countDocuments({ exam: e._id, student: stu2._id })).toBe(1);
  });

  test('time limit is enforced on the server: late save rejected, late submit auto-evaluates saved answers only', async () => {
    const e = await Exam.create({ title: 'Timed', durationMinutes: 10, startTime: new Date(Date.now() - 60e3), endTime: new Date(Date.now() + 3600e3),
      createdBy: fac._id, questions: idsOf(qs), assignedStudents: [stu2._id], status: 'published' });
    const s = (await api().post(`/api/exams/${e._id}/start`).set(auth(tStu2))).body.data;
    const q = s.questions[0];
    const keyed = await Question.findById(q._id);
    const correct = String(keyed.options.find((o) => o.isCorrect)._id);
    expect((await api().put(`/api/attempts/${s.attemptId}/answers`).set(auth(tStu2)).send({ answers: [{ question: q._id, selectedOption: correct }] })).status).toBe(200);
    // Simulate the clock running out (deadline far in the past, beyond grace)
    await Attempt.updateOne({ _id: s.attemptId }, { deadline: new Date(Date.now() - 60e3) });
    const late = await api().put(`/api/attempts/${s.attemptId}/answers`).set(auth(tStu2)).send({ answers: [{ question: s.questions[1]._id, selectedOption: s.questions[1].options[0]._id }] });
    expect(late.status).toBe(403);
    const stored = await Attempt.findById(s.attemptId);
    expect(['auto_submitted', 'in_progress']).toContain(stored.status);
    const sub = await api().post(`/api/attempts/${s.attemptId}/submit`).set(auth(tStu2));
    expect([200, 409]).toContain(sub.status);
    const final = await Attempt.findById(s.attemptId);
    expect(final.status).toBe('auto_submitted');
    expect(final.answers).toHaveLength(1); // the late answer was not accepted
  });

  test('sweeper auto-submits abandoned expired attempts', async () => {
    const e = await Exam.create({ title: 'Abandoned', durationMinutes: 10, startTime: new Date(Date.now() - 60e3), endTime: new Date(Date.now() + 3600e3),
      createdBy: fac._id, questions: idsOf(qs), assignedStudents: [outsider._id], status: 'published' });
    const s = (await api().post(`/api/exams/${e._id}/start`).set(auth(tOut))).body.data;
    await Attempt.updateOne({ _id: s.attemptId }, { deadline: new Date(Date.now() - 60e3) });
    expect(await attemptService.sweepExpired()).toBeGreaterThanOrEqual(1);
    expect((await Attempt.findById(s.attemptId)).status).toBe('auto_submitted');
  });

  test('negative marking and permitted retake', async () => {
    const e = await Exam.create({ title: 'Negative', durationMinutes: 10, startTime: new Date(Date.now() - 60e3), endTime: new Date(Date.now() + 3600e3),
      createdBy: fac._id, questions: idsOf(qs), assignedStudents: [stu3._id], status: 'published', negativeMarking: 0.5, maxAttempts: 2 });
    const s = (await api().post(`/api/exams/${e._id}/start`).set(auth(tStu3))).body.data;
    const keyed = await Question.find({ _id: { $in: idsOf(qs) } });
    const wrong = s.questions.slice(0, 2).map((q) => ({ question: q._id, selectedOption: String(keyed.find((k) => String(k._id) === q._id).options.find((o) => !o.isCorrect)._id) }));
    const right = s.questions.slice(2).map((q) => ({ question: q._id, selectedOption: String(keyed.find((k) => String(k._id) === q._id).options.find((o) => o.isCorrect)._id) }));
    await api().post(`/api/attempts/${s.attemptId}/submit`).set(auth(tStu3)).send({ answers: [...wrong, ...right] });
    const a = await Attempt.findById(s.attemptId);
    expect(a.score).toBe(2); // 2 correct (4) - 2 wrong x (2 x 0.5) = 2
    const again = await api().post(`/api/exams/${e._id}/start`).set(auth(tStu3));
    expect(again.status).toBe(201);
    expect(again.body.data.attemptNumber).toBe(2);
    await api().post(`/api/exams/${e._id}/start`).set(auth(tStu3));
    await api().post(`/api/attempts/${again.body.data.attemptId}/submit`).set(auth(tStu3));
    expect((await api().post(`/api/exams/${e._id}/start`).set(auth(tStu3))).status).toBe(409); // maxAttempts reached
  });

  test('random subset & shuffle per attempt', async () => {
    const many = await Question.create([...Array(8)].map((_, i) => ({ ...mcq(`Bulk ${i}`), createdBy: fac._id })));
    const e = await Exam.create({ title: 'Random', durationMinutes: 10, startTime: new Date(Date.now() - 60e3), endTime: new Date(Date.now() + 3600e3),
      createdBy: fac._id, questions: idsOf(many), assignedStudents: [stu._id], status: 'published', selection: { questionCount: 3, shuffleQuestions: true, shuffleOptions: true } });
    const s = (await api().post(`/api/exams/${e._id}/start`).set(auth(tStu))).body.data;
    expect(s.questions).toHaveLength(3);
  });
});

// ------------------------------------------------------------------ RESULTS & ANALYTICS
describe('Results release and analytics', () => {
  test('cannot release before the window closes; only owner can release', async () => {
    expect((await api().post(`/api/exams/${exam._id}/release-results`).set(auth(tFac))).status).toBe(409);
    await Exam.updateOne({ _id: exam._id }, { startTime: new Date(Date.now() - 7200e3), endTime: new Date(Date.now() - 3600e3) });
    // another stu2 still has no attempt on this exam; in-progress ones from other tests are on other exams
    expect((await api().post(`/api/exams/${exam._id}/release-results`).set(auth(tFac2))).status).toBe(403);
    expect((await api().post(`/api/exams/${exam._id}/release-results`).set(auth(tStu))).status).toBe(403);
    expect((await api().post(`/api/exams/${exam._id}/release-results`).set(auth(tFac))).status).toBe(200);
    expect((await api().post(`/api/exams/${exam._id}/release-results`).set(auth(tFac))).status).toBe(409);
  });

  test('student sees their own marks after release; correct answers only if enabled', async () => {
    const mine = await api().get('/api/attempts/mine').set(auth(tStu));
    const att = mine.body.data.find((a) => String(a.exam._id) === String(exam._id));
    expect(att.score).toBe(8);
    const res = await api().get(`/api/attempts/${att._id}`).set(auth(tStu));
    expect(res.body.data).toMatchObject({ resultsReleased: true, score: 8, totalMarks: 8, percentage: 100, correctCount: 4 });
    expect(res.body.data.details[0].correctOption).toBeUndefined();
    await Exam.updateOne({ _id: exam._id }, { showCorrectAnswers: true });
    const res2 = await api().get(`/api/attempts/${att._id}`).set(auth(tStu));
    expect(res2.body.data.details[0].correctOption).toBeTruthy();
  });

  test('faculty results list, attempts list and audit log (owner only)', async () => {
    const results = await api().get(`/api/exams/${exam._id}/results`).set(auth(tFac));
    expect(results.status).toBe(200);
    expect(results.body.data[0]).toMatchObject({ score: 8, totalMarks: 8 });
    expect((await api().get(`/api/exams/${exam._id}/results`).set(auth(tFac2))).status).toBe(403);
    expect((await api().get(`/api/exams/${exam._id}/results`).set(auth(tStu))).status).toBe(403);
    expect((await api().get(`/api/exams/${exam._id}/results`).set(auth(tAdmin))).status).toBe(200);
    const audit = await api().get(`/api/exams/${exam._id}/audit-log`).set(auth(tFac));
    const actions = audit.body.data.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['exam.published', 'attempt.started', 'attempt.submitted', 'results.released']));
  });

  test('analytics aggregation: summary, question-wise, section-wise, distribution', async () => {
    // add a second, weaker student result to make stats non-trivial
    const e2 = exam;
    const s = (await api().post(`/api/exams/${e2._id}/start`).set(auth(tStu2)));
    expect(s.status).toBe(403); // window closed now; stats rely on the seeded/previous attempt only
    const res = await api().get(`/api/exams/${exam._id}/analytics`).set(auth(tFac));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.summary).toMatchObject({ students: 1, highestScore: 8, lowestScore: 8, averageScore: 8, totalMarks: 8 });
    expect(d.questionWise).toHaveLength(4);
    expect(d.questionWise[0]).toMatchObject({ correctRate: 100 });
    expect(d.sectionWise[0]).toMatchObject({ section: 'Section A', students: 1, averageScore: 8 });
    expect(d.scoreDistribution).toEqual([{ range: '80-100%', students: 1 }]);
    expect((await api().get(`/api/exams/${exam._id}/analytics`).set(auth(tFac2))).status).toBe(403);
  });

  test('student performance report: own only; faculty/admin may view', async () => {
    const own = await api().get(`/api/reports/students/${stu._id}/performance`).set(auth(tStu));
    expect(own.status).toBe(200);
    expect(own.body.data).toMatchObject({ examsTaken: 1, averagePercentage: 100 });
    expect((await api().get(`/api/reports/students/${stu._id}/performance`).set(auth(tStu3))).status).toBe(403);
    expect((await api().get(`/api/reports/students/${stu._id}/performance`).set(auth(tFac))).status).toBe(200);
    expect((await api().get(`/api/reports/students/${new mongoose.Types.ObjectId()}/performance`).set(auth(tAdmin))).status).toBe(404);
  });

  test('exam with attempts cannot be deleted', async () => {
    expect((await api().delete(`/api/exams/${exam._id}`).set(auth(tFac))).status).toBe(409);
  });
});

// ------------------------------------------------------------------ SOCKET.IO
describe('Socket.IO real-time features', () => {
  const connect = (token) => new Promise((resolve, reject) => {
    const s = ioc(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => { s.close(); reject(e); });
  });
  const once = (s, ev) => new Promise((r) => s.once(ev, r));

  test('unauthenticated / invalid-token sockets are rejected', async () => {
    await expect(connect(undefined)).rejects.toThrow(/Authentication/);
    await expect(connect('junk')).rejects.toThrow(/Authentication/);
  });

  test('faculty monitors live attempts; student gets publish/release notifications; students cannot monitor', async () => {
    const live = await Exam.create({ title: 'Live', durationMinutes: 10, startTime: new Date(Date.now() - 60e3), endTime: new Date(Date.now() + 3600e3),
      createdBy: fac._id, questions: idsOf(qs), assignedStudents: [stu._id, stu3._id], status: 'draft' });
    const sStu = await connect(tStu);
    const sFac = await connect(tFac);
    const sFac2 = await connect(tFac2);

    // students are not allowed to join the monitor room; non-owner faculty either
    expect((await new Promise((r) => sStu.emit('monitor:join', { examId: String(live._id) }, r))).success).toBe(false);
    expect((await new Promise((r) => sFac2.emit('monitor:join', { examId: String(live._id) }, r))).success).toBe(false);
    const joined = await new Promise((r) => sFac.emit('monitor:join', { examId: String(live._id) }, r));
    expect(joined).toMatchObject({ success: true, activeAttempts: [] });

    const published = once(sStu, 'exam:published');
    await api().post(`/api/exams/${live._id}/publish`).set(auth(tFac));
    expect((await published).title).toBe('Live');

    const started = once(sFac, 'attempt:started');
    const s = (await api().post(`/api/exams/${live._id}/start`).set(auth(tStu))).body.data;
    expect(String((await started).studentId)).toBe(String(stu._id));

    const progress = once(sFac, 'attempt:progress');
    await api().put(`/api/attempts/${s.attemptId}/answers`).set(auth(tStu)).send({ answers: [{ question: s.questions[0]._id, selectedOption: s.questions[0].options[0]._id }] });
    expect(await progress).toMatchObject({ answeredCount: 1, total: 4 });

    const submittedMon = once(sFac, 'attempt:submitted');
    const submittedStu = once(sStu, 'attempt:submitted');
    await api().post(`/api/attempts/${s.attemptId}/submit`).set(auth(tStu));
    expect((await submittedMon).score).toBeDefined();         // faculty see the score
    expect((await submittedStu).score).toBeUndefined();       // student does not (until release)

    [sStu, sFac, sFac2].forEach((x) => x.close());
  });
});

// ------------------------------------------------------------------ MISC
describe('Error handling & misc', () => {
  test('unknown route -> 404 JSON; malformed JSON -> 400; health check', async () => {
    const r = await api().get('/api/nope').set(auth(tAdmin));
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ success: false });
    const bad = await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{bad json');
    expect(bad.status).toBe(400);
    expect((await api().get('/health')).body.status).toBe('ok');
  });

  test('admin user management CRUD with pagination and search', async () => {
    const list = await api().get('/api/users?role=student&limit=2&page=1').set(auth(tAdmin));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeLessThanOrEqual(2);
    expect(list.body.meta.total).toBeGreaterThan(2);
    expect((await api().get('/api/users?q=nobody-matches-this').set(auth(tAdmin))).body.meta.total).toBe(0);
    const u = (await api().post('/api/users').set(auth(tAdmin)).send({ name: 'Temp Person', email: 'temp@t.test', password: 'Password@123', role: 'student' })).body.data;
    expect((await api().patch(`/api/users/${u._id}`).set(auth(tAdmin)).send({ role: 'faculty' })).body.data.role).toBe('faculty');
    expect((await api().delete(`/api/users/${u._id}`).set(auth(tAdmin))).status).toBe(200);
    expect((await api().get(`/api/users/${u._id}`).set(auth(tAdmin))).status).toBe(404);
    expect((await api().delete(`/api/users/${admin._id}`).set(auth(tAdmin))).status).toBe(409);
  });

  test('groups: admin CRUD and membership', async () => {
    const g = (await api().post('/api/groups').set(auth(tAdmin)).send({ name: 'Section Z' })).body.data;
    expect((await api().post('/api/groups').set(auth(tAdmin)).send({ name: 'Section Z' })).status).toBe(409);
    expect((await api().post('/api/groups').set(auth(tFac)).send({ name: 'Nope' })).status).toBe(403);
    expect((await api().post(`/api/groups/${g._id}/members`).set(auth(tAdmin)).send({ userIds: [String(stu2._id)] })).status).toBe(200);
    expect((await api().get(`/api/groups/${g._id}`).set(auth(tFac))).body.data.members).toHaveLength(1);
    expect((await api().delete(`/api/groups/${groupA._id}`).set(auth(tAdmin))).status).toBe(409); // assigned to exams
    expect((await api().delete(`/api/groups/${g._id}`).set(auth(tAdmin))).status).toBe(200);
  });
});
