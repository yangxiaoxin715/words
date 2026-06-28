const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]);
const wordsDataPath = path.join(__dirname, '..', 'words-data.js');
const wordsData = fs.readFileSync(wordsDataPath, 'utf8');

if (inlineScripts.length === 0) {
  throw new Error('Could not find inline scripts in index.html');
}

function makeElement() {
  return {
    className: '',
    textContent: '',
    innerHTML: '',
    style: {},
    onclick: null,
    classList: {
      values: new Set(),
      add(...names) {
        names.forEach((name) => this.values.add(name));
      },
      remove(...names) {
        names.forEach((name) => this.values.delete(name));
      },
      contains(name) {
        return this.values.has(name);
      },
    },
  };
}

function createHarness() {
  const ids = [
    'home', 'quiz', 'report', 'mappage', 'ringFill', 'ringNum', 'startBtn',
    'homeHint', 'quizLabel', 'cardChinese', 'btnGroup', 'cardWord',
    'flipHint', 'progressText', 'progressBar', 'countdown', 'undoBtn',
    'reportTitle', 'reportSub', 'statNew', 'statHunting', 'statTotal',
    'progressBig', 'nextBtn', 'mapStats', 'masteryMap', 'cardArea',
    'quizPrep', 'audioPrepMessage', 'audioRetryBtn',
    'poolFoundation', 'poolExpansion',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement()]));
  ['home', 'quiz', 'report', 'mappage'].forEach((id) => {
    elements[id].classList.add('page');
  });
  elements.home.classList.add('active');

  const storage = new Map();
  const timeouts = new Map();
  const intervals = new Map();
  const audioInstances = [];
  const alerts = [];
  let nextTimerId = 1;

  const context = vm.createContext({
    console,
    Math,
    JSON,
    encodeURIComponent,
    document: {
      getElementById(id) {
        if (!elements[id]) elements[id] = makeElement();
        return elements[id];
      },
      querySelectorAll(selector) {
        if (selector !== '.page') return [];
        return ['home', 'quiz', 'report', 'mappage'].map((id) => elements[id]);
      },
      createElement() {
        return makeElement();
      },
    },
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
    Audio: function Audio() {
      const listeners = {};
      const audio = {
        src: '',
        preload: '',
        currentTime: 0,
        playCalls: 0,
        pauseCalls: 0,
        loadCalls: 0,
        addEventListener(name, callback) {
          if (!listeners[name]) listeners[name] = [];
          listeners[name].push(callback);
        },
        removeEventListener(name, callback) {
          listeners[name] = (listeners[name] || [])
            .filter((item) => item !== callback);
        },
        load() {
          this.loadCalls += 1;
        },
        play() {
          this.playCalls += 1;
          return Promise.resolve();
        },
        pause() {
          this.pauseCalls += 1;
        },
        emit(name) {
          (listeners[name] || []).slice().forEach((callback) => callback());
        },
      };
      audioInstances.push(audio);
      return audio;
    },
    Blob: function Blob() {},
    URL: {
      createObjectURL() {
        return 'blob:test';
      },
      revokeObjectURL() {},
    },
    alert(message) {
      alerts.push(String(message));
    },
    scrollTo() {},
    confirm() {
      return true;
    },
    setTimeout(callback) {
      const id = nextTimerId++;
      timeouts.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    setInterval(callback) {
      const id = nextTimerId++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
  });
  context.globalThis = context;
  context.window = context;

  vm.runInContext(wordsData, context);
  inlineScripts.forEach((script) => vm.runInContext(script, context));

  return {
    context,
    elements,
    storage,
    alerts,
    audioInstances,
    run(code) {
      return vm.runInContext(code, context);
    },
    runTimeouts() {
      const pending = [...timeouts.values()];
      timeouts.clear();
      pending.forEach((callback) => callback());
    },
    activePage() {
      return ['home', 'quiz', 'report', 'mappage']
        .find((id) => elements[id].classList.contains('active'));
    },
    activeIntervalCount() {
      return intervals.size;
    },
    resolvePendingAudio() {
      audioInstances
        .filter((audio) => audio.src.startsWith('https://'))
        .forEach((audio) => audio.emit('canplaythrough'));
    },
    rejectFirstPendingAudio() {
      const pending = audioInstances
        .find((audio) => audio.src.startsWith('https://'));
      if (!pending) throw new Error('No pending remote audio');
      pending.emit('error');
    },
    preparedAudio() {
      return audioInstances.filter((audio) => audio.src.startsWith('https://'));
    },
    flushPromises() {
      return new Promise((resolve) => setImmediate(resolve));
    },
  };
}

async function testInitialPreparationLoadsOnlyFirstTenWords() {
  const h = createHarness();
  h.run(`
    quizWords = WORDS.slice(0, 20);
    quizIndex = 0;
    showPage('quiz');
    prepareRoundAudio();
  `);

  assert.equal(h.preparedAudio().length, 10);
  assert.equal(h.activeIntervalCount(), 0);
  assert.equal(h.elements.quizPrep.classList.contains('hidden'), false);
  assert.equal(h.elements.cardArea.classList.contains('hidden'), true);
  assert.equal(h.elements.audioPrepMessage.textContent, '正在准备音频…');

  h.resolvePendingAudio();
  await h.flushPromises();

  assert.equal(h.activeIntervalCount(), 1);
  assert.equal(h.elements.cardWord.textContent, 'I');
  assert.equal(h.elements.quizPrep.classList.contains('hidden'), true);
  assert.equal(h.elements.cardArea.classList.contains('hidden'), false);
  assert.equal(h.preparedAudio()[0].playCalls, 1);
}

async function testAdvancingCardExtendsAudioWindowInBackground() {
  const h = createHarness();
  h.run(`
    quizWords = WORDS.slice(0, 20);
    quizIndex = 0;
    showPage('quiz');
    prepareRoundAudio();
  `);

  h.resolvePendingAudio();
  await h.flushPromises();
  h.run(`
    clearCountdown();
    quizIndex = 1;
    showCard();
  `);

  assert.equal(h.preparedAudio().length, 11);
  assert.equal(h.elements.quizPrep.classList.contains('hidden'), true);
  assert.equal(h.activeIntervalCount(), 1);
}

async function testMissingCurrentAudioWaitsBeforeCountdown() {
  const h = createHarness();
  h.run(`
    quizWords = WORDS.slice(0, 11);
    quizIndex = 0;
    showPage('quiz');
    prepareRoundAudio();
  `);

  h.resolvePendingAudio();
  await h.flushPromises();
  h.run(`
    clearCountdown();
    quizIndex = 10;
    showCard();
  `);

  assert.equal(h.activeIntervalCount(), 0);
  assert.equal(h.elements.quizPrep.classList.contains('hidden'), false);
  assert.equal(h.elements.cardArea.classList.contains('hidden'), true);

  h.resolvePendingAudio();
  await h.flushPromises();

  assert.equal(h.activeIntervalCount(), 1);
  assert.equal(h.elements.cardWord.textContent, 'my');
  assert.equal(h.elements.quizPrep.classList.contains('hidden'), true);
}

async function testFirstAudioFailureRetriesSilently() {
  const h = createHarness();
  h.run(`
    quizWords = WORDS.slice(0, 1);
    quizIndex = 0;
    showPage('quiz');
    prepareRoundAudio();
  `);

  h.rejectFirstPendingAudio();
  await h.flushPromises();

  assert.equal(h.activeIntervalCount(), 0);
  assert.equal(h.elements.audioRetryBtn.classList.contains('hidden'), true);
  assert.equal(h.preparedAudio().length, 1);

  h.resolvePendingAudio();
  await h.flushPromises();
  assert.equal(h.activeIntervalCount(), 1);
}

async function testRepeatedAudioFailureShowsRetry() {
  const h = createHarness();
  h.run(`
    quizWords = WORDS.slice(0, 1);
    quizIndex = 0;
    showPage('quiz');
    prepareRoundAudio();
  `);

  h.rejectFirstPendingAudio();
  await h.flushPromises();
  h.rejectFirstPendingAudio();
  await h.flushPromises();

  assert.equal(h.activeIntervalCount(), 0);
  assert.equal(h.elements.audioRetryBtn.classList.contains('hidden'), false);
  assert.match(h.elements.audioPrepMessage.textContent, /加载失败/);
}

async function testRetryCanStartQuizAfterRepeatedFailure() {
  const h = createHarness();
  h.run(`
    quizWords = WORDS.slice(0, 1);
    quizIndex = 0;
    showPage('quiz');
    prepareRoundAudio();
  `);

  h.rejectFirstPendingAudio();
  await h.flushPromises();
  h.rejectFirstPendingAudio();
  await h.flushPromises();
  h.run('retryAudioPreparation()');
  h.resolvePendingAudio();
  await h.flushPromises();

  assert.equal(h.activeIntervalCount(), 1);
  assert.equal(h.elements.cardWord.textContent, 'I');
  assert.equal(h.elements.audioRetryBtn.classList.contains('hidden'), true);
}

function testFirstDiagnosticRoundResumesOnlyUnseenWords() {
  const h = createHarness();
  h.run(`
    const partial = {};
    WORDS.slice(0, 100).forEach((word) => {
      partial[getKey(word)] = 0;
    });
    saveData(partial);
  `);

  assert.equal(h.run('pickRoundWords(loadData()).length'), 100);
}

function testLastDiagnosticTimeoutCanExitIntoReview() {
  const h = createHarness();
  h.run(`
    const partial = {};
    WORDS.slice(0, 199).forEach((word) => {
      partial[getKey(word)] = 0;
    });
    saveData(partial);
    quizWords = [WORDS[199]];
    quizIndex = 0;
    roundResults = [];
    showPage('quiz');
    autoSkip();
    exitQuiz();
  `);

  assert.equal(h.activePage(), 'home');
  assert.equal(h.run('isDiagnosticDone()'), true);
  assert.match(h.elements.homeHint.textContent, /启动100补词中/);
  h.elements.startBtn.onclick();
  assert.equal(h.run('quizWords.length'), 20);
}

function testReviewRoundsContainTwentyWords() {
  const h = createHarness();
  h.run(`
    const captured = {};
    WORDS.forEach((word) => {
      captured[getKey(word)] = CAPTURE_THRESHOLD;
    });
    saveData(captured);
  `);

  assert.equal(h.run('pickRoundWords(loadData()).length'), 20);
}

function testStaleLastReviewAnswerShowsReport() {
  const h = createHarness();
  h.run(`
    const captured = {};
    WORD_POOLS.foundation.forEach((word) => {
      captured[getKey(word)] = CAPTURE_THRESHOLD;
    });
    saveData(captured);
    quizWords = WORD_POOLS.foundation.slice(0, 20);
    quizIndex = quizWords.length;
    roundResults = quizWords.map((word) => ({
      word,
      result: 'timeout',
      prevValue: CAPTURE_THRESHOLD,
      nextValue: CAPTURE_THRESHOLD,
    }));
    showPage('quiz');
    answer('correct');
  `);

  assert.equal(h.activePage(), 'report');
  assert.equal(h.alerts.length, 0);
  assert.match(h.elements.nextBtn.textContent, /进入 201—400/);
}

function testFoundationCompletionReportButtonStartsSecondPool() {
  const h = createHarness();
  h.run(`
    const captured = {};
    WORD_POOLS.foundation.forEach((word) => {
      captured[getKey(word)] = CAPTURE_THRESHOLD;
    });
    saveData(captured);
    quizWords = [WORD_POOLS.foundation[199]];
    quizIndex = 0;
    roundResults = [];
    showPage('quiz');
    answer('correct');
  `);

  assert.equal(h.activePage(), 'report');
  assert.match(h.elements.nextBtn.textContent, /进入 201—400/);

  h.elements.nextBtn.onclick();
  assert.equal(h.run('ACTIVE_POOL_ID'), 'expansion');
  assert.equal(h.activePage(), 'quiz');
  assert.equal(h.run('quizWords.length'), 20);
  assert.equal(h.run('quizWords.some((word) => word.poolId === "expansion")'), true);
}

function testExitCancelsPendingTimeoutAdvance() {
  const h = createHarness();
  h.run(`
    quizWords = [WORDS[0]];
    quizIndex = 0;
    roundResults = [];
    showPage('quiz');
    autoSkip();
    exitQuiz();
  `);

  h.runTimeouts();
  assert.equal(h.activePage(), 'home');
}

function testReportUsesFinalStatusForHuntingTimeout() {
  const h = createHarness();
  h.run(`
    const diagnosed = {};
    WORDS.forEach((word) => {
      diagnosed[getKey(word)] = 0;
    });
    diagnosed[getKey(WORDS[0])] = 2;
    saveData(diagnosed);
    quizWords = [WORDS[0]];
    quizIndex = 0;
    roundResults = [];
    autoSkip();
  `);
  h.runTimeouts();

  assert.equal(h.run('loadData()[getKey(WORDS[0])]'), 2);
  assert.match(h.elements.reportSub.textContent, /瞄准中 1/);
  assert.match(h.elements.reportSub.textContent, /潜伏中 0/);
}

function testTimeoutKeepsCapturedWordsCaptured() {
  const h = createHarness();
  h.run(`
    const diagnosed = {};
    WORDS.forEach((word) => {
      diagnosed[getKey(word)] = 0;
    });
    diagnosed[getKey(WORDS[0])] = 3;
    saveData(diagnosed);
    quizWords = [WORDS[0]];
    quizIndex = 0;
    roundResults = [];
    showPage('quiz');
    autoSkip();
  `);
  h.runTimeouts();
  h.runTimeouts();

  assert.equal(h.run('loadData()[getKey(WORDS[0])]'), 3);
  assert.match(h.elements.reportSub.textContent, /已捕获 1/);
}

function testReportNeverShowsNegativeNewCaptures() {
  const h = createHarness();
  h.run(`
    const diagnosed = {};
    WORDS.forEach((word) => {
      diagnosed[getKey(word)] = 0;
    });
    diagnosed[getKey(WORDS[0])] = CAPTURE_THRESHOLD;
    saveData(diagnosed);
    quizWords = [WORDS[0]];
    quizIndex = 0;
    roundResults = [];
    answer('familiar');
  `);

  assert.equal(h.elements.statNew.textContent, 0);
  assert.match(h.elements.reportSub.textContent, /已捕获 1/);
}

function testLegacyDiagnosticFlagCannotSkipUnseenWords() {
  const h = createHarness();
  h.storage.set('wordHunter_diagDone', 'true');

  assert.equal(h.run('isDiagnosticDone()'), false);
  assert.equal(h.run('pickRoundWords(loadData()).length'), 200);
}

function testMalformedStoredDataFallsBackToEmptyState() {
  const h = createHarness();
  h.storage.set('wordHunter_data', '{not valid json');

  assert.equal(h.run('Object.keys(loadData()).length'), 0);
  assert.equal(h.run('pickRoundWords(loadData()).length'), 200);
}

function testWordListHasFourHundredUniqueStorageKeys() {
  const h = createHarness();
  const result = h.run(`({
    count: WORDS.length,
    uniqueKeys: new Set(WORDS.map(getKey)).size
  })`);

  assert.equal(result.count, 400);
  assert.equal(result.uniqueKeys, 400);
}

function testVocabularyPoolsExposeTwoFixedTwoHundredWordGroups() {
  const h = createHarness();
  const result = h.run(`({
    foundation: WORD_POOLS.foundation.length,
    expansion: WORD_POOLS.expansion.length,
    expansionGeneral: WORD_POOLS.expansion.filter((word) => word.source === '通用高频').length,
    expansionPep: WORD_POOLS.expansion.filter((word) => word.source === 'PEP六上').length,
    expansionStartsAt: WORD_POOLS.expansion[0].position,
    expansionEndsAt: WORD_POOLS.expansion[199].position
  })`);

  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    {
      foundation: 200,
      expansion: 200,
      expansionGeneral: 120,
      expansionPep: 80,
      expansionStartsAt: 201,
      expansionEndsAt: 400,
    }
  );
}

