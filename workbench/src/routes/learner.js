const express = require('express');
const { readSession } = require('../auth');
const mockProvider = require('../ai/mock-provider');
const { id } = require('../db');
const { findWord, getWords } = require('../words');

const QUESTIONNAIRE_FIELDS = [
  'grade',
  'textbook',
  'englishLevel',
  'dailyMinutes',
  'audioExposure',
  'favoriteFigure',
  'favoriteQuestion',
  'parentPain',
  'expectedChange',
  'guardianConsent',
];

const REQUIRED_QUESTIONNAIRE_FIELDS = [
  'grade',
  'dailyMinutes',
  'favoriteFigure',
  'favoriteQuestion',
];

function requireLearnerSession(req, res, next) {
  const session = readSession(req);

  if (!session) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (session.role !== 'learner') {
    res.status(403).json({ error: 'Learner session required' });
    return;
  }

  req.learnerSession = session;
  next();
}

function normalizeAnswers(body) {
  const answers = {};
  for (const field of QUESTIONNAIRE_FIELDS) {
    if (field === 'guardianConsent') {
      answers[field] = body?.[field] === true;
    } else {
      answers[field] =
        typeof body?.[field] === 'string' ? body[field].trim() : '';
    }
  }
  return answers;
}

function parseQuestionnaire(row) {
  if (!row) return null;

  try {
    const parsed = JSON.parse(row.answers_json);
    const answers = {};
    for (const field of QUESTIONNAIRE_FIELDS) {
      if (field === 'guardianConsent') {
        answers[field] = parsed[field] === true;
      } else {
        answers[field] = typeof parsed[field] === 'string' ? parsed[field] : '';
      }
    }
    return answers;
  } catch {
    return null;
  }
}

function missingRequiredFields(answers) {
  return REQUIRED_QUESTIONNAIRE_FIELDS.filter((field) => !answers[field]);
}

function getProfile(db, learnerId) {
  const learner = db
    .prepare('select id, nickname, grade from learners where id = ?')
    .get(learnerId);

  if (!learner) return null;

  const questionnaire = db
    .prepare(
      `select answers_json
       from questionnaires
       where learner_id = ?
       order by created_at desc, id desc
       limit 1`
    )
    .get(learnerId);

  return {
    learner,
    questionnaire: parseQuestionnaire(questionnaire),
  };
}

function requireCurrentLearner(db, req, res) {
  const learner = db
    .prepare('select id, nickname, grade from learners where id = ?')
    .get(req.learnerSession.id);
  if (!learner) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return learner;
}

function statusForCount(count) {
  if (count >= 3) return 'captured';
  if (count > 0) return 'hunting';
  return 'new';
}

function countFrom(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
}

function readWordStateCounts(db, learnerId) {
  const rows = db
    .prepare(
      `select word_key, correct_count
       from word_states
       where learner_id = ?`
    )
    .all(learnerId);

  return rows.reduce((states, row) => {
    states[row.word_key] = row.correct_count;
    return states;
  }, {});
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

function normalizeFlashcardEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('Flashcard events are required');
  }

  return events.map((event) => {
    const wordKey = typeof event?.wordKey === 'string' ? event.wordKey.trim() : '';
    const result = typeof event?.result === 'string' ? event.result.trim() : '';

    if (!wordKey || !findWord(wordKey)) {
      throw new Error('Unknown flashcard word');
    }

    if (!['captured', 'familiar', 'skip'].includes(result)) {
      throw new Error('Invalid flashcard result');
    }

    return {
      wordKey,
      result,
    };
  });
}

function applyFlashcardResult(previousCount, result) {
  if (previousCount >= 3) return previousCount;
  if (result === 'captured') return 3;
  if (result === 'familiar') {
    return Math.min(2, Math.max(1, previousCount + 1));
  }
  return previousCount;
}

function applyStoredCounts(db, learnerId, events) {
  const counts = readWordStateCounts(db, learnerId);

  return events.map((event) => {
    const previousCount = countFrom(counts[event.wordKey]);
    const nextCount = applyFlashcardResult(previousCount, event.result);
    counts[event.wordKey] = nextCount;

    return {
      ...event,
      previousCount,
      nextCount,
      status: statusForCount(nextCount),
    };
  });
}

function countSessionEvents(events, predicate) {
  return events.filter((event) => predicate(event.nextCount)).length;
}

function parseDayNumber(value) {
  const dayNumber = Number(value);
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 7) {
    return null;
  }
  return dayNumber;
}

