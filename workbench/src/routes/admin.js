const express = require('express');
const { readSession } = require('../auth');
const mockProvider = require('../ai/mock-provider');
const { id } = require('../db');
const { getWords } = require('../words');

function requireAdminSession(req, res, next) {
  const session = readSession(req);

  if (!session) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (session.role !== 'admin') {
    res.status(403).json({ error: 'Admin session required' });
    return;
  }

  req.adminSession = session;
  next();
}

function requireCurrentAdmin(db, req, res) {
  const admin = db
    .prepare('select id, display_name from admin_users where id = ?')
    .get(req.adminSession.id);
  if (!admin) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return admin;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getQuestionnaire(db, learnerId) {
  const row = db
    .prepare(
      `select answers_json
       from questionnaires
       where learner_id = ?
       order by submitted_at desc, rowid desc
       limit 1`
    )
    .get(learnerId);
  return row ? parseJson(row.answers_json, null) : null;
}

function getFlashcardSummary(db, learnerId) {
  const row = db
    .prepare(
      `select
         sum(case when correct_count >= 3 then 1 else 0 end) as captured,
         sum(case when correct_count > 0 and correct_count < 3 then 1 else 0 end) as hunting
       from word_states
       where learner_id = ?`
    )
    .get(learnerId);
  const captured = Number(row?.captured || 0);
  const hunting = Number(row?.hunting || 0);

  return {
    captured,
    hunting,
    unseen: Math.max(getWords().length - captured - hunting, 0),
  };
}

function getDaySubmissions(db, learnerId) {
  return db
    .prepare(
      `select day_number, checklist_json, submitted_at
       from day_submissions
       where learner_id = ?
       order by day_number`
    )
    .all(learnerId)
    .map((row) => ({
      dayNumber: row.day_number,
      checklist: parseJson(row.checklist_json, {}),
      submittedAt: row.submitted_at,
    }));
}

function getLookupRecords(db, learnerId) {
  return db
    .prepare(
      `select id, type, text, context, day_number, result_json, looked_up_at
       from lookup_records
       where learner_id = ?
       order by looked_up_at desc, rowid desc`
    )
    .all(learnerId)
    .map((row) => ({
      id: row.id,
      type: row.type,
      text: row.text,
      context: row.context || '',
      dayNumber: row.day_number,
      result: parseJson(row.result_json, {}),
      lookedUpAt: row.looked_up_at,
    }));
}

function getTeacherNotes(db, learnerId) {
  return db
    .prepare(
      `select id, note_text, wechat_state, created_at
       from teacher_notes
       where learner_id = ?
       order by created_at desc, rowid desc`
    )
    .all(learnerId)
    .map((row) => ({
      id: row.id,
      noteText: row.note_text,
      wechatState: row.wechat_state || '',
      createdAt: row.created_at,
    }));
}

function getGeneratedDrafts(db, learnerId) {
  return db
    .prepare(
      `select id, source_episode_id, draft_json, status, created_at
       from generated_drafts
       where learner_id = ?
       order by created_at desc, rowid desc`
    )
    .all(learnerId)
    .map((row) => ({
      id: row.id,
      sourceEpisodeId: row.source_episode_id,
      draft: parseJson(row.draft_json, {}),
      status: row.status,
      createdAt: row.created_at,
    }));
}

function serializeDraftRow(row) {
  return {
    id: row.id,
    sourceEpisodeId: row.source_episode_id,
    draft: parseJson(row.draft_json, {}),
    status: row.status,
    createdAt: row.created_at,
  };
}

function getLearner(db, learnerId) {
  return db
    .prepare('select id, nickname, grade, created_at from learners where id = ?')
    .get(learnerId);
}

function createAdminRouter(db) {
  if (!db) {
    throw new Error('createAdminRouter(db) requires an open database connection');
  }

  const router = express.Router();

  router.use(requireAdminSession);

  router.get('/learners', (req, res) => {
    if (!requireCurrentAdmin(db, req, res)) return;

    const learners = db
      .prepare('select id, nickname, grade, created_at from learners order by created_at, rowid')
      .all()
      .map((learner) => ({
        ...learner,
        flashcardSummary: getFlashcardSummary(db, learner.id),
        daySubmissionCount: db
          .prepare('select count(*) as count from day_submissions where learner_id = ?')
          .get(learner.id).count,
        lookupCount: db
          .prepare('select count(*) as count from lookup_records where learner_id = ?')
          .get(learner.id).count,
      }));

    res.json({ learners });
  });

  router.get('/learners/:learnerId', (req, res) => {
    if (!requireCurrentAdmin(db, req, res)) return;

    const learner = getLearner(db, req.params.learnerId);
    if (!learner) {
      res.status(404).json({ error: 'Learner not found' });
      return;
    }

    res.json({
      learner,
      questionnaire: getQuestionnaire(db, learner.id),
      flashcardSummary: getFlashcardSummary(db, learner.id),
      wordCount: getWords().length,
      daySubmissions: getDaySubmissions(db, learner.id),
      lookupRecords: getLookupRecords(db, learner.id),
      teacherNotes: getTeacherNotes(db, learner.id),
      generatedDrafts: getGeneratedDrafts(db, learner.id),
    });
  });

  router.get('/learners/:learnerId/drafts', (req, res) => {
    if (!requireCurrentAdmin(db, req, res)) return;

    const learner = getLearner(db, req.params.learnerId);
    if (!learner) {
      res.status(404).json({ error: 'Learner not found' });
      return;
    }

    res.json({ drafts: getGeneratedDrafts(db, learner.id) });
  });

  router.post('/learners/:learnerId/drafts', (req, res) => {
    if (!requireCurrentAdmin(db, req, res)) return;

    const learner = getLearner(db, req.params.learnerId);
    if (!learner) {
      res.status(404).json({ error: 'Learner not found' });
      return;
    }

    const draft = mockProvider.generateDraft({
      learner,
      questionnaire: getQuestionnaire(db, learner.id),
      flashcardSummary: getFlashcardSummary(db, learner.id),
      daySubmissions: getDaySubmissions(db, learner.id),
      lookupRecords: getLookupRecords(db, learner.id),
    });
    const draftId = id('draft');

    db.prepare(
      `insert into generated_drafts (
         id, learner_id, draft_json, status
       )
       values (?, ?, ?, ?)`
    ).run(draftId, learner.id, JSON.stringify(draft), 'draft');

    const row = db
      .prepare(
        `select id, source_episode_id, draft_json, status, created_at
         from generated_drafts
         where id = ?`
      )
      .get(draftId);

    res.json({ draft: serializeDraftRow(row) });
  });

  return router;
}

module.exports = { createAdminRouter };
