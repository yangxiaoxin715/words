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

function makeElement(initialId = '', registry = null) {
  const element = {
    className: '',
    textContent: '',
    innerHTML: '',
    style: {},
    onclick: null,
    children: [],
    attributes: {},
    appendChild(child) {
      this.children.push(child);
      if (registry && child.id) registry[child.id] = child;
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    click() {},
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
  let elementId = initialId;
  Object.defineProperty(element, 'id', {
    get() {
      return elementId;
    },
    set(value) {
      elementId = String(value);
      if (registry && elementId) registry[elementId] = element;
    },
  });
  if (registry && initialId) registry[initialId] = element;
  return element;
}

function createHarness() {
  const ids = [
    'home', 'quiz', 'report', 'mappage', 'ringFill', 'ringNum', 'startBtn',
    'homeHint', 'quizLabel', 'cardChinese', 'btnGroup', 'cardWord',
    'flipHint', 'progressText', 'progressBar', 'countdown', 'undoBtn',
    'reportTitle', 'reportSub', 'statNew', 'statHunting', 'statTotal',
    'progressBig', 'nextBtn', 'mapStats', 'masteryMap', 'cardArea',
    'quizPrep', 'audioPrepMessage', 'audioRetryBtn',
    'poolSwitch', 'poolFoundation', 'poolExpansion', 'poolUpgrade',
  ];
  const elements = {};
  ids.forEach((id) => {
    elements[id] = makeElement(id, elements);
  });
  ['home', 'quiz', 'report', 'mappage'].forEach((id) => {
    elements[id].classList.add('page');
  });
  elements.home.classList.add('active');

  const storage = new Map();
  const timeouts = new Map();
  const intervals = new Map();
  const audioInstances = [];
  const alerts = [];
  const blobs = [];
  let nextTimerId = 1;

  const context = vm.createContext({
    console,
    Math,
    JSON,
    encodeURIComponent,
    document: {
      getElementById(id) {
        if (!elements[id]) elements[id] = makeElement(id, elements);
        return elements[id];
      },
      querySelectorAll(selector) {
        if (selector !== '.page') return [];
        return ['home', 'quiz', 'report', 'mappage'].map((id) => elements[id]);
      },
      createElement() {
        return makeElement('', elements);
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
    Blob: function Blob(parts, options) {
      this.parts = parts;
      this.options = options;
      blobs.push(this);
    },
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
    blobs,
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

function testWordListHasOneThousandUniqueStorageKeys() {
  const h = createHarness();
  const result = h.run(`({
    count: WORDS.length,
    uniqueKeys: new Set(WORDS.map(getKey)).size
  })`);

  assert.equal(result.count, 1000);
  assert.equal(result.uniqueKeys, 1000);
}

function testVocabularyPoolsExposeDynamicTwoHundredWordGroups() {
  const h = createHarness();
  const result = h.run(`({
    foundation: WORD_POOLS.foundation.length,
    expansion: WORD_POOLS.expansion.length,
    upgrade: WORD_POOLS.upgrade.length,
    group4: WORD_POOLS.group4.length,
    group5: WORD_POOLS.group5.length,
    expansionGeneral: WORD_POOLS.expansion.filter((word) => word.source === '通用高频').length,
    expansionStory: WORD_POOLS.expansion.filter((word) => word.source === '故事高频').length,
    expansionPep: WORD_POOLS.expansion.filter((word) => word.source === 'PEP六上').length,
    upgradeAction: WORD_POOLS.upgrade.filter((word) => word.source === '故事动作/状态').length,
    upgradeForm: WORD_POOLS.upgrade.filter((word) => word.source === '真实故事词形').length,
    upgradeLogic: WORD_POOLS.upgrade.filter((word) => word.source === '逻辑/线索词').length,
    upgradeEmotion: WORD_POOLS.upgrade.filter((word) => word.source === '情绪/人物变化').length,
    group4Scene: WORD_POOLS.group4.filter((word) => word.source === '故事场景和物件词').length,
    group4Relation: WORD_POOLS.group4.filter((word) => word.source === '人物关系和互动词').length,
    group4Detail: WORD_POOLS.group4.filter((word) => word.source === '细节描写词').length,
    group4Reading: WORD_POOLS.group4.filter((word) => word.source === '阅读理解逻辑词').length,
    group4Bridge: WORD_POOLS.group4.filter((word) => word.source === '非虚构桥接词').length,
    group5History: WORD_POOLS.group5.filter((word) => word.source === '主线历史和人物词').length,
    group5Action: WORD_POOLS.group5.filter((word) => word.source === '情节推进动作词').length,
    group5Mind: WORD_POOLS.group5.filter((word) => word.source === '人物心理和态度词').length,
    group5Language: WORD_POOLS.group5.filter((word) => word.source === '语言文字和阅读表达词').length,
    group5Scene: WORD_POOLS.group5.filter((word) => word.source === '长故事场景细节词').length,
    expansionStartsAt: WORD_POOLS.expansion[0].position,
    expansionEndsAt: WORD_POOLS.expansion[199].position,
    upgradeStartsAt: WORD_POOLS.upgrade[0].position,
    upgradeEndsAt: WORD_POOLS.upgrade[199].position,
    group4StartsAt: WORD_POOLS.group4[0].position,
    group4EndsAt: WORD_POOLS.group4[199].position,
    group5StartsAt: WORD_POOLS.group5[0].position,
    group5EndsAt: WORD_POOLS.group5[199].position,
    poolTabCount: POOL_TABS.length,
    poolTabLabels: POOL_TABS.map((pool) => pool.label),
    poolOrder: getPoolOrder()
  })`);

  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    {
      foundation: 200,
      expansion: 200,
      upgrade: 200,
      group4: 200,
      group5: 200,
      expansionGeneral: 120,
      expansionStory: 50,
      expansionPep: 30,
      upgradeAction: 80,
      upgradeForm: 50,
      upgradeLogic: 40,
      upgradeEmotion: 30,
      group4Scene: 50,
      group4Relation: 35,
      group4Detail: 35,
      group4Reading: 45,
      group4Bridge: 35,
      group5History: 45,
      group5Action: 45,
      group5Mind: 35,
      group5Language: 35,
      group5Scene: 40,
      expansionStartsAt: 201,
      expansionEndsAt: 400,
      upgradeStartsAt: 401,
      upgradeEndsAt: 600,
      group4StartsAt: 601,
      group4EndsAt: 800,
      group5StartsAt: 801,
      group5EndsAt: 1000,
      poolTabCount: 5,
      poolTabLabels: ['1—200', '201—400', '401—600', '601—800', '801—1000'],
      poolOrder: ['foundation', 'expansion', 'upgrade', 'group4', 'group5'],
    }
  );
}

function testWordsExposeTagSchemaForCurrentThousandWords() {
  const h = createHarness();
  const result = h.run(`({
    total: WORDS.length,
    missingStage: WORDS.filter((word) => !word.stageLabel || !word.stageName).length,
    missingUseStage: WORDS.filter((word) => !word.useStage).length,
    missingStoryRole: WORDS.filter((word) => !word.storyRole).length,
    missingTags: WORDS.filter((word) => !Array.isArray(word.tags) || word.tags.length !== 3).length,
    uncoveredSources: [...new Set(WORDS.map((word) => word.source))]
      .filter((source) => !WORD_TAG_SCHEMA.sourceRoles[source]),
    first: {
      stageLabel: WORDS[0].stageLabel,
      stageName: WORDS[0].stageName,
      useStage: WORDS[0].useStage,
      storyRole: WORDS[0].storyRole,
      tags: WORDS[0].tags,
    },
    expansion: {
      stageLabel: WORD_POOLS.expansion[0].stageLabel,
      useStage: WORD_POOLS.expansion[0].useStage,
      storyRole: WORD_POOLS.expansion[0].storyRole,
    },
    upgrade: {
      stageLabel: WORD_POOLS.upgrade[0].stageLabel,
      useStage: WORD_POOLS.upgrade[0].useStage,
      storyRole: WORD_POOLS.upgrade[0].storyRole,
    },
    group5Action: WORD_POOLS.group5
      .find((word) => word.source === '情节推进动作词').storyRole,
    nextStage: WORD_TAG_SCHEMA.poolStages.group6,
  })`);

  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    {
      total: 1000,
      missingStage: 0,
      missingUseStage: 0,
      missingStoryRole: 0,
      missingTags: 0,
      uncoveredSources: [],
      first: {
        stageLabel: '1—200',
        stageName: '第一组',
        useStage: '低年级可闪',
        storyRole: '基础识别',
        tags: ['1—200', '低年级可闪', '基础识别'],
      },
      expansion: {
        stageLabel: '201—400',
        useStage: '低中年级可闪',
        storyRole: '句子骨架',
      },
      upgrade: {
        stageLabel: '401—600',
        useStage: '中年级故事升级',
        storyRole: '动作状态',
      },
      group5Action: '情节动作',
      nextStage: {
        label: '1001—1200',
        name: '第六组',
        useStage: '高年级长阅读桥接',
      },
    }
  );
}

function testExportDataIncludesVocabularyTags() {
  const h = createHarness();
  h.run(`
    selectPool('group5');
    const data = loadData();
    data[getKey(DIAGNOSTIC_WORDS[0])] = CAPTURE_THRESHOLD;
    saveData(data);
    exportData();
  `);

  assert.equal(h.blobs.length, 1);
  const csv = h.blobs[0].parts[0];
  const lines = csv.split('\n');

  assert.equal(
    lines[0],
    '\uFEFFEnglish,Chinese,Tier,段位,使用阶段,故事作用,正确次数,状态'
  );
  assert.match(lines[1], /^emperor,皇帝,主线历史和人物词,801—1000,高年级阅读升级,历史人物,3,已捕获$/);
}

function testHomeRendersFifthPoolTabFromVocabularyData() {
  const h = createHarness();
  h.run('renderHome()');

  assert.equal(h.elements.poolGroup4.textContent, '601—800');
  assert.equal(h.elements.poolGroup4.getAttribute('aria-selected'), 'false');
  assert.equal(h.elements.poolGroup5.textContent, '801—1000');
  assert.equal(h.elements.poolGroup5.getAttribute('aria-selected'), 'false');

  h.run(`selectPool('group5')`);
  assert.equal(h.run('ACTIVE_POOL_ID'), 'group5');
  assert.equal(h.run('DIAGNOSTIC_WORDS[0].position'), 801);
  assert.equal(h.run('DIAGNOSTIC_WORDS[199].position'), 1000);
  assert.equal(h.storage.get('wordHunter_activePool'), 'group5');
  assert.equal(h.elements.poolGroup5.classList.contains('active'), true);
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

function testThirdPoolCanBeSelectedAfterVocabularyExpansion() {
  const h = createHarness();
  h.run(`selectPool('upgrade')`);

  assert.equal(h.run('ACTIVE_POOL_ID'), 'upgrade');
  assert.equal(h.run('DIAGNOSTIC_WORDS[0].position'), 401);
  assert.equal(h.run('DIAGNOSTIC_WORDS[199].position'), 600);
  assert.equal(h.storage.get('wordHunter_activePool'), 'upgrade');
  assert.equal(h.elements.poolUpgrade.classList.contains('active'), true);
}

function testExpansionCompletionReportButtonStartsThirdPool() {
  const h = createHarness();
  h.run(`
    selectPool('expansion');
    const data = {};
    WORD_POOLS.expansion.forEach((word) => {
      data[getKey(word)] = CAPTURE_THRESHOLD;
    });
    saveData(data);
    quizWords = [WORD_POOLS.expansion[199]];
    quizIndex = quizWords.length;
    roundResults = [{
      word: WORD_POOLS.expansion[199],
      result: 'correct',
      prevValue: CAPTURE_THRESHOLD - 1,
      nextValue: CAPTURE_THRESHOLD,
    }];
    showReport();
  `);

  assert.match(h.elements.nextBtn.textContent, /进入 401—600/);
  h.elements.nextBtn.onclick();
  assert.equal(h.run('ACTIVE_POOL_ID'), 'upgrade');
  assert.equal(h.run('quizWords.length'), 20);
  assert.equal(h.run('quizWords.some((word) => word.poolId === "upgrade")'), true);
}

function testUpgradeCompletionReportButtonStartsFourthPool() {
  const h = createHarness();
  h.run(`
    selectPool('upgrade');
    const data = {};
    WORD_POOLS.upgrade.forEach((word) => {
      data[getKey(word)] = CAPTURE_THRESHOLD;
    });
    saveData(data);
    quizWords = [WORD_POOLS.upgrade[199]];
    quizIndex = quizWords.length;
    roundResults = [{
      word: WORD_POOLS.upgrade[199],
      result: 'correct',
      prevValue: CAPTURE_THRESHOLD - 1,
      nextValue: CAPTURE_THRESHOLD,
    }];
    showReport();
  `);

  assert.match(h.elements.nextBtn.textContent, /进入 601—800/);
  h.elements.nextBtn.onclick();
  assert.equal(h.run('ACTIVE_POOL_ID'), 'group4');
  assert.equal(h.run('quizWords.length'), 20);
  assert.equal(h.run('quizWords.some((word) => word.poolId === "group4")'), true);
}

function testFourthPoolCompletionReportButtonStartsFifthPool() {
  const h = createHarness();
  h.run(`
    selectPool('group4');
    const data = {};
    WORD_POOLS.group4.forEach((word) => {
      data[getKey(word)] = CAPTURE_THRESHOLD;
    });
    saveData(data);
    quizWords = [WORD_POOLS.group4[199]];
    quizIndex = quizWords.length;
    roundResults = [{
      word: WORD_POOLS.group4[199],
      result: 'correct',
      prevValue: CAPTURE_THRESHOLD - 1,
      nextValue: CAPTURE_THRESHOLD,
    }];
    showReport();
  `);

  assert.match(h.elements.nextBtn.textContent, /进入 801—1000/);
  h.elements.nextBtn.onclick();
  assert.equal(h.run('ACTIVE_POOL_ID'), 'group5');
  assert.equal(h.run('quizWords.length'), 20);
  assert.equal(h.run('quizWords.some((word) => word.poolId === "group5")'), true);
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
  assert.match(html, /<link rel="icon" href="assets\/word-hunter-logo\.svg" type="image\/svg\+xml">/);
  assert.doesNotMatch(html, /<div class="home-icon">🎯<\/div>/);
  assert.equal(
    fs.existsSync(path.join(__dirname, '..', 'assets', 'word-hunter-logo.svg')),
    true
  );
}

function testHomeUsesTaggedWordDataCacheVersion() {
  assert.match(html, /words-data\.js\?v=20260703-1000-tags-vocab/);
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
  testWordListHasOneThousandUniqueStorageKeys,
  testVocabularyPoolsExposeDynamicTwoHundredWordGroups,
  testWordsExposeTagSchemaForCurrentThousandWords,
  testExportDataIncludesVocabularyTags,
  testHomeRendersFifthPoolTabFromVocabularyData,
  testSecondPoolCanBeSelectedWithoutFinishingFirstPool,
  testThirdPoolCanBeSelectedAfterVocabularyExpansion,
  testExpansionCompletionReportButtonStartsThirdPool,
  testUpgradeCompletionReportButtonStartsFourthPool,
  testFourthPoolCompletionReportButtonStartsFifthPool,
  testSecondPoolDynamicRoundUsesEightNewTenOldWeakTwoOldCaptured,
  testSecondPoolDynamicRoundUsesSixteenNewWhenOldPoolIsNearlyClear,
  testSecondPoolDynamicRoundUsesFourteenNewWhenOldPoolHasSomeGaps,
  testSecondPoolFirstRoundDoesNotDowngradeCapturedOldWord,
  testSecondPoolFirstRoundOnlyIncrementsHuntingOldWordOnce,
  testVocabularyModelExposesStartupSlice,
  testStartupStageOnlyUsesStartupWords,
  testHomeUsesProjectLogoAsset,
  testHomeUsesTaggedWordDataCacheVersion,
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
