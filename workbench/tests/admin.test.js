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

function startAdminTestApp() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-admin-'));
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

async function seedLearnerActivity(baseUrl, learnerCookie) {
  await putJson(
    baseUrl,
    '/api/learner/questionnaire',
    {
      grade: '五年级',
      textbook: '人教版',
      englishLevel: '能读短句',
      dailyMinutes: '20',
      audioExposure: '每周三次',
      favoriteFigure: 'Mulan',
      favoriteQuestion: 'Why do stories make words easier?',
      parentPain: '坚持打卡难',
      expectedChange: '敢开口读',
      guardianConsent: true,
    },
    { cookie: learnerCookie }
  );
  await postJson(
    baseUrl,
    '/api/learner/flashcards/session',
    {
      startedAt: '2026-07-03T10:00:00.000Z',
      endedAt: '2026-07-03T10:03:00.000Z',
      durationSeconds: 180,
      events: [
        { wordKey: 'apple', result: 'captured' },
        { wordKey: 'banana', result: 'familiar' },
      ],
    },
    { cookie: learnerCookie }
  );
  await putJson(
    baseUrl,
    '/api/learner/day-submissions/6',
    {
      checklist: {
        answeredSixQuestions: true,
        guess: 'The door will open.',
      },
    },
    { cookie: learnerCookie }
  );
  await postJson(
    baseUrl,
    '/api/learner/lookups',
    {
      type: 'sentence',
      text: 'The key was under the old map.',
      context: 'The child opened the door.',
      dayNumber: 4,
    },
    { cookie: learnerCookie }
  );
}

test('admin can list learners with flashcard summary', async () => {
  const { baseUrl, cleanup } = await startAdminTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    await seedLearnerActivity(baseUrl, learnerCookie);
    const adminCookie = await login(baseUrl, 'admin-demo');

    const res = await fetch(`${baseUrl}/api/admin/learners`, {
      headers: { cookie: adminCookie },
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.ok(json.learners.length >= 2);
    const apple = json.learners.find((learner) => learner.nickname === 'Apple');
    assert.ok(apple);
    assert.equal(apple.grade, '五年级');
    assert.equal(apple.flashcardSummary.captured, 1);
    assert.equal(apple.flashcardSummary.hunting, 1);
    assert.equal(apple.daySubmissionCount, 1);
    assert.ok(apple.id);
  } finally {
    await cleanup();
  }
});

test('admin can read learner detail', async () => {
  const { baseUrl, db, cleanup } = await startAdminTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    await seedLearnerActivity(baseUrl, learnerCookie);
    const adminCookie = await login(baseUrl, 'admin-demo');
    const learnerId = db
      .prepare('select id from learners where access_code = ?')
      .get('apple-demo').id;

    const res = await fetch(`${baseUrl}/api/admin/learners/${learnerId}`, {
      headers: { cookie: adminCookie },
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.learner.nickname, 'Apple');
    assert.equal(json.questionnaire.favoriteFigure, 'Mulan');
    assert.deepEqual(json.flashcardSummary, {
      captured: 1,
      hunting: 1,
      unseen: json.wordCount - 2,
    });
    assert.equal(json.daySubmissions.length, 1);
    assert.equal(json.daySubmissions[0].dayNumber, 6);
    assert.equal(json.lookupRecords.length, 1);
    assert.equal(json.lookupRecords[0].text, 'The key was under the old map.');
    assert.deepEqual(json.teacherNotes, []);
    assert.deepEqual(json.generatedDrafts, []);
  } finally {
    await cleanup();
  }
});

test('admin endpoints reject learner sessions', async () => {
  const { baseUrl, cleanup } = await startAdminTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const res = await fetch(`${baseUrl}/api/admin/learners`, {
      headers: { cookie: learnerCookie },
    });
    const json = await res.json();

    assert.equal(res.status, 403);
    assert.equal(json.error, 'Admin session required');
  } finally {
    await cleanup();
  }
});
