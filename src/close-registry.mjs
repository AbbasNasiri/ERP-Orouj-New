const blockers = new Map();
let sequence = 0;
let presenter = null;
export function registerCloseBlocker(read) {
  const id = ++sequence;
  blockers.set(id, read);
  return () => blockers.delete(id);
}
export function latestCloseBlocker() {
  return [...blockers.values()].reverse().map(read => read()).find(value => value && value.active !== false) || null;
}
export function setClosePresenter(fn) {
  presenter = fn;
  return () => { if (presenter === fn) presenter = null; };
}
export function requestGuardedAction(action, { exit = false, blocker = null } = {}) {
  if (!presenter) return false;
  presenter({ action, exit, blocker });
  return true;
}