function testSecondPoolCanBeSelectedWithoutFinishingFirstPool() {
  const h = createHarness();
  h.run(`selectPool('expansion')`);

  assert.equal(h.run('ACTIVE_POOL_ID'), 'expansion');
  assert.equal(h.run('DIAGNOSTIC_WORDS[0].position'), 201);
  assert.equal(h.run('DIAGNOSTIC_WORDS[199].position'), 400);
  assert.equal(h.storage.get('wordHunter_activePool'), 'expansion');
  assert.equal(h.elements.poolExpansion.classList.contains('active'), true);
}

function testSecondPoolDynamicRoundUsesEightNewTenOldWeakTwoOldCaptured() {
  const h = createHarness();
  const result = h.run(`
    selectPool('expansion');
    const data = {};
    WORD_POOLS.foundation.slice(0, 2).forEach((word) => {
      data[getKey(word)] = CAPTURE_THRESHOLD;
    });
    saveData(data);
    const picked = pickRoundWords(data);
    ({
      total: picked.length,
      current: picked.filter((word) => word.poolId === 'expansion').length,
      oldWeak: picked.filter((word) =>
        word.poolId === 'foundation' && !isCaptured(data, word)
      ).length,
      oldCaptured: picked.filter((word) =>
        word.poolId === 'foundation' && isCaptured(data, word)
      ).length
    });
  `);

  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    { total: 20, current: 8, oldWeak: 10, oldCaptured: 2 }
  );
}

