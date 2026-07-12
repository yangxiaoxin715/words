const app = document.getElementById('app');
const FLASHCARD_LIMIT = 20;
const DAY_CHECKLISTS = [
  {
    day: 1,
    title: '第 1 天',
    items: [
      { key: 'listened', label: '听过音频', type: 'checkbox' },
      { key: 'heardWords', label: '听到哪些词', type: 'textarea' },
      { key: 'firstGuess', label: '第一次猜到的故事意思', type: 'textarea' },
      { key: 'childQuestion', label: '孩子冒出来的问题', type: 'textarea' },
    ],
  },
  {
    day: 2,
    title: '第 2 天',
    items: [
      { key: 'readText', label: '读过原文', type: 'checkbox' },
      { key: 'knownWords', label: '一眼认识的词', type: 'textarea' },
      { key: 'understoodSentences', label: '已经能理解的句子', type: 'textarea' },
      { key: 'targetListeningWords', label: '准备重点听的词', type: 'textarea' },
    ],
  },
  {
    day: 3,
    title: '第 3 天',
    items: [
      { key: 'audioTextAlignment', label: '音频和文字能对上的地方', type: 'textarea' },
      { key: 'stuckSentences', label: '卡住的句子', type: 'textarea' },
      { key: 'readingPace', label: '今天读起来的节奏', type: 'textarea' },
    ],
  },
  {
    day: 4,
    title: '第 4 天',
    items: [
      { key: 'lookupKeySentences', label: '查过的关键句', type: 'textarea' },
      { key: 'keywords', label: '查过的关键词', type: 'textarea' },
      { key: 'relistenResult', label: '查完再听的变化', type: 'textarea' },
    ],
  },
  {
    day: 5,
    title: '第 5 天',
    items: [
      { key: 'storySummary', label: '孩子复述的故事', type: 'textarea' },
      { key: 'readSentences', label: '今天能读出来的句子', type: 'textarea' },
    ],
  },
  {
    day: 6,
    title: '第 6 天',
    items: [
      { key: 'answeredSixQuestions', label: '完成 6 个故事问题', type: 'checkbox' },
      { key: 'guess', label: '对剧情的猜想', type: 'textarea' },
      { key: 'guessReason', label: '为什么这样猜', type: 'textarea' },
    ],
  },
  {
    day: 7,
    title: '第 7 天',
    items: [
      { key: 'dayOneComparison', label: '和第 1 天相比的变化', type: 'textarea' },
      { key: 'finalGuess', label: '最后一次剧情猜想', type: 'textarea' },
      { key: 'nextEpisodeInterest', label: '想不想继续下一集', type: 'textarea' },
    ],
  },
];
let activeFlashcardSession = null;

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

async function fetchLearnerProfile() {
  const res = await fetch('/api/learner/profile');
  if (!res.ok) throw new Error('Unable to read learner profile');
  return res.json();
}

async function fetchFlashcardSummary() {
  const res = await fetch('/api/learner/flashcards/summary');
  if (!res.ok) throw new Error('Unable to read flashcard summary');
  return res.json();
}

async function fetchLearnerWords() {
  const res = await fetch('/api/learner/words');
  if (!res.ok) throw new Error('Unable to read words');
  return res.json();
}

async function fetchDaySubmissions() {
  const res = await fetch('/api/learner/day-submissions');
  if (!res.ok) throw new Error('Unable to read day submissions');
  return res.json();
}

