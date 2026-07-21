const STORAGE_KEY = "wordHunterWebLearner";
const SESSION_TARGET = 100;
const COUNTDOWN_KEY = "wordHunterCountdown";
let HUNT_TIMEOUT_MS = Number(localStorage.getItem(COUNTDOWN_KEY)) || 3000;
const HUNT_REVEAL_MS = 1000;
const AUDIO_FALLBACK_MS = 700;
const EFFECTIVE_ELAPSED_CAP_MS = 10000;
const RESPONSE_LABELS = {
  known: "老朋友",
  vague: "有点眼熟",
  new: "新朋友",
};

const state = {
  learnerId: null,
  learningCode: "",
  sessionToken: "",
  cards: [],
  index: 0,
  revealed: false,
  startedAt: 0,
  audioPlayId: 0,
  audioStartTimer: null,
  mode: "hunt",
  huntRunning: false,
  huntTimer: null,
  huntAwaitingChoice: false,
  huntStatus: "",
  submitting: false,
  stageCapture: null,
  deckSource: "core",
  customPack: null,
  reviewSummary: null,
  sessionElapsedMs: 0,
};

const el = {
  todayNew: document.getElementById("todayNew"),
  todayTime: document.getElementById("todayTime"),
  detailKnownTotal: document.getElementById("detailKnownTotal"),
  loginView: document.getElementById("loginView"),
  learningView: document.getElementById("learningView"),
  loginForm: document.getElementById("loginForm"),
  loginCode: document.getElementById("loginCode"),
  loginPassword: document.getElementById("loginPassword"),
  loginError: document.getElementById("loginError"),
  logoutBtn: document.getElementById("logoutBtn"),
  homePanel: document.getElementById("homePanel"),
  sessionPanel: document.getElementById("sessionPanel"),
  startSessionBtn: document.getElementById("startSessionBtn"),
  sessionBackBtn: document.getElementById("sessionBackBtn"),
  sessionTitle: document.getElementById("sessionTitle"),
  sessionCounter: document.getElementById("sessionCounter"),
  newFriendTotal: document.getElementById("newFriendTotal"),
  knownTotal: document.getElementById("knownTotal"),
  familiarTotal: document.getElementById("familiarTotal"),
  coreTodaySeen: document.getElementById("coreTodaySeen"),
  coreTodayTime: document.getElementById("coreTodayTime"),
  customTodaySeen: document.getElementById("customTodaySeen"),
  customTodayTime: document.getElementById("customTodayTime"),
  streakDays: document.getElementById("streakDays"),
  stageLabel: document.getElementById("stageLabel"),
  stageCaptured: document.getElementById("stageCaptured"),
  stageTarget: document.getElementById("stageTarget"),
  stageRemaining: document.getElementById("stageRemaining"),
  stageProgressFill: document.getElementById("stageProgressFill"),
  reviewStageBtn: document.getElementById("reviewStageBtn"),
  advanceStageBtn: document.getElementById("advanceStageBtn"),
  customPackEmpty: document.getElementById("customPackEmpty"),
  customPackLoaded: document.getElementById("customPackLoaded"),
  customPackName: document.getElementById("customPackName"),
  customPackProgress: document.getElementById("customPackProgress"),
  customPackProgressFill: document.getElementById("customPackProgressFill"),
  customPackFile: document.getElementById("customPackFile"),
  importCustomPackBtn: document.getElementById("importCustomPackBtn"),
  loadCustomPackBtn: document.getElementById("loadCustomPackBtn"),
  customPackStatus: document.getElementById("customPackStatus"),
  sessionProgress: document.getElementById("sessionProgress"),
  progressFill: document.getElementById("progressFill"),
  countdownTrack: document.getElementById("countdownTrack"),
  countdownFill: document.getElementById("countdownFill"),
  wordPosition: document.getElementById("wordPosition"),
  wordText: document.getElementById("wordText"),
  meaningText: document.getElementById("meaningText"),
  responseButtons: document.getElementById("responseButtons"),
  cardFace: document.getElementById("cardFace"),
  speakBtn: document.getElementById("speakBtn"),
  countdownToggle: document.getElementById("countdownToggle"),
  huntStatus: document.getElementById("huntStatus"),
  accountCodeLine: document.getElementById("accountCodeLine"),
  visibleLearningCode: document.getElementById("visibleLearningCode"),
  exportDataBtn: document.getElementById("exportDataBtn"),
  exportDataBtnAlt: document.getElementById("exportDataBtnAlt"),
  exportStatus: document.getElementById("exportStatus"),
  sessionComplete: document.getElementById("sessionComplete"),
  retryRoundBtn: document.getElementById("retryRoundBtn"),
  backHomeBtn: document.getElementById("backHomeBtn"),
};

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: "请求失败" }));
    throw new Error(data.detail || "请求失败");
  }
  return response.json();
}

function saveLearner() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      learnerId: state.learnerId,
      learningCode: state.learningCode,
      sessionToken: state.sessionToken,
    }),
  );
}

function readLearner() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function authHeaders() {
  return state.sessionToken ? { "X-Word-Hunter-Session": state.sessionToken } : {};
}

function showLogin() {
  el.loginView.classList.remove("hidden");
  el.learningView.classList.add("hidden");
  el.logoutBtn.classList.add("hidden");
}