function normalizeChecklist(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Checklist is required');
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => {
      if (typeof entryValue === 'boolean') return [key, entryValue];
      if (entryValue === null || entryValue === undefined) return [key, ''];
      return [key, String(entryValue).trim()];
    })
  );
}

function parseDaySubmission(row) {
  return {
    dayNumber: row.day_number,
    checklist: JSON.parse(row.checklist_json),
  };
}

function parseLookupRecord(row) {
  return {
    id: row.id,
    type: row.type,
    text: row.text,
    context: row.context || '',
    dayNumber: row.day_number,
    result: JSON.parse(row.result_json),
    lookedUpAt: row.looked_up_at,
  };
}

function normalizeLookup(body) {
  const type = typeof body?.type === 'string' ? body.type.trim() : '';
  const text = typeof body?.text === 'string' ? body.text : '';
  const context = typeof body?.context === 'string' ? body.context : '';
  const trimmedText = text.trim();
  const trimmedContext = context.trim();
  const dayNumber =
    body?.dayNumber === undefined || body?.dayNumber === null || body?.dayNumber === ''
      ? null
      : parseDayNumber(body.dayNumber);

  if (!['word', 'sentence'].includes(type)) {
    throw new Error('Lookup type must be word or sentence');
  }
  if (!trimmedText) {
    throw new Error('Lookup text is required');
  }
  if (body?.dayNumber !== undefined && body?.dayNumber !== null && body?.dayNumber !== '' && !dayNumber) {
    throw new Error('Day number must be between 1 and 7');
  }

  return { type, text, context, trimmedText, trimmedContext, dayNumber };
}

