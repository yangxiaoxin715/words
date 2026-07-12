# Word Hunter Data Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the flashcard app use one canonical vocabulary source with a fixed 200-word diagnostic set, a fixed 100-word startup gate, and corrected timeout/report behavior.

**Architecture:** Keep the app as a single-file HTML app, but move the vocabulary model into a clearly structured in-memory catalog so the 2000-word universe, 200-word diagnostic slice, and 100-word startup slice all come from one source of truth. Tighten the round-state logic so timeout no longer causes a hidden reset or inconsistent reporting, and make the report derive from the same persisted word state used by the quiz flow.

**Tech Stack:** HTML, vanilla JavaScript, Node.js test harness.

---

### Task 1: Lock the vocabulary model into one canonical source

**Files:**
- Modify: `index.html`
- Modify: `tests/word-hunter.test.js`

- [ ] **Step 1: Write the failing test**

```js
function testVocabularySlicesAreDerivedFromOneCatalog() {
  const h = createHarness();
  assert.equal(h.run('WORDS.length'), 200);
  assert.equal(h.run('DIAGNOSTIC_WORDS.length'), 200);
  assert.equal(h.run('STARTUP_WORDS.length'), 100);
  assert.equal(h.run('TOTAL_WORDS.length'), 2000);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/word-hunter.test.js`
Expected: fail because the catalog constants do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
const TOTAL_WORDS = [...];
const DIAGNOSTIC_WORDS = TOTAL_WORDS.slice(0, 200);
const STARTUP_WORDS = DIAGNOSTIC_WORDS.slice(0, 100);
const WORDS = DIAGNOSTIC_WORDS;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/word-hunter.test.js`
Expected: pass for the new slice assertions.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/word-hunter.test.js
git commit -m "feat: normalize vocabulary source"
```

### Task 2: Fix timeout and report semantics

**Files:**
- Modify: `index.html`
- Modify: `tests/word-hunter.test.js`

- [ ] **Step 1: Write the failing test**

```js
function testTimeoutPreservesCurrentWordStateAndReportCounts() {
  const h = createHarness();
  h.run(`
    const data = {};
    data[getKey(WORDS[0])] = 1;
    saveData(data);
    quizWords = [WORDS[0]];
    quizIndex = 0;
    roundResults = [];
    showPage('quiz');
    autoSkip();
  `);
  assert.equal(h.run('loadData()[getKey(WORDS[0])]'), 1);
  assert.match(h.elements.reportSub.textContent, /瞄准中 1/);
  assert.match(h.elements.reportSub.textContent, /潜伏中 0/);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/word-hunter.test.js`
Expected: fail because timeout currently mutates progress and report text is derived from mixed assumptions.

- [ ] **Step 3: Write minimal implementation**

```js
function autoSkip() {
  const w = quizWords[quizIndex];
  const data = loadData();
  const key = getKey(w);
  if (!hasWord(data, w)) data[key] = 0;
  saveData(data);
  roundResults.push({ word: w, result: 'timeout', prevValue: data[key], nextValue: data[key] });
  ...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/word-hunter.test.js`
Expected: pass for timeout persistence and report counters.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/word-hunter.test.js
git commit -m "fix: preserve timeout state and report counts"
```

### Task 3: Verify startup gate and round selection

**Files:**
- Modify: `index.html`
- Modify: `tests/word-hunter.test.js`

- [ ] **Step 1: Write the failing test**

```js
function testStartupGateUsesCapturedStartupWordsOnly() {
  const h = createHarness();
  h.run(`
    const data = {};
    DIAGNOSTIC_WORDS.slice(0, 100).forEach((word) => {
      data[getKey(word)] = 3;
    });
    saveData(data);
  `);
  assert.equal(h.run('isStartupReady(loadData())'), false);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/word-hunter.test.js`
Expected: fail because startup readiness still follows the old all-words diagnostic flag.

- [ ] **Step 3: Write minimal implementation**

```js
function isStartupReady(data = loadData()) {
  return STARTUP_WORDS.every((w) => isCaptured(data, w));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/word-hunter.test.js`
Expected: pass for startup readiness and round selection.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/word-hunter.test.js
git commit -m "fix: startup gate and round selection"
```