async function putDaySubmission(dayNumber, checklist) {
  const res = await fetch(`/api/learner/day-submissions/${dayNumber}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ checklist }),
  });
  if (!res.ok) throw new Error('Unable to save day submission');
  return res.json();
}

async function fetchLookups() {
  const res = await fetch('/api/learner/lookups');
  if (!res.ok) throw new Error('Unable to read lookup records');
  return res.json();
}

async function postLookup(payload) {
  const res = await fetch('/api/learner/lookups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Unable to save lookup');
  return res.json();
}

async function postFlashcardSession(payload) {
  const res = await fetch('/api/learner/flashcards/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Unable to save flashcard session');
  return res.json();
}

function renderLogin(error = '') {
  app.innerHTML = `
    <section class="panel">
      <h2>学员登录</h2>
      <form id="loginForm">
        <label>
          访问码
          <input name="accessCode" autocomplete="one-time-code" required>
        </label>
        <button type="submit">进入学员工具</button>
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

function valueFor(questionnaire, field) {
  return questionnaire ? questionnaire[field] || '' : '';
}

function countValue(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
}

function cardStateLabel(count) {
  if (count >= 3) return '已捕获';
  if (count > 0) return '瞄准中';
  return '潜伏中';
}

function renderFlashcardPanel(summary, message = '') {
  const panel = document.getElementById('flashcardPanel');
  if (!panel) return;

  panel.innerHTML = `
    <h2>闪卡练习</h2>
    <div class="grid">
      <p><strong>已捕获</strong><br>${escapeHtml(summary.captured)}</p>
      <p><strong>瞄准中</strong><br>${escapeHtml(summary.hunting)}</p>
      <p><strong>潜伏中</strong><br>${escapeHtml(summary.unseen)}</p>
    </div>
    ${message ? `<p>${escapeHtml(message)}</p>` : ''}
    <button id="startFlashcardsButton" type="button">开始 20 张闪卡</button>
  `;

  document
    .getElementById('startFlashcardsButton')
    .addEventListener('click', startFlashcardPractice);
}

function renderFlashcardLoading() {
  const panel = document.getElementById('flashcardPanel');
  if (!panel) return;

  panel.innerHTML = `
    <h2>闪卡练习</h2>
    <p>正在读取闪卡记录…</p>
  `;
}

function renderFlashcardError(message) {
  const panel = document.getElementById('flashcardPanel');
  if (!panel) return;

  panel.innerHTML = `
    <h2>闪卡练习</h2>
    <p>${escapeHtml(message)}</p>
    <button id="reloadFlashcardsButton" class="secondary" type="button">重新读取</button>
  `;

  document
    .getElementById('reloadFlashcardsButton')
    .addEventListener('click', () => loadFlashcardPanel());
}

function renderDayPanelLoading() {
  const panel = document.getElementById('dayPanel');
  if (!panel) return;

  panel.innerHTML = `
    <h2>7 天打卡</h2>
    <p>正在读取打卡记录…</p>
  `;
}

function renderDayPanelError(message) {
  const panel = document.getElementById('dayPanel');
  if (!panel) return;

  panel.innerHTML = `
    <h2>7 天打卡</h2>
    <p>${escapeHtml(message)}</p>
    <button id="reloadDayPanelButton" class="secondary" type="button">重新读取</button>
  `;

  document
    .getElementById('reloadDayPanelButton')
    .addEventListener('click', () => loadDayPanel());
}

function getDayConfig(dayNumber) {
  return DAY_CHECKLISTS.find((day) => day.day === dayNumber) || DAY_CHECKLISTS[0];
}

function renderDayPanel(submissions, activeDay = 1, message = '') {
  const panel = document.getElementById('dayPanel');
  if (!panel) return;

  const dayConfig = getDayConfig(activeDay);
  const submissionByDay = new Map(
    submissions.map((submission) => [submission.dayNumber, submission.checklist])
  );
  const checklist = submissionByDay.get(dayConfig.day) || {};

  panel.innerHTML = `
    <h2>7 天打卡</h2>
    <div class="day-tabs" role="tablist">
      ${DAY_CHECKLISTS.map((day) => {
        const saved = submissionByDay.has(day.day) ? '已存' : '';
        return `
          <button
            class="secondary ${day.day === dayConfig.day ? 'active' : ''}"
            data-day-tab="${day.day}"
            type="button"
          >${day.day}${saved ? ` ${saved}` : ''}</button>
        `;
      }).join('')}
    </div>
    <form id="daySubmissionForm">
      <h3>${escapeHtml(dayConfig.title)}</h3>
      ${dayConfig.items.map((item) => {
        const value = checklist[item.key];
        if (item.type === 'checkbox') {
          return `
            <label class="check-row">
              <input name="${escapeHtml(item.key)}" type="checkbox" value="true" ${value === true ? 'checked' : ''}>
              <span>${escapeHtml(item.label)}</span>
            </label>
          `;
        }
        return `
          <label>
            ${escapeHtml(item.label)}
            <textarea name="${escapeHtml(item.key)}">${escapeHtml(value || '')}</textarea>
          </label>
        `;
      }).join('')}
      ${message ? `<p>${escapeHtml(message)}</p>` : ''}
      <button type="submit">保存第 ${escapeHtml(dayConfig.day)} 天</button>
    </form>
  `;

  panel.querySelectorAll('[data-day-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      renderDayPanel(submissions, Number(button.dataset.dayTab));
    });
  });

  document
    .getElementById('daySubmissionForm')
    .addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const nextChecklist = {};
      for (const item of dayConfig.items) {
        if (item.type === 'checkbox') {
          nextChecklist[item.key] = formData.get(item.key) === 'true';
        } else {
          nextChecklist[item.key] = String(formData.get(item.key) || '');
        }
      }

      try {
        await putDaySubmission(dayConfig.day, nextChecklist);
        const fresh = await fetchDaySubmissions();
        renderDayPanel(fresh.submissions, dayConfig.day, '已保存。');
      } catch {
        const retainedSubmissions = submissions
          .filter((submission) => submission.dayNumber !== dayConfig.day)
          .concat([{ dayNumber: dayConfig.day, checklist: nextChecklist }])
          .sort((a, b) => a.dayNumber - b.dayNumber);
        renderDayPanel(
          retainedSubmissions,
          dayConfig.day,
          '暂时无法保存，请稍后再试。'
        );
      }
    });
}