function testSecondPoolDynamicRoundUsesSixteenNewWhenOldPoolIsNearlyClear() {
  const h = createHarness();
  const result = h.run(`
    selectPool('expansion');
    const data = {};
    WORD_POOLS.foundation.forEach((word) => {
      data[getKey(word)] = CAPTURE_THRESHOLD;
    });
    WORD_POOLS.foundation.slice(0, 2).forEach((word) => {
      data[getKey(word)] = 1;
    });
    saveData(data);
    const picked = pickRoundWords(data);
    ({
      total: picked.length,
      current: picked.filter((word) => word.poolId === 'expansion').length,
      oldWeak: picked.filter((word) =>
        word.poolId === 'foundation' && !isCaptured(data, word)
      ).length,
      oldCaptured: picked.filter((word) =>
        word.poolId === 'foundation' && isCaptured(data, word)
      ).length
    });
  `);

  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    { total: 20, current: 16, oldWeak: 2, oldCaptured: 2 }
  );
}

function testSecondPoolDynamicRoundUsesFourteenNewWhenOldPoolHasSomeGaps() {
  const h = createHarness();
  const result = h.run(`
    selectPool('expansion');
    const data = {};
    WORD_POOLS.foundation.forEach((word) => {
      data[getKey(word)] = CAPTURE_THRESHOLD;
    });
    WORD_POOLS.foundation.slice(0, 20).forEach((word) => {
      data[getKey(word)] = 1;
    });
    saveData(data);
    const picked = pickRoundWords(data);
    ({
      total: picked.length,
      current: picked.filter((word) => word.poolId === 'expansion').length,
      oldWeak: picked.filter((word) =>
        word.poolId === 'foundation' && !isCaptured(data, word)
      ).length,
      oldCaptured: picked.filter((word) =>
        word.poolId === 'foundation' && isCaptured(data, word)
      ).length
    });
  `);

  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    { total: 20, current: 14, oldWeak: 4, oldCaptured: 2 }
  );
}