function showLearning() {
  el.loginView.classList.add("hidden");
  el.learningView.classList.remove("hidden");
  el.logoutBtn.classList.remove("hidden");
  showHome();
}

function showHome() {
  clearHuntTimer();
  stopAudio();
  state.huntRunning = false;
  state.huntAwaitingChoice = false;
  state.huntStatus = "";
  el.homePanel.classList.remove("hidden");
  el.sessionPanel.classList.add("hidden");
  document.body.classList.remove("session-active");
  renderCard();
}

function showSession() {
  el.homePanel.classList.add("hidden");
  el.sessionPanel.classList.remove("hidden");
  el.cardFace.classList.remove("hidden");
  el.sessionComplete.classList.add("hidden");
  document.body.classList.add("session-active");
  renderCard();
}

async function startLearner(learningCode, password) {
  const data = await request("/api/learners", {
    method: "POST",
    body: JSON.stringify({
      learning_code: learningCode,
      password,
    }),
  });
  state.learnerId = data.learner_id;
  state.learningCode = data.learning_code;
  state.sessionToken = data.session_token;
  saveLearner();
  showLearning();
  updateDashboard(data.dashboard);
  updateCode();
}

function updateCode() {
  el.visibleLearningCode.textContent = state.learningCode || "";
  el.visibleLearningCode.classList.toggle("hidden", !state.learningCode);
  el.accountCodeLine.classList.toggle("hidden", !state.learningCode);
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}秒`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!seconds) return `${minutes}分`;
  return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
}

function effectiveElapsedMs(ms) {
  return Math.min(Math.max(0, Number(ms) || 0), EFFECTIVE_ELAPSED_CAP_MS);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportLearningData() {
  if (!state.learnerId || !state.sessionToken) return;
  el.exportStatus.textContent = "";
  const response = await fetch(`/api/learners/${state.learnerId}/export`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: "请求失败" }));
    throw new Error(data.detail || "请求失败");
  }
  const datePart = new Date().toISOString().slice(0, 10);
  const disposition = response.headers.get("content-disposition") || "";
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  const filename = filenameMatch
    ? filenameMatch[1]
    : `word-hunter-${state.learningCode}-${datePart}.csv`;
  const blob = await response.blob();
  downloadBlob(filename, blob);
  el.exportStatus.textContent = "已导出";
}

function updateDashboard(dashboard) {
  el.knownTotal.textContent = dashboard.known_total;
  el.todayNew.textContent = dashboard.today_new;
  el.todayTime.textContent = formatDuration(dashboard.today_elapsed_ms);
  el.coreTodaySeen.textContent = dashboard.core_today_seen;
  el.coreTodayTime.textContent = formatDuration(dashboard.core_today_elapsed_ms);
  el.customTodaySeen.textContent = dashboard.custom_today_seen;
  el.customTodayTime.textContent = formatDuration(dashboard.custom_today_elapsed_ms);
  el.detailKnownTotal.textContent = dashboard.known_total;
  el.newFriendTotal.textContent = dashboard.new_friend_total;
  el.familiarTotal.textContent = dashboard.familiar_total;
  el.streakDays.textContent = dashboard.streak_days;
  updateStageCapture(dashboard.stage_capture);
  loadDashboardWordMap();
}

async function loadDashboardWordMap() {
  const mapEl = document.getElementById("dashboardWordMap");
  if (!mapEl || !state.learnerId) return;
  mapEl.innerHTML = '<p class="subtle">掌握地图加载中…</p>';
  try {
    const data = await request(`/api/learners/${state.learnerId}/word-map`, {
      headers: authHeaders(),
    });
    function renderSection(src, sectionLabel) {
      const groups = [
        { key: "known", label: "老朋友", css: "known", icon: "#4caf50", words: src.known || [] },
        { key: "familiar", label: "有点眼熟", css: "vague", icon: "#ff9800", words: src.familiar || [] },
        { key: "new_friend", label: "新朋友", css: "new", icon: "#9e9e9e", words: src.new_friend || [] },
      ];
      const hasWords = groups.some((g) => g.words.length > 0);
      if (!hasWords) return "";
      let html = sectionLabel ? `<div class="word-map-section-label">${sectionLabel}</div>` : "";
      for (const g of groups) {
        if (!g.words.length) continue;
        const tags = g.words
          .map((w) => `<span class="word-tag word-tag-${g.css}">${w}</span>`)
          .join("");
        html += `<div class="word-map-group">
          <div class="word-map-label"><span class="map-icon" style="background:${g.icon}"></span>${g.label}（${g.words.length}）</div>
          <div class="word-map-tags">${tags}</div>
        </div>`;
      }
      return html;
    }
    const coreHtml = renderSection(data.core, "");
    const customHtml = renderSection(data.custom, "导入词包");
    mapEl.innerHTML = (coreHtml + customHtml) || '<p class="subtle">还没有学习数据</p>';
  } catch {
    mapEl.innerHTML = '<p class="subtle">掌握地图加载失败</p>';
  }
}

function updateStageCapture(stageCapture) {
  if (!stageCapture) return;
  state.stageCapture = stageCapture;
  const target = stageCapture.target || 0;
  const captured = stageCapture.captured || 0;
  const remaining = Math.max(stageCapture.remaining || 0, 0);
  const percent = target ? Math.min((captured / target) * 100, 100) : 0;

  el.stageLabel.textContent = stageCapture.label || "一级词";
  el.stageCaptured.textContent = captured;
  el.stageTarget.textContent = target;
  el.stageProgressFill.style.width = `${percent}%`;

  if (stageCapture.complete) {
    el.stageRemaining.textContent = `${stageCapture.label}完成`;
  } else {
    el.stageRemaining.textContent = `还差 ${remaining} 个`;
  }

  el.advanceStageBtn.textContent = stageCapture.next_stage_label
    ? `进入${stageCapture.next_stage_label}`
    : "全部完成";
  el.advanceStageBtn.classList.toggle(
    "hidden",
    !stageCapture.complete || !stageCapture.next_stage_number,
  );
}

function updateDeckSource(source) {
  state.deckSource = source;
}

function updateCustomPack(customPack) {
  state.customPack = customPack;
  if (!customPack) {
    el.customPackEmpty.classList.remove("hidden");
    el.customPackLoaded.classList.add("hidden");
    return;
  }
  el.customPackEmpty.classList.add("hidden");
  el.customPackLoaded.classList.remove("hidden");
  el.customPackName.textContent = customPack.name;
  const total = customPack.total || 0;
  const captured = customPack.captured || 0;
  const percent = total ? Math.min((captured / total) * 100, 100) : 0;
  el.customPackProgress.textContent = `${captured} / ${total}`;
  el.customPackProgressFill.style.width = `${percent}%`;
  el.loadCustomPackBtn.disabled = total === 0;
  el.loadCustomPackBtn.textContent = customPack.complete ? "再刷一遍" : "开始刷";
}

async function refreshCustomPack() {
  const data = await request(`/api/learners/${state.learnerId}/custom-pack`, {
    headers: authHeaders(),
  });
  updateCustomPack(data.pack_summary);
}

function readFileWithFileReader(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsText(file, "utf-8");
  });
}

async function readCustomPackFile(file) {
  const errors = [];
  if ("FileReader" in window) {
    try {
      return await readFileWithFileReader(file);
    } catch (error) {
      errors.push(error);
    }
  }
  if (typeof file.text === "function") {
    try {
      return await file.text();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) {
    throw new Error("文件读取失败，请把 CSV 保存到本机后重新选择");
  }
  throw new Error("当前浏览器无法读取这个文件");
}

async function uploadCustomPackFile(file, name) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(
    `/api/learners/${state.learnerId}/custom-pack/upload?name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    },
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: "请求失败" }));
    throw new Error(data.detail || "请求失败");
  }
  return response.json();
}

