const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: '1mb' }));
// Express 5 leaves req.body undefined for body-less requests; normalise so controllers can destructure safely
app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });
if (env.nodeEnv !== 'test') app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/health', (_req, res) => res.json({ success: true, status: 'ok', uptime: process.uptime() }));
app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