function testSecondPoolFirstRoundDoesNotDowngradeCapturedOldWord() {
  const h = createHarness();
  h.run(`
    selectPool('expansion');
    const data = {};
    data[getKey(WORD_POOLS.foundation[0])] = CAPTURE_THRESHOLD;
    saveData(data);
    quizWords = [WORD_POOLS.foundation[0]];
    quizIndex = 0;
    roundResults = [];
    answer('familiar');
  `);

  assert.equal(
    h.run('loadData()[getKey(WORD_POOLS.foundation[0])]'),
    3
  );
}

function testSecondPoolFirstRoundOnlyIncrementsHuntingOldWordOnce() {
  const h = createHarness();
  h.run(`
    selectPool('expansion');
    const data = {};
    data[getKey(WORD_POOLS.foundation[0])] = 1;
    saveData(data);
    quizWords = [WORD_POOLS.foundation[0]];
    quizIndex = 0;
    roundResults = [];
    answer('correct');
  `);

  assert.equal(
    h.run('loadData()[getKey(WORD_POOLS.foundation[0])]'),
    2
  );
}

function testVocabularyModelExposesStartupSlice() {
  const h = createHarness();
  const result = h.run(`({
    diagnostic: DIAGNOSTIC_WORDS.length,
    startup: STARTUP_WORDS.length,
    startupIncluded: STARTUP_WORDS.every((word) => DIAGNOSTIC_WORDS.includes(word))
  })`);

  assert.equal(result.diagnostic, 200);
  assert.equal(result.startup, 100);
  assert.equal(result.startupIncluded, true);
}

