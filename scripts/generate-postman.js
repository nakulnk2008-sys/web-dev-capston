/**
 * Generates postman/Exam_System.postman_collection.json
 * Run order matters (it is a workflow): npm run seed  ->  npm start  ->  run the collection (Postman Runner / newman).
 */
const fs = require('fs');
const path = require('path');

const item = (name, method, url, { token, body, tests = [], save = '', desc } = {}) => {
  const header = [];
  if (body !== undefined) header.push({ key: 'Content-Type', value: 'application/json' });
  if (token) header.push({ key: 'Authorization', value: `Bearer {{${token}}}` });
  const exec = [...tests, ...(save ? [save] : [])];
  return {
    name,
    request: {
      method, header, description: desc,
      url: { raw: `{{baseUrl}}${url}`, host: ['{{baseUrl}}'], path: url.replace(/\?.*/, '').split('/').filter(Boolean),
        query: url.includes('?') ? url.split('?')[1].split('&').map((p) => ({ key: p.split('=')[0], value: p.split('=')[1] })) : undefined },
      body: body !== undefined ? { mode: 'raw', raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } } : undefined,
    },
    event: [{ listen: 'test', script: { type: 'text/javascript', exec } }],
  };
};
const status = (code, label) => `pm.test("${label || 'Status is ' + code}", () => pm.response.to.have.status(${code}));`;
const set = (v, expr) => `pm.collectionVariables.set("${v}", ${expr});`;
const json = 'pm.response.json()';

const folders = [];
const add = (name, items) => folders.push({ name, item: items });

add('1. Authentication', [
  item('Login - admin (200)', 'POST', '/api/auth/login', { body: { email: 'admin@exam.test', password: 'Password@123' },
    tests: [status(200)], save: set('adminToken', `${json}.data.accessToken`) }),
  item('Login - faculty (200)', 'POST', '/api/auth/login', { body: { email: 'faculty1@exam.test', password: 'Password@123' },
    tests: [status(200)], save: set('facultyToken', `${json}.data.accessToken`) }),
  item('Login - faculty 2 (200)', 'POST', '/api/auth/login', { body: { email: 'faculty2@exam.test', password: 'Password@123' },
    tests: [status(200)], save: set('faculty2Token', `${json}.data.accessToken`) }),
  item('Login - student1 CSE-A (200)', 'POST', '/api/auth/login', { body: { email: 'student1@exam.test', password: 'Password@123' },
    tests: [status(200), 'pm.test("returns access + refresh token", () => { const d = pm.response.json().data; pm.expect(d.accessToken).to.be.a("string"); pm.expect(d.refreshToken).to.be.a("string"); });'],
    save: [set('studentToken', `${json}.data.accessToken`), set('studentRefresh', `${json}.data.refreshToken`), set('student1Id', `${json}.data.user._id`)].join('\n') }),
  item('Login - student5 CSE-B (200)', 'POST', '/api/auth/login', { body: { email: 'student5@exam.test', password: 'Password@123' },
    tests: [status(200)], save: set('student5Token', `${json}.data.accessToken`) }),
  item('Login - wrong password (401)', 'POST', '/api/auth/login', { body: { email: 'student1@exam.test', password: 'wrong' }, tests: [status(401)] }),
  item('Register - validation failure (400)', 'POST', '/api/auth/register', { body: { name: 'x', email: 'not-an-email', password: '1' },
    tests: [status(400), 'pm.test("field errors listed", () => pm.expect(pm.response.json().errors.length).to.be.above(0));'] }),
  item('Register - new student (201)', 'POST', '/api/auth/register', {
    body: '{"name":"Postman Student","email":"pm.{{$timestamp}}@exam.test","password":"Password@123","role":"admin"}',
    tests: [status(201), 'pm.test("role forced to student", () => pm.expect(pm.response.json().data.user.role).to.eql("student"));'] }),
  item('Get profile - no token (401)', 'GET', '/api/users/me', { tests: [status(401)] }),
  item('Get profile - student (200)', 'GET', '/api/users/me', { token: 'studentToken', tests: [status(200)] }),
  item('Refresh token (200) - rotates', 'POST', '/api/auth/refresh', { body: '{"refreshToken":"{{studentRefresh}}"}',
    tests: [status(200)], save: set('studentRefreshNew', `${json}.data.refreshToken`) }),
  item('Refresh with spent token (401) - reuse detected', 'POST', '/api/auth/refresh', { body: '{"refreshToken":"{{studentRefresh}}"}', tests: [status(401)] }),
  item('Logout (200)', 'POST', '/api/auth/logout', { body: '{"refreshToken":"{{studentRefreshNew}}"}', tests: [status(200)] }),
  item('Student calls admin route (403)', 'POST', '/api/users', { token: 'studentToken',
    body: { name: 'Nope Nope', email: 'nope@exam.test', password: 'Password@123', role: 'admin' }, tests: [status(403)] }),
  item('Admin creates faculty (201)', 'POST', '/api/users', { token: 'adminToken',
    body: '{"name":"Created Faculty","email":"cf.{{$timestamp}}@exam.test","password":"Password@123","role":"faculty"}', tests: [status(201)] }),
]);

