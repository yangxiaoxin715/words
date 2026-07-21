# Mixed Core Word Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the main line so each practice stage mixes easier, medium, and harder words.

**Architecture:** Keep `words.position` as the original source position and add `words.practice_position` for the main-line order. Stage capture, main deck selection, and review deck selection use `practice_position`; exports and admin details keep showing original positions.

**Tech Stack:** FastAPI, SQLite, Python unittest, vanilla JavaScript frontend.

---

### Task 1: Add Tests For Mixed Main-Line Order

**Files:**
- Modify: `tests/test_api.py`

- [ ] **Step 1: Update the first-deck test**

Change `test_first_deck_prioritizes_unseen_words_without_repetition` so it expects the first mixed cards to be:

```python
self.assertEqual([card["position"] for card in cards[:6]], [1, 201, 401, 2, 202, 402])
```

Remove the old assertion that the last word is `"all"`, because the deck is no longer original-position contiguous.

- [ ] **Step 2: Update second-stage expectation**

In `test_stage_stays_complete_until_learner_advances`, expect the next deck positions:

```python
self.assertEqual([card["position"] for card in next_deck["cards"]], [467, 68, 268, 468, 69])
```

- [ ] **Step 3: Run the focused tests and confirm failure**

Run:

```bash
../platform/.venv/bin/python -m unittest \
  tests.test_api.WordHunterApiTest.test_first_deck_prioritizes_unseen_words_without_repetition \
  tests.test_api.WordHunterApiTest.test_stage_stays_complete_until_learner_advances
```

Expected: both tests fail because the implementation still orders by original `words.position`.

### Task 2: Add Practice Order To Words

**Files:**
- Modify: `app.py`

- [ ] **Step 1: Add a helper that builds mixed practice rows**

Add a helper near `parse_words()`:

```python
def mixed_practice_positions(total_words: int) -> dict[int, int]:
    band_size = (total_words + 2) // 3
    bands = [
        list(range(1, min(band_size, total_words) + 1)),
        list(range(band_size + 1, min(band_size * 2, total_words) + 1)),
        list(range(band_size * 2 + 1, total_words + 1)),
    ]
    order: list[int] = []
    max_len = max((len(band) for band in bands), default=0)
    for index in range(max_len):
        for band in bands:
            if index < len(band):
                order.append(band[index])
    return {original_position: practice_position for practice_position, original_position in enumerate(order, start=1)}
```

- [ ] **Step 2: Add and populate `practice_position`**

In `init_db()`, add a nullable integer column if missing:

```python
ensure_column(conn, "words", "practice_position", "integer")
```

After inserting or detecting words, populate `practice_position` for every word using `mixed_practice_positions(word_count)`.

- [ ] **Step 3: Run focused tests**

Run the same focused unittest command. Expected: stage-related assertions may still fail until queries use `practice_position`.

### Task 3: Use Practice Order For Main-Line Queries

**Files:**
- Modify: `app.py`

- [ ] **Step 1: Update stage capture queries**

In `get_stage_capture`, change `words.position between ? and ?` to `words.practice_position between ? and ?`.

- [ ] **Step 2: Update main deck selection**

In `select_deck_cards`, change the current-stage filter to `words.practice_position between ? and ?` and order by:

```sql
case when coalesce(today_new_friend.new_count, 0) >= ? then 1 else 0 end,
words.practice_position
```

- [ ] **Step 3: Update review summary and review deck**

In `get_review_summary` and `select_review_deck_cards`, use `words.practice_position between ? and ?`. Order review cards by `words.practice_position`.

- [ ] **Step 4: Run focused tests**

Run the focused unittest command. Expected: both tests pass.

### Task 4: Full Verification

**Files:**
- No further file changes unless tests reveal regressions.

- [ ] **Step 1: Run backend tests**

```bash
../platform/.venv/bin/python -m unittest discover -s tests
```

Expected: all tests pass.

- [ ] **Step 2: Run JS checks**

```bash
node --check public/app.js
node tests/test_hunt_flow.js
```

Expected: no output for syntax check; hunt flow script exits 0.

- [ ] **Step 3: Compile Python**

```bash
../platform/.venv/bin/python -m py_compile app.py
```

Expected: exits 0.

- [ ] **Step 4: Restart local server**

Stop the current uvicorn session and restart:

```bash
../platform/.venv/bin/python -m uvicorn app:app --host 0.0.0.0 --port 8010
```

Expected: local site remains available at `http://192.168.0.109:8010/`.