async function importCustomPack() {
  try {
    const file = el.customPackFile.files && el.customPackFile.files[0];
    if (!file) {
      el.customPackStatus.textContent = "请导入 CSV 文件";
      return;
    }
    el.customPackStatus.textContent = "正在导入...";
    const name = file.name.replace(/\.csv$/i, "") || "导入词包";
    const data = await uploadCustomPackFile(file, name);
    updateCustomPack(data.pack_summary);
    el.customPackStatus.textContent = "已导入词包，可以点击刷导入词包";
  } catch (error) {
    el.customPackStatus.textContent = error.message;
  } finally {
    el.customPackFile.value = "";
  }
}

async function refreshDashboard() {
  const dashboard = await request(`/api/learners/${state.learnerId}/dashboard`, {
    headers: authHeaders(),
  });
  updateDashboard(dashboard);
}

async function loadDeck(options = {}) {
  updateDeckSource("core");
  const resetParam = options.reset ? "&reset=1" : "";
  const data = await request(`/api/learners/${state.learnerId}/deck?limit=${SESSION_TARGET}${resetParam}`, {
    headers: authHeaders(),
  });
  clearHuntTimer();
  stopAudio();
  state.cards = data.cards;
  state.index = 0;
  state.revealed = false;
  state.huntRunning = false;
  state.huntAwaitingChoice = false;
  state.huntStatus = "";
  state.startedAt = Date.now();
  state.reviewSummary = null;

  if (data.deck_summary?.stage_capture) {
    updateStageCapture(data.deck_summary.stage_capture);
  }
  renderCard();
  return true;
}

async function loadReviewDeck() {
  updateDeckSource("review");
  const data = await request(`/api/learners/${state.learnerId}/review-deck?limit=${SESSION_TARGET}`, {
    headers: authHeaders(),
  });
  clearHuntTimer();
  stopAudio();
  state.cards = data.cards;
  state.index = 0;
  state.revealed = false;
  state.huntRunning = false;
  state.huntAwaitingChoice = false;
  state.huntStatus = "";
  state.startedAt = Date.now();
  state.reviewSummary = data.review_summary;

  if (data.review_summary?.stage_capture) {
    updateStageCapture(data.review_summary.stage_capture);
  }
  renderCard();
  return true;
}

async function loadCustomPackDeck() {
  if (!state.customPack) {
    el.customPackStatus.textContent = "请先导入词包";
    return false;
  }
  updateDeckSource("custom");
  const data = await request(`/api/learners/${state.learnerId}/custom-pack/deck?limit=${SESSION_TARGET}`, {
    headers: authHeaders(),
  });
  clearHuntTimer();
  stopAudio();
  state.cards = data.cards;
  state.index = 0;
  state.revealed = false;
  state.huntRunning = false;
  state.huntAwaitingChoice = false;
  state.huntStatus = "";
  state.startedAt = Date.now();
  state.reviewSummary = null;

  updateCustomPack(data.pack_summary);
  renderCard();
  return true;
}