add('2. Groups', [
  item('List groups (200)', 'GET', '/api/groups', { token: 'facultyToken', tests: [status(200)],
    save: `const g = pm.response.json().data.find(x => x.name === "CSE-A"); ${set('groupAId', 'g._id')}` }),
  item('Student lists groups (403)', 'GET', '/api/groups', { token: 'studentToken', tests: [status(403)] }),
  item('Create group - faculty (403)', 'POST', '/api/groups', { token: 'facultyToken', body: { name: 'Hack' }, tests: [status(403)] }),
  item('Create group - duplicate name (409)', 'POST', '/api/groups', { token: 'adminToken', body: { name: 'CSE-A' }, tests: [status(409)] }),
]);

const q = (text, correct, extra = {}) => ({ text, subject: 'Postman', topic: 'Demo', difficulty: 'easy', marks: 2, ...extra,
  options: ['A', 'B', 'C'].map((t, i) => ({ text: `Option ${t}`, isCorrect: i === correct })) });
add('3. Question Bank', [
  item('Create question 1 (201)', 'POST', '/api/questions', { token: 'facultyToken', body: q('Postman question one?', 0),
    tests: [status(201)], save: set('q1', `${json}.data._id`) }),
  item('Create question 2 (201)', 'POST', '/api/questions', { token: 'facultyToken', body: q('Postman question two?', 1),
    tests: [status(201)], save: set('q2', `${json}.data._id`) }),
  item('Create question - no correct option (400)', 'POST', '/api/questions', { token: 'facultyToken', body: q('Invalid question?', 5), tests: [status(400)] }),
  item('Create question - missing fields (400)', 'POST', '/api/questions', { token: 'facultyToken', body: { text: 'hi' }, tests: [status(400)] }),
  item('Create question - student (403)', 'POST', '/api/questions', { token: 'studentToken', body: q('Student tries?', 0), tests: [status(403)] }),
  item('Create question - no token (401)', 'POST', '/api/questions', { body: q('Anon tries?', 0), tests: [status(401)] }),
  item('List + filter + paginate (200)', 'GET', '/api/questions?topic=Demo&difficulty=easy&page=1&limit=5', { token: 'facultyToken',
    tests: [status(200), 'pm.test("pagination meta", () => pm.expect(pm.response.json().meta).to.have.property("totalPages"));'] }),
  item('Get question - not found (404)', 'GET', '/api/questions/64b64b64b64b64b64b64b64b', { token: 'facultyToken', tests: [status(404)] }),
  item('Get question - invalid id (400)', 'GET', '/api/questions/abc', { token: 'facultyToken', tests: [status(400)] }),
  item('Edit another faculty\'s question (403)', 'PATCH', '/api/questions/{{q1}}', { token: 'faculty2Token', body: { marks: 5 }, tests: [status(403)] }),
  item('Student cannot read answer key via question API (403)', 'GET', '/api/questions/{{q1}}', { token: 'studentToken', tests: [status(403)] }),
]);

