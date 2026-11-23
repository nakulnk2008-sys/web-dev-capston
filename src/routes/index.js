const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const v = require('../validators');
const env = require('../config/env');

const auth = require('../controllers/authController');
const users = require('../controllers/userController');
const groups = require('../controllers/groupController');
const questions = require('../controllers/questionController');
const exams = require('../controllers/examController');
const attempts = require('../controllers/attemptController');
const reports = require('../controllers/reportController');

const ADMIN = 'admin', FACULTY = 'faculty', STUDENT = 'student';
const staff = authorize(FACULTY, ADMIN);

// --- Auth (public) ---
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: env.nodeEnv === 'test' ? 10000 : 100,
  standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many requests, try again later' } });
router.post('/auth/register', authLimiter, v.register, validate, auth.register);
router.post('/auth/login', authLimiter, v.login, validate, auth.login);
router.post('/auth/refresh', authLimiter, v.refreshBody, validate, auth.refresh);
router.post('/auth/logout', v.refreshBody, validate, auth.logout);
router.post('/auth/logout-all', authenticate, auth.logoutAll);

// Everything below requires a valid access token
router.use(authenticate);

// --- Users ---
router.get('/users/me', users.getMe);
router.patch('/users/me', v.updateMe, validate, users.updateMe);
router.get('/users', authorize(ADMIN, FACULTY), v.listUsers, validate, users.listUsers);
router.post('/users', authorize(ADMIN), v.createUser, validate, users.createUser);
router.get('/users/:id', authorize(ADMIN), v.id, validate, users.getUser);
router.patch('/users/:id', authorize(ADMIN), v.updateUser, validate, users.updateUser);
router.delete('/users/:id', authorize(ADMIN), v.id, validate, users.deleteUser);

// --- Groups (academic sections) ---
router.get('/groups', staff, groups.list);
router.post('/groups', authorize(ADMIN), v.group, validate, groups.create);
router.get('/groups/:id', staff, v.id, validate, groups.get);
router.patch('/groups/:id', authorize(ADMIN), v.groupUpdate, validate, groups.update);
router.delete('/groups/:id', authorize(ADMIN), v.id, validate, groups.remove);
router.post('/groups/:id/members', authorize(ADMIN), v.groupMembers, validate, groups.addMembers);
router.delete('/groups/:id/members/:userId', authorize(ADMIN), v.groupMember, validate, groups.removeMember);

// --- Question bank (faculty/admin only: students never reach these routes) ---
router.get('/questions', staff, v.questionList, validate, questions.list);
router.post('/questions', staff, v.questionCreate, validate, questions.create);
router.get('/questions/:id', staff, v.id, validate, questions.get);
router.patch('/questions/:id', staff, v.questionUpdate, validate, questions.update);
router.delete('/questions/:id', staff, v.id, validate, questions.remove);

// --- Exams ---
router.get('/exams/assigned', authorize(STUDENT), exams.listAssigned);
router.get('/exams', staff, v.examList, validate, exams.list);
router.post('/exams', staff, v.examCreate, validate, exams.create);
router.get('/exams/:id', v.id, validate, exams.get); // role-aware: students get a safe subset
router.patch('/exams/:id', staff, v.examUpdate, validate, exams.update);
router.delete('/exams/:id', staff, v.id, validate, exams.remove);
router.post('/exams/:id/publish', staff, v.id, validate, exams.publish);
router.post('/exams/:id/release-results', staff, v.id, validate, exams.releaseResults);
router.get('/exams/:id/attempts', staff, v.id, validate, exams.listAttempts);
router.get('/exams/:id/results', staff, v.id, validate, exams.results);
router.get('/exams/:id/analytics', staff, v.id, validate, exams.analytics);
router.get('/exams/:id/audit-log', staff, v.id, validate, exams.auditLog);
router.post('/exams/:id/start', authorize(STUDENT), v.id, validate, attempts.start);

// --- Attempts ---
router.get('/attempts/mine', authorize(STUDENT), attempts.mine);
router.get('/attempts/:id', v.id, validate, attempts.get);
router.put('/attempts/:id/answers', authorize(STUDENT), v.answers, validate, attempts.saveAnswers);
router.post('/attempts/:id/submit', authorize(STUDENT), v.submit, validate, attempts.submit);

// --- Reports ---
router.get('/reports/students/:studentId/performance', v.studentId, validate, reports.studentPerformance);
router.get('/reports/platform', authorize(ADMIN), reports.platform);

module.exports = router;