function currentCard() {
  return state.cards[state.index];
}

function updateResponseButtons() {
  const isHuntChoice = state.mode === "hunt" && state.huntAwaitingChoice;
  el.responseButtons.classList.toggle("hunt-choice", isHuntChoice);
  document.querySelectorAll("[data-response]").forEach((button) => {
    button.classList.toggle("hidden", isHuntChoice && button.dataset.response === "new");
  });
}

function currentDeckLabel() {
  if (state.deckSource === "custom") return "导入词包";
  if (state.deckSource === "review") return "新朋友";
  return state.stageCapture?.label || "一级词";
}

function updateSessionHeader(currentNumber, total) {
  const title = state.deckSource === "custom"
    ? "刷导入词包"
    : state.deckSource === "review"
    ? "再见一面"
    : "刷词中";
  el.sessionTitle.textContent = `${title} · ${currentDeckLabel()}`;
  el.sessionProgress.textContent = `${currentNumber} / ${total}`;
}

function renderCard() {
  const card = currentCard();
  const isCustom = state.deckSource === "custom";
  const isReview = state.deckSource === "review";
  const completed = Math.min(state.index, state.cards.length);
  const total = state.cards.length || SESSION_TARGET;
  const remaining = Math.max(total - state.index, 0);
  const percent = total ? (completed / total) * 100 : 0;
  const currentNumber = card ? Math.min(state.index + 1, total) : total;

  el.huntStatus.textContent = state.huntStatus;
  el.speakBtn.classList.add("hidden");

  updateSessionHeader(currentNumber, total);
  el.progressFill.style.width = `${percent}%`;

  if (!card) {
    clearHuntTimer();
    state.huntRunning = false;
    state.huntAwaitingChoice = false;
    const stageComplete = !isCustom && Boolean(state.stageCapture?.complete);
    const reviewComplete = isReview && (state.reviewSummary?.remaining || 0) === 0;
    const completionLabel = stageComplete || reviewComplete ? "已完成" : "本轮完成";
    el.wordPosition.textContent = `${completionLabel} · 本轮用时 ${formatDuration(state.sessionElapsedMs)}`;
    el.cardFace.classList.add("hidden");
    el.responseButtons.classList.add("hidden");
    el.sessionComplete.classList.remove("hidden");
    const canRetry = !stageComplete && !reviewComplete;
    el.retryRoundBtn.classList.toggle("hidden", !canRetry);
    updateSessionHeader(total, total);
    el.progressFill.style.width = "100%";
    if (isCustom) refreshCustomPack();
    else refreshDashboard();
    return;
  }

  el.wordPosition.textContent = isCustom
    ? `导入词包还剩 ${remaining} 个`
    : isReview
    ? `再见一面还剩 ${remaining} 个`
    : `还剩 ${remaining} 个`;
  el.wordText.textContent = card.word;
  const wordLen = card.word.length;
  el.wordText.classList.toggle("word-text-sm", wordLen > 10);
  el.wordText.classList.toggle("word-text-md", wordLen > 5 && wordLen <= 10);
  el.meaningText.textContent = card.meaning;
  el.meaningText.classList.toggle("hidden", !state.revealed);
  el.responseButtons.classList.toggle(
    "hidden",
    !state.revealed || !state.huntAwaitingChoice,
  );
  updateResponseButtons();
}

function revealCard() {
  if (!currentCard()) return;
  state.revealed = true;
  renderCard();
}

function startCountdown() {
  if (!el.countdownTrack || !el.countdownFill) return;

  el.countdownTrack.classList.remove("countdown-idle");
  el.countdownFill.style.transition = "none";
  el.countdownFill.style.transform = "scaleX(1)";

  window.requestAnimationFrame(() => {
    el.countdownFill.style.transition = `transform ${HUNT_TIMEOUT_MS}ms linear`;
    el.countdownFill.style.transform = "scaleX(0)";
  });
}

function stopCountdown() {
  if (!el.countdownTrack || !el.countdownFill) return;

  el.countdownTrack.classList.add("countdown-idle");
  el.countdownFill.style.transition = "none";
  el.countdownFill.style.transform = "scaleX(1)";
}

function clearAudioStartTimer() {
  if (!state.audioStartTimer) return;
  clearTimeout(state.audioStartTimer);
  state.audioStartTimer = null;
}

function clearHuntTimer() {
  if (state.huntTimer) {
    clearTimeout(state.huntTimer);
    state.huntTimer = null;
  }
  stopCountdown();
}

const sharedAudio = new Audio();

