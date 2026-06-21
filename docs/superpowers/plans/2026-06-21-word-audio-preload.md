# Word Audio Preload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preload every audio clip in a round before showing the first card, so each visible word gets a full three-second answer window and timeout still reveals Chinese for one second.

**Architecture:** Keep the single-file application structure. Add a preparation state to the quiz page and maintain a per-round map of preloaded `Audio` elements. `startHunt()` selects words and starts preparation; only a successful preparation batch may call `showCard()`. A monotonically increasing batch token prevents stale loads from starting a quiz after retry or exit.

**Tech Stack:** Plain HTML/CSS/JavaScript, Node.js `node:test`-style assertion harness using `vm`.

---

### Task 1: Lock down preload behavior in tests

**Files:**
- Modify: `tests/word-hunter.test.js`

- [ ] **Step 1: Extend the Audio harness**

Track created audio instances, registered event listeners, `load()`, `play()`, `pause()`, `currentTime`, and `preload`. Add harness helpers that resolve or reject pending audio loads.

```js
const audioInstances = [];

Audio: function Audio() {
  const listeners = {};
  const audio = {
    src: '',
    preload: '',
    currentTime: 0,
    playCalls: 0,
    pauseCalls: 0,
    addEventListener(name, callback) {
      (listeners[name] ||= []).push(callback);
    },
    removeEventListener(name, callback) {
      listeners[name] = (listeners[name] || []).filter((item) => item !== callback);
    },
    load() {},
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
```

- [ ] **Step 2: Add failing tests**

Add async tests for:

```js
async function testCountdownWaitsForAllRoundAudio() {
  const h = createHarness();
  h.run(`quizWords = WORDS.slice(0, 2); quizIndex = 0; showPage('quiz'); prepareRoundAudio();`);
  assert.equal(h.activeIntervalCount(), 0);
  assert.equal(h.elements.quizPrep.classList.contains('hidden'), false);
  h.resolvePendingAudio();
  await h.flushPromises();
  assert.equal(h.activeIntervalCount(), 1);
  assert.equal(h.elements.cardWord.textContent, 'I');
}

async function testFailedAudioShowsRetryWithoutCountdown() {
  const h = createHarness();
  h.run(`quizWords = WORDS.slice(0, 2); quizIndex = 0; showPage('quiz'); prepareRoundAudio();`);
  h.rejectFirstPendingAudio();
  await h.flushPromises();
  assert.equal(h.activeIntervalCount(), 0);
  assert.equal(h.elements.audioRetryBtn.classList.contains('hidden'), false);
}

async function testRetryCanStartQuizAfterFailure() {
  const h = createHarness();
  h.run(`quizWords = WORDS.slice(0, 2); quizIndex = 0; showPage('quiz'); prepareRoundAudio();`);
  h.rejectFirstPendingAudio();
  await h.flushPromises();
  h.run('retryAudioPreparation()');
  h.resolvePendingAudio();
  await h.flushPromises();
  assert.equal(h.activeIntervalCount(), 1);
}
```

- [ ] **Step 3: Run tests to verify RED**

Run: `node tests/word-hunter.test.js`

Expected: the new tests fail because preparation functions and UI elements do not exist.

### Task 2: Add quiz preparation UI

**Files:**
- Modify: `index.html`
- Test: `tests/word-hunter.test.js`

- [ ] **Step 1: Add preparation markup and styles**

Add `#quizPrep`, `#audioPrepMessage`, and `#audioRetryBtn`. Hide the card area while preparing and reveal it only after successful preload.

```html
<div class="quiz-prep hidden" id="quizPrep">
  <div class="quiz-prep-icon">🎧</div>
  <div class="quiz-prep-message" id="audioPrepMessage">正在准备音频…</div>
  <button class="audio-retry-btn hidden" id="audioRetryBtn"
          onclick="retryAudioPreparation()">重新加载</button>
</div>
```

- [ ] **Step 2: Run tests**

Run: `node tests/word-hunter.test.js`

Expected: preload tests still fail on missing JavaScript behavior; existing tests remain green.

### Task 3: Implement per-round audio preparation

**Files:**
- Modify: `index.html`
- Test: `tests/word-hunter.test.js`

- [ ] **Step 1: Add per-round audio state**

```js
let audioEl = null;
let roundAudio = new Map();
let audioPreparationToken = 0;
let activeWordAudio = null;
```

- [ ] **Step 2: Add loading lifecycle**

Implement:

```js
function createPreparedAudio(word) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const cleanup = () => {
      audio.removeEventListener('canplaythrough', onReady);
      audio.removeEventListener('error', onError);
    };
    const onReady = () => { cleanup(); resolve(audio); };
    const onError = () => { cleanup(); reject(new Error(`audio failed: ${word.english}`)); };
    audio.preload = 'auto';
    audio.addEventListener('canplaythrough', onReady);
    audio.addEventListener('error', onError);
    audio.src = getAudioUrl(word);
    audio.load();
  });
}
```

Add `prepareRoundAudio()`, `retryAudioPreparation()`, `clearRoundAudio()`, and preparation-state rendering. Store all successful audio elements only when the active batch completes.

- [ ] **Step 3: Route round start through preparation**

Change `startHunt()` to show the quiz page and call `prepareRoundAudio()` instead of `showCard()`.

- [ ] **Step 4: Use prepared audio on cards**

Change `speakWord()` to play `roundAudio.get(getKey(currentWord))`. `showCard()` must start the countdown only after preparation has succeeded.

- [ ] **Step 5: Clear audio when leaving**

Call `clearRoundAudio()` from quiz exit and before a new preparation batch so stale loads cannot start a quiz.

- [ ] **Step 6: Run tests to verify GREEN**

Run: `node tests/word-hunter.test.js`

Expected: all existing and new tests pass.

### Task 4: Verify behavior and regression safety

**Files:**
- Modify if required: `index.html`
- Modify if required: `tests/word-hunter.test.js`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: zero failures.

- [ ] **Step 2: Check HTML script syntax**

Extract the inline script and compile it with Node’s `vm.Script`.

Run:

```bash
node -e "const fs=require('fs'),vm=require('vm');const h=fs.readFileSync('index.html','utf8');const s=h.match(/<script>([\\s\\S]*?)<\\/script>/);new vm.Script(s[1]);console.log('inline script syntax ok')"
```

Expected: `inline script syntax ok`.

- [ ] **Step 3: Inspect the focused diff**

Run: `git diff --check && git diff -- index.html tests/word-hunter.test.js`

Expected: no whitespace errors; diff only contains the preparation UI, audio lifecycle, and tests.

- [ ] **Step 4: Commit implementation**

```bash
git add index.html tests/word-hunter.test.js
git commit -m "fix: preload round audio before word timer"
```