const win = (a, b) => `{"title":"Postman Exam","durationMinutes":20,"startTime":"{{startIso}}","endTime":"{{endIso}}","questions":["{{q1}}","{{q2}}"],"assignedGroups":["{{groupAId}}"],"negativeMarking":0.5}`;
add('4. Exam creation & publishing', [
  item('Create exam - end before start (400)', 'POST', '/api/exams', { token: 'facultyToken',
    body: `{"title":"Bad Exam","durationMinutes":20,"startTime":"2030-01-02T10:00:00Z","endTime":"2030-01-02T09:00:00Z"}`, tests: [status(400)] }),
  item('Create exam (201, draft)', 'POST', '/api/exams', { token: 'facultyToken', body: win(),
    tests: [status(201), 'pm.test("starts as draft", () => pm.expect(pm.response.json().data.status).to.eql("draft"));'], save: set('examId', `${json}.data._id`),
    desc: 'Pre-request sets startIso/endIso relative to now.' }),
  item('Publish exam - not owner (403)', 'POST', '/api/exams/{{examId}}/publish', { token: 'faculty2Token', tests: [status(403)] }),
  item('Publish exam (200)', 'POST', '/api/exams/{{examId}}/publish', { token: 'facultyToken', tests: [status(200)] }),
  item('Publish again (409)', 'POST', '/api/exams/{{examId}}/publish', { token: 'facultyToken', tests: [status(409)] }),
  item('Edit published exam (409)', 'PATCH', '/api/exams/{{examId}}', { token: 'facultyToken', body: { title: 'Changed' }, tests: [status(409)] }),
  item('Delete question used in published exam (409)', 'DELETE', '/api/questions/{{q1}}', { token: 'facultyToken', tests: [status(409)] }),
]);

add('5. Student attempt flow', [
  item('Not-assigned student (CSE-B) cannot start (403)', 'POST', '/api/exams/{{examId}}/start', { token: 'student5Token', tests: [status(403)] }),
  item('Assigned exams list (200)', 'GET', '/api/exams/assigned', { token: 'studentToken',
    tests: [status(200), 'pm.test("exam listed, no questions leaked", () => { const e = pm.response.json().data.find(x => x._id === pm.collectionVariables.get("examId")); pm.expect(e).to.exist; pm.expect(e.questions).to.be.undefined; });'] }),
  item('Start attempt (201) - no answer key in payload', 'POST', '/api/exams/{{examId}}/start', { token: 'studentToken',
    tests: [status(201), 'pm.test("answer key never returned", () => pm.expect(pm.response.text()).to.not.match(/isCorrect|correctOption/));'],
    save: ['const d = pm.response.json().data;', set('attemptId', 'd.attemptId'), set('aq1', 'd.questions[0]._id'), set('ao1', 'd.questions[0].options[0]._id'),
      set('aq2', 'd.questions[1]._id'), set('ao2', 'd.questions[1].options[0]._id')].join('\n') }),
  item('Start again - resumes same attempt (200)', 'POST', '/api/exams/{{examId}}/start', { token: 'studentToken',
    tests: [status(200), 'pm.test("same attempt", () => pm.expect(pm.response.json().data.attemptId).to.eql(pm.collectionVariables.get("attemptId")));'] }),
  item('Other student reads attempt (404)', 'GET', '/api/attempts/{{attemptId}}', { token: 'student5Token', tests: [status(404)] }),
  item('Save answers - option from other question (400)', 'PUT', '/api/attempts/{{attemptId}}/answers', { token: 'studentToken',
    body: '{"answers":[{"question":"{{aq1}}","selectedOption":"{{ao2}}"}]}', tests: [status(400)] }),
  item('Save answers - bad payload (400)', 'PUT', '/api/attempts/{{attemptId}}/answers', { token: 'studentToken', body: { answers: [] }, tests: [status(400)] }),
  item('Save answers (200)', 'PUT', '/api/attempts/{{attemptId}}/answers', { token: 'studentToken',
    body: '{"answers":[{"question":"{{aq1}}","selectedOption":"{{ao1}}"}]}', tests: [status(200)] }),
  item('Submit - client-sent score is ignored (200)', 'POST', '/api/attempts/{{attemptId}}/submit', { token: 'studentToken',
    body: '{"answers":[{"question":"{{aq1}}","selectedOption":"{{ao1}}"},{"question":"{{aq2}}","selectedOption":"{{ao2}}"}],"score":999}',
    tests: [status(200), 'pm.test("no marks in response", () => pm.expect(pm.response.json().data.score).to.be.undefined);'] }),
  item('Submit again (409)', 'POST', '/api/attempts/{{attemptId}}/submit', { token: 'studentToken', tests: [status(409)] }),
  item('Start second attempt on single-attempt exam (409)', 'POST', '/api/exams/{{examId}}/start', { token: 'studentToken', tests: [status(409)] }),
  item('Result hidden until released (200)', 'GET', '/api/attempts/{{attemptId}}', { token: 'studentToken',
    tests: [status(200), 'pm.test("results not released", () => { const d = pm.response.json().data; pm.expect(d.resultsReleased).to.eql(false); pm.expect(d.score).to.be.undefined; });'] }),
]);

