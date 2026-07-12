const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { openDb } = require('../src/db');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

test('privacy page is linked from learner and admin shells', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-static-'));
  const db = openDb(path.join(tmpDir, 'test.sqlite'));
  const app = createApp({ db });

  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const learner = await fetch(`${baseUrl}/`);
    const learnerHtml = await learner.text();
    assert.equal(learner.status, 200);
    assert.match(learnerHtml, /privacy\.html/);

    const admin = await fetch(`${baseUrl}/admin.html`);
    const adminHtml = await admin.text();
    assert.equal(admin.status, 200);
    assert.match(adminHtml, /privacy\.html/);

    const privacy = await fetch(`${baseUrl}/privacy.html`);
    const privacyHtml = await privacy.text();
    assert.equal(privacy.status, 200);
    assert.match(privacyHtml, /学习数据说明/);
    assert.match(privacyHtml, /不需要身份证/);
  } finally {
    await closeServer(server);
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
