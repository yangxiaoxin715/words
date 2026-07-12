# 1000 Word Tags And 1200 Roadmap Design

## Goal

Stabilize the 1000-word main vocabulary before adding more words. Each word should carry reusable labels for stage, use context, and story role. The next 200-word group should have a clear job before any new words are selected.

## Decisions

1. Keep the word list source of truth in `words-data.js`.
2. Generate labels from existing pool and source values, instead of hand-editing 1000 separate entries.
3. Export the labels in the mastery CSV so future grade grouping can use the same data.
4. Define 1001-1200 as a long-reading bridge group, focused on reading questions, nonfiction, cause/effect, long sentences, and retelling.

## Data Fields

Each word gets these generated fields:

- `stageLabel`: range label such as `801—1000`.
- `stageName`: group name such as `第五组`.
- `useStage`: broad use context such as `高年级阅读升级`.
- `storyRole`: vocabulary job such as `历史人物` or `情节动作`.
- `tags`: `[stageLabel, useStage, storyRole]`.

## 1001-1200 Direction

The sixth group should not be a simple difficulty increase. It should help children move from story recognition to longer reading tasks:

- Reading-question and instruction words: about 35.
- Nonfiction, biography, and history words: about 45.
- Cause/effect and opinion words: about 45.
- Long-sentence and abstract action words: about 40.
- Retelling and writing-output words: about 35.

## Verification

The implementation must keep all existing tests passing and add checks that:

- Every current word has stage and role labels.
- Every current source has a schema mapping.
- The CSV export includes stage, use context, and story role.
