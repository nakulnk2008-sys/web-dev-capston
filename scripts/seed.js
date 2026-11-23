/**
 * Seed script: node scripts/seed.js   (npm run seed)
 * WARNING: clears all collections of the configured database, then inserts demo data.
 * Demo password for every account: Password@123
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const { connectDB } = require('../src/config/db');
const User = require('../src/models/User');
const Group = require('../src/models/Group');
const Question = require('../src/models/Question');
const Exam = require('../src/models/Exam');
const Attempt = require('../src/models/Attempt');
const AuditLog = require('../src/models/AuditLog');
const RefreshToken = require('../src/models/RefreshToken');
const { buildQuestionSet, evaluate } = require('../src/services/attemptService');

const PASSWORD = 'Password@123';
const min = (n) => new Date(Date.now() + n * 60000);

// [text, [options...], correctIndex, topic, difficulty, marks]
const BANK = [
  ['Which module is used to create an HTTP server in Node.js?', ['http', 'fs', 'path', 'os'], 0, 'Node.js Basics', 'easy', 1],
  ['Which command initialises a new npm project with defaults?', ['npm init -y', 'npm start', 'npm new', 'npm create-app'], 0, 'Node.js Basics', 'easy', 1],
  ['Which global object exposes environment variables in Node.js?', ['process.env', 'global.env', 'os.env', 'require.env'], 0, 'Node.js Basics', 'easy', 1],
  ['Which class is used to build custom events in Node.js?', ['EventEmitter', 'Stream', 'Buffer', 'Timer'], 0, 'Node.js Basics', 'medium', 1],
  ['Which Express method registers middleware for all HTTP methods?', ['app.use()', 'app.get()', 'app.listen()', 'app.route()'], 0, 'Express.js', 'easy', 1],
  ['An Express error-handling middleware has how many parameters?', ['4', '2', '3', '1'], 0, 'Express.js', 'medium', 2],
  ['Which HTTP status code means "Created"?', ['201', '200', '204', '202'], 0, 'Express.js', 'easy', 1],
  ['Which HTTP status code is returned for an unauthenticated request?', ['401', '403', '404', '409'], 0, 'Express.js', 'easy', 1],
  ['In MVC, which component contains the business/request logic?', ['Controller', 'Model schema', 'View template', 'Router table'], 0, 'Express.js', 'medium', 2],
  ['Which Mongoose method defines a document structure?', ['new Schema()', 'new Router()', 'new Model()', 'new Store()'], 0, 'MongoDB & Mongoose', 'easy', 1],
  ['Which aggregation stage groups documents by a key?', ['$group', '$match', '$limit', '$skip'], 0, 'MongoDB & Mongoose', 'medium', 2],
  ['Which aggregation stage filters documents early in a pipeline?', ['$match', '$unwind', '$lookup', '$project'], 0, 'MongoDB & Mongoose', 'medium', 2],
  ['What does an index on a field primarily improve?', ['Query speed', 'Write speed', 'Disk usage', 'Network latency'], 0, 'MongoDB & Mongoose', 'medium', 1],
  ['Which operator performs a left outer join in aggregation?', ['$lookup', '$merge', '$bucket', '$facet'], 0, 'MongoDB & Mongoose', 'hard', 2],
  ['Which library is commonly used to hash passwords in Node.js?', ['bcrypt', 'jsonwebtoken', 'cors', 'morgan'], 0, 'Security', 'easy', 1],
  ['A JWT consists of how many dot-separated parts?', ['3', '2', '4', '5'], 0, 'Security', 'medium', 1],
  ['Why are refresh tokens used alongside short-lived access tokens?', ['To get new access tokens without re-login', 'To encrypt passwords', 'To speed up queries', 'To enable CORS'], 0, 'Security', 'medium', 2],
  ['RBAC stands for?', ['Role-Based Access Control', 'Rule-Based API Control', 'Remote Backend Access Cache', 'Role-Bound Auth Cookie'], 0, 'Security', 'easy', 1],
  ['Which library provides real-time bidirectional communication in Node.js?', ['Socket.IO', 'Mongoose', 'dotenv', 'bcrypt'], 0, 'Real-time', 'easy', 1],
  ['In Socket.IO, what groups sockets so you can broadcast to them together?', ['Rooms', 'Schemas', 'Routers', 'Pipes'], 0, 'Real-time', 'medium', 2],
];

async function main() {
  await connectDB();
  await Promise.all([User, Group, Question, Exam, Attempt, AuditLog, RefreshToken].map((m) => m.deleteMany({})));
  await Promise.all([User, Group, Question, Exam, Attempt, AuditLog, RefreshToken].map((m) => m.init()));

  const [secA, secB] = await Group.create([{ name: 'CSE-A', description: 'Computer Science Section A' }, { name: 'CSE-B', description: 'Computer Science Section B' }]);

  const admin = await User.create({ name: 'Ada Admin', email: 'admin@exam.test', password: PASSWORD, role: 'admin' });
  const f1 = await User.create({ name: 'Prof. Rao', email: 'faculty1@exam.test', password: PASSWORD, role: 'faculty' });
  const f2 = await User.create({ name: 'Prof. Iyer', email: 'faculty2@exam.test', password: PASSWORD, role: 'faculty' });
  const studentNames = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Sana', 'Vikram', 'Zoya'];
  const students = [];
  for (let i = 0; i < studentNames.length; i++) {
    students.push(await User.create({
      name: studentNames[i], email: `student${i + 1}@exam.test`, password: PASSWORD, role: 'student',
      rollNumber: `CSE${100 + i}`, groups: [i < 4 ? secA._id : secB._id],
    }));
  }

  const questions = await Question.create(BANK.map(([text, opts, ci, topic, difficulty, marks]) => ({
    text, topic, difficulty, marks, subject: 'Backend Development', createdBy: f1._id,
    options: opts.map((t, i) => ({ text: t, isCorrect: i === ci })),
  })));

  // 1) Open exam now (students can start immediately)
  const openExam = await Exam.create({
    title: 'Backend Development - Unit Test 1 (LIVE)', instructions: 'Single correct answer per question. Negative marking: 25%.',
    durationMinutes: 20, startTime: min(-60), endTime: min(60 * 24), createdBy: f1._id,
    questions: questions.map((q) => q._id), selection: { questionCount: 10, shuffleQuestions: true, shuffleOptions: true },
    assignedGroups: [secA._id, secB._id], negativeMarking: 0.25, maxAttempts: 1, status: 'published',
  });

  // 2) Finished exam with released results + attempts (for analytics demo)
  const pastExam = await Exam.create({
    title: 'Node.js & Express Quiz (COMPLETED)', durationMinutes: 15, startTime: min(-2880), endTime: min(-2700), createdBy: f1._id,
    questions: questions.slice(0, 9).map((q) => q._id), assignedGroups: [secA._id, secB._id], maxAttempts: 1,
    status: 'published', resultsReleased: true, showCorrectAnswers: true,
  });
  const pool = await Question.find({ _id: { $in: pastExam.questions } });
  for (let i = 0; i < students.length; i++) {
    const set = await buildQuestionSet(pastExam);
    // student i answers first (3 + i) questions correctly, the rest wrong
    const answers = set.map((aq, idx) => {
      const q = pool.find((p) => String(p._id) === String(aq.question));
      const correct = q.options.find((o) => o.isCorrect)._id;
      const wrong = q.options.find((o) => !o.isCorrect)._id;
      return { question: aq.question, selectedOption: idx < 3 + i ? correct : wrong, answeredAt: min(-2800) };
    });
    const att = new Attempt({ exam: pastExam._id, student: students[i]._id, attemptNumber: 1, questions: set, answers,
      startedAt: min(-2800), deadline: min(-2785), submittedAt: min(-2790), status: 'submitted' });
    Object.assign(att, await evaluate(att, 0));
    await att.save();
  }

  // 3) Draft exam (not yet published)
  await Exam.create({
    title: 'Security & Real-time Quiz (DRAFT)', durationMinutes: 30, startTime: min(60 * 48), endTime: min(60 * 49), createdBy: f1._id,
    questions: questions.slice(14).map((q) => q._id), assignedStudents: students.slice(0, 3).map((s) => s._id), status: 'draft',
  });

  console.log('Seed complete.\n');
  console.log(`Password for all accounts: ${PASSWORD}`);
  console.log('admin@exam.test | faculty1@exam.test (owns the demo exams) | faculty2@exam.test | student1..8@exam.test');
  console.log(`LIVE exam id (students can start): ${openExam._id}`);
  console.log(`COMPLETED exam id (results released): ${pastExam._id}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