function createLearnerRouter(db) {
  if (!db) {
    throw new Error('createLearnerRouter(db) requires an open database connection');
  }

  const router = express.Router();

  router.use(requireLearnerSession);

  router.get('/profile', (req, res) => {
    const profile = getProfile(db, req.learnerSession.id);
    if (!profile) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    res.json(profile);
  });

  router.get('/words', (req, res) => {
    if (!requireCurrentLearner(db, req, res)) return;

    res.json({
      words: getWords(),
      states: readWordStateCounts(db, req.learnerSession.id),
    });
  });

  router.get('/flashcards/summary', (req, res) => {
    if (!requireCurrentLearner(db, req, res)) return;

    res.json(getFlashcardSummary(db, req.learnerSession.id));
  });

  router.post('/flashcards/session', (req, res) => {
    if (!requireCurrentLearner(db, req, res)) return;

    let events;
    try {
      events = normalizeFlashcardEvents(req.body?.events);
    } catch (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    const startedAt =
      typeof req.body?.startedAt === 'string' && req.body.startedAt.trim()
        ? req.body.startedAt.trim()
        : new Date().toISOString();
    const endedAt =
      typeof req.body?.endedAt === 'string' && req.body.endedAt.trim()
        ? req.body.endedAt.trim()
        : startedAt;
    const durationSeconds = countFrom(req.body?.durationSeconds);
    const sessionId = id('flashcard_session');
    const learnerId = req.learnerSession.id;
    const appliedEvents = applyStoredCounts(db, learnerId, events);
    const capturedCount = countSessionEvents(appliedEvents, (count) => count >= 3);
    const huntingCount = countSessionEvents(
      appliedEvents,
      (count) => count > 0 && count < 3
    );

    const saveSession = db.transaction(() => {
      db.prepare(
        `insert into flashcard_sessions (
           id, learner_id, started_at, ended_at, duration_seconds,
           card_count, captured_count, hunting_count
         )
         values (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        sessionId,
        learnerId,
        startedAt,
        endedAt,
        durationSeconds,
        appliedEvents.length,
        capturedCount,
        huntingCount
      );

      for (const event of appliedEvents) {
        db.prepare(
          `insert into flashcard_events (
             id, session_id, learner_id, word_key, result,
             previous_count, next_count
           )
           values (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id('flashcard_event'),
          sessionId,
          learnerId,
          event.wordKey,
          event.result,
          event.previousCount,
          event.nextCount
        );

        db.prepare(
          `insert into word_states (
             id, learner_id, word_key, status, correct_count,
             last_seen_at, updated_at
           )
           values (?, ?, ?, ?, ?, ?, datetime('now'))
           on conflict(learner_id, word_key) do update set
             status = excluded.status,
             correct_count = excluded.correct_count,
             last_seen_at = excluded.last_seen_at,
             updated_at = datetime('now')`
        ).run(
          id('word_state'),
          learnerId,
          event.wordKey,
          event.status,
          event.nextCount,
          endedAt
        );
      }
    });

    saveSession();

    res.json({
      session: {
        id: sessionId,
        cardCount: appliedEvents.length,
        capturedCount,
        huntingCount,
      },
      summary: getFlashcardSummary(db, learnerId),
    });
  });

  router.get('/day-submissions', (req, res) => {
    if (!requireCurrentLearner(db, req, res)) return;

    const rows = db
      .prepare(
        `select day_number, checklist_json
         from day_submissions
         where learner_id = ?
         order by day_number`
      )
      .all(req.learnerSession.id);

    res.json({ submissions: rows.map(parseDaySubmission) });
  });

  router.put('/day-submissions/:dayNumber', (req, res) => {
    if (!requireCurrentLearner(db, req, res)) return;

    const dayNumber = parseDayNumber(req.params.dayNumber);
    if (!dayNumber) {
      res.status(400).json({ error: 'Day number must be between 1 and 7' });
      return;
    }

    let checklist;
    try {
      checklist = normalizeChecklist(req.body?.checklist);
    } catch (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    const submissionId = id('day_submission');
    const checklistJson = JSON.stringify(checklist);

    db.prepare(
      `insert into day_submissions (
         id, learner_id, day_number, checklist_json, updated_at
       )
       values (?, ?, ?, ?, datetime('now'))
       on conflict(learner_id, day_number) do update set
         checklist_json = excluded.checklist_json,
         submitted_at = datetime('now'),
         updated_at = datetime('now')`
    ).run(submissionId, req.learnerSession.id, dayNumber, checklistJson);

    res.json({
      submission: {
        dayNumber,
        checklist,
      },
    });
  });

  router.get('/lookups', (req, res) => {
    if (!requireCurrentLearner(db, req, res)) return;

    const rows = db
      .prepare(
        `select id, type, text, context, day_number, result_json, looked_up_at
         from lookup_records
         where learner_id = ?
         order by looked_up_at desc, rowid desc`
      )
      .all(req.learnerSession.id);

    res.json({ lookups: rows.map(parseLookupRecord) });
  });

  router.post('/lookups', (req, res) => {
    if (!requireCurrentLearner(db, req, res)) return;

    let lookupInput;
    try {
      lookupInput = normalizeLookup(req.body);
    } catch (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    const result = mockProvider.lookup({
      type: lookupInput.type,
      text: lookupInput.trimmedText,
      context: lookupInput.trimmedContext,
    });
    const lookupId = id('lookup');

    db.prepare(
      `insert into lookup_records (
         id, learner_id, day_number, type, text, context, result_json
       )
       values (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      lookupId,
      req.learnerSession.id,
      lookupInput.dayNumber,
      lookupInput.type,
      lookupInput.text,
      lookupInput.context,
      JSON.stringify(result)
    );

    res.json({
      lookup: {
        id: lookupId,
        type: lookupInput.type,
        text: lookupInput.text,
        context: lookupInput.context,
        dayNumber: lookupInput.dayNumber,
        result,
      },
    });
  });

  router.put('/questionnaire', (req, res) => {
    const answers = normalizeAnswers(req.body);

    if (answers.guardianConsent !== true) {
      res.status(400).json({ error: 'Guardian consent is required' });
      return;
    }

    const missingFields = missingRequiredFields(answers);
    if (missingFields.length > 0) {
      res.status(400).json({
        error: 'Required questionnaire fields are missing',
        fields: missingFields,
      });
      return;
    }

    const learner = db
      .prepare('select id, nickname, grade from learners where id = ?')
      .get(req.learnerSession.id);
    if (!learner) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const save = db.transaction(() => {
      if (answers.grade) {
        db.prepare(
          `update learners
           set grade = ?, updated_at = datetime('now')
           where id = ?`
        ).run(answers.grade, learner.id);
      }

      const existing = db
        .prepare('select id from questionnaires where learner_id = ?')
        .get(learner.id);
      const answersJson = JSON.stringify(answers);

      if (existing) {
        db.prepare(
          `update questionnaires
           set answers_json = ?, submitted_at = datetime('now')
           where id = ?`
        ).run(answersJson, existing.id);
      } else {
        db.prepare(
          `insert into questionnaires (id, learner_id, answers_json)
           values (?, ?, ?)`
        ).run(id('questionnaire'), learner.id, answersJson);
      }
    });

    save();

    res.json({ questionnaire: answers });
  });

  return router;
}

module.exports = { createLearnerRouter };
