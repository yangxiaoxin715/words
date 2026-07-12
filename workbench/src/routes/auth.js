const express = require('express');
const { clearSession, readSession, writeSession } = require('../auth');

function sessionJson(db, session) {
  if (!session) return { authenticated: false };

  if (session.role === 'admin') {
    const admin = db
      .prepare('select id, display_name from admin_users where id = ?')
      .get(session.id);
    if (!admin) return { authenticated: false };
    return {
      authenticated: true,
      role: 'admin',
      id: admin.id,
      displayName: admin.display_name,
    };
  }

  if (session.role === 'learner') {
    const learner = db
      .prepare('select id, nickname from learners where id = ?')
      .get(session.id);
    if (!learner) return { authenticated: false };
    return {
      authenticated: true,
      role: 'learner',
      id: learner.id,
      nickname: learner.nickname,
    };
  }

  return { authenticated: false };
}

function createAuthRouter(db) {
  if (!db) {
    throw new Error('createAuthRouter(db) requires an open database connection');
  }

  const router = express.Router();

  router.post('/login', (req, res) => {
    const accessCode =
      typeof req.body?.accessCode === 'string' ? req.body.accessCode.trim() : '';

    if (!accessCode) {
      res.status(401).json({ authenticated: false, error: 'Invalid access code' });
      return;
    }

    const admin = db
      .prepare('select id, display_name from admin_users where access_code = ?')
      .get(accessCode);
    if (admin) {
      writeSession(res, { role: 'admin', id: admin.id });
      res.json({
        authenticated: true,
        role: 'admin',
        id: admin.id,
        displayName: admin.display_name,
      });
      return;
    }

    const learner = db
      .prepare('select id, nickname from learners where access_code = ?')
      .get(accessCode);
    if (learner) {
      writeSession(res, { role: 'learner', id: learner.id });
      res.json({
        authenticated: true,
        role: 'learner',
        id: learner.id,
        nickname: learner.nickname,
      });
      return;
    }

    res.status(401).json({ authenticated: false, error: 'Invalid access code' });
  });

  router.post('/logout', (req, res) => {
    clearSession(res);
    res.json({ authenticated: false });
  });

  router.get('/session', (req, res) => {
    res.json(sessionJson(db, readSession(req)));
  });

  return router;
}

module.exports = { createAuthRouter };