function stopAudio() {
  clearAudioStartTimer();
  sharedAudio.pause();
  sharedAudio.removeAttribute("src");
  sharedAudio.load();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function setCountdown(ms) {
  HUNT_TIMEOUT_MS = ms;
  localStorage.setItem(COUNTDOWN_KEY, ms);
  if (el.countdownToggle) {
    el.countdownToggle.textContent = ms === 5000 ? "5s" : "3s";
  }
}

function toggleCountdown() {
  setCountdown(HUNT_TIMEOUT_MS === 3000 ? 5000 : 3000);
}

function speakWithBrowserVoice(card) {
  if (!card || !("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(card.word);
  utterance.lang = "en-US";
  utterance.rate = 0.82;
  window.speechSynthesis.speak(utterance);
}

function speakCurrentWord() {
  const card = currentCard();
  if (!card) return Promise.resolve(false);

  stopAudio();
  const playId = ++state.audioPlayId;
  if (card.word_id) {
    sharedAudio.src = `/api/audio/${card.word_id}?voice=us`;
  } else {
    sharedAudio.src = `/api/audio/speak?word=${encodeURIComponent(card.word)}&voice=us`;
  }
  let settled = false;
  let fallbackTimer = null;

  return new Promise((resolve) => {
    const clearOwnFallbackTimer = () => {
      if (state.audioStartTimer === fallbackTimer) {
        clearTimeout(fallbackTimer);
        state.audioStartTimer = null;
      }
    };

    const finish = (played) => {
      if (settled) return;
      settled = true;
      clearOwnFallbackTimer();
      resolve(played);
    };

    const fallbackToBrowserVoice = () => {
      if (state.audioPlayId !== playId) {
        finish(false);
        return;
      }
      sharedAudio.pause();
      speakWithBrowserVoice(card);
      finish(true);
    };

    fallbackTimer = window.setTimeout(fallbackToBrowserVoice, AUDIO_FALLBACK_MS);
    state.audioStartTimer = fallbackTimer;

    try {
      Promise.resolve(sharedAudio.play())
        .then(() => {
          if (state.audioPlayId === playId) {
            finish(true);
            return;
          }
          finish(false);
        })
        .catch(() => {
          fallbackToBrowserVoice();
        });
    } catch {
      fallbackToBrowserVoice();
    }
  });
}

async function playHuntCard() {
  const card = currentCard();
  if (!card || state.mode !== "hunt" || !state.huntRunning) return;

  const wordId = card.word_id;
  clearHuntTimer();
  state.revealed = false;
  state.huntAwaitingChoice = false;
  state.huntStatus = "";
  renderCard();
  state.startedAt = Date.now();
  await speakCurrentWord();
  if (
    state.mode !== "hunt" ||
    !state.huntRunning ||
    !currentCard() ||
    currentCard().word_id !== wordId
  ) {
    return;
  }
  startCountdown();
  state.huntTimer = window.setTimeout(finishHuntTimeout, HUNT_TIMEOUT_MS);
}

function startHuntMode() {
  if (!currentCard()) return;
  state.mode = "hunt";
  state.huntRunning = true;
  state.huntAwaitingChoice = false;
  state.huntStatus = "";
  state.revealed = false;
  renderCard();
  playHuntCard();
}

async function startPracticeSession(options = {}) {
  if (!currentCard() && !options.keepCurrentDeck) {
    await loadDeck();
  }
  state.sessionElapsedMs = 0;
  showSession();
  if (currentCard()) {
    startHuntMode();
  }
}

async function returnHome() {
  showHome();
  if (state.learnerId) {
    try {
      await refreshDashboard();
      await refreshCustomPack();
    } catch {
      // 返回首页先保证刷词不中断；数据下次请求会刷新。
    }
  }
}

async function startSprintSession() {
  await loadDeck({ reset: true });
  await startPracticeSession({ keepCurrentDeck: true });
}

async function startReviewSession() {
  await loadReviewDeck();
  await startPracticeSession({ keepCurrentDeck: true });
}

async function startCustomPackSession() {
  const loaded = await loadCustomPackDeck();
  if (loaded) {
    await startPracticeSession({ keepCurrentDeck: true });
  }
}

function finishHuntTimeout() {
  if (state.mode !== "hunt" || !state.huntRunning) return;
  showHuntTimeoutAnswer();
}

function showHuntAnswerForChoice() {
  if (state.mode !== "hunt" || !state.huntRunning || !currentCard()) return;
  clearHuntTimer();
  stopAudio();
  state.revealed = true;
  state.huntAwaitingChoice = true;
  state.huntStatus = "";
  renderCard();
}

function showHuntTimeoutAnswer() {
  const card = currentCard();
  if (state.mode !== "hunt" || !state.huntRunning || !card) return;

  const wordId = card.word_id;
  clearHuntTimer();
  stopAudio();
  state.revealed = true;
  state.huntAwaitingChoice = false;
  state.huntStatus = "新朋友";
  renderCard();

  state.huntTimer = window.setTimeout(() => {
    const current = currentCard();
    if (
      state.mode !== "hunt" ||
      !state.huntRunning ||
      !current ||
      current.word_id !== wordId
    ) {
      return;
    }
    submitResponse("new", { continueHunt: true, huntStatus: "新朋友" });
  }, HUNT_REVEAL_MS);
}

function handleCardFaceClick() {
  if (!currentCard()) return;
  if (state.huntRunning && !state.revealed) showHuntAnswerForChoice();
}

async function submitResponse(response, options = {}) {
  if (state.deckSource === "custom") {
    return submitCustomPackResponse(response, options);
  }
  const card = currentCard();
  if (!card || state.submitting) return;
  state.submitting = true;
  clearHuntTimer();
  stopAudio();

  const elapsedMs = Date.now() - state.startedAt;
  try {
    const result = await request(`/api/learners/${state.learnerId}/events`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        word_id: card.word_id,
        response,
        elapsed_ms: elapsedMs,
      }),
    });
    if (result.dashboard) {
      updateDashboard(result.dashboard);
    }
    state.sessionElapsedMs += effectiveElapsedMs(elapsedMs);
  } finally {
    state.submitting = false;
  }

  state.index += 1;
  state.revealed = false;
  state.huntAwaitingChoice = false;
  state.huntStatus = options.huntStatus || "";
  state.startedAt = Date.now();

  if (options.continueHunt && !currentCard()) {
    state.huntRunning = false;
  }

  renderCard();
  if (options.continueHunt && state.huntRunning) {
    playHuntCard();
  }
}

