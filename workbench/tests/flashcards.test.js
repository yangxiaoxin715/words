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

function startFlashcardTestApp() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-flashcards-'));
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

async function readWordCount(baseUrl, cookie) {
  const res = await fetch(`${baseUrl}/api/learner/words`, {
    headers: { cookie },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  return json.words.length;
}

test('learner words endpoint returns normalized root word data', async () => {
  const { baseUrl, cleanup } = await startFlashcardTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const res = await fetch(`${baseUrl}/api/learner/words`, {
      headers: { cookie: learnerCookie },
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.words.length >= 1000);
    assert.deepEqual(Object.keys(json.words[0]).sort(), [
      'chinese',
      'english',
      'key',
      'poolId',
      'position',
      'stageLabel',
      'stageName',
      'storyRole',
      'tags',
      'useStage',
    ]);
    assert.deepEqual(json.words[0], {
      key: 'i',
      english: 'I',
      chinese: '我',
      position: 1,
      poolId: 'foundation',
      stageLabel: '1—200',
      stageName: '第一组',
      useStage: '低年级可闪',
      storyRole: '基础识别',
      tags: ['1—200', '低年级可闪', '基础识别'],
    });
  } finally {
    await cleanup();
  }
});

test('new learner flashcard summary starts with every word unseen', async () => {
  const { baseUrl, cleanup } = await startFlashcardTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const wordCount = await readWordCount(baseUrl, learnerCookie);
    const res = await fetch(`${baseUrl}/api/learner/flashcards/summary`, {
      headers: { cookie: learnerCookie },
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, {
      captured: 0,
      hunting: 0,
      unseen: wordCount,
    });
  } finally {
    await cleanup();
  }
});

test('posting a flashcard session stores duration and updates word counts', async () => {
  const { baseUrl, db, cleanup } = await startFlashcardTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const wordCount = await readWordCount(baseUrl, learnerCookie);
    const payload = {
      startedAt: '2026-07-03T10:00:00.000Z',
      endedAt: '2026-07-03T10:03:00.000Z',
      durationSeconds: 180,
      events: [
        { wordKey: 'apple', result: 'captured', previousCount: 2, nextCount: 3 },
        { wordKey: 'banana', result: 'familiar', previousCount: 0, nextCount: 1 },
        { wordKey: 'orange', result: 'skip', previousCount: 0, nextCount: 0 },
      ],
    };

    const res = await postJson(
      baseUrl,
      '/api/learner/flashcards/session',
      payload,
      { cookie: learnerCookie }
    );

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.session.id);

    const session = db
      .prepare(
        `select started_at, ended_at, duration_seconds, card_count, captured_count, hunting_count
         from flashcard_sessions
         where id = ?`
      )
      .get(json.session.id);
    assert.deepEqual(session, {
      started_at: payload.startedAt,
      ended_at: payload.endedAt,
      duration_seconds: 180,
      card_count: 3,
      captured_count: 1,
      hunting_count: 1,
    });

    const events = db
      .prepare(
        `select word_key, result, previous_count, next_count
         from flashcard_events
         where session_id = ?
         order by rowid`
      )
      .all(json.session.id);
    assert.equal(events.length, 3);
    assert.deepEqual(events.map((event) => event.word_key), [
      'apple',
      'banana',
      'orange',
    ]);
    assert.deepEqual(events.map((event) => event.next_count), [3, 1, 0]);

    const states = db
      .prepare(
        `select word_key, status, correct_count
         from word_states
         order by word_key`
      )
      .all();
    assert.deepEqual(states, [
      { word_key: 'apple', status: 'captured', correct_count: 3 },
      { word_key: 'banana', status: 'hunting', correct_count: 1 },
      { word_key: 'orange', status: 'new', correct_count: 0 },
    ]);

    const summary = await fetch(`${baseUrl}/api/learner/flashcards/summary`, {
      headers: { cookie: learnerCookie },
    });

    assert.equal(summary.status, 200);
    const summaryJson = await summary.json();
    assert.deepEqual(summaryJson, {
      captured: 1,
      hunting: 1,
      unseen: wordCount - 2,
    });
  } finally {
    await cleanup();
  }
});

test('flashcard session applies results from stored state instead of client counts', async () => {
  const { baseUrl, db, cleanup } = await startFlashcardTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');

    const first = await postJson(
      baseUrl,
      '/api/learner/flashcards/session',
      {
        startedAt: '2026-07-03T10:00:00.000Z',
        endedAt: '2026-07-03T10:01:00.000Z',
        durationSeconds: 60,
        events: [
          { wordKey: 'apple', result: 'captured', previousCount: 0, nextCount: 3 },
          { wordKey: 'banana', result: 'familiar', previousCount: 0, nextCount: 1 },
        ],
      },
      { cookie: learnerCookie }
    );
    assert.equal(first.status, 200);

    const second = await postJson(
      baseUrl,
      '/api/learner/flashcards/session',
      {
        startedAt: '2026-07-03T10:02:00.000Z',
        endedAt: '2026-07-03T10:03:00.000Z',
        durationSeconds: 60,
        events: [
          { wordKey: 'apple', result: 'familiar', previousCount: 0, nextCount: 1 },
          { wordKey: 'banana', result: 'skip', previousCount: 0, nextCount: 0 },
        ],
      },
      { cookie: learnerCookie }
    );
    const secondJson = await second.json();
    assert.equal(second.status, 200);

    const events = db
      .prepare(
        `select word_key, result, previous_count, next_count
         from flashcard_events
         where session_id = ?
         order by rowid`
      )
      .all(secondJson.session.id);
    assert.deepEqual(events, [
      {
        word_key: 'apple',
        result: 'familiar',
        previous_count: 3,
        next_count: 3,
      },
      {
        word_key: 'banana',
        result: 'skip',
        previous_count: 1,
        next_count: 1,
      },
    ]);

    const states = db
      .prepare(
        `select word_key, status, correct_count
         from word_states
         where word_key in ('apple', 'banana')
         order by word_key`
      )
      .all();
    assert.deepEqual(states, [
      { word_key: 'apple', status: 'captured', correct_count: 3 },
      { word_key: 'banana', status: 'hunting', correct_count: 1 },
    ]);
  } finally {
    await cleanup();
  }
});

test('flashcard session requires an events array', async () => {
  const { baseUrl, cleanup } = await startFlashcardTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const res = await postJson(
      baseUrl,
      '/api/learner/flashcards/session',
      {
        startedAt: '2026-07-03T10:00:00.000Z',
        endedAt: '2026-07-03T10:03:00.000Z',
        durationSeconds: 180,
      },
      { cookie: learnerCookie }
    );

    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, 'Flashcard events are required');
  } finally {
    await cleanup();
  }
});

test('flashcard endpoints are learner-only', async () => {
  const { baseUrl, cleanup } = await startFlashcardTestApp();

  try {
    const unauthenticated = await fetch(`${baseUrl}/api/learner/words`);
    const unauthenticatedJson = await unauthenticated.json();
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticatedJson.error, 'Authentication required');

    const adminCookie = await login(baseUrl, 'admin-demo');
    const adminSummary = await fetch(`${baseUrl}/api/learner/flashcards/summary`, {
      headers: { cookie: adminCookie },
    });
    const adminSummaryJson = await adminSummary.json();
    assert.equal(adminSummary.status, 403);
    assert.equal(adminSummaryJson.error, 'Learner session required');
  } finally {
    await cleanup();
  }
});
