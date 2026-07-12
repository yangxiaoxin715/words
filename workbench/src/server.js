const express = require('express');
const path = require('node:path');
const config = require('./config');
const { openDb } = require('./db');
const { createAdminRouter } = require('./routes/admin');
const { createAuthRouter } = require('./routes/auth');
const { createLearnerRouter } = require('./routes/learner');

function createApp(options = {}) {
  const db = options.db || openDb();
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }

    next(error);
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'word-hunter-workbench' });
  });
  app.use('/api', createAuthRouter(db));
  app.use('/api/learner', createLearnerRouter(db));
  app.use('/api/admin', createAdminRouter(db));

  app.use(express.static(path.join(config.appDir, 'public')));

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Workbench listening on http://127.0.0.1:${config.port}`);
  });
}

module.exports = { createApp };