async function submitCustomPackResponse(response, options = {}) {
  const card = currentCard();
  if (!card || state.submitting) return;
  state.submitting = true;
  clearHuntTimer();
  stopAudio();

  const elapsedMs = Date.now() - state.startedAt;
  try {
    const result = await request(`/api/learners/${state.learnerId}/custom-pack/events`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        pack_word_id: card.pack_word_id,
        response,
        elapsed_ms: elapsedMs,
      }),
    });
    updateCustomPack(result.pack_summary);
    state.sessionElapsedMs += effectiveElapsedMs(elapsedMs);
  } finally {
    state.submitting = false;
  }

  state.index += 1;
  state.revealed = false;
  state.huntAwaitingChoice = false;
  state.huntStatus = options.huntStatus || "";
  state.startedAt = Date.now();

  if (options.continueHunt && !currentCard()) {
    state.huntRunning = false;
  }

  renderCard();
  if (options.continueHunt && state.huntRunning) {
    playHuntCard();
  }
}

function sprintStage() {
  return loadDeck({ reset: true });
}

async function advanceStage() {
  const data = await request(`/api/learners/${state.learnerId}/stage/advance`, {
    method: "POST",
    headers: authHeaders(),
  });
  updateDashboard(data.dashboard);
  await loadDeck({ reset: true });
}

function bindEvents() {
  el.cardFace.addEventListener("click", handleCardFaceClick);
  el.speakBtn.addEventListener("click", speakCurrentWord);
  el.countdownToggle.addEventListener("click", toggleCountdown);
  el.startSessionBtn.addEventListener("click", startSprintSession);
  el.sessionBackBtn.addEventListener("click", () => {
    returnHome();
  });
  el.reviewStageBtn.addEventListener("click", startReviewSession);
  el.advanceStageBtn.addEventListener("click", advanceStage);
  el.loadCustomPackBtn.addEventListener("click", startCustomPackSession);
  el.customPackFile.addEventListener("change", importCustomPack);
  const handleExport = async () => {
    try {
      await exportLearningData();
    } catch (error) {
      el.exportStatus.textContent = error.message;
    }
  };
  el.exportDataBtn.addEventListener("click", handleExport);
  el.exportDataBtnAlt.addEventListener("click", handleExport);
  el.retryRoundBtn.addEventListener("click", () => {
    if (state.deckSource === "custom") startCustomPackSession();
    else if (state.deckSource === "review") startReviewSession();
    else startSprintSession();
  });
  el.backHomeBtn.addEventListener("click", () => returnHome());

  document.querySelectorAll("[data-response]").forEach((button) => {
    button.addEventListener("click", () => {
      const response = button.dataset.response;
      submitResponse(response, {
        continueHunt: state.huntRunning,
        huntStatus: RESPONSE_LABELS[response] || "",
      });
    });
  });

  el.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = el.loginCode.value.trim().toUpperCase();
    const password = el.loginPassword.value;
    if (!code || !password) {
      el.loginError.textContent = "请输入编号和密码";
      return;
    }

    try {
      el.loginError.textContent = "";
      await startLearner(code, password);
      await refreshCustomPack();
      await loadDeck();
    } catch (error) {
      showLogin();
      el.loginError.textContent = error.message;
    }
  });

  el.logoutBtn.addEventListener("click", () => {
    clearHuntTimer();
    stopAudio();
    localStorage.removeItem(STORAGE_KEY);
    state.learnerId = null;
    state.learningCode = "";
    state.sessionToken = "";
    state.cards = [];
    state.index = 0;
    state.customPack = null;
    state.reviewSummary = null;
    state.deckSource = "core";
    el.loginPassword.value = "";
    updateCode();
    showLogin();
  });
}

async function boot() {
  bindEvents();
  setCountdown(HUNT_TIMEOUT_MS);
  const existing = readLearner();
  if (existing.learningCode) {
    el.loginCode.value = existing.learningCode;
  }

  try {
    if (existing.learnerId && existing.sessionToken && existing.learningCode) {
      state.learnerId = existing.learnerId;
      state.learningCode = existing.learningCode;
      state.sessionToken = existing.sessionToken;
      showLearning();
      updateCode();
      await refreshDashboard();
      await refreshCustomPack();
    } else {
      showLogin();
      return;
    }
    await loadDeck();
  } catch (error) {
    localStorage.removeItem(STORAGE_KEY);
    showLogin();
    el.loginError.textContent = "请重新登录";
  }
}

// ============ Vocab Test Module ============

