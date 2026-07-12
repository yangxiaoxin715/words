const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const { seed } = require('../src/seed');
const { createApp } = require('../src/server');

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function startDraftTestApp() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-drafts-'));
  const db = openDb(path.join(tmpDir, 'test.sqlite'));
  seed(db);

  const app = createApp({ db });
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        db,
        async cleanup() {
          await closeServer(server);
          db.close();
          fs.rmSync(tmpDir, { recursive: true, force: true });
        },
      });
    });
    server.once('error', (error) => {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      reject(error);
    });
  });
}

async function postJson(baseUrl, route, body, headers = {}) {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function login(baseUrl, accessCode) {
  const res = await postJson(baseUrl, '/api/login', { accessCode });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie');
}

test('admin can generate and list a next episode draft', async () => {
  const { baseUrl, db, cleanup } = await startDraftTestApp();

  try {
    const adminCookie = await login(baseUrl, 'admin-demo');
    const learnerId = db
      .prepare('select id from learners where access_code = ?')
      .get('apple-demo').id;

    const create = await postJson(
      baseUrl,
      `/api/admin/learners/${learnerId}/drafts`,
      {},
      { cookie: adminCookie }
    );
    const createJson = await create.json();

    assert.equal(create.status, 200);
    assert.ok(createJson.draft.id);
    assert.equal(createJson.draft.status, 'draft');
    assert.equal(createJson.draft.draft.title, 'Next Story Draft');
    assert.match(createJson.draft.draft.body, /opened the book/);
    assert.deepEqual(createJson.draft.draft.reviewNotes, [
      '请人工检查故事钩子、用词难度和孩子猜想是否被接住。',
    ]);

    const stored = db
      .prepare(
        `select learner_id, draft_json, status
         from generated_drafts
         where id = ?`
      )
      .get(createJson.draft.id);
    assert.equal(stored.learner_id, learnerId);
    assert.equal(stored.status, 'draft');
    assert.deepEqual(JSON.parse(stored.draft_json), createJson.draft.draft);

    const list = await fetch(`${baseUrl}/api/admin/learners/${learnerId}/drafts`, {
      headers: { cookie: adminCookie },
    });
    const listJson = await list.json();
    assert.equal(list.status, 200);
    assert.equal(listJson.drafts.length, 1);
    assert.equal(listJson.drafts[0].id, createJson.draft.id);
  } finally {
    await cleanup();
  }
});

test('draft generation rejects missing learners and learner sessions', async () => {
  const { baseUrl, cleanup } = await startDraftTestApp();

  try {
    const adminCookie = await login(baseUrl, 'admin-demo');
    const missing = await postJson(
      baseUrl,
      '/api/admin/learners/missing-learner/drafts',
      {},
      { cookie: adminCookie }
    );
    const missingJson = await missing.json();
    assert.equal(missing.status, 404);
    assert.equal(missingJson.error, 'Learner not found');

    const learnerCookie = await login(baseUrl, 'apple-demo');
    const forbidden = await postJson(
      baseUrl,
      '/api/admin/learners/someone/drafts',
      {},
      { cookie: learnerCookie }
    );
    const forbiddenJson = await forbidden.json();
    assert.equal(forbidden.status, 403);
    assert.equal(forbiddenJson.error, 'Admin session required');

    const forbiddenList = await fetch(
      `${baseUrl}/api/admin/learners/someone/drafts`,
      { headers: { cookie: learnerCookie } }
    );
    const forbiddenListJson = await forbiddenList.json();
    assert.equal(forbiddenList.status, 403);
    assert.equal(forbiddenListJson.error, 'Admin session required');
  } finally {
    await cleanup();
  }
});