function testStartupStageOnlyUsesStartupWords() {
  const h = createHarness();
  h.run(`
    const diagnosed = {};
    WORDS.forEach((word) => {
      diagnosed[getKey(word)] = 3;
    });
    WORDS.slice(0, 5).forEach((word) => {
      diagnosed[getKey(word)] = 0;
    });
    saveData(diagnosed);
  `);

  const result = h.run(`({
    picked: pickRoundWords(loadData()).map((word) => getKey(word)),
    startup: WORDS.slice(0, 100).map((word) => getKey(word))
  })`);
  assert.equal(result.picked.length, 20);
  assert.equal(result.picked.every((key) => result.startup.includes(key)), true);
}

function testHomeUsesProjectLogoAsset() {
  assert.match(html, /<img class="home-logo" src="assets\/word-hunter-logo\.svg"/);
  assert.doesNotMatch(html, /<div class="home-icon">🎯<\/div>/);
  assert.equal(
    fs.existsSync(path.join(__dirname, '..', 'assets', 'word-hunter-logo.svg')),
    true
  );
}

const tests = [
  testInitialPreparationLoadsOnlyFirstTenWords,
  testAdvancingCardExtendsAudioWindowInBackground,
  testMissingCurrentAudioWaitsBeforeCountdown,
  testFirstAudioFailureRetriesSilently,
  testRepeatedAudioFailureShowsRetry,
  testRetryCanStartQuizAfterRepeatedFailure,
  testFirstDiagnosticRoundResumesOnlyUnseenWords,
  testLastDiagnosticTimeoutCanExitIntoReview,
  testReviewRoundsContainTwentyWords,
  testStaleLastReviewAnswerShowsReport,
  testFoundationCompletionReportButtonStartsSecondPool,
  testExitCancelsPendingTimeoutAdvance,
  testReportUsesFinalStatusForHuntingTimeout,
  testTimeoutKeepsCapturedWordsCaptured,
  testReportNeverShowsNegativeNewCaptures,
  testLegacyDiagnosticFlagCannotSkipUnseenWords,
  testMalformedStoredDataFallsBackToEmptyState,
  testWordListHasFourHundredUniqueStorageKeys,
  testVocabularyPoolsExposeTwoFixedTwoHundredWordGroups,
  testSecondPoolCanBeSelectedWithoutFinishingFirstPool,
  testSecondPoolDynamicRoundUsesEightNewTenOldWeakTwoOldCaptured,
  testSecondPoolDynamicRoundUsesSixteenNewWhenOldPoolIsNearlyClear,
  testSecondPoolDynamicRoundUsesFourteenNewWhenOldPoolHasSomeGaps,
  testSecondPoolFirstRoundDoesNotDowngradeCapturedOldWord,
  testSecondPoolFirstRoundOnlyIncrementsHuntingOldWordOnce,
  testVocabularyModelExposesStartupSlice,
  testStartupStageOnlyUsesStartupWords,
  testHomeUsesProjectLogoAsset,
];

(async () => {
  let failures = 0;
  for (const test of tests) {
    try {
      await test();
      console.log(`PASS ${test.name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${test.name}`);
      console.error(error.message);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  } else {
    console.log(`All ${tests.length} tests passed.`);
  }
})();