const VT_TIME_LIMIT_MS = 10 * 60 * 1000; // 10 minutes
const VT_LEVEL_NAMES = { 1: "一级词", 2: "二级词", 3: "三级词" };
const VT_LEVEL_TOTALS = { 1: 112, 2: 31, 3: 57 };
const VT_RESPONSE_LABELS = { known: "老朋友", vague: "有点眼熟", new: "新朋友" };

const vocabTest = {
  words: [],
  index: 0,
  results: [],
  revealed: false,
  awaitingChoice: false,
  startedAt: 0,
  timerInterval: null,
  huntTimer: null,
};

const vt = {
  view: document.getElementById("vocabTestView"),
  panel: document.getElementById("vocabTestPanel"),
  result: document.getElementById("vocabTestResult"),
  count: document.getElementById("vocabTestCount"),
  timer: document.getElementById("vocabTestTimer"),
  progress: document.getElementById("vocabTestProgress"),
  status: document.getElementById("vocabTestStatus"),
  huntStatus: document.getElementById("vocabTestHuntStatus"),
  card: document.getElementById("vocabTestCard"),
  word: document.getElementById("vocabTestWord"),
  meaning: document.getElementById("vocabTestMeaning"),
  response: document.getElementById("vocabTestResponse"),
  backBtn: document.getElementById("vocabTestBackBtn"),
  resultTotal: document.getElementById("vocabResultTotal"),
  resultL1: document.getElementById("vocabResultL1"),
  resultL2: document.getElementById("vocabResultL2"),
  resultL3: document.getElementById("vocabResultL3"),
  resultVague: document.getElementById("vocabResultVague"),
  resultNew: document.getElementById("vocabResultNew"),
  resultTested: document.getElementById("vocabResultTested"),
  resultTime: document.getElementById("vocabResultTime"),
  exportBtn: document.getElementById("vocabTestExportBtn"),
  retryBtn: document.getElementById("vocabTestRetryBtn"),
  exitBtn: document.getElementById("vocabTestExitBtn"),
  startBtn: document.getElementById("startVocabTestBtn"),
};

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function loadTestWords() {
  const raw = globalThis.TEST_WORDS || [];
  const pools = { 1: [], 2: [], 3: [] };
  for (const [word, meaning, level] of raw) {
    if (pools[level]) pools[level].push({ word, meaning, level });
  }
  shuffleArray(pools[1]);
  shuffleArray(pools[2]);
  shuffleArray(pools[3]);

  // 两易一难：2个一级 + 1个二级/三级交替
  const result = [];
  const easy = pools[1];
  const hard = [...pools[2], ...pools[3]];
  let ei = 0, hi = 0;
  while (ei < easy.length || hi < hard.length) {
    if (ei < easy.length) result.push(easy[ei++]);
    if (ei < easy.length) result.push(easy[ei++]);
    if (hi < hard.length) result.push(hard[hi++]);
  }
  return result;
}