async function loadDayPanel() {
  renderDayPanelLoading();

  try {
    const payload = await fetchDaySubmissions();
    renderDayPanel(payload.submissions || []);
  } catch {
    renderDayPanelError('暂时无法读取打卡记录，请稍后再试。');
  }
}

function renderLookupPanelLoading() {
  const panel = document.getElementById('lookupPanel');
  if (!panel) return;

  panel.innerHTML = `
    <h2>查词查句</h2>
    <p>正在读取查询记录…</p>
  `;
}

function renderLookupPanelError(message) {
  const panel = document.getElementById('lookupPanel');
  if (!panel) return;

  panel.innerHTML = `
    <h2>查词查句</h2>
    <p>${escapeHtml(message)}</p>
    <button id="reloadLookupPanelButton" class="secondary" type="button">重新读取</button>
  `;
  document
    .getElementById('reloadLookupPanelButton')
    .addEventListener('click', () => loadLookupPanel());
}

function renderLookupPanel(lookups, message = '', draft = {}) {
  const panel = document.getElementById('lookupPanel');
  if (!panel) return;

  const draftType = draft.type || 'sentence';
  const draftDayNumber = draft.dayNumber || '';

  panel.innerHTML = `
    <h2>查词查句</h2>
    <form id="lookupForm">
      <div class="grid">
        <label>
          类型
          <select name="type">
            <option value="sentence" ${draftType === 'sentence' ? 'selected' : ''}>句子</option>
            <option value="word" ${draftType === 'word' ? 'selected' : ''}>单词</option>
          </select>
        </label>
        <label>
          第几天
          <select name="dayNumber">
            <option value="" ${draftDayNumber === '' ? 'selected' : ''}>不绑定</option>
            ${DAY_CHECKLISTS.map((day) => `
              <option value="${day.day}" ${String(draftDayNumber) === String(day.day) ? 'selected' : ''}>第 ${day.day} 天</option>
            `).join('')}
          </select>
        </label>
      </div>
      <label>
        要查的内容
        <textarea name="text" required>${escapeHtml(draft.text || '')}</textarea>
      </label>
      <label>
        前后文
        <textarea name="context">${escapeHtml(draft.context || '')}</textarea>
      </label>
      ${message ? `<p>${escapeHtml(message)}</p>` : ''}
      <button type="submit">保存查询</button>
    </form>
    <div class="lookup-list">
      ${lookups.length === 0 ? '<p>还没有查询记录。</p>' : lookups.slice(0, 6).map((lookup) => `
        <section class="record">
          <strong>${lookup.type === 'word' ? '单词' : '句子'}${lookup.dayNumber ? ` · 第 ${lookup.dayNumber} 天` : ''}</strong>
          <p>${escapeHtml(lookup.text)}</p>
          ${lookup.context ? `<p>前后文：${escapeHtml(lookup.context)}</p>` : ''}
          <p>${escapeHtml(lookup.result.meaning)}</p>
          <p>关键词：${escapeHtml((lookup.result.keyWords || []).join('、') || '-')}</p>
          <p>${escapeHtml(lookup.result.contextClue)}</p>
          <p>${escapeHtml(lookup.result.relistenTip)}</p>
        </section>
      `).join('')}
    </div>
  `;

  document
    .getElementById('lookupForm')
    .addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const payload = {
        type: String(formData.get('type') || 'sentence'),
        dayNumber: String(formData.get('dayNumber') || ''),
        text: String(formData.get('text') || ''),
        context: String(formData.get('context') || ''),
      };

      try {
        await postLookup(payload);
        const fresh = await fetchLookups();
        renderLookupPanel(fresh.lookups || [], '已保存。');
      } catch {
        renderLookupPanel(lookups, '暂时无法保存，请稍后再试。', payload);
      }
    });
}

