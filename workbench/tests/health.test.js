const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

test('health endpoint returns service status', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-health-'));
  const db = openDb(path.join(tmpDir, 'test.sqlite'));
  const app = createApp({ db });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(json, { ok: true, service: 'word-hunter-workbench' });
  } finally {
    try {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
});
