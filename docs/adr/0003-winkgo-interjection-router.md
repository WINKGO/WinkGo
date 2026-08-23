# ADR 0003: WINK GO interjection router

Status: accepted, phase 1 routing implemented (2026-08-21)

## Decision

Messages submitted while an Agent turn is running use one explicit mode:

- `native`: deliver into the active turn; disabled until a backend-specific live test passes.
- `boundary_queue`: persist immediately as `pending`, then start automatically after the active turn releases.
- `cancel_resume`: explicit user action only; reserved for a later phase.

Unknown, custom and WINK GO Agent providers default to `boundary_queue`. The frontend must never infer native delivery from an Agent name or from generic proactive-input/steer capabilities.

## Phase 1 contract

- `ConversationRuntimeSummary.interjection_mode` is the single capability surface.
- A queued message is persisted before acknowledgement and broadcast through `message.userCreated` with `status=pending`.
- Starting the queued turn updates the same message through `message.statusChanged` keyed by `msg_id`.
- XiaoZhi receives `execution_status=queued` and can query the same persisted status.
- The queue is bounded to 20 items per conversation and cleared when the conversation is deleted.
- Boundary messages persist a versioned internal delivery marker. Startup
  recovery rebuilds only marked right-side `pending` messages in creation order
  and schedules them automatically; ordinary pending messages are never executed.
- Internal delivery metadata is stripped from message API responses.
- Delivery uses the persisted state machine `pending -> work -> finish|error`.
  Persisting `work` is a precondition for network/backend delivery. A recovered
  `work` row is classified `error` and never replayed automatically.
- Queue reservations and queued items share one bounded accounting boundary;
  after persistence, a sender rechecks the active runtime and self-wakes if the
  previous turn released during the database write.
- Forked history strips `_winkgo_delivery` and normalizes copied delivery rows to
  `finish`; search previews skip the internal marker entirely.
- XiaoZhi status reads its exact message by `msg_id`, and cancellation follows
  the runtime's current `turn_id` after a queued message starts a new turn.

## Deferred native delivery

The conversation service now owns a tested native-delivery route: it persists the
follow-up as `pending`, attempts delivery against the current turn, marks the same
message `finish` after acknowledgement, and falls back to the bounded boundary
queue without changing `msg_id` when delivery fails. Pending confirmations bypass
native delivery and keep the safer boundary behavior.

Codex is the first production backend to advertise native delivery. Its
`turn/steer` dispatch waits for the matching JSON-RPC response before marking the
message delivered. An explicit Codex rejection safely falls back to the boundary
queue. A write failure, closed acknowledgement channel or five-second response
timeout is classified as delivery-uncertain: the message becomes `error` and is
not replayed automatically, preventing duplicate side effects.

Live verification on 2026-08-22 against `codex-cli 0.145.0` confirmed both the
successful JSON-RPC acknowledgement and that steered text appeared in the active
turn's emitted content before `turn/completed`. The redacted primary capture is
stored at `backend/protocols/samples/codex-cli/0.145.0/turn-steer-live-redacted.ndjson`.

The current WINK GO Claude adapter does not advertise or dispatch native
mid-turn delivery (`backend/crates/winkgo-session/src/backend/claude_conn.rs`),
so Claude and all unknown/custom backends continue to use the persisted boundary
queue. This states the adapter's current behavior, not an unverified claim about
future Claude CLI capabilities.