async function loadLookupPanel() {
  renderLookupPanelLoading();

  try {
    const payload = await fetchLookups();
    renderLookupPanel(payload.lookups || []);
  } catch {
    renderLookupPanelError('暂时无法读取查询记录，请稍后再试。');
  }
}

async function loadFlashcardPanel(message = '') {
  renderFlashcardLoading();

  try {
    renderFlashcardPanel(await fetchFlashcardSummary(), message);
  } catch {
    renderFlashcardError('暂时无法读取闪卡记录，请稍后再试。');
  }
}

function buildFlashcardPayload(session, endedAt) {
  return {
    startedAt: session.startedAt,
    endedAt: endedAt.toISOString(),
    durationSeconds: Math.max(
      0,
      Math.round((endedAt.getTime() - session.startedAtMs) / 1000)
    ),
    events: session.events,
  };
}

async function saveActiveFlashcardSession() {
  const session = activeFlashcardSession;
  activeFlashcardSession = null;

  if (!session || session.events.length === 0) {
    await loadFlashcardPanel();
    return;
  }

  renderFlashcardLoading();

  try {
    const saved = await postFlashcardSession(
      buildFlashcardPayload(session, new Date())
    );
    renderFlashcardPanel(saved.summary, `本次记录 ${session.events.length} 张。`);
  } catch {
    activeFlashcardSession = session;
    renderFlashcardError('暂时无法保存闪卡记录，请先不要关闭页面。');
  }
}

function renderCurrentFlashcard() {
  const panel = document.getElementById('flashcardPanel');
  if (!panel || !activeFlashcardSession) return;

  const session = activeFlashcardSession;
  const word = session.cards[session.index];
  const count = countValue(session.counts[word.key]);

  panel.innerHTML = `
    <h2>闪卡练习</h2>
    <p>${escapeHtml(session.index + 1)} / ${escapeHtml(session.cards.length)} · ${escapeHtml(cardStateLabel(count))}</p>
    <h3>${escapeHtml(word.english)}</h3>
    <p>${escapeHtml(word.chinese)}</p>
    <p>${escapeHtml(word.stageName)} · ${escapeHtml(word.storyRole)}</p>
    <div class="actions">
      <button data-flashcard-result="captured" type="button">已捕获</button>
      <button data-flashcard-result="familiar" class="secondary" type="button">瞄准中</button>
      <button data-flashcard-result="skip" class="secondary" type="button">潜伏中</button>
      <button id="finishFlashcardsButton" class="secondary" type="button">结束并保存</button>
    </div>
  `;

  panel
    .querySelectorAll('[data-flashcard-result]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        recordFlashcardResult(button.dataset.flashcardResult);
      });
    });
  document
    .getElementById('finishFlashcardsButton')
    .addEventListener('click', saveActiveFlashcardSession);
}

