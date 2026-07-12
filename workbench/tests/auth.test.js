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

function startAuthTestApp() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-auth-'));
  const db = openDb(path.join(tmpDir, 'test.sqlite'));
  seed(db);

  const app = createApp({ db });
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
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

test('access-code login creates learner and admin sessions', async () => {
  const { baseUrl, cleanup } = await startAuthTestApp();

  try {
    const learnerLogin = await postJson(baseUrl, '/api/login', {
      accessCode: 'apple-demo',
    });
    const learnerJson = await learnerLogin.json();
    const learnerCookie = learnerLogin.headers.get('set-cookie');

    assert.equal(learnerLogin.status, 200);
    assert.equal(learnerJson.authenticated, true);
    assert.equal(learnerJson.role, 'learner');
    assert.equal(learnerJson.nickname, 'Apple');
    assert.ok(learnerJson.id);
    assert.match(learnerCookie, /HttpOnly/i);
    assert.match(learnerCookie, /SameSite=Lax/i);
    assert.match(learnerCookie, /Path=\//i);

    const learnerSession = await fetch(`${baseUrl}/api/session`, {
      headers: { cookie: learnerCookie },
    });
    const learnerSessionJson = await learnerSession.json();

    assert.equal(learnerSession.status, 200);
    assert.deepEqual(learnerSessionJson, learnerJson);

    const adminLogin = await postJson(baseUrl, '/api/login', {
      accessCode: 'admin-demo',
    });
    const adminJson = await adminLogin.json();
    const adminCookie = adminLogin.headers.get('set-cookie');

    assert.equal(adminLogin.status, 200);
    assert.equal(adminJson.authenticated, true);
    assert.equal(adminJson.role, 'admin');
    assert.equal(adminJson.displayName, '点妈');
    assert.ok(adminJson.id);
    assert.match(adminCookie, /HttpOnly/i);
    assert.match(adminCookie, /SameSite=Lax/i);
  } finally {
    await cleanup();
  }
});

test('bad access code is rejected', async () => {
  const { baseUrl, cleanup } = await startAuthTestApp();

  try {
    const res = await postJson(baseUrl, '/api/login', {
      accessCode: 'missing-code',
    });
    const json = await res.json();

    assert.equal(res.status, 401);
    assert.deepEqual(json, { authenticated: false, error: 'Invalid access code' });
    assert.equal(res.headers.get('set-cookie'), null);
  } finally {
    await cleanup();
  }
});

test('logout clears session cookie', async () => {
  const { baseUrl, cleanup } = await startAuthTestApp();

  try {
    const login = await postJson(baseUrl, '/api/login', {
      accessCode: 'apple-demo',
    });
    const cookie = login.headers.get('set-cookie');

    const logout = await postJson(baseUrl, '/api/logout', {}, { cookie });
    const logoutJson = await logout.json();
    const clearCookie = logout.headers.get('set-cookie');

    assert.equal(logout.status, 200);
    assert.deepEqual(logoutJson, { authenticated: false });
    assert.match(clearCookie, /Max-Age=0/i);
    assert.match(clearCookie, /SameSite=Lax/i);
  } finally {
    await cleanup();
  }
});

test('tampered session cookie is rejected', async () => {
  const { baseUrl, cleanup } = await startAuthTestApp();

  try {
    const login = await postJson(baseUrl, '/api/login', {
      accessCode: 'apple-demo',
    });
    const cookie = login.headers.get('set-cookie');
    const [cookiePair] = cookie.split(';');
    const [cookieName, token] = cookiePair.split('=');
    const [body, signature] = token.split('.');
    const tamperedBody = `${body.slice(0, -1)}${body.endsWith('A') ? 'B' : 'A'}`;
    const tamperedCookie = `${cookieName}=${tamperedBody}.${signature}`;

    const session = await fetch(`${baseUrl}/api/session`, {
      headers: { cookie: tamperedCookie },
    });
    const json = await session.json();

    assert.equal(session.status, 200);
    assert.deepEqual(json, { authenticated: false });
  } finally {
    await cleanup();
  }
});
