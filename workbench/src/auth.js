const crypto = require('node:crypto');
const config = require('./config');

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(value) {
  return crypto
    .createHmac('sha256', config.cookieSecret)
    .update(value)
    .digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function signSession(payload) {
  const body = base64UrlEncode(JSON.stringify({ role: payload.role, id: payload.id }));
  return `${body}.${sign(body)}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string') return null;

  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) return null;
  if (!safeEqual(sign(body), signature)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(body));
    if (!payload || !payload.role || !payload.id) return null;
    if (!['admin', 'learner'].includes(payload.role)) return null;
    return { role: payload.role, id: payload.id };
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }

  return cookies;
}

function readSession(req) {
  const token = parseCookies(req.headers.cookie)[config.cookieName];
  return verifySession(token);
}

function writeSession(res, payload) {
  res.cookie(config.cookieName, signSession(payload), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
}

function clearSession(res) {
  res.cookie(config.cookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

module.exports = {
  signSession,
  verifySession,
  readSession,
  writeSession,
  clearSession,
};