add('6. Results, analytics & reports', [
  item('Find seeded COMPLETED exam (200)', 'GET', '/api/exams?status=published&limit=50', { token: 'facultyToken', tests: [status(200)],
    save: `const e = pm.response.json().data.find(x => x.title.includes("COMPLETED")); ${set('completedExamId', 'e._id')}` }),
  item('Release results while exam is open (409)', 'POST', '/api/exams/{{examId}}/release-results', { token: 'facultyToken', tests: [status(409)] }),
  item('Faculty results list (200)', 'GET', '/api/exams/{{examId}}/results', { token: 'facultyToken', tests: [status(200)] }),
  item('Student views exam results (403)', 'GET', '/api/exams/{{examId}}/results', { token: 'studentToken', tests: [status(403)] }),
  item('Other faculty views results (403)', 'GET', '/api/exams/{{examId}}/results', { token: 'faculty2Token', tests: [status(403)] }),
  item('Live attempts list (200)', 'GET', '/api/exams/{{examId}}/attempts?status=submitted', { token: 'facultyToken', tests: [status(200)] }),
  item('Audit log (200)', 'GET', '/api/exams/{{examId}}/audit-log', { token: 'facultyToken',
    tests: [status(200), 'pm.test("events logged", () => pm.expect(pm.response.json().data.map(a => a.action)).to.include.members(["exam.published","attempt.started","attempt.submitted"]));'] }),
  item('Analytics on seeded COMPLETED exam (200)', 'GET', '/api/exams/{{completedExamId}}/analytics', { token: 'facultyToken',
    tests: [status(200), 'pm.test("aggregations present", () => { const d = pm.response.json().data; pm.expect(d.summary.students).to.eql(8); pm.expect(d.questionWise.length).to.be.above(0); pm.expect(d.sectionWise.length).to.eql(2); });'] }),
  item('Student performance - own (200)', 'GET', '/api/reports/students/{{student1Id}}/performance', { token: 'studentToken', tests: [status(200)] }),
  item('Student performance - someone else (403)', 'GET', '/api/reports/students/{{student1Id}}/performance', { token: 'student5Token', tests: [status(403)] }),
  item('Platform report - admin (200)', 'GET', '/api/reports/platform', { token: 'adminToken', tests: [status(200)] }),
  item('Platform report - faculty (403)', 'GET', '/api/reports/platform', { token: 'facultyToken', tests: [status(403)] }),
  item('Unknown route (404)', 'GET', '/api/does-not-exist', { token: 'adminToken', tests: [status(404)] }),
]);

// collection-level pre-request: compute exam window relative to "now" so the collection can be re-run any time
const prereq = [
  'if (!pm.collectionVariables.get("startIso") || pm.info.requestName === "Create exam (201, draft)") {',
  '  pm.collectionVariables.set("startIso", new Date(Date.now() - 5*60000).toISOString());',
  '  pm.collectionVariables.set("endIso", new Date(Date.now() + 120*60000).toISOString());',
  '}',
];

const collection = {
  info: { name: 'Online Examination System API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    description: 'Run order: `npm run seed`, `npm start`, then run this collection top to bottom (Runner / newman).' },
  item: folders,
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: prereq } }],
  variable: [
    { key: 'baseUrl', value: 'http://localhost:5000' },
    { key: 'completedExamId', value: '' },
    { key: 'startIso', value: '' },
    { key: 'endIso', value: '' },
  ],
};

fs.mkdirSync(path.join(__dirname, '..', 'postman'), { recursive: true });
const out = path.join(__dirname, '..', 'postman', 'Exam_System.postman_collection.json');
fs.writeFileSync(out, JSON.stringify(collection, null, 2));
console.log('Wrote', out);
