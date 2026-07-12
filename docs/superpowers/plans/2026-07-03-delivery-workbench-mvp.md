# 2000词交付工作台 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private learner delivery-record system that tracks flashcard data, questionnaire data, seven-day checklist submissions, lookup records, story guesses, and teacher-side next-episode draft generation.

**Architecture:** Keep the existing static Word Hunter page untouched for public fallback, and add a new `workbench/` Node application for the private delivery system. The app uses server-rendered/static pages plus JSON APIs, stores data in SQLite for the first domestic-server deployment, and keeps AI provider calls behind a server-side adapter so API keys never reach the browser.

**Tech Stack:** Node.js, Express, better-sqlite3, vanilla HTML/CSS/JS, built-in `node:test`, existing `words-data.js`, domestic cloud ECS-compatible deployment.

---

## Scope

This plan implements the first testable website version:

- Learner access-code login.
- Parent consent and questionnaire.
- Flashcard session tracking using the current 1000-word data.
- Day1-Day7 checklist submissions.
- Controlled word/sentence lookup records with a mock AI response first.
- Day6/Day7 story guesses.
- Admin learner list and learner detail.
- Admin next-episode English draft generation with a mock provider first.

Out of scope for this MVP:

- Public registration.
- Payment.
- SMS login.
- Audio generation.
- Class statistics.
- Full AI provider production integration.
- Deployment automation.

## File Structure

Create a new app under `workbench/`:

- `workbench/package.json`: workbench scripts and dependencies.
- `workbench/src/server.js`: Express app setup, middleware, static file serving, API route registration.
- `workbench/src/config.js`: environment parsing and runtime defaults.
- `workbench/src/db.js`: SQLite connection, migrations, and query helpers.
- `workbench/src/schema.sql`: database schema.
- `workbench/src/seed.js`: local seed data for one admin and two sample learners.
- `workbench/src/words.js`: loads existing root `words-data.js` and exposes normalized words.
- `workbench/src/auth.js`: access-code session cookie helpers.
- `workbench/src/ai/mock-provider.js`: deterministic lookup and story draft generator used before real API keys exist.
- `workbench/src/routes/auth.js`: login/logout/session routes.
- `workbench/src/routes/learner.js`: questionnaire, flashcards, checklist, lookup, guess routes.
- `workbench/src/routes/admin.js`: admin learner list, learner detail, draft generation routes.
- `workbench/public/index.html`: private learner shell.
- `workbench/public/admin.html`: admin shell.
- `workbench/public/styles.css`: shared workbench UI styles.
- `workbench/public/learner.js`: learner-side browser logic.
- `workbench/public/admin.js`: admin-side browser logic.
- `workbench/tests/*.test.js`: API and data tests.
- `docs/product/2000词交付工作台产品方案_2026-07-03.md`: existing product source.
- `docs/deployment/domestic-workbench-deployment.md`: domestic deployment notes.

## Data Model

Use these tables in `workbench/src/schema.sql`:

- `learners`: learner profile and access code.
- `admin_users`: admin display name and access code.
- `questionnaires`: parent-filled onboarding answers.
- `word_states`: one row per learner and word key.
- `flashcard_sessions`: one row per flashcard practice session.
- `flashcard_events`: individual word answers.
- `story_episodes`: story metadata and text.
- `day_submissions`: Day1-Day7 checklist records.
- `lookup_records`: controlled lookup records.
- `story_guesses`: Day6/Day7 story guesses.
- `teacher_notes`: WeChat state notes entered by teacher.
- `generated_drafts`: next-episode draft output and review state.

Use access codes in MVP. Store them as plain seed values only for local testing; before real deployment, replace them with hashed values or one-time enrollment codes.

## Task 1: Scaffold Workbench App

**Files:**
- Create: `workbench/package.json`
- Create: `workbench/src/config.js`
- Create: `workbench/src/server.js`
- Create: `workbench/public/index.html`
- Create: `workbench/public/admin.html`
- Create: `workbench/public/styles.css`
- Create: `workbench/tests/health.test.js`

- [ ] **Step 1: Add workbench package**

Create `workbench/package.json`:

```json
{
  "name": "word-hunter-workbench",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "dev": "node src/server.js",
    "test": "node --test tests/*.test.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "express": "^4.21.2"
  }
}
```

