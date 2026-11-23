const mongoose = require('mongoose');

/**
 * One student's attempt at an exam. The set (and order) of questions/options is frozen
 * at start so shuffling is stable across reloads and evaluation is independent of later edits.
 */
const attemptQuestionSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    marks: { type: Number, required: true },
    optionOrder: [{ type: mongoose.Schema.Types.ObjectId }], // option _ids, in the order shown to the student
  },
  { _id: false }
);

const answerSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, required: true },
    selectedOption: { type: mongoose.Schema.Types.ObjectId, required: true },
    answeredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const evaluationSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, required: true },
    selectedOption: { type: mongoose.Schema.Types.ObjectId },
    correctOption: { type: mongoose.Schema.Types.ObjectId },
    isCorrect: { type: Boolean, default: false },
    marksAwarded: { type: Number, default: 0 },
  },
  { _id: false }
);

const attemptSchema = new mongoose.Schema(
  {
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    attemptNumber: { type: Number, required: true, min: 1 },
    questions: [attemptQuestionSchema],
    answers: [answerSchema],
    startedAt: { type: Date, required: true },
    deadline: { type: Date, required: true }, // min(startedAt + duration, exam.endTime) - enforced server side
    submittedAt: { type: Date },
    status: { type: String, enum: ['in_progress', 'submitted', 'auto_submitted'], default: 'in_progress' },
    evaluation: [evaluationSchema],
    totalMarks: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Prevents two concurrent "start" calls from creating the same attempt number twice
attemptSchema.index({ exam: 1, student: 1, attemptNumber: 1 }, { unique: true });
// Used by the expiry sweeper and live monitoring
attemptSchema.index({ status: 1, deadline: 1 });
attemptSchema.index({ exam: 1, status: 1, score: -1 });
attemptSchema.index({ student: 1, submittedAt: -1 });

module.exports = mongoose.model('Attempt', attemptSchema);