function recordFlashcardResult(result) {
  const session = activeFlashcardSession;
  if (!session) return;

  const word = session.cards[session.index];
  const previousCount = countValue(session.counts[word.key]);
  let nextCount = previousCount;

  if (result === 'captured') {
    nextCount = Math.max(3, previousCount);
  } else if (result === 'familiar') {
    nextCount = Math.min(2, Math.max(1, previousCount + 1));
  }

  session.counts[word.key] = nextCount;
  session.events.push({
    wordKey: word.key,
    result,
    previousCount,
    nextCount,
  });
  session.index += 1;

  if (
    session.index >= session.cards.length ||
    session.events.length >= FLASHCARD_LIMIT
  ) {
    saveActiveFlashcardSession();
    return;
  }

  renderCurrentFlashcard();
}

async function startFlashcardPractice() {
  renderFlashcardLoading();

  try {
    const payload = await fetchLearnerWords();
    const states = payload.states || {};
    const practiceCards = payload.words
      .filter((word) => countValue(states[word.key]) < 3)
      .slice(0, FLASHCARD_LIMIT);
    const reviewCards =
      practiceCards.length > 0
        ? practiceCards
        : payload.words.slice(0, FLASHCARD_LIMIT);

    if (reviewCards.length === 0) {
      await loadFlashcardPanel('还没有可用词卡。');
      return;
    }

    activeFlashcardSession = {
      startedAt: new Date().toISOString(),
      startedAtMs: Date.now(),
      cards: reviewCards,
      counts: { ...states },
      events: [],
      index: 0,
    };
    renderCurrentFlashcard();
  } catch {
    renderFlashcardError('暂时无法开始闪卡练习，请稍后再试。');
  }
}

function renderQuestionnaireForm(profile, error = '') {
  const questionnaire = profile.questionnaire || {};

  app.innerHTML = `
    <section class="panel">
      <h2>${escapeHtml(profile.learner.nickname)}，先把学习画像补齐</h2>
      <form id="questionnaireForm">
        <div class="grid">
          <label>
            年级
            <input name="grade" value="${escapeHtml(valueFor(questionnaire, 'grade') || profile.learner.grade || '')}" required>
          </label>
          <label>
            教材版本
            <input name="textbook" value="${escapeHtml(valueFor(questionnaire, 'textbook'))}">
          </label>
          <label>
            英语状态
            <input name="englishLevel" value="${escapeHtml(valueFor(questionnaire, 'englishLevel'))}">
          </label>
          <label>
            每天可投入分钟数
            <input name="dailyMinutes" inputmode="numeric" value="${escapeHtml(valueFor(questionnaire, 'dailyMinutes'))}" required>
          </label>
          <label>
            平时听英文的情况
            <input name="audioExposure" value="${escapeHtml(valueFor(questionnaire, 'audioExposure'))}">
          </label>
          <label>
            喜欢的人物或角色
            <input name="favoriteFigure" value="${escapeHtml(valueFor(questionnaire, 'favoriteFigure'))}" required>
          </label>
        </div>
        <label>
          最想问的英文学习问题
          <textarea name="favoriteQuestion" required>${escapeHtml(valueFor(questionnaire, 'favoriteQuestion'))}</textarea>
        </label>
        <label>
          家长现在最头疼的事
          <textarea name="parentPain">${escapeHtml(valueFor(questionnaire, 'parentPain'))}</textarea>
        </label>
        <label>
          希望这 7 天看到的变化
          <textarea name="expectedChange">${escapeHtml(valueFor(questionnaire, 'expectedChange'))}</textarea>
        </label>
        <label style="display:flex; gap:10px; align-items:flex-start;">
          <input name="guardianConsent" type="checkbox" value="true" style="width:auto; margin-top:3px;" ${questionnaire.guardianConsent ? 'checked' : ''} required>
          <span>家长已知情并同意记录学习交付数据，仅用于本次学习服务。</span>
        </label>
        ${error ? `<p>${escapeHtml(error)}</p>` : ''}
        <button type="submit">保存学习画像</button>
      </form>
      <button id="logoutButton" class="secondary" type="button">退出登录</button>
    </section>
  `;

  document.getElementById('logoutButton').addEventListener('click', logout);
  document
    .getElementById('questionnaireForm')
    .addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const answers = {
        grade: String(formData.get('grade') || ''),
        textbook: String(formData.get('textbook') || ''),
        englishLevel: String(formData.get('englishLevel') || ''),
        dailyMinutes: String(formData.get('dailyMinutes') || ''),
        audioExposure: String(formData.get('audioExposure') || ''),
        favoriteFigure: String(formData.get('favoriteFigure') || ''),
        favoriteQuestion: String(formData.get('favoriteQuestion') || ''),
        parentPain: String(formData.get('parentPain') || ''),
        expectedChange: String(formData.get('expectedChange') || ''),
        guardianConsent: formData.get('guardianConsent') === 'true',
      };

      try {
        const res = await fetch('/api/learner/questionnaire', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(answers),
        });

        if (!res.ok) {
          renderQuestionnaireForm(
            { ...profile, questionnaire: answers },
            '请确认必填项和家长知情同意后再保存。'
          );
          return;
        }

        renderLearnerProfile(await fetchLearnerProfile());
      } catch {
        renderQuestionnaireForm(profile, '暂时无法保存，请稍后再试。');
      }
    });
}

