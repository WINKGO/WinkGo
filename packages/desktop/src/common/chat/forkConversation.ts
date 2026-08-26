/**
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

/** A WINK GO Core conversation can branch at any persisted message. */
export type TForkCapability = { at_turn: boolean };

/**
 * Decide whether the message-level branch action is available.
 *
 * WINK GO uses a data-level branch that copies local history through the
 * selected message and starts a fresh runtime. That makes every persisted
 * message a safe anchor when `at_turn` is true; HEAD-only agents remain
 * restricted to the latest message.
 */
export function isForkEnabled(
  capability: TForkCapability | undefined,
  position: { isLastMessage: boolean; hasTurnAnchor: boolean }
): boolean {
  if (!capability) return false;
  return capability.at_turn || position.isLastMessage;
}
