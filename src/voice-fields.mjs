/* Pure DOM helpers for explicit, editable dictation insertion. */
const TEXT_LIKE = new Set(['text', 'search', 'tel', 'url', 'email', '']);
export function isDictatable(el) {
  if (!el || typeof el.tagName !== 'string' || el.isConnected === false || el.readOnly || el.disabled) return false;
  if (el.closest?.('[data-voice-ui]')) return false;
  if (el.matches?.(':disabled')) return false;
  if (el.closest?.('[hidden], [aria-hidden="true"]')) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'textarea' || (tag === 'input' && TEXT_LIKE.has(String(el.type || '').toLowerCase()));
}
export function insertIntoField(el, text, { win = typeof window !== 'undefined' ? window : null } = {}) {
  if (!isDictatable(el) || !win || typeof text !== 'string' || !text.trim()) return false;
  const tag = el.tagName.toLowerCase();
  const proto = tag === 'textarea' ? win.HTMLTextAreaElement?.prototype : win.HTMLInputElement?.prototype;
  if (!proto) return false;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const before = String(el.value ?? '');
  const glue = before.length ? (tag === 'textarea' ? '\n' : ' ') : '';
  const next = before + glue + text;
  const maximum = Number(el.maxLength);
  if (Number.isFinite(maximum) && maximum >= 0 && next.length > maximum) return false;
  if (setter) setter.call(el, next); else el.value = next;
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  try { el.setSelectionRange(next.length, next.length); } catch (_) {}
  return true;
}
