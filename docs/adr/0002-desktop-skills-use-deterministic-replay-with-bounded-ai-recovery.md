# Desktop Skills use deterministic replay with bounded AI recovery

WINK GO records desktop procedures as local deterministic Desktop Skills and replays those steps without a model by default. AI is invoked only for a bounded Recovery Attempt after a verified step failure or ambiguous target, because always-on visual reasoning costs more tokens, is slower, and is less predictable; pure coordinate macros are cheaper but too brittle when windows move or application layouts change. Desktop observations and full workflows stay on the computer, while ESP32 and mobile callers send only a skill id and runtime parameters.

## Consequences

- Every Desktop Execution is visible through the Control Border and can be cancelled immediately.
- Semantic window and UI targets are preferred; coordinates are only guarded fallbacks bound to the expected application window.
- Consequential actions remain confirmation-gated even when they were present in the original recording.
- A failed Recovery Attempt stops safely instead of granting the model an open-ended desktop session.
