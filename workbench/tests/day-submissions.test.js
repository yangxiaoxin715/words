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

function startDaySubmissionTestApp() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-days-'));
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

async function putJson(baseUrl, route, body, headers = {}) {
  return fetch(`${baseUrl}${route}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function login(baseUrl, accessCode) {
  const res = await postJson(baseUrl, '/api/login', { accessCode });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie');
}

test('learner can save and read Day6 checklist submission', async () => {
  const { baseUrl, db, cleanup } = await startDaySubmissionTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const checklist = {
      listened: true,
      answeredSixQuestions: true,
      guess: 'The door will open after the child reads the map.',
      guessReason: 'The story kept showing the map and the key.',
    };

    const save = await putJson(
      baseUrl,
      '/api/learner/day-submissions/6',
      { checklist },
      { cookie: learnerCookie }
    );
    const saveJson = await save.json();

    assert.equal(save.status, 200);
    assert.equal(saveJson.submission.dayNumber, 6);
    assert.deepEqual(saveJson.submission.checklist, checklist);

    const dbRow = db
      .prepare(
        `select day_number, checklist_json
         from day_submissions
         where learner_id = (
           select id from learners where access_code = ?
         )`
      )
      .get('apple-demo');
    assert.equal(dbRow.day_number, 6);
    assert.deepEqual(JSON.parse(dbRow.checklist_json), checklist);

    const read = await fetch(`${baseUrl}/api/learner/day-submissions`, {
      headers: { cookie: learnerCookie },
    });
    const readJson = await read.json();

    assert.equal(read.status, 200);
    assert.deepEqual(readJson.submissions, [
      {
        dayNumber: 6,
        checklist,
      },
    ]);
  } finally {
    await cleanup();
  }
});

test('saving the same day updates the existing submission', async () => {
  const { baseUrl, db, cleanup } = await startDaySubmissionTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const first = {
      listened: true,
      guess: 'The child will run away.',
    };
    const second = {
      listened: true,
      answeredSixQuestions: true,
      guess: 'The child will ask for help.',
      guessReason: 'The helper appeared twice.',
    };

    const firstSave = await putJson(
      baseUrl,
      '/api/learner/day-submissions/6',
      { checklist: first },
      { cookie: learnerCookie }
    );
    assert.equal(firstSave.status, 200);

    const secondSave = await putJson(
      baseUrl,
      '/api/learner/day-submissions/6',
      { checklist: second },
      { cookie: learnerCookie }
    );
    const secondJson = await secondSave.json();
    assert.equal(secondSave.status, 200);
    assert.deepEqual(secondJson.submission.checklist, second);

    const count = db
      .prepare(
        `select count(*) as count
         from day_submissions
         where learner_id = (
           select id from learners where access_code = ?
         ) and day_number = 6`
      )
      .get('apple-demo').count;
    assert.equal(count, 1);
  } finally {
    await cleanup();
  }
});

test('day submission rejects day numbers outside the seven-day flow', async () => {
  const { baseUrl, cleanup } = await startDaySubmissionTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const save = await putJson(
      baseUrl,
      '/api/learner/day-submissions/8',
      { checklist: { listened: true } },
      { cookie: learnerCookie }
    );
    const json = await save.json();

    assert.equal(save.status, 400);
    assert.equal(json.error, 'Day number must be between 1 and 7');
  } finally {
    await cleanup();
  }
});

test('day submission endpoints are learner-only', async () => {
  const { baseUrl, cleanup } = await startDaySubmissionTestApp();

  try {
    const unauthenticated = await fetch(`${baseUrl}/api/learner/day-submissions`);
    const unauthenticatedJson = await unauthenticated.json();
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticatedJson.error, 'Authentication required');

    const adminCookie = await login(baseUrl, 'admin-demo');
    const adminSave = await putJson(
      baseUrl,
      '/api/learner/day-submissions/1',
      { checklist: { listened: true } },
      { cookie: adminCookie }
    );
    const adminSaveJson = await adminSave.json();

    assert.equal(adminSave.status, 403);
    assert.equal(adminSaveJson.error, 'Learner session required');
  } finally {
    await cleanup();
  }
});

test('day submission endpoints reject a stale learner session', async () => {
  const { baseUrl, db, cleanup } = await startDaySubmissionTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    db.prepare('delete from learners where access_code = ?').run('apple-demo');

    const read = await fetch(`${baseUrl}/api/learner/day-submissions`, {
      headers: { cookie: learnerCookie },
    });
    const readJson = await read.json();
    assert.equal(read.status, 401);
    assert.equal(readJson.error, 'Authentication required');

    const save = await putJson(
      baseUrl,
      '/api/learner/day-submissions/1',
      { checklist: { listened: true } },
      { cookie: learnerCookie }
    );
    const saveJson = await save.json();
    assert.equal(save.status, 401);
    assert.equal(saveJson.error, 'Authentication required');
  } finally {
    await cleanup();
  }
});
