const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/tokens');
const User = require('../models/User');
const Exam = require('../models/Exam');
const Attempt = require('../models/Attempt');
const env = require('../config/env');

let io = null;
const monitorRoom = (examId) => `exam:${examId}:monitor`;
const userRoom = (userId) => `user:${userId}`;

/**
 * Socket.IO setup.
 *  Auth      : client must connect with { auth: { token: '<access JWT>' } }; unauthenticated sockets are rejected.
 *  Rooms     : user:<id>               - private notifications for one user
 *              exam:<id>:monitor       - live exam status for the exam's owner / admin
 *  Client -> server events : monitor:join { examId } (ack), monitor:leave { examId }
 *  Server -> client events : exam:published, results:released, attempt:submitted  (to students)
 *                            attempt:started, attempt:progress, attempt:submitted (to monitors)
 */
function init(httpServer) {
  io = new Server(httpServer, { cors: { origin: env.corsOrigin } });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication required'));
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub).select('name role isActive');
      if (!user || !user.isActive) return next(new Error('Authentication failed'));
      socket.user = user;
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(userRoom(socket.user._id));

    socket.on('monitor:join', async ({ examId } = {}, ack = () => {}) => {
      try {
        const { role, _id } = socket.user;
        if (role === 'student') return ack({ success: false, message: 'Forbidden' });
        const exam = await Exam.findById(examId).select('createdBy');
        if (!exam) return ack({ success: false, message: 'Exam not found' });
        if (role !== 'admin' && String(exam.createdBy) !== String(_id)) {
          return ack({ success: false, message: 'Forbidden' });
        }
        socket.join(monitorRoom(examId));
        const active = await Attempt.find({ exam: examId, status: 'in_progress' })
          .select('student startedAt deadline answers').populate('student', 'name rollNumber').lean();
        ack({
          success: true,
          activeAttempts: active.map((a) => ({
            attemptId: a._id, student: a.student, startedAt: a.startedAt, deadline: a.deadline, answeredCount: a.answers.length,
          })),
        });
      } catch {
        ack({ success: false, message: 'Invalid request' });
      }
    });

    socket.on('monitor:leave', ({ examId } = {}) => socket.leave(monitorRoom(examId)));
  });
  return io;
}

const emitToUser = (userId, event, payload) => io && io.to(userRoom(userId)).emit(event, payload);
const emitToMonitor = (examId, event, payload) => io && io.to(monitorRoom(examId)).emit(event, payload);
const getIO = () => io;

module.exports = { init, emitToUser, emitToMonitor, getIO };
