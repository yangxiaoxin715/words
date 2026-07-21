# Mixed Core Word Order Design

## Goal

The 2000-word main line should avoid long runs of unfamiliar words. A learner should regularly meet easier words while moving through medium and harder words, so each practice group keeps a usable mix of confidence and challenge.

## Product Rule

The source word list keeps its original `position`. The app adds a separate practice order for the main line.

Practice order is built from three bands. The app splits the current word list into thirds instead of hard-coding a 2000-word boundary, so the rule works for the current 600-word internal list and the later 2000-word list.

- Band A: first third of the source list
- Band B: second third of the source list
- Band C: final third of the source list

The main line interleaves them in repeated A, B, C cycles:

```text
A1, B1, C1, A2, B2, C2, ...
```

Each 200-word stage therefore contains about one third easier words, one third medium words, and one third harder words. With the current 600-word list, the first cards are original positions `[1, 201, 401, 2, 202, 402]`. With a 2000-word list, the app will compute the bands automatically.

## Behavior

- Stage capture uses practice order, not original list order.
- Main deck selection uses practice order.
- New-friend review uses the same current practice stage.
- Export and admin detail still keep the original word position so word identity stays stable.
- Existing test learner data may be cleared during internal testing; no compatibility migration for historical progress is required beyond populating practice order.

## Acceptance

- A fresh learner's first six main-line cards follow original positions `[1, 201, 401, 2, 202, 402]` for the current 600-word list.
- A fresh learner's first 100 cards are unique.
- Advancing to the second stage starts at practice positions 201-205, which map to original positions `[467, 68, 268, 468, 69]` for the current 600-word list.
- Current-stage capture and review only consider words in the learner's current practice stage.
