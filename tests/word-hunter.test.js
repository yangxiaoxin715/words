const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
const wordsDataPath = path.join(__dirname, '..', 'words-data.js');
const wordsData = fs.readFileSync(wordsDataPath, 'utf8');

if (!scriptMatch) {
  throw new Error('Could not find inline script in index.html');
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
    'progressBig', 'nextBtn', 'mapStats', 'masteryMap',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement()]));
  ['home', 'quiz', 'report', 'mappage'].forEach((id) => {
    elements[id].classList.add('page');
  });
  elements.home.classList.add('active');

  const storage = new Map();
  const timeouts = new Map();
  const intervals = new Map();
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
      return {
        src: '',
        play() {
          return Promise.resolve();
        },
      };
    },
    Blob: function Blob() {},
    URL: {
      createObjectURL() {
        return 'blob:test';
      },
      revokeObjectURL() {},
    },
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

  vm.runInContext(wordsData, context);
  vm.runInContext(scriptMatch[1], context);

  return {
    context,
    elements,
    storage,
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
  };
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

function testWordListHasTwoHundredUniqueStorageKeys() {
  const h = createHarness();
  const result = h.run(`({
    count: WORDS.length,
    uniqueKeys: new Set(WORDS.map(getKey)).size
  })`);

  assert.equal(result.count, 200);
  assert.equal(result.uniqueKeys, 200);
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

const tests = [
  testFirstDiagnosticRoundResumesOnlyUnseenWords,
  testLastDiagnosticTimeoutCanExitIntoReview,
  testReviewRoundsContainTwentyWords,
  testExitCancelsPendingTimeoutAdvance,
  testReportUsesFinalStatusForHuntingTimeout,
  testTimeoutKeepsCapturedWordsCaptured,
  testReportNeverShowsNegativeNewCaptures,
  testLegacyDiagnosticFlagCannotSkipUnseenWords,
  testMalformedStoredDataFallsBackToEmptyState,
  testWordListHasTwoHundredUniqueStorageKeys,
  testVocabularyModelExposesStartupSlice,
  testStartupStageOnlyUsesStartupWords,
];

let failures = 0;
for (const test of tests) {
  try {
    test();
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