function formatTimer(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function clearVtHuntTimer() {
  if (vocabTest.huntTimer) {
    clearTimeout(vocabTest.huntTimer);
    vocabTest.huntTimer = null;
  }
}

function speakVtWord(word) {
  stopAudio();
  const url = `/api/audio/speak?word=${encodeURIComponent(word)}&voice=us`;
  sharedAudio.src = url;
  sharedAudio.play().catch(() => {});
}

function startVocabTest() {
  vocabTest.words = loadTestWords();
  vocabTest.index = 0;
  vocabTest.results = [];
  vocabTest.revealed = false;
  vocabTest.awaitingChoice = false;
  vocabTest.startedAt = Date.now();

  el.loginView.classList.add("hidden");
  vt.view.classList.remove("hidden");
  vt.panel.classList.remove("hidden");
  vt.result.classList.add("hidden");
  document.body.classList.add("session-active");

  clearInterval(vocabTest.timerInterval);
  vocabTest.timerInterval = setInterval(updateVocabTimer, 1000);
  vtNextCard();
}

function updateVocabTimer() {
  const elapsed = Date.now() - vocabTest.startedAt;
  const remaining = VT_TIME_LIMIT_MS - elapsed;
  vt.timer.textContent = formatTimer(remaining);
  if (remaining <= 0) {
    finishVocabTest();
  }
}

function vtNextCard() {
  clearVtHuntTimer();
  const total = vocabTest.words.length;
  const i = vocabTest.index;
  vt.count.textContent = `${i} / ${total}`;
  vt.progress.style.width = `${(i / total) * 100}%`;

  if (i >= total) {
    finishVocabTest();
    return;
  }

  const item = vocabTest.words[i];
  vt.word.textContent = item.word;
  const wordLen = item.word.length;
  vt.word.classList.toggle("word-text-sm", wordLen > 10);
  vt.word.classList.toggle("word-text-md", wordLen > 5 && wordLen <= 10);
  vt.meaning.textContent = item.meaning;
  vt.meaning.classList.add("hidden");
  vt.response.classList.add("hidden");
  vt.huntStatus.textContent = "";
  vocabTest.revealed = false;
  vocabTest.awaitingChoice = false;

  const remaining = total - i;
  vt.status.textContent = `还剩 ${remaining} 个`;

  // Play audio then start countdown
  speakVtWord(item.word);
  vocabTest.huntTimer = setTimeout(vtAutoReveal, HUNT_TIMEOUT_MS);
}

function vtAutoReveal() {
  // Countdown expired: reveal meaning and auto-mark as 新朋友 after a pause
  if (vocabTest.revealed || vocabTest.index >= vocabTest.words.length) return;
  vocabTest.revealed = true;
  vocabTest.awaitingChoice = false;
  vt.meaning.classList.remove("hidden");
  vt.huntStatus.textContent = "新朋友";
  // Auto-submit after showing meaning briefly
  vocabTest.huntTimer = setTimeout(() => {
    vtRecordResponse("new");
  }, HUNT_REVEAL_MS);
}

function vtManualReveal() {
  if (vocabTest.revealed || vocabTest.index >= vocabTest.words.length) return;
  clearVtHuntTimer();
  stopAudio();
  vocabTest.revealed = true;
  vocabTest.awaitingChoice = true;
  vt.meaning.classList.remove("hidden");
  vt.response.classList.remove("hidden");
}

function vtRecordResponse(response) {
  clearVtHuntTimer();
  const item = vocabTest.words[vocabTest.index];
  if (!item) return;
  vocabTest.results.push({
    word: item.word,
    meaning: item.meaning,
    level: item.level,
    response,
  });
  vt.huntStatus.textContent = VT_RESPONSE_LABELS[response] || "";
  vocabTest.index++;
  vtNextCard();
}

function finishVocabTest() {
  clearInterval(vocabTest.timerInterval);
  clearVtHuntTimer();
  stopAudio();
  vt.panel.classList.add("hidden");
  vt.result.classList.remove("hidden");
  document.body.classList.remove("session-active");

  const elapsed = Date.now() - vocabTest.startedAt;
  const counts = { 1: { known: 0, vague: 0, new: 0 }, 2: { known: 0, vague: 0, new: 0 }, 3: { known: 0, vague: 0, new: 0 } };
  for (const r of vocabTest.results) {
    counts[r.level][r.response]++;
  }
  const knownTotal = counts[1].known + counts[2].known + counts[3].known;
  const vagueTotal = counts[1].vague + counts[2].vague + counts[3].vague;
  const newTotal = counts[1].new + counts[2].new + counts[3].new;

  vt.resultTotal.textContent = knownTotal;
  vt.resultL1.textContent = `${counts[1].known}/${VT_LEVEL_TOTALS[1]}`;
  vt.resultL2.textContent = `${counts[2].known}/${VT_LEVEL_TOTALS[2]}`;
  vt.resultL3.textContent = `${counts[3].known}/${VT_LEVEL_TOTALS[3]}`;
  vt.resultVague.textContent = vagueTotal;
  vt.resultNew.textContent = newTotal;
  vt.resultTested.textContent = vocabTest.results.length;
  vt.resultTime.textContent = formatDuration(elapsed);
}

function exportVocabResult() {
  const elapsed = Date.now() - vocabTest.startedAt;
  const header = "单词,中文,故事级别,判断";
  const rows = vocabTest.results.map(
    (r) =>
      `${r.word},${r.meaning.replace(/,/g, "，")},${VT_LEVEL_NAMES[r.level]},${VT_RESPONSE_LABELS[r.response]}`,
  );

  const counts = { 1: { known: 0, vague: 0, new: 0 }, 2: { known: 0, vague: 0, new: 0 }, 3: { known: 0, vague: 0, new: 0 } };
  for (const r of vocabTest.results) {
    counts[r.level][r.response]++;
  }
  const summary = [
    "",
    "汇总",
    `已测词数,${vocabTest.results.length}/196`,
    `用时,${formatDuration(elapsed)}`,
    "",
    "级别,老朋友,有点眼熟,新朋友,总词数",
    `一级词,${counts[1].known},${counts[1].vague},${counts[1].new},${VT_LEVEL_TOTALS[1]}`,
    `二级词,${counts[2].known},${counts[2].vague},${counts[2].new},${VT_LEVEL_TOTALS[2]}`,
    `三级词,${counts[3].known},${counts[3].vague},${counts[3].new},${VT_LEVEL_TOTALS[3]}`,
    `合计,${counts[1].known + counts[2].known + counts[3].known},${counts[1].vague + counts[2].vague + counts[3].vague},${counts[1].new + counts[2].new + counts[3].new},196`,
  ];

  const csv = [header, ...rows, ...summary].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(`词汇测试_${new Date().toISOString().slice(0, 10)}.csv`, blob);
}

function exitVocabTest() {
  clearInterval(vocabTest.timerInterval);
  clearVtHuntTimer();
  stopAudio();
  vt.view.classList.add("hidden");
  document.body.classList.remove("session-active");
  showLogin();
}

// Bind vocab test events
vt.startBtn.addEventListener("click", startVocabTest);
vt.card.addEventListener("click", vtManualReveal);
vt.backBtn.addEventListener("click", exitVocabTest);
vt.exportBtn.addEventListener("click", exportVocabResult);
vt.retryBtn.addEventListener("click", startVocabTest);
vt.exitBtn.addEventListener("click", exitVocabTest);
document.querySelectorAll("[data-vt-response]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (vocabTest.awaitingChoice) vtRecordResponse(btn.dataset.vtResponse);
  });
});

boot();
