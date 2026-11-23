const mongoose = require('mongoose');

/** Academic group (class / section / batch) used to assign exams and to aggregate performance. */
const groupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Group', groupSchema);
