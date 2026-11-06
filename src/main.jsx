import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import ExitGuard from './ExitGuard.jsx';
import './ui-theme.css';
import './ui-type.css';

/* Electron always uses the authenticated backend. Browser development has
   separate demo storage; a failed desktop backend must never use that path. */
if (!window.storage) {
  const api = window.printshopApi;
  const checked = (r) => {
    if (r && r.ok) return r;
    const err = new Error((r && r.error) || 'ذخیره‌سازی در دسترس نیست.');
    err.code = r && r.code;
    if (err.code === 'UNAUTHENTICATED') window.dispatchEvent(new Event('printshop:session-expired'));
    throw err;
  };
  const requireDesktop = () => { if (api && !api.secure) checked({ ok: false, code: 'BACKEND_UNAVAILABLE', error: 'پایگاه داده فعال نیست؛ اطلاعات تغییری نکرده است.' }); };
  /* بند ب: بردار نسخهٔ هر کلید همان چیزی است که آخرین بار خوانده‌ایم. هنگام نوشتن
     پس فرستاده می‌شود تا سرور بفهمد این ایستگاه اطلاعات تازه را دیده است یا نه.
     پس از رد شدن، بردار دست‌نخورده می‌ماند: تلاش دوباره بی‌خواندنِ تازه، باز هم رد می‌شود. */
  const revs = new Map();
  window.storage = {
    async get(key) {
      let v;
      requireDesktop();
      if (api) { const r = checked(await api.get(key)); if (r.revs) revs.set(key, r.revs); v = r.value === null || r.value === undefined ? null : JSON.stringify(r.value); }
      else v = localStorage.getItem(key);
      if (v === null || v === undefined) throw new Error('not found');
      return { key, value: v, shared: true };
    },
    async set(key, value) {
      requireDesktop();
      if (api) {
        const response = await api.set(key, JSON.parse(value), revs.get(key));
        if (response && response.code === 'STALE_RECORD') {
          window.dispatchEvent(new CustomEvent('printshop:stale', { detail: { key, ids: response.stale || [] } }));
          const err = new Error(response.error || 'این اطلاعات جای دیگری تغییر کرده است.');
          err.code = 'STALE_RECORD';
          throw err;
        }
        checked(response);
        if (response.revs) revs.set(key, response.revs);
        if (Object.hasOwn(response, 'value')) value = JSON.stringify(response.value);
      } else localStorage.setItem(key, value);
      return { key, value, shared: true };
    },
    async delete(key) {
      requireDesktop();
      if (api) checked(await api.del(key)); else localStorage.removeItem(key);
      revs.delete(key);
      return { key, deleted: true, shared: true };
    },
  };
}

/* Electron/Windows quirk: after a native alert()/confirm() the text inputs can stop
   accepting keyboard focus. Re-focusing the window right after the dialog fixes it. */
if (window.printshopApi && window.printshopApi.refocus) {
  const _alert = window.alert.bind(window);
  const _confirm = window.confirm.bind(window);
  window.alert = (m) => { _alert(m); window.printshopApi.refocus(); };
  window.confirm = (m) => { const r = _confirm(m); window.printshopApi.refocus(); return r; };
}

createRoot(document.getElementById('root')).render(<ExitGuard><App /></ExitGuard>);
