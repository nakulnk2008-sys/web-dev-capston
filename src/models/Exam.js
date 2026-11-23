const mongoose = require('mongoose');

const examSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 150 },
    instructions: { type: String, trim: true, maxlength: 3000, default: '' },
    durationMinutes: { type: Number, required: true, min: 1, max: 600 },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Question pool for the exam
    questions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
    selection: {
      // If set (< pool size) every attempt receives a random subset of this many questions
      questionCount: { type: Number, min: 1 },
      shuffleQuestions: { type: Boolean, default: false },
      shuffleOptions: { type: Boolean, default: false },
    },

    // Assignment
    assignedStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    assignedGroups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }],

    // Scoring / policy
    negativeMarking: { type: Number, min: 0, max: 1, default: 0 }, // fraction of question marks deducted for a wrong answer
    maxAttempts: { type: Number, min: 1, max: 5, default: 1 }, // >1 == permitted retake
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    resultsReleased: { type: Boolean, default: false },
    showCorrectAnswers: { type: Boolean, default: false }, // after release, reveal correct options to students
  },
  { timestamps: true }
);

examSchema.index({ createdBy: 1, startTime: -1 });
examSchema.index({ status: 1, startTime: 1, endTime: 1 });
examSchema.index({ assignedStudents: 1 });
examSchema.index({ assignedGroups: 1 });

examSchema.pre('validate', function () {
  if (this.startTime && this.endTime && this.endTime <= this.startTime) {
    this.invalidate('endTime', 'endTime must be after startTime');
  }
  if (this.startTime && this.endTime && this.durationMinutes) {
    const windowMin = (this.endTime - this.startTime) / 60000;
    if (this.durationMinutes > windowMin) {
      this.invalidate('durationMinutes', 'Duration cannot exceed the length of the exam window');
    }
  }
});

module.exports = mongoose.model('Exam', examSchema);
