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

function startQuestionnaireTestApp() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-questionnaire-'));
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

test('learner profile starts with no questionnaire and rejects unauthenticated access', async () => {
  const { baseUrl, cleanup } = await startQuestionnaireTestApp();

  try {
    const unauthenticated = await fetch(`${baseUrl}/api/learner/profile`);
    assert.equal(unauthenticated.status, 401);

    const learnerCookie = await login(baseUrl, 'apple-demo');
    const profile = await fetch(`${baseUrl}/api/learner/profile`, {
      headers: { cookie: learnerCookie },
    });
    const json = await profile.json();

    assert.equal(profile.status, 200);
    assert.equal(json.learner.nickname, 'Apple');
    assert.equal(json.learner.grade, '四年级');
    assert.ok(json.learner.id);
    assert.equal(json.questionnaire, null);
  } finally {
    await cleanup();
  }
});

test('questionnaire requires guardian consent', async () => {
  const { baseUrl, cleanup } = await startQuestionnaireTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const res = await putJson(
      baseUrl,
      '/api/learner/questionnaire',
      {
        grade: '五年级',
        dailyMinutes: '20',
        favoriteFigure: 'Mulan',
        favoriteQuestion: 'Why do stories make words easier?',
        guardianConsent: false,
      },
      { cookie: learnerCookie }
    );
    const json = await res.json();

    assert.equal(res.status, 400);
    assert.equal(json.error, 'Guardian consent is required');
  } finally {
    await cleanup();
  }
});

test('questionnaire rejects missing required answers before saving', async () => {
  const { baseUrl, db, cleanup } = await startQuestionnaireTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const res = await putJson(
      baseUrl,
      '/api/learner/questionnaire',
      {
        grade: '  ',
        dailyMinutes: '',
        favoriteFigure: '',
        favoriteQuestion: '',
        guardianConsent: true,
      },
      { cookie: learnerCookie }
    );
    const json = await res.json();

    assert.equal(res.status, 400);
    assert.equal(json.error, 'Required questionnaire fields are missing');
    assert.deepEqual(json.fields, [
      'grade',
      'dailyMinutes',
      'favoriteFigure',
      'favoriteQuestion',
    ]);

    const count = db
      .prepare(
        `select count(*) as count
         from questionnaires
         where learner_id = (
           select id from learners where access_code = ?
         )`
      )
      .get('apple-demo').count;
    assert.equal(count, 0);
  } finally {
    await cleanup();
  }
});

test('malformed questionnaire json returns a json error response', async () => {
  const { baseUrl, cleanup } = await startQuestionnaireTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const res = await fetch(`${baseUrl}/api/learner/questionnaire`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: learnerCookie,
      },
      body: '{"grade":',
    });
    const json = await res.json();

    assert.equal(res.status, 400);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal(json.error, 'Invalid JSON body');
  } finally {
    await cleanup();
  }
});

test('learner can save and read questionnaire answers', async () => {
  const { baseUrl, cleanup } = await startQuestionnaireTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const answers = {
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
    };

    const save = await putJson(
      baseUrl,
      '/api/learner/questionnaire',
      answers,
      { cookie: learnerCookie }
    );
    const saveJson = await save.json();

    assert.equal(save.status, 200);
    assert.deepEqual(saveJson.questionnaire, answers);

    const profile = await fetch(`${baseUrl}/api/learner/profile`, {
      headers: { cookie: learnerCookie },
    });
    const profileJson = await profile.json();

    assert.equal(profile.status, 200);
    assert.equal(profileJson.learner.grade, '五年级');
    assert.deepEqual(profileJson.questionnaire, answers);
  } finally {
    await cleanup();
  }
});

test('re-saving updates the existing questionnaire without duplicate rows', async () => {
  const { baseUrl, db, cleanup } = await startQuestionnaireTestApp();

  try {
    const learnerCookie = await login(baseUrl, 'apple-demo');
    const first = {
      grade: '五年级',
      textbook: '',
      englishLevel: '',
      dailyMinutes: '20',
      audioExposure: '',
      favoriteFigure: 'Mulan',
      favoriteQuestion: 'Why do stories make words easier?',
      parentPain: '',
      expectedChange: '',
      guardianConsent: true,
    };
    const second = {
      ...first,
      dailyMinutes: '30',
      favoriteFigure: 'Hermione',
      expectedChange: '主动复述故事',
    };

    const firstSave = await putJson(
      baseUrl,
      '/api/learner/questionnaire',
      first,
      { cookie: learnerCookie }
    );
    assert.equal(firstSave.status, 200);

    const secondSave = await putJson(
      baseUrl,
      '/api/learner/questionnaire',
      second,
      { cookie: learnerCookie }
    );
    const secondJson = await secondSave.json();
    assert.equal(secondSave.status, 200);
    assert.deepEqual(secondJson.questionnaire, second);

    const count = db
      .prepare(
        `select count(*) as count
         from questionnaires
         where learner_id = (
           select id from learners where access_code = ?
         )`
      )
      .get('apple-demo').count;
    assert.equal(count, 1);

    const profile = await fetch(`${baseUrl}/api/learner/profile`, {
      headers: { cookie: learnerCookie },
    });
    const profileJson = await profile.json();
    assert.deepEqual(profileJson.questionnaire, second);
  } finally {
    await cleanup();
  }
});

test('admin session cannot access learner profile', async () => {
  const { baseUrl, cleanup } = await startQuestionnaireTestApp();

  try {
    const adminCookie = await login(baseUrl, 'admin-demo');
    const profile = await fetch(`${baseUrl}/api/learner/profile`, {
      headers: { cookie: adminCookie },
    });
    const json = await profile.json();

    assert.equal(profile.status, 403);
    assert.equal(json.error, 'Learner session required');

    const save = await putJson(
      baseUrl,
      '/api/learner/questionnaire',
      {
        grade: '五年级',
        dailyMinutes: '20',
        favoriteFigure: 'Mulan',
        favoriteQuestion: 'Why?',
        guardianConsent: true,
      },
      { cookie: adminCookie }
    );
    const saveJson = await save.json();
    assert.equal(save.status, 403);
    assert.equal(saveJson.error, 'Learner session required');
  } finally {
    await cleanup();
  }
});
