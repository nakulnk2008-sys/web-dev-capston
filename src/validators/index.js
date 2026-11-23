const { body, param, query } = require('express-validator');

const mongoId = (field, where = param) => where(field).isMongoId().withMessage(`${field} must be a valid id`);
const idList = (field, { optional = true } = {}) => {
  const c = body(field);
  return (optional ? c.optional() : c).isArray().withMessage(`${field} must be an array`).bail()
    .custom((arr) => arr.every((v) => /^[a-f\d]{24}$/i.test(String(v)))).withMessage(`${field} must contain valid ids`);
};
const email = body('email').isEmail().withMessage('Valid email is required').normalizeEmail({ gmail_remove_dots: false });
const password = body('password').isString().isLength({ min: 8, max: 72 }).withMessage('Password must be 8-72 characters');

exports.id = [mongoId('id')];
exports.studentId = [mongoId('studentId')];

exports.register = [
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Name must be 2-80 characters'),
  email, password,
  body('rollNumber').optional().isString().trim().isLength({ max: 30 }),
];
exports.login = [email, body('password').isString().notEmpty().withMessage('Password is required')];
exports.refreshBody = [body('refreshToken').isString().notEmpty().withMessage('refreshToken is required')];

exports.updateMe = [
  body('name').optional().trim().isLength({ min: 2, max: 80 }),
  body('rollNumber').optional().isString().trim().isLength({ max: 30 }),
  body('newPassword').optional().isLength({ min: 8, max: 72 }).withMessage('New password must be 8-72 characters'),
  body('currentPassword').if(body('newPassword').exists()).notEmpty().withMessage('currentPassword is required to set a new password'),
];
exports.createUser = [
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Name must be 2-80 characters'),
  email, password,
  body('role').isIn(['admin', 'faculty', 'student']).withMessage('role must be admin, faculty or student'),
  idList('groups'),
  body('rollNumber').optional().isString().trim().isLength({ max: 30 }),
];
exports.updateUser = [
  mongoId('id'),
  body('name').optional().trim().isLength({ min: 2, max: 80 }),
  body('role').optional().isIn(['admin', 'faculty', 'student']),
  body('isActive').optional().isBoolean().toBoolean(),
  idList('groups'),
  body('rollNumber').optional().isString().trim().isLength({ max: 30 }),
];
exports.listUsers = [
  query('role').optional().isIn(['admin', 'faculty', 'student']),
  query('group').optional().isMongoId(),
];

exports.group = [
  body('name').trim().isLength({ min: 1, max: 80 }).withMessage('Name is required (max 80 chars)'),
  body('description').optional().isString().isLength({ max: 300 }),
];
exports.groupUpdate = [mongoId('id'), body('name').optional().trim().isLength({ min: 1, max: 80 }), body('description').optional().isString().isLength({ max: 300 })];
exports.groupMembers = [mongoId('id'), idList('userIds', { optional: false })];
exports.groupMember = [mongoId('id'), mongoId('userId')];

const questionBody = (optional) => {
  const o = (c) => (optional ? c.optional() : c);
  return [
    o(body('text')).isString().trim().isLength({ min: 3, max: 2000 }).withMessage('text must be 3-2000 characters'),
    o(body('options')).isArray({ min: 2, max: 6 }).withMessage('options must be an array of 2-6 items'),
    body('options.*.text').if(body('options').exists()).isString().trim().notEmpty().withMessage('Each option needs text'),
    body('options.*.isCorrect').if(body('options').exists()).optional().isBoolean().withMessage('isCorrect must be boolean'),
    o(body('subject')).isString().trim().notEmpty().withMessage('subject is required'),
    o(body('topic')).isString().trim().notEmpty().withMessage('topic is required'),
    body('marks').optional().isFloat({ min: 0.25, max: 100 }).withMessage('marks must be between 0.25 and 100'),
    body('difficulty').optional().isIn(['easy', 'medium', 'hard']).withMessage('difficulty must be easy, medium or hard'),
  ];
};
exports.questionCreate = questionBody(false);
exports.questionUpdate = [mongoId('id'), ...questionBody(true)];
exports.questionList = [
  query('difficulty').optional().isIn(['easy', 'medium', 'hard']),
];

const examBody = (optional) => {
  const o = (c) => (optional ? c.optional() : c);
  return [
    o(body('title')).isString().trim().isLength({ min: 3, max: 150 }).withMessage('title must be 3-150 characters'),
    body('instructions').optional().isString().isLength({ max: 3000 }),
    o(body('durationMinutes')).isInt({ min: 1, max: 600 }).withMessage('durationMinutes must be 1-600').toInt(),
    o(body('startTime')).isISO8601().withMessage('startTime must be an ISO-8601 date').toDate(),
    o(body('endTime')).isISO8601().withMessage('endTime must be an ISO-8601 date').toDate(),
    idList('questions'), idList('assignedStudents'), idList('assignedGroups'),
    body('selection.questionCount').optional().isInt({ min: 1 }).toInt(),
    body('selection.shuffleQuestions').optional().isBoolean().toBoolean(),
    body('selection.shuffleOptions').optional().isBoolean().toBoolean(),
    body('negativeMarking').optional().isFloat({ min: 0, max: 1 }).withMessage('negativeMarking must be between 0 and 1'),
    body('maxAttempts').optional().isInt({ min: 1, max: 5 }).toInt(),
    body('showCorrectAnswers').optional().isBoolean().toBoolean(),
  ];
};
exports.examCreate = examBody(false);
exports.examUpdate = [mongoId('id'), ...examBody(true)];
exports.examList = [query('status').optional().isIn(['draft', 'published'])];

exports.answers = [
  mongoId('id'),
  body('answers').isArray({ min: 1, max: 500 }).withMessage('answers must be a non-empty array'),
  body('answers.*.question').isMongoId().withMessage('answers[].question must be a valid id'),
  body('answers.*.selectedOption').isMongoId().withMessage('answers[].selectedOption must be a valid id'),
];
exports.submit = [
  mongoId('id'),
  body('answers').optional().isArray({ max: 500 }),
  body('answers.*.question').optional().isMongoId(),
  body('answers.*.selectedOption').optional().isMongoId(),
];
