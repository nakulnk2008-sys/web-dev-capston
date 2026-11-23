const http = require('http');
const env = require('./config/env');
const { connectDB } = require('./config/db');
const app = require('./app');
const socket = require('./sockets');
const listeners = require('./events/listeners');
const { sweepExpired } = require('./services/attemptService');

async function main() {
  await connectDB();
  console.log('MongoDB connected');
  const server = http.createServer(app);
  socket.init(server);
  listeners.register();

  // Auto-submit attempts whose time ran out (e.g. student closed the browser)
  const sweeper = setInterval(() => sweepExpired().catch((e) => console.error('sweeper:', e.message)), 30000);
  sweeper.unref();

  server.listen(env.port, () => console.log(`Exam system API listening on :${env.port} (${env.nodeEnv})`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => { console.error('Fatal startup error:', e); process.exit(1); });
