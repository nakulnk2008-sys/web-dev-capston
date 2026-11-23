const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true }, // e.g. exam.started, exam.submitted
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam' },
    attempt: { type: mongoose.Schema.Types.ObjectId, ref: 'Attempt' },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ exam: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
