// Item lifecycle, ported from legacy core/state_machine/item_state.py and core/lifecycle/controller.py.
// VISIBLE -> STARTED -> IMPLEMENTING -> VERIFYING -> READY_TO_SUBMIT -> SUBMITTED, plus FAILED / CLOSED.

export const ItemStatus = Object.freeze({
  VISIBLE: 'VISIBLE',
  STARTED: 'STARTED',
  IMPLEMENTING: 'IMPLEMENTING',
  VERIFYING: 'VERIFYING',
  READY_TO_SUBMIT: 'READY_TO_SUBMIT',
  SUBMITTED: 'SUBMITTED',
  FAILED: 'FAILED',
  CLOSED: 'CLOSED',
});

const S = ItemStatus;

export const TRANSITIONS = Object.freeze({
  [S.VISIBLE]: [S.STARTED, S.CLOSED],
  [S.STARTED]: [S.IMPLEMENTING, S.FAILED, S.CLOSED],
  [S.IMPLEMENTING]: [S.VERIFYING, S.FAILED, S.CLOSED],
  [S.VERIFYING]: [S.READY_TO_SUBMIT, S.IMPLEMENTING, S.FAILED, S.CLOSED],
  [S.READY_TO_SUBMIT]: [S.SUBMITTED, S.VERIFYING, S.IMPLEMENTING, S.FAILED, S.CLOSED],
  [S.SUBMITTED]: [],
  [S.FAILED]: [],
  [S.CLOSED]: [],
});

export const FORBIDDEN = Object.freeze([
  [S.VISIBLE, S.SUBMITTED],
  [S.VISIBLE, S.VERIFYING],
  [S.STARTED, S.SUBMITTED],
]);

export const TERMINAL = Object.freeze([S.SUBMITTED, S.FAILED, S.CLOSED]);
export const ACTIVE = Object.freeze([S.STARTED, S.IMPLEMENTING, S.VERIFYING, S.READY_TO_SUBMIT]);

export class IllegalTransition extends Error {
  constructor(itemId, from, to) {
    super(`${itemId}: ${from} -> ${to} is illegal`);
    this.code = 'ILLEGAL_TRANSITION';
  }
}

export function canTransition(from, to) {
  if (FORBIDDEN.some(([a, b]) => a === from && b === to)) return false;
  return (TRANSITIONS[from] ?? []).includes(to);
}

// The only way an item changes state. Records when it entered the state (for the watchdog)
// and the history (for MTTR and debugging).
export function transition(item, to, now = Date.now()) {
  if (item.status === to) return item;
  if (!canTransition(item.status, to)) throw new IllegalTransition(item.key, item.status, to);
  item.history.push({ from: item.status, to, at: now });
  item.status = to;
  item.statusSince = now;
  return item;
}

// legacy LifecycleController.rework: back to IMPLEMENTING from verification.
export function rework(item, now) {
  if (item.status === S.VERIFYING || item.status === S.READY_TO_SUBMIT) return transition(item, S.IMPLEMENTING, now);
  return item;
}
