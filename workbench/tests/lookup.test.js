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

function startLookupTestApp() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-lookups-'));
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

test('sentence lookup saves original text and generated guidance', async () => {
  const { baseUrl, db, cleanup } = await startLookupTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const payload = {
      type: 'sentence',
      text: 'The key was under the old map.',
      context: 'The child opened the door.',
      dayNumber: 4,
    };

    const save = await postJson(baseUrl, '/api/learner/lookups', payload, {
      cookie: learnerCookie,
    });
    const saveJson = await save.json();

    assert.equal(save.status, 200);
    assert.equal(saveJson.lookup.type, 'sentence');
    assert.equal(saveJson.lookup.text, payload.text);
    assert.equal(saveJson.lookup.context, payload.context);
    assert.equal(saveJson.lookup.dayNumber, 4);
    assert.deepEqual(Object.keys(saveJson.lookup.result).sort(), [
      'contextClue',
      'keyWords',
      'meaning',
      'relistenTip',
    ]);

    const row = db
      .prepare(
        `select type, text, context, day_number, result_json
         from lookup_records
         where learner_id = (
           select id from learners where access_code = ?
         )`
      )
      .get('apple-demo');

    assert.equal(row.type, 'sentence');
    assert.equal(row.text, payload.text);
    assert.equal(row.context, payload.context);
    assert.equal(row.day_number, 4);
    assert.deepEqual(JSON.parse(row.result_json), saveJson.lookup.result);

    const read = await fetch(`${baseUrl}/api/learner/lookups`, {
      headers: { cookie: learnerCookie },
    });
    const readJson = await read.json();

    assert.equal(read.status, 200);
    assert.equal(readJson.lookups.length, 1);
    assert.equal(readJson.lookups[0].text, payload.text);
    assert.deepEqual(readJson.lookups[0].result, saveJson.lookup.result);
  } finally {
    await cleanup();
  }
});

test('word lookup preserves original text while validating trimmed text', async () => {
  const { baseUrl, cleanup } = await startLookupTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const save = await postJson(
      baseUrl,
      '/api/learner/lookups',
      {
        type: 'word',
        text: '  map  ',
        context: '  The map was on the table.  ',
      },
      { cookie: learnerCookie }
    );
    const json = await save.json();

    assert.equal(save.status, 200);
    assert.equal(json.lookup.type, 'word');
    assert.equal(json.lookup.text, '  map  ');
    assert.equal(json.lookup.context, '  The map was on the table.  ');
    assert.equal(json.lookup.dayNumber, null);
  } finally {
    await cleanup();
  }
});

test('lookup rejects invalid type or empty text', async () => {
  const { baseUrl, cleanup } = await startLookupTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const invalidType = await postJson(
      baseUrl,
      '/api/learner/lookups',
      { type: 'paragraph', text: 'The door opened.' },
      { cookie: learnerCookie }
    );
    const invalidTypeJson = await invalidType.json();
    assert.equal(invalidType.status, 400);
    assert.equal(invalidTypeJson.error, 'Lookup type must be word or sentence');

    const emptyText = await postJson(
      baseUrl,
      '/api/learner/lookups',
      { type: 'sentence', text: '   ' },
      { cookie: learnerCookie }
    );
    const emptyTextJson = await emptyText.json();
    assert.equal(emptyText.status, 400);
    assert.equal(emptyTextJson.error, 'Lookup text is required');
  } finally {
    await cleanup();
  }
});

test('lookup endpoints are learner-only', async () => {
  const { baseUrl, cleanup } = await startLookupTestApp();

  try {
    const unauthenticated = await fetch(`${baseUrl}/api/learner/lookups`);
    const unauthenticatedJson = await unauthenticated.json();
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticatedJson.error, 'Authentication required');

    const adminCookie = await login(baseUrl, 'admin-demo');
    const adminLookup = await postJson(
      baseUrl,
      '/api/learner/lookups',
      { type: 'sentence', text: 'The door opened.' },
      { cookie: adminCookie }
    );
    const adminLookupJson = await adminLookup.json();
    assert.equal(adminLookup.status, 403);
    assert.equal(adminLookupJson.error, 'Learner session required');
  } finally {
    await cleanup();
  }
});
