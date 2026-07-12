const adminApp = document.getElementById('adminApp');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function fetchSession() {
  const res = await fetch('/api/session');
  return res.json();
}

async function fetchLearners() {
  const res = await fetch('/api/admin/learners');
  if (!res.ok) throw new Error('Unable to read learners');
  return res.json();
}

async function fetchLearnerDetail(learnerId) {
  const res = await fetch(`/api/admin/learners/${encodeURIComponent(learnerId)}`);
  if (!res.ok) throw new Error('Unable to read learner detail');
  return res.json();
}

async function postDraft(learnerId) {
  const res = await fetch(`/api/admin/learners/${encodeURIComponent(learnerId)}/drafts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Unable to generate draft');
  return res.json();
}

function renderLogin(error = '') {
  adminApp.innerHTML = `
    <section class="panel">
      <h2>老师登录</h2>
      <form id="loginForm">
        <label>
          访问码
          <input name="accessCode" autocomplete="one-time-code" required>
        </label>
        <button type="submit">进入工作台</button>
      </form>
      ${error ? `<p>${escapeHtml(error)}</p>` : ''}
    </section>
  `;

  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const accessCode = String(formData.get('accessCode') || '');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessCode }),
      });

      if (!res.ok) {
        renderLogin('访问码不对，请检查后再试。');
        return;
      }

      renderSession(await res.json());
    } catch {
      renderLogin('暂时无法登录，请稍后再试。');
    }
  });
}

function renderAdmin(session) {
  adminApp.innerHTML = `
    <section class="panel">
      <h2>${escapeHtml(session.displayName)}，交付工作台</h2>
      <button id="logoutButton" class="secondary" type="button">退出登录</button>
    </section>
    <section id="learnerListPanel" class="panel">
      <h2>学员列表</h2>
      <p>正在读取学员数据…</p>
    </section>
    <section id="learnerDetailPanel" class="panel">
      <h2>学员详情</h2>
      <p>选择一个学员查看交付记录。</p>
    </section>
  `;
  document.getElementById('logoutButton').addEventListener('click', logout);
  loadLearners();
}

function renderLearnerList(learners) {
  const panel = document.getElementById('learnerListPanel');
  if (!panel) return;

  panel.innerHTML = `
    <h2>学员列表</h2>
    <div class="table-list">
      ${learners.map((learner) => `
        <button class="row-button" data-learner-id="${escapeHtml(learner.id)}" type="button">
          <span><strong>${escapeHtml(learner.nickname)}</strong><br>${escapeHtml(learner.grade || '-')}</span>
          <span>已捕获 ${escapeHtml(learner.flashcardSummary.captured)}<br>打卡 ${escapeHtml(learner.daySubmissionCount)}</span>
          <span>查询 ${escapeHtml(learner.lookupCount)}</span>
        </button>
      `).join('')}
    </div>
  `;

  panel.querySelectorAll('[data-learner-id]').forEach((button) => {
    button.addEventListener('click', () => loadLearnerDetail(button.dataset.learnerId));
  });
}

function renderLearnerListError() {
  const panel = document.getElementById('learnerListPanel');
  if (!panel) return;

  panel.innerHTML = `
    <h2>学员列表</h2>
    <p>暂时无法读取学员数据。</p>
    <button id="reloadLearnersButton" class="secondary" type="button">重新读取</button>
  `;
  document.getElementById('reloadLearnersButton').addEventListener('click', loadLearners);
}

async function loadLearners() {
  try {
    const payload = await fetchLearners();
    renderLearnerList(payload.learners || []);
  } catch {
    renderLearnerListError();
  }
}

function renderLearnerDetail(detail) {
  const panel = document.getElementById('learnerDetailPanel');
  if (!panel) return;

  const questionnaire = detail.questionnaire || {};
  const questionnaireRows = [
    ['年级', questionnaire.grade || detail.learner.grade || '-'],
    ['教材版本', questionnaire.textbook || '-'],
    ['英语状态', questionnaire.englishLevel || '-'],
    ['每天时间', questionnaire.dailyMinutes || '-'],
    ['平时听英文的情况', questionnaire.audioExposure || '-'],
    ['喜欢的人物', questionnaire.favoriteFigure || '-'],
    ['最想问的问题', questionnaire.favoriteQuestion || '-'],
    ['家长头疼的事', questionnaire.parentPain || '-'],
    ['希望看到的变化', questionnaire.expectedChange || '-'],
    ['家长知情同意', questionnaire.guardianConsent ? '已同意' : '-'],
  ];
  panel.innerHTML = `
    <h2>${escapeHtml(detail.learner.nickname)} 的交付记录</h2>
    <button id="generateDraftButton" type="button">生成下一集原文草稿</button>
    <h3>学习画像</h3>
    <div class="detail-grid">
      ${questionnaireRows.map(([label, value]) => `
        <p><strong>${escapeHtml(label)}</strong><br>${escapeHtml(value)}</p>
      `).join('')}
    </div>
    <div class="grid">
      <p><strong>已捕获</strong><br>${escapeHtml(detail.flashcardSummary.captured)}</p>
      <p><strong>瞄准中</strong><br>${escapeHtml(detail.flashcardSummary.hunting)}</p>
      <p><strong>潜伏中</strong><br>${escapeHtml(detail.flashcardSummary.unseen)}</p>
      <p><strong>词库总数</strong><br>${escapeHtml(detail.wordCount)}</p>
    </div>
    <h3>7 天打卡</h3>
    <div class="lookup-list">
      ${detail.daySubmissions.length === 0 ? '<p>还没有打卡记录。</p>' : detail.daySubmissions.map((submission) => `
        <section class="record">
          <strong>第 ${escapeHtml(submission.dayNumber)} 天</strong>
          <p>${escapeHtml(Object.entries(submission.checklist).map(([key, value]) => `${key}: ${value}`).join('；'))}</p>
        </section>
      `).join('')}
    </div>
    <h3>查词查句</h3>
    <div class="lookup-list">
      ${detail.lookupRecords.length === 0 ? '<p>还没有查询记录。</p>' : detail.lookupRecords.map((lookup) => `
        <section class="record">
          <strong>${lookup.type === 'word' ? '单词' : '句子'}${lookup.dayNumber ? ` · 第 ${lookup.dayNumber} 天` : ''}</strong>
          <p>${escapeHtml(lookup.text)}</p>
          ${lookup.context ? `<p>前后文：${escapeHtml(lookup.context)}</p>` : ''}
          <p>${escapeHtml(lookup.result.meaning || '')}</p>
        </section>
      `).join('')}
    </div>
    <h3>老师笔记</h3>
    <div class="lookup-list">
      ${detail.teacherNotes.length === 0 ? '<p>还没有老师笔记。</p>' : detail.teacherNotes.map((note) => `
        <section class="record">
          <strong>${escapeHtml(note.createdAt)}</strong>
          <p>${escapeHtml(note.noteText)}</p>
          ${note.wechatState ? `<p>微信状态：${escapeHtml(note.wechatState)}</p>` : ''}
        </section>
      `).join('')}
    </div>
    <h3>下一集草稿</h3>
    <div class="lookup-list">
      ${detail.generatedDrafts.length === 0 ? '<p>还没有草稿。</p>' : detail.generatedDrafts.map((draft) => `
        <section class="record">
          <strong>${escapeHtml(draft.status)} · ${escapeHtml(draft.createdAt)}</strong>
          <p>${escapeHtml(draft.draft.title || '未命名草稿')}</p>
          <p>${escapeHtml(draft.draft.body || '')}</p>
        </section>
      `).join('')}
    </div>
  `;

  document
    .getElementById('generateDraftButton')
    .addEventListener('click', () => generateDraft(detail.learner.id));
}

async function loadLearnerDetail(learnerId) {
  const panel = document.getElementById('learnerDetailPanel');
  if (panel) {
    panel.innerHTML = `
      <h2>学员详情</h2>
      <p>正在读取交付记录…</p>
    `;
  }

  try {
    renderLearnerDetail(await fetchLearnerDetail(learnerId));
  } catch {
    if (panel) {
      panel.innerHTML = `
        <h2>学员详情</h2>
        <p>暂时无法读取这个学员的记录。</p>
      `;
    }
  }
}

async function generateDraft(learnerId) {
  const panel = document.getElementById('learnerDetailPanel');
  const button = document.getElementById('generateDraftButton');
  if (button) {
    button.disabled = true;
    button.textContent = '正在生成…';
  }

  try {
    await postDraft(learnerId);
    renderLearnerDetail(await fetchLearnerDetail(learnerId));
  } catch {
    if (panel) {
      const error = document.createElement('p');
      error.textContent = '暂时无法生成草稿，请稍后再试。';
      panel.prepend(error);
    }
    if (button) {
      button.disabled = false;
      button.textContent = '生成下一集原文草稿';
    }
  }
}

function renderWrongEntrance() {
  adminApp.innerHTML = `
    <section class="panel">
      <h2>这里是老师入口</h2>
      <p>你现在登录的是学员账号，请从学员入口进入。</p>
      <button id="logoutButton" class="secondary" type="button">退出登录</button>
    </section>
  `;
  document.getElementById('logoutButton').addEventListener('click', logout);
}

function renderSession(session) {
  if (!session.authenticated) {
    renderLogin();
    return;
  }

  if (session.role === 'admin') {
    renderAdmin(session);
    return;
  }

  renderWrongEntrance();
}

async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch {
    // Local session display can still return to the login form.
  }
  renderLogin();
}

if (adminApp) {
  fetchSession()
    .then(renderSession)
    .catch(() => renderLogin('暂时无法读取登录状态，请稍后再试。'));
}
