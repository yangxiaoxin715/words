# Rolling Word Audio Preload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start a round after loading only its first ten audio clips, then maintain a rolling look-ahead buffer without reducing any word’s three-second answer time.

**Architecture:** Keep the existing single-file application. Store completed audio in `roundAudio` and in-flight requests in `pendingAudioLoads` so each word has at most one active request. The initial gate waits for ten words; every displayed card silently fills a ten-word window ahead. A batch token invalidates stale requests after retry, exit, or a new round.

**Tech Stack:** Plain HTML/CSS/JavaScript and the existing Node.js `vm` test harness.

---

### Task 1: Define rolling-window behavior with failing tests

**Files:**
- Modify: `tests/word-hunter.test.js`

- [ ] **Step 1: Test that initial preparation is capped at ten**

```js
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
  h.resolvePendingAudio();
  await h.flushPromises();
  assert.equal(h.activeIntervalCount(), 1);
}
```

- [ ] **Step 2: Test that advancing one card adds one background request**

```js
async function testAdvancingCardExtendsAudioWindow() {
  const h = createHarness();
  h.run(`
    quizWords = WORDS.slice(0, 20);
    quizIndex = 0;
    showPage('quiz');
    prepareRoundAudio();
  `);
  h.resolvePendingAudio();
  await h.flushPromises();
  h.run(`clearCountdown(); quizIndex = 1; showCard();`);

  assert.equal(h.preparedAudio().length, 11);
  assert.equal(h.elements.quizPrep.classList.contains('hidden'), true);
}
```

- [ ] **Step 3: Test that a missing current audio pauses the timer**

```js
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
  h.run(`clearCountdown(); quizIndex = 10; showCard();`);

  assert.equal(h.activeIntervalCount(), 0);
  assert.equal(h.elements.quizPrep.classList.contains('hidden'), false);
  h.resolvePendingAudio();
  await h.flushPromises();
  assert.equal(h.activeIntervalCount(), 1);
}
```

- [ ] **Step 4: Run tests and verify RED**

Run: `node tests/word-hunter.test.js`

Expected: the ten-word cap fails because the current implementation creates requests for the whole round.

### Task 2: Implement deduplicated rolling loads

**Files:**
- Modify: `index.html`
- Test: `tests/word-hunter.test.js`

- [ ] **Step 1: Replace whole-round loading state**

```js
const INITIAL_AUDIO_BATCH_SIZE = 10;
const AUDIO_LOOKAHEAD_SIZE = 10;
const AUDIO_LOAD_ATTEMPTS = 2;

let roundAudio = new Map();
let pendingAudioLoads = new Map();
let loadingAudio = new Set();
```

- [ ] **Step 2: Add a deduplicated loader with one silent retry**

`loadWordAudio(word, token, attemptsLeft)` must:

- return cached audio immediately;
- return the existing promise when the word is already loading;
- create one `Audio` attempt at a time;
- retry once after the first failure;
- store successful audio in `roundAudio`;
- remove failed and completed entries from `pendingAudioLoads`;
- discard stale audio when the batch token changes.

- [ ] **Step 3: Limit the initial gate to ten words**

```js
const initialWords = quizWords.slice(0, INITIAL_AUDIO_BATCH_SIZE);
Promise.all(initialWords.map((word) => loadWordAudio(word, token)))
```

The preparation message remains exactly `正在准备音频…`.

- [ ] **Step 4: Add rolling window fill**

```js
function preloadAudioWindow(startIndex = quizIndex) {
  const end = Math.min(quizWords.length, startIndex + AUDIO_LOOKAHEAD_SIZE);
  for (let index = startIndex; index < end; index++) {
    loadWordAudio(quizWords[index], audioPreparationToken).catch(() => {});
  }
}
```

- [ ] **Step 5: Gate each card on its current audio**

If `roundAudio` lacks the current word, hide the card, show the generic preparation state, and await `loadWordAudio()`. Render, play, and start the timer only after success. Once rendered, call `preloadAudioWindow()` without exposing background progress.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `node tests/word-hunter.test.js`

Expected: all rolling-window and existing behavior tests pass.

### Task 3: Verify regression safety

**Files:**
- Modify if required: `index.html`
- Modify if required: `tests/word-hunter.test.js`

- [ ] **Step 1: Run the full suite**

Run: `npm test`

Expected: zero failures.

- [ ] **Step 2: Compile the inline script**

Run:

```bash
node -e "const fs=require('fs'),vm=require('vm');const h=fs.readFileSync('index.html','utf8');const s=h.match(/<script>([\\s\\S]*?)<\\/script>/);new vm.Script(s[1]);console.log('inline script syntax ok')"
```

Expected: `inline script syntax ok`.

- [ ] **Step 3: Inspect and commit**

Run: `git diff --check && git diff -- index.html tests/word-hunter.test.js`

Commit:

```bash
git add index.html tests/word-hunter.test.js docs/superpowers/specs/2026-06-21-word-audio-preload-design.md docs/superpowers/plans/2026-06-21-word-audio-preload.md
git commit -m "perf: stream word audio preload"
```