function renderSummary(profile) {
  const q = profile.questionnaire;
  app.innerHTML = `
    <section class="panel">
      <h2>${escapeHtml(profile.learner.nickname)}，学习画像已保存</h2>
      <div class="grid">
        <p><strong>年级</strong><br>${escapeHtml(q.grade || profile.learner.grade || '-')}</p>
        <p><strong>每天时间</strong><br>${escapeHtml(q.dailyMinutes || '-')}</p>
        <p><strong>喜欢的人物</strong><br>${escapeHtml(q.favoriteFigure || '-')}</p>
        <p><strong>最想问的问题</strong><br>${escapeHtml(q.favoriteQuestion || '-')}</p>
      </div>
      <p>下一步：闪卡记录和七天打卡会放在这里。</p>
      <div class="actions">
        <button id="editQuestionnaireButton" class="secondary" type="button">修改学习画像</button>
        <button id="logoutButton" class="secondary" type="button">退出登录</button>
      </div>
    </section>
    <section id="flashcardPanel" class="panel">
      <h2>闪卡练习</h2>
      <p>正在读取闪卡记录…</p>
    </section>
    <section id="dayPanel" class="panel">
      <h2>7 天打卡</h2>
      <p>正在读取打卡记录…</p>
    </section>
    <section id="lookupPanel" class="panel">
      <h2>查词查句</h2>
      <p>正在读取查询记录…</p>
    </section>
  `;
  document
    .getElementById('editQuestionnaireButton')
    .addEventListener('click', async () => {
      if (activeFlashcardSession) {
        const session = activeFlashcardSession;
        await saveActiveFlashcardSession();
        if (activeFlashcardSession === session) return;
      }
      renderQuestionnaireForm(profile);
    });
  document.getElementById('logoutButton').addEventListener('click', logout);
  loadFlashcardPanel();
  loadDayPanel();
  loadLookupPanel();
}

function renderLearnerProfile(profile) {
  if (profile.questionnaire) {
    renderSummary(profile);
    return;
  }

  renderQuestionnaireForm(profile);
}

function renderLearner() {
  app.innerHTML = `
    <section class="panel">
      <h2>正在读取学习画像</h2>
    </section>
  `;

  fetchLearnerProfile()
    .then(renderLearnerProfile)
    .catch(() => renderLogin('暂时无法读取学员信息，请重新登录后再试。'));
}

function renderWrongEntrance() {
  app.innerHTML = `
    <section class="panel">
      <h2>这里是学员入口</h2>
      <p>你现在登录的是老师账号，请从后台入口进入。</p>
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

  if (session.role === 'learner') {
    renderLearner(session);
    return;
  }

  renderWrongEntrance();
}

async function logout() {
  if (activeFlashcardSession) {
    try {
      await saveActiveFlashcardSession();
    } catch {
      // Logout should still clear the local session view.
    }
  }

  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch {
    // Local session display can still return to the login form.
  }
  renderLogin();
}

if (app) {
  fetchSession()
    .then(renderSession)
    .catch(() => renderLogin('暂时无法读取登录状态，请稍后再试。'));
}
