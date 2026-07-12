const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { openDb, id } = require('../src/db');
const { seed } = require('../src/seed');

function tableColumns(db, tableName) {
  return db
    .prepare(`pragma table_info(${tableName})`)
    .all()
    .map((column) => column.name);
}

function assertHasColumns(db, tableName, columnNames) {
  const columns = tableColumns(db, tableName);
  for (const columnName of columnNames) {
    assert.ok(
      columns.includes(columnName),
      `expected ${tableName}.${columnName}`
    );
  }
}

test('migrations create required tables and persist learners', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-db-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  const db = openDb(dbPath);

  try {
    const requiredTables = [
      'learners',
      'admin_users',
      'questionnaires',
      'word_states',
      'flashcard_sessions',
      'flashcard_events',
      'story_episodes',
      'day_submissions',
      'lookup_records',
      'story_guesses',
      'teacher_notes',
      'generated_drafts',
    ];

    const tables = db
      .prepare("select name from sqlite_master where type = 'table'")
      .all()
      .map((row) => row.name);

    for (const tableName of requiredTables) {
      assert.ok(tables.includes(tableName), `expected table ${tableName}`);
    }

    const learnerId = id('learner');
    db.prepare(
      'insert into learners (id, nickname, access_code, grade) values (?, ?, ?, ?)'
    ).run(learnerId, 'Test Learner', 'test-learner', '四年级');

    const learner = db
      .prepare('select id, nickname, access_code, grade from learners where id = ?')
      .get(learnerId);

    assert.deepEqual(learner, {
      id: learnerId,
      nickname: 'Test Learner',
      access_code: 'test-learner',
      grade: '四年级',
    });

    assert.throws(() => {
      db.prepare(
        'insert into learners (id, nickname, access_code) values (?, ?, ?)'
      ).run(id('learner'), 'Duplicate', 'test-learner');
    }, /UNIQUE/);

    db.prepare(
      'insert into word_states (id, learner_id, word_key, status, correct_count) values (?, ?, ?, ?, ?)'
    ).run(id('word_state'), learnerId, 'apple', 'captured', 3);
    assert.throws(() => {
      db.prepare(
        'insert into word_states (id, learner_id, word_key, status, correct_count) values (?, ?, ?, ?, ?)'
      ).run(id('word_state'), learnerId, 'apple', 'captured', 3);
    }, /UNIQUE/);

    db.prepare(
      'insert into questionnaires (id, learner_id, answers_json) values (?, ?, ?)'
    ).run(id('questionnaire'), learnerId, '{"grade":"四年级"}');
    assert.throws(() => {
      db.prepare(
        'insert into questionnaires (id, learner_id, answers_json) values (?, ?, ?)'
      ).run(id('questionnaire'), learnerId, '{"grade":"五年级"}');
    }, /UNIQUE/);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('schema stores planned flashcard lookup and draft payloads', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-db-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  const db = openDb(dbPath);

  try {
    assertHasColumns(db, 'flashcard_sessions', [
      'id',
      'learner_id',
      'started_at',
      'ended_at',
      'duration_seconds',
      'card_count',
      'captured_count',
      'hunting_count',
      'created_at',
    ]);
    assertHasColumns(db, 'flashcard_events', [
      'id',
      'session_id',
      'learner_id',
      'word_key',
      'result',
      'previous_count',
      'next_count',
      'answered_at',
      'created_at',
    ]);
    assertHasColumns(db, 'lookup_records', [
      'id',
      'learner_id',
      'story_episode_id',
      'day_number',
      'type',
      'text',
      'context',
      'result_json',
      'looked_up_at',
      'created_at',
    ]);
    assertHasColumns(db, 'generated_drafts', [
      'id',
      'learner_id',
      'source_episode_id',
      'draft_json',
      'status',
      'created_at',
      'updated_at',
    ]);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('migrations keep latest questionnaire before adding learner uniqueness', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-db-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  const legacyDb = new Database(dbPath);

  try {
    const learnerId = id('learner');
    legacyDb.exec(`
      create table learners (
        id text primary key,
        nickname text not null,
        access_code text not null unique,
        grade text
      );
      create table questionnaires (
        id text primary key,
        learner_id text not null,
        answers_json text not null,
        submitted_at text not null default (datetime('now')),
        created_at text not null default (datetime('now'))
      );
    `);
    legacyDb
      .prepare('insert into learners (id, nickname, access_code, grade) values (?, ?, ?, ?)')
      .run(learnerId, 'Legacy Learner', 'legacy-learner', '三年级');
    legacyDb
      .prepare(
        'insert into questionnaires (id, learner_id, answers_json, submitted_at, created_at) values (?, ?, ?, ?, ?)'
      )
      .run(
        'questionnaire_old',
        learnerId,
        '{"grade":"三年级"}',
        '2026-07-01 08:00:00',
        '2026-07-01 08:00:00'
      );
    legacyDb
      .prepare(
        'insert into questionnaires (id, learner_id, answers_json, submitted_at, created_at) values (?, ?, ?, ?, ?)'
      )
      .run(
        'questionnaire_new',
        learnerId,
        '{"grade":"四年级"}',
        '2026-07-02 08:00:00',
        '2026-07-02 08:00:00'
      );
    legacyDb.close();

    const db = openDb(dbPath);
    try {
      const rows = db
        .prepare('select id, answers_json from questionnaires where learner_id = ?')
        .all(learnerId);

      assert.deepEqual(rows, [
        { id: 'questionnaire_new', answers_json: '{"grade":"四年级"}' },
      ]);
      assert.throws(() => {
        db.prepare(
          'insert into questionnaires (id, learner_id, answers_json) values (?, ?, ?)'
        ).run(id('questionnaire'), learnerId, '{"grade":"五年级"}');
      }, /UNIQUE/);
    } finally {
      db.close();
    }
  } finally {
    if (legacyDb.open) legacyDb.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('seed inserts demo users once when run repeatedly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-db-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  const db = openDb(dbPath);

  try {
    seed(db);
    seed(db);

    const adminCount = db
      .prepare('select count(*) as count from admin_users')
      .get().count;
    const learnerCount = db
      .prepare('select count(*) as count from learners')
      .get().count;

    assert.equal(adminCount, 1);
    assert.equal(learnerCount, 2);
    assert.equal(
      db.prepare('select display_name from admin_users where access_code = ?')
        .get('admin-demo').display_name,
      '点妈'
    );
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
