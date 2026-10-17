# Recognition

The imported mockup recognition is local and deterministic. It supplies suggestions for the fictional demo and is not an agreed folder-identification rule. Canonical period assignment and guarded question answers do not run this recognition algorithm or learn cues. Recognition is local and deterministic. `recognize(signals, catalog)` in `src/backend/domain/recognition.ts` is pure: it reads an app name, window title, optional browser URL, OCR text, audio transcripts, speakers, and the previous block's app, window and matter. The catalog contains clients, matters and explicit markers. Stored demo blocks use their window title and source excerpts; no live screenpipe, Jev or language model call occurs.

The full matter reference and its `YYYY-NNN` prefix are one implicit reference cue. The client's display name is another implicit cue. Explicit marker types are `reference`, `case_number`, `opposing_party`, `client_name`, `file`, `email`, `domain`, and `keyword`. Default weights are 0.95, 0.95, 0.60, 0.30, 0.60, 0.45, 0.35 and 0.15 respectively in that order. Explicit markers carry their own weight from 0 to 1. Domain markers match browser URLs only. Matching ignores case and accents, treats underscores as spaces, and requires whole word boundaries. A cue found in several sources contributes once per matter.

For distinct matched cues with weights `w`, `score = min(0.99, 1 - product(1 - w) + continuity)`. Continuity is 0.1 when the immediately previous block belongs to the same matter and has the same app and window title; otherwise it is zero. The response lists each matching type, value, signal location, and weight. If the best score reaches `setting.confidence_threshold` (0.8 in the demo), the decision is `assigned`. A score from 0.5 up to the threshold is `to_check` with a proposed matter. Below 0.5, no matter is proposed. The client name alone cannot decide between two of that client's matters.

Examples from the fictional seed:

| Block / signal                                                | Best matter         |     Score | Explanation                               |
| ------------------------------------------------------------- | ------------------- | --------: | ----------------------------------------- |
| `[2025-031] Opposing documents`                               | Dupont v Martin     |      0.95 | Short reference                           |
| `2025-031 Conclusions v3.docx` and Martin Distribution in OCR | Dupont v Martin     |      0.99 | Reference and opposing party, capped      |
| JAF appeal deadline research                                  | Divorce             |      0.60 | Explicit JAF file cue; proposed in My day |
| Martin Distribution alone                                     | Dupont v Martin     |      0.60 | Opposing party; proposed                  |
| Paul Dupont alone                                             | Both Dupont matters | 0.30 each | Ambiguous client name; no assignment      |

The seed loader calculates each block's confidence from its actual stored signals. Existing historical assignments remain as recorded, including manual approvals and the active block. Therefore some `assigned` blocks score below today's 0.8 automatic threshold: blocks 1, 5, 7, 8, 12 and 19. Block 13 is unassigned with the Divorce suggestion at 0.60; discarded blocks have confidence zero. The demo marker `hits` and `last_seen_at` also come from the engine. A hit counts a recognized explicit cue per block, including a proposed candidate.

Assignment through both the canonical and legacy routes preserves explicit markers without learning new cues. Reusable learning remains deferred by the requirements. The read route `GET /api/blocks/{id}/recognition` does not change counts or learn cues. Fixture-only recognition refresh lives in `tests/fixtures/recognition.ts` and runs only during explicit test setup.