- [ ] **Step 2: Add runtime config**

Create `workbench/src/config.js`:

```js
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
```

- [ ] **Step 3: Add minimal server**

Create `workbench/src/server.js`:

```js
const express = require('express');
const path = require('node:path');
const config = require('./config');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(config.appDir, 'public')));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'word-hunter-workbench' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Workbench listening on http://127.0.0.1:${config.port}`);
  });
}

module.exports = { createApp };
```

- [ ] **Step 4: Add static shells**

Create `workbench/public/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>单词猎人学员工具</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="shell">
    <h1>单词猎人学员工具</h1>
    <p>仅限已授权学员使用。</p>
    <section id="app">正在加载…</section>
  </main>
  <script src="/learner.js"></script>
</body>
</html>
```

Create `workbench/public/admin.html`:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>2000词交付工作台</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="shell wide">
    <h1>2000词交付工作台</h1>
    <section id="adminApp">正在加载…</section>
  </main>
  <script src="/admin.js"></script>
</body>
</html>
```

Create `workbench/public/styles.css`:

```css
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif;
  background: #f6f7f9;
  color: #1d1d1f;
}
.shell {
  width: min(720px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 32px 0 56px;
}
.shell.wide { width: min(1120px, calc(100vw - 32px)); }
.panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
  margin: 16px 0;
}
button, input, textarea, select {
  font: inherit;
}
button {
  border: 0;
  border-radius: 8px;
  padding: 12px 16px;
  background: #1f6feb;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}
button.secondary { background: #eef2f7; color: #1d1d1f; }
input, textarea, select {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 11px 12px;
  margin-top: 6px;
}
textarea { min-height: 92px; resize: vertical; }
label { display: block; margin: 12px 0; font-weight: 650; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: Add health test**

Create `workbench/tests/health.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');

