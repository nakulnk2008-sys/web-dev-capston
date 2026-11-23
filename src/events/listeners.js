const bus = require('./appEvents');
const AuditLog = require('../models/AuditLog');
const socket = require('../sockets');

const safe = (fn) => async (payload) => {
  try {
    await fn(payload);
  } catch (err) {
    // Side-effects must never break the request that triggered them
    console.error('[event listener error]', err.message);
  }
};

const audit = (action, doc) => AuditLog.create({ action, ...doc });

function register() {
  bus.on('exam.published', safe(async ({ exam, actorId, studentIds }) => {
    await audit('exam.published', { actor: actorId, exam: exam._id, meta: { assigned: studentIds.length } });
    studentIds.forEach((id) =>
      socket.emitToUser(id, 'exam:published', {
        examId: exam._id, title: exam.title, startTime: exam.startTime, endTime: exam.endTime,
      })
    );
  }));

  bus.on('attempt.started', safe(async ({ attempt, exam }) => {
    await audit('attempt.started', { actor: attempt.student, exam: exam._id, attempt: attempt._id, meta: { attemptNumber: attempt.attemptNumber, deadline: attempt.deadline } });
    socket.emitToMonitor(exam._id, 'attempt:started', {
      attemptId: attempt._id, studentId: attempt.student, startedAt: attempt.startedAt, deadline: attempt.deadline,
    });
  }));

  bus.on('attempt.answered', safe(async ({ attemptId, examId, studentId, answeredCount, total }) => {
    socket.emitToMonitor(examId, 'attempt:progress', { attemptId, studentId, answeredCount, total });
  }));

  bus.on('attempt.submitted', safe(async ({ attempt, auto }) => {
    await audit('attempt.submitted', { actor: attempt.student, exam: attempt.exam, attempt: attempt._id, meta: { auto, score: attempt.score, totalMarks: attempt.totalMarks } });
    socket.emitToMonitor(attempt.exam, 'attempt:submitted', {
      attemptId: attempt._id, studentId: attempt.student, status: attempt.status, submittedAt: attempt.submittedAt, score: attempt.score, totalMarks: attempt.totalMarks,
    });
    // Student only gets a confirmation - marks stay hidden until faculty release results
    socket.emitToUser(attempt.student, 'attempt:submitted', { attemptId: attempt._id, status: attempt.status, submittedAt: attempt.submittedAt });
  }));

  bus.on('results.released', safe(async ({ exam, actorId, studentIds }) => {
    await audit('results.released', { actor: actorId, exam: exam._id });
    studentIds.forEach((id) => socket.emitToUser(id, 'results:released', { examId: exam._id, title: exam.title }));
  }));
}

module.exports = { register };
