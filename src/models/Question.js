const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 500 },
    isCorrect: { type: Boolean, default: false }, // never exposed by student-facing APIs
  },
  { _id: true }
);

const questionSchema = new mongoose.Schema(
  {
    text: { type: String, required: [true, 'Question text is required'], trim: true, maxlength: 2000 },
    options: {
      type: [optionSchema],
      validate: [
        {
          validator: (o) => o.length >= 2 && o.length <= 6,
          message: 'A question must have between 2 and 6 options',
        },
        {
          validator: (o) => o.filter((x) => x.isCorrect).length === 1,
          message: 'Exactly one option must be marked correct',
        },
      ],
    },
    marks: { type: Number, required: true, min: [0.25, 'Marks must be at least 0.25'], max: 100, default: 1 },
    subject: { type: String, required: true, trim: true, index: true },
    topic: { type: String, required: true, trim: true },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// Supports the question-bank filter (topic / difficulty / subject) scoped to an author
questionSchema.index({ createdBy: 1, subject: 1, topic: 1, difficulty: 1 });
questionSchema.index({ text: 'text' });

module.exports = mongoose.model('Question', questionSchema);