test('health endpoint returns service status', async () => {
  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(json, { ok: true, service: 'word-hunter-workbench' });
  } finally {
    server.close();
  }
});
```

- [ ] **Step 6: Install and run**

Run:

```bash
cd workbench
npm install
npm test
```

Expected: one passing test.

- [ ] **Step 7: Commit**

```bash
git add workbench
git commit -m "Create delivery workbench app shell"
```

## Task 2: Add Database Schema, Migrations, and Seed Data

**Files:**
- Create: `workbench/src/schema.sql`
- Create: `workbench/src/db.js`
- Create: `workbench/src/seed.js`
- Create: `workbench/tests/db.test.js`

- [ ] **Step 1: Add schema**

Create `workbench/src/schema.sql` with the tables listed in the Data Model section. Use `text` IDs generated in application code, `datetime('now')` timestamps, and unique constraints on learner access code and learner-word key.

- [ ] **Step 2: Add database helper**

Create `workbench/src/db.js` with:

```js
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('./config');

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function openDb(dbPath = config.dbPath) {
  ensureDir(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = { openDb, id };
```

- [ ] **Step 3: Add seed script**

Create `workbench/src/seed.js` that inserts:

- Admin: display name `点妈`, access code `admin-demo`.
- Learner: nickname `Apple`, access code `apple-demo`, grade `四年级`.
- Learner: nickname `果冻`, access code `guodong-demo`, grade `四年级`.

The script should use `insert or ignore` so it can run repeatedly.

- [ ] **Step 4: Add database test**

Create `workbench/tests/db.test.js` to open a temp database, run migrations, insert one learner, and verify it can be read back.

- [ ] **Step 5: Run tests**

Run:

```bash
cd workbench
npm test
```

Expected: health and db tests pass.

- [ ] **Step 6: Commit**

```bash
git add workbench/src/schema.sql workbench/src/db.js workbench/src/seed.js workbench/tests/db.test.js
git commit -m "Add workbench database schema"
```

## Task 3: Add Access-Code Login

**Files:**
- Create: `workbench/src/auth.js`
- Create: `workbench/src/routes/auth.js`
- Modify: `workbench/src/server.js`
- Create: `workbench/public/learner.js`
- Create: `workbench/public/admin.js`
- Create: `workbench/tests/auth.test.js`

- [ ] **Step 1: Implement signed session helper**

Use Node `crypto.createHmac('sha256', config.cookieSecret)` to sign a JSON payload containing `{ role, id }`. Store as HTTP-only cookie.

- [ ] **Step 2: Add auth routes**

Implement:

- `POST /api/login` with `{ accessCode }`.
- `POST /api/logout`.
- `GET /api/session`.

Login checks `admin_users.access_code` first, then `learners.access_code`.

- [ ] **Step 3: Wire routes into server**

In `workbench/src/server.js`, initialize `db = openDb()` and register auth routes before static fallbacks.

- [ ] **Step 4: Add browser login UI**

`learner.js` and `admin.js` should both render an access-code form when `/api/session` returns no session. Learner login redirects to learner screen; admin login redirects to admin screen.

- [ ] **Step 5: Test login**

Add `workbench/tests/auth.test.js`:

- Seed a learner and admin.
- `POST /api/login` with `apple-demo` returns learner session.
- `POST /api/login` with `admin-demo` returns admin session.
- Bad access code returns 401.

- [ ] **Step 6: Commit**

```bash
git add workbench/src/auth.js workbench/src/routes/auth.js workbench/src/server.js workbench/public/learner.js workbench/public/admin.js workbench/tests/auth.test.js
git commit -m "Add access-code login"
```

## Task 4: Add Questionnaire Flow

**Files:**
- Create: `workbench/src/routes/learner.js`
- Modify: `workbench/src/server.js`
- Modify: `workbench/public/learner.js`
- Create: `workbench/tests/questionnaire.test.js`

- [ ] **Step 1: Add questionnaire API**

Implement:

- `GET /api/learner/profile`
- `PUT /api/learner/questionnaire`

Fields:

- `grade`
- `textbook`
- `englishLevel`
- `dailyMinutes`
- `audioExposure`
- `favoriteFigure`
- `favoriteQuestion`
- `parentPain`
- `expectedChange`
- `guardianConsent`

Reject save when `guardianConsent` is not `true`.

- [ ] **Step 2: Add learner form**

After login, if no questionnaire exists, render the questionnaire form. Use required fields for grade, daily minutes, favorite figure, favorite question, and guardian consent.

- [ ] **Step 3: Test questionnaire save**

Add API tests for:

- Consent missing returns 400.
- Valid questionnaire saves and can be read.

- [ ] **Step 4: Commit**

```bash
git add workbench/src/routes/learner.js workbench/src/server.js workbench/public/learner.js workbench/tests/questionnaire.test.js
git commit -m "Add learner questionnaire flow"
```

## Task 5: Add Word Data API and Flashcard Tracking

**Files:**
- Create: `workbench/src/words.js`
- Modify: `workbench/src/routes/learner.js`
- Modify: `workbench/public/learner.js`
- Create: `workbench/tests/flashcards.test.js`

- [ ] **Step 1: Load existing word data**

`workbench/src/words.js` should read root `words-data.js` in a VM context, normalize words into:

```js
{
  key,
  english,
  chinese,
  position,
  poolId,
  stageLabel,
  stageName,
  useStage,
  storyRole,
  tags
}
```

- [ ] **Step 2: Add word and session APIs**

Implement:

- `GET /api/learner/words`
- `GET /api/learner/flashcards/summary`
- `POST /api/learner/flashcards/session`

Session payload:

```json
{
  "startedAt": "2026-07-03T10:00:00.000Z",
  "endedAt": "2026-07-03T10:05:00.000Z",
  "durationSeconds": 300,
  "events": [
    { "wordKey": "apple", "result": "captured", "previousCount": 2, "nextCount": 3 }
  ]
}
```

- [ ] **Step 3: Add learner flashcard page**

Render a compact flashcard practice page using existing rules:

- Captured when count reaches 3.
- Familiar increments to at least 1 and below 3.
- Skip keeps current count.
- Save session when learner exits or finishes 20 cards.

- [ ] **Step 4: Test flashcard summary**

Tests should verify:

- Posting captured event updates `word_states`.
- Summary returns captured, hunting, and unseen counts.
- Session duration is stored.

- [ ] **Step 5: Commit**

```bash
git add workbench/src/words.js workbench/src/routes/learner.js workbench/public/learner.js workbench/tests/flashcards.test.js
git commit -m "Add flashcard tracking"
```

## Task 6: Add Day1-Day7 Checklist and Submissions

**Files:**
- Modify: `workbench/src/routes/learner.js`
- Modify: `workbench/public/learner.js`
- Create: `workbench/tests/day-submissions.test.js`

- [ ] **Step 1: Define checklist config**

Add a constant in `learner.js` and matching server validation for Day1-Day7:

- Day1: listened, heard words, first guess, child question.
- Day2: read text, known words, understood sentences, target listening words.
- Day3: audio-text alignment, stuck sentences, reading pace.
- Day4: lookup key sentences, keywords, re-listen result.
- Day5: story summary, read sentences.
- Day6: six story questions, guess, guess reason.
- Day7: Day1 comparison, final guess, next episode interest.

- [ ] **Step 2: Add submission API**

Implement:

- `GET /api/learner/day-submissions`
- `PUT /api/learner/day-submissions/:dayNumber`

Reject day numbers outside 1-7.

- [ ] **Step 3: Add checklist UI**

Render tabs or segmented buttons for Day1-Day7. Each day shows checkboxes and small text fields only for that day.

- [ ] **Step 4: Test day submission**

Tests verify saving Day6 guess and reading it back.

- [ ] **Step 5: Commit**

```bash
git add workbench/src/routes/learner.js workbench/public/learner.js workbench/tests/day-submissions.test.js
git commit -m "Add seven-day checklist submissions"
```

## Task 7: Add Controlled Lookup Records

**Files:**
- Create: `workbench/src/ai/mock-provider.js`
- Modify: `workbench/src/routes/learner.js`
- Modify: `workbench/public/learner.js`
- Create: `workbench/tests/lookup.test.js`

- [ ] **Step 1: Add mock lookup provider**

The mock provider accepts `{ type, text, context }` and returns:

```js
{
  meaning: '这句话大概是在推进故事情节。',
  keyWords: ['请老师审核关键词'],
  contextClue: '先看前后两句，再回到音频里找声音。',
  relistenTip: '重听时注意这句话里的动作词。'
}
```

- [ ] **Step 2: Add lookup API**

Implement:

- `POST /api/learner/lookups`
- `GET /api/learner/lookups`

Only allow `type` values `word` and `sentence`.

- [ ] **Step 3: Add lookup UI**

Add a page section for Day4 controlled lookup:

- Select word or sentence.
- Text input.
- Context input.
- Save and show result.
- Do not provide full-text translation.

- [ ] **Step 4: Test lookup**

Tests verify sentence lookup saves original text and generated result.

- [ ] **Step 5: Commit**

```bash
git add workbench/src/ai/mock-provider.js workbench/src/routes/learner.js workbench/public/learner.js workbench/tests/lookup.test.js
git commit -m "Add controlled lookup records"
```

## Task 8: Add Admin Learner Detail

**Files:**
- Create: `workbench/src/routes/admin.js`
- Modify: `workbench/src/server.js`
- Modify: `workbench/public/admin.js`
- Create: `workbench/tests/admin.test.js`

- [ ] **Step 1: Add admin APIs**

Implement:

- `GET /api/admin/learners`
- `GET /api/admin/learners/:learnerId`

Require admin session.

Learner detail includes:

- profile
- questionnaire
- flashcard summary
- day submissions
- lookup records
- story guesses
- teacher notes
- generated drafts

- [ ] **Step 2: Add admin UI**

Admin page shows:

- learner list
- current day completion
- captured count
- last submission time
- detail panel

- [ ] **Step 3: Test admin access**

Tests verify learner session receives 403 for admin API and admin session receives learner data.

- [ ] **Step 4: Commit**

```bash
git add workbench/src/routes/admin.js workbench/src/server.js workbench/public/admin.js workbench/tests/admin.test.js
git commit -m "Add admin learner detail"
```

## Task 9: Add Next-Episode Draft Generation

**Files:**
- Modify: `workbench/src/ai/mock-provider.js`
- Modify: `workbench/src/routes/admin.js`
- Modify: `workbench/public/admin.js`
- Create: `workbench/tests/drafts.test.js`

- [ ] **Step 1: Add mock draft generator**

Input:

- learner profile
- questionnaire
- flashcard summary
- known words
- hunting words
- day submissions
- lookup records
- story guesses

Output:

```js
{
  title: 'Next Story Draft',
  body: 'The learner opened the book again. New words appeared.',
  targetWords: [],
  reviewWords: [],
  reviewNotes: ['请人工检查故事钩子、用词难度和孩子猜想是否被接住。']
}
```

- [ ] **Step 2: Add draft API**

Implement:

- `POST /api/admin/learners/:learnerId/drafts`
- `GET /api/admin/learners/:learnerId/drafts`

Store generated draft as JSON and `status = 'draft'`.

- [ ] **Step 3: Add admin button**

In learner detail, add “生成下一集原文草稿”. Show output in a review panel.

- [ ] **Step 4: Test draft generation**

Tests verify draft generation stores a draft tied to the learner.

- [ ] **Step 5: Commit**

```bash
git add workbench/src/ai/mock-provider.js workbench/src/routes/admin.js workbench/public/admin.js workbench/tests/drafts.test.js
git commit -m "Add next episode draft generation"
```

## Task 10: Add Privacy and Domestic Deployment Notes

**Files:**
- Create: `workbench/public/privacy.html`
- Create: `docs/deployment/domestic-workbench-deployment.md`
- Modify: `workbench/public/index.html`

- [ ] **Step 1: Add privacy page**

Create a short page explaining:

- site is for authorized learners only
- records learning delivery data
- does not collect ID card, face data, precise location, home address
- guardian can request deletion
- data is used for learning delivery and teacher feedback

- [ ] **Step 2: Link privacy page**

Add a footer link from learner shell to `/privacy.html`.

- [ ] **Step 3: Add deployment notes**

Create `docs/deployment/domestic-workbench-deployment.md` with:

- recommended early deployment: domestic ECS + Node + SQLite + Nginx
- later deployment: ECS + managed PostgreSQL/MySQL + OSS/COS
- ICP positioning: private learner delivery record tool
- homepage should only show login
- AI API keys stored in server environment variables
- daily SQLite backup command

- [ ] **Step 4: Commit**

```bash
git add workbench/public/privacy.html workbench/public/index.html docs/deployment/domestic-workbench-deployment.md
git commit -m "Document privacy and domestic deployment"
```

## Final Verification

- [ ] Run existing static app tests:

```bash
npm test
```

Expected: existing Word Hunter tests pass.

- [ ] Run workbench tests:

```bash
cd workbench
npm test
```

Expected: all workbench API/data tests pass.

- [ ] Start workbench:

```bash
cd workbench
npm run dev
```

Expected: server logs `Workbench listening on http://127.0.0.1:5057`.

- [ ] Browser verify learner path:

Open `http://127.0.0.1:5057/`, log in with `apple-demo`, fill questionnaire, run flashcards, submit Day6 guess, create lookup.

- [ ] Browser verify admin path:

Open `http://127.0.0.1:5057/admin.html`, log in with `admin-demo`, open Apple detail, generate next-episode draft.

- [ ] Commit final fixes:

```bash
git status --short
git add <changed files>
git commit -m "Polish delivery workbench MVP"
```

## User Cooperation Needed

No cooperation is required to build the local MVP.

Before real deployment, request these from Yangming:

1. Domestic cloud account choice: Tencent Cloud, Alibaba Cloud, Huawei Cloud, or another provider.
2. ICP备案主体 choice: personal first, or individual business/company if ready.
3. Domain name.
4. Official site name for备案, preferably “单词猎人学员工具” or “英语阅读打卡工具”.
5. AI provider choice and API key, preferably a domestic provider for production.
6. Privacy contact method for deletion requests.

## Self-Review

Spec coverage:

- Flashcard data tracking is covered by Task 5.
- Questionnaire is covered by Task 4.
- Seven-day checklist is covered by Task 6.
- Station lookup is covered by Task 7.
- Story guesses are included in Task 6 and admin detail in Task 8.
- Admin next-episode draft generation is covered by Task 9.
- Domestic private deployment and privacy notes are covered by Task 10.

Placeholder scan:

- This plan defines every route, file, and test target needed for MVP implementation.

Scope check:

- This is scoped to a local and domestic-server-ready MVP. It does not include payment, public registration, audio generation, or production AI integration.
