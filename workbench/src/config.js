const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const appDir = path.resolve(__dirname, '..');

module.exports = {
  port: Number(process.env.PORT || 5057),
  rootDir,
  appDir,
  dbPath: process.env.WORKBENCH_DB || path.join(appDir, 'data', 'workbench.sqlite'),
  cookieName: 'word_hunter_workbench_session',
  cookieSecret: process.env.WORKBENCH_COOKIE_SECRET || 'local-dev-secret',
};
