import { useEffect, useRef, useState } from 'react';
import { FilePenLine, LogOut } from 'lucide-react';
import { latestCloseBlocker, registerCloseBlocker, requestGuardedAction, setClosePresenter } from './close-registry.mjs';

export function useUnsavedChanges({ dirty, busy = false, title, onDiscard }) {
  const current = useRef(); current.current = { active: !!dirty || !!busy, dirty: !!dirty, busy: !!busy, title, close: onDiscard };
  useEffect(() => registerCloseBlocker(() => current.current), []);
}

export default function ExitGuard({ children }) {
  const [prompt, setPrompt] = useState(null);
  const pending = useRef(null), dialog = useRef(null), previousFocus = useRef(null);
  const finish = () => { pending.current = null; setPrompt(null); previousFocus.current?.focus?.(); };
  const present = request => {
    if (pending.current) return;
    previousFocus.current = document.activeElement;
    const blocker = request.blocker || latestCloseBlocker();
    const next = blocker ? { kind: 'panel', blocker } : { kind: request.exit ? 'exit' : 'action', action: request.action };
    pending.current = next; setPrompt(next);
  };
  useEffect(() => setClosePresenter(present), []);
  useEffect(() => {
    const api = window.printshopApi;
    return api?.onCloseRequest?.(requestId => {
      const blocker = latestCloseBlocker();
      // A window-close request first resolves the open form; it never silently
      // continues from discarding a draft to exiting the whole application.
      if (blocker) { api.respondClose(requestId, false); present({ blocker }); }
      else if (pending.current) api.respondClose(requestId, false);
      else {
        previousFocus.current = document.activeElement;
        const next = { kind: 'exit', action: () => api.respondClose(requestId, true), cancel: () => api.respondClose(requestId, false) };
        pending.current = next; setPrompt(next);
      }
    });
  }, []);
  useEffect(() => {
    if (!prompt) return;
    dialog.current?.querySelector('button')?.focus();
    const keyboard = event => {
      if (event.key === 'Escape') { event.preventDefault(); prompt.cancel?.(); finish(); }
      if (event.key !== 'Tab') return;
      const buttons = [...dialog.current.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard, true);
    return () => document.removeEventListener('keydown', keyboard, true);
  }, [prompt]);
  return <>{children}{prompt && <div className="ui-exit-overlay no-print"><section ref={dialog} className="ui-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-dialog-title" aria-describedby="exit-dialog-description">
    <span className="ui-exit-mark">{prompt.kind === 'panel' ? <FilePenLine size={23}/> : <LogOut size={23}/>}</span>
    <h2 id="exit-dialog-title">{prompt.kind === 'panel' ? (prompt.blocker.dirty && !prompt.blocker.busy ? `«${prompt.blocker.title || 'فرم'}» هنوز ثبت نشده است` : `«${prompt.blocker.title || 'فرم'}» باز است`) : prompt.kind === 'exit' ? 'از برنامه خارج می‌شوید؟' : 'از حساب خارج می‌شوید؟'}</h2>
    <p id="exit-dialog-description">{prompt.kind === 'panel' ? (prompt.blocker.busy ? 'عملیات ثبت در جریان است. به فرم برگردید و تا دریافت نتیجه صبر کنید.' : prompt.blocker.dirty ? 'آنچه در این فرم وارد کرده‌اید هنوز ثبت نشده است. اگر الان ببندید، چیزی ذخیره نمی‌شود. برای ثبت، به فرم برگردید.' : 'ابتدا فرم باز را ببندید؛ سپس برای خروج از برنامه دوباره اقدام کنید.') : 'با تأیید شما، این نشست پایان می‌یابد.'}</p>
    <div className="ui-exit-actions"><button type="button" className="ui-button ui-button-primary" onClick={() => { prompt.cancel?.(); finish(); }}>{prompt.kind === 'panel' ? 'بازگشت به فرم' : 'ماندن در برنامه'}</button><button type="button" className="ui-button" disabled={prompt.kind === 'panel' && prompt.blocker.busy} onClick={async () => { const action = prompt.kind === 'panel' ? prompt.blocker.close : prompt.action; finish(); await action?.(); }}>{prompt.kind === 'panel' ? (prompt.blocker.dirty ? 'بستن بدون ثبت' : 'بستن فرم') : 'تأیید خروج'}</button></div>
  </section></div>}</>;
}

export function GuardedModal({ title, onClose, children, wide, trackChanges = true, dirty: dirtyProp }) {
  const [touched, setTouched] = useState(false);
  const controlled = typeof dirtyProp === 'boolean';
  const dirty = controlled ? dirtyProp : touched;
  const setDirty = () => setTouched(true);
  const latest = useRef(); latest.current = { title, dirty, close: onClose };
  const dialog = useRef(null), previousFocus = useRef(null);
  useEffect(() => {
    previousFocus.current = document.activeElement;
    const unregister = registerCloseBlocker(() => latest.current);
    return () => { unregister(); previousFocus.current?.focus?.(); };
  }, []);
  /* trackChanges=false برای مودال‌هایی که نوشتن در آن‌ها پیش‌نویس نیست (مثل شرح تصمیم بررسی یک طرف). */
  const close = () => (trackChanges || controlled) && dirty ? requestGuardedAction(null, { blocker: latest.current }) : onClose();
  return <div className="ui-modal-overlay no-print"><section ref={dialog} className={`ui-modal${wide ? ' ui-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onChangeCapture={trackChanges && !controlled ? setDirty : undefined} onInputCapture={trackChanges && !controlled ? setDirty : undefined}>
    <header className="ui-modal-header"><h2>{title}</h2><button type="button" className="ui-modal-close" aria-label={`بستن ${title}`} onClick={close}>×</button></header><div className="ui-modal-body">{children}</div>
  </section></div>;
}
