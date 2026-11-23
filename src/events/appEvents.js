const { EventEmitter } = require('events');

/**
 * Application-wide event bus (Node.js EventEmitter).
 *
 * Controllers/services emit domain events and know nothing about who reacts. Listeners
 * (events/listeners.js) write the audit log and push real-time Socket.IO notifications.
 * This decouples the exam workflow from side effects.
 *
 * Events: exam.published, attempt.started, attempt.answered, attempt.submitted, results.released
 */
module.exports = new EventEmitter();
