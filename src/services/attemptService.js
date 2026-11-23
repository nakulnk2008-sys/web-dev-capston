const Attempt = require('../models/Attempt');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const AppError = require('../utils/AppError');
const shuffle = require('../utils/shuffle');
const env = require('../config/env');
const bus = require('../events/appEvents');
const { isAssigned } = require('./examService');

const round2 = (n) => Math.round(n * 100) / 100;

/** Builds the question set + option order for one attempt (random subset / shuffles per exam settings). */
exports.buildQuestionSet = async (exam) => {
  let questions = await Question.find({ _id: { $in: exam.questions } }).select('marks options._id');
  if (!questions.length) throw new AppError('Exam has no available questions', 409);
  if (exam.selection.questionCount && exam.selection.questionCount < questions.length) {
    questions = shuffle(questions).slice(0, exam.selection.questionCount);
  } else if (exam.selection.shuffleQuestions) {
    questions = shuffle(questions);
  }
  return questions.map((q) => {
    const ids = q.options.map((o) => o._id);
    return { question: q._id, marks: q.marks, optionOrder: exam.selection.shuffleOptions ? shuffle(ids) : ids };
  });
};

/** Student-safe view: question text + option text only. Correct answers are NEVER included. */
exports.presentQuestions = async (attempt) => {
  const docs = await Question.find({ _id: { $in: attempt.questions.map((q) => q.question) } })
    .select('text subject topic options._id options.text').lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return attempt.questions
    .map((aq) => {
      const q = byId.get(String(aq.question));
      if (!q) return null;
      const opts = new Map(q.options.map((o) => [String(o._id), o]));
      return {
        _id: q._id,
        text: q.text,
        subject: q.subject,
        topic: q.topic,
        marks: aq.marks,
        options: aq.optionOrder.map((id) => ({ _id: id, text: opts.get(String(id)).text })),
      };
    })
    .filter(Boolean);
};

/** Validates answers against the attempt's own question/option set, returns merged answers list. */
exports.mergeAnswers = (attempt, incoming) => {
  const allowed = new Map(attempt.questions.map((q) => [String(q.question), new Set(q.optionOrder.map(String))]));
  const merged = new Map(attempt.answers.map((a) => [String(a.question), a]));
  const errors = [];
  incoming.forEach((a, i) => {
    const opts = allowed.get(String(a.question));
    if (!opts) return errors.push({ field: `answers[${i}].question`, message: 'Question is not part of this attempt' });
    if (!opts.has(String(a.selectedOption))) {
      return errors.push({ field: `answers[${i}].selectedOption`, message: 'Option does not belong to the question' });
    }
    merged.set(String(a.question), { question: a.question, selectedOption: a.selectedOption, answeredAt: new Date() });
  });
  if (errors.length) throw new AppError('Invalid answers', 400, errors);
  return [...merged.values()];
};

/** Server-side marking. Clients never submit scores. */
exports.evaluate = async (attempt, negativeMarking = 0) => {
  const questions = await Question.find({ _id: { $in: attempt.questions.map((q) => q.question) } }).select('options');
  const correctByQ = new Map(questions.map((q) => [String(q._id), q.options.find((o) => o.isCorrect)?._id]));
  const ans = new Map(attempt.answers.map((a) => [String(a.question), a.selectedOption]));
  let score = 0, totalMarks = 0, correctCount = 0;
  const evaluation = attempt.questions.map((aq) => {
    totalMarks += aq.marks;
    const correctOption = correctByQ.get(String(aq.question));
    const selected = ans.get(String(aq.question));
    let marksAwarded = 0;
    const isCorrect = !!selected && !!correctOption && String(selected) === String(correctOption);
    if (selected) marksAwarded = isCorrect ? aq.marks : -round2(aq.marks * negativeMarking);
    if (isCorrect) correctCount += 1;
    score += marksAwarded;
    return { question: aq.question, selectedOption: selected, correctOption, isCorrect, marksAwarded };
  });
  return { evaluation, totalMarks: round2(totalMarks), score: Math.max(0, round2(score)), correctCount };
};

/**
 * Atomically moves an attempt in_progress -> submitted/auto_submitted. The status filter in the
 * update guarantees an attempt can be finalised exactly once, even under concurrent requests.
 */
exports.finalize = async (attempt, { auto = false, answers } = {}) => {
  const exam = await Exam.findById(attempt.exam).select('negativeMarking');
  if (answers) attempt.answers = answers;
  const result = await exports.evaluate(attempt, exam ? exam.negativeMarking : 0);
  const updated = await Attempt.findOneAndUpdate(
    { _id: attempt._id, status: 'in_progress' },
    { $set: { status: auto ? 'auto_submitted' : 'submitted', submittedAt: new Date(), answers: attempt.answers, ...result } },
    { returnDocument: 'after' }
  );
  if (!updated) throw new AppError('Attempt has already been submitted', 409);
  bus.emit('attempt.submitted', { attempt: updated, auto });
  return updated;
};

exports.isExpired = (attempt, now = new Date()) =>
  now.getTime() > attempt.deadline.getTime() + env.submitGraceSeconds * 1000;

/** Auto-submits every in-progress attempt whose deadline (plus grace) has passed. Returns count. */
exports.sweepExpired = async () => {
  const cutoff = new Date(Date.now() - env.submitGraceSeconds * 1000);
  const stale = await Attempt.find({ status: 'in_progress', deadline: { $lt: cutoff } });
  let n = 0;
  for (const a of stale) {
    try { await exports.finalize(a, { auto: true }); n += 1; } catch { /* already finalised elsewhere */ }
  }
  return n;
};

exports.assertCanAccess = (user, exam) => {
  if (!isAssigned(user, exam)) throw new AppError('This examination is not assigned to you', 403);
};
