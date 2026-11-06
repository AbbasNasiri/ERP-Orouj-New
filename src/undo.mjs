'use strict';

/* کارفرما (۱۴۰۵/۰۸/۰۹): «نمیشه برگشت» بزرگ‌ترین ترس اپراتور است. این پشته پیش از هر تغییر از حالت قبل عکس
   می‌گیرد تا «یک مرحله عقب» همان‌جا و بدون بستن فرم کار کند. */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* «یک تغییر» یعنی چه: همان فیلد یا همان قلم، پشت سر هم = یک مرحله؛ فیلد دیگر، قلم دیگر یا همان فیلد
   پس از مکث = مرحلهٔ تازه. تایپِ کندِ یک عدد به‌جای اینکه حرف‌به‌حرف عقب برود، یک‌جا برمی‌گردد. */
export function changedTag(prevJson, nextJson) {
  const prev = JSON.parse(prevJson), next = JSON.parse(nextJson);
  const keys = Object.keys(next);
  for (const key of keys) {
    if (key === 'items') continue;
    if (!same(prev[key], next[key])) return key;
  }
  if (Object.keys(prev).length !== keys.length) return 'form';
  const before = prev.items || [], after = next.items || [];
  if (before.length !== after.length) return 'items';
  for (let i = 0; i < after.length; i++) if (!same(before[i], after[i])) return `item:${after[i].id || i}`;
  return 'form';
}

export function createUndoStack({ start, regroupMs = 3000, limit = 60, now = () => Date.now() } = {}) {
  const stack = [];
  let current = start, tag = null, at = now() - regroupMs - 1;
  return {
    get depth() { return stack.length; },
    record(json, nextTag) {
      if (json === current) return stack.length;
      const key = nextTag === undefined ? changedTag(current, json) : nextTag;
      const time = now();
      if (key !== tag || time - at > regroupMs) {
        stack.push(current);
        if (stack.length > limit) stack.shift();
      }
      current = json; tag = key; at = time;
      return stack.length;
    },
    /* پس از هر برگشت، تغییر بعدی یک مرحلهٔ تازه شمرده می‌شود. */
    touch() { tag = null; at = now() - regroupMs - 1; return stack.length; },
    undo() {
      if (!stack.length) return null;
      current = stack.pop();
      this.touch();
      return current;
    },
    rewind(json) {
      current = json;
      stack.length = 0;
      this.touch();
      return current;
    },
  };
}
