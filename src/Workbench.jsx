import { isValidElement, useEffect, useId, useRef, useState } from 'react';
import Sidebar from './Sidebar.jsx';
import './workbench.css';

const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value))];

const isTextEntry = element => {
  if (!element) return false;
  const tag = String(element.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable === true;
};

// RTL order: the next item is visually to the left.
function shiftedTab(enabled, currentId, key) {
  if (enabled.length < 2) return undefined;
  const index = enabled.findIndex(item => item.id === currentId);
  if (index < 0) return undefined;
  if (key === 'ArrowLeft') return enabled[(index + 1) % enabled.length]?.id;
  if (key === 'ArrowRight') return enabled[(index - 1 + enabled.length) % enabled.length]?.id;
  if (key === 'Home') return enabled[0]?.id;
  if (key === 'End') return enabled[enabled.length - 1]?.id;
  return undefined;
}

/** Controlled navigation only: closing a tab never deletes its underlying data. */
export function workbenchReducer(state = { openIds: [], activeId: '' }, action = {}) {
  const allowed = unique(Array.isArray(action.allowedIds) ? action.allowedIds : [...(state.openIds || []), ...(action.type === 'open' ? [action.id] : [])]);
  const parentOf = action.parentOf && typeof action.parentOf === 'object' ? action.parentOf : {};
  let openIds = unique(state.openIds || []).filter(id => allowed.includes(id));
  if (!openIds.length && allowed.length) openIds = [allowed[0]];
  let activeId = openIds.includes(state.activeId) ? state.activeId : (openIds[0] || '');
  if (action.type === 'open' && allowed.includes(action.id)) {
    if (!openIds.includes(action.id)) openIds = groupTabsByParent([...openIds, action.id], parentOf);
    activeId = action.id;
  } else if (action.type === 'close' && openIds.includes(action.id) && openIds.length > 1) {
    const index = openIds.indexOf(action.id);
    openIds = openIds.filter(id => id !== action.id);
    if (activeId === action.id) activeId = openIds[Math.min(index, openIds.length - 1)];
  }
  return { openIds, activeId };
}

// Sub-tabs belong beside their parent tab: opening any tab re-groups the strip once, in opening order.
function groupTabsByParent(openIds, parentOf) {
  const parents = new Set(openIds);
  const kids = new Map();
  for (const id of openIds) {
    const parent = parentOf[id];
    if (parent && parent !== id && parents.has(parent)) {
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent).push(id);
    }
  }
  const grouped = [];
  const isSubTab = id => {
    const parent = parentOf[id];
    return !!parent && parent !== id && kids.has(parent);
  };
  for (const id of openIds) {
    if (isSubTab(id)) continue;
    grouped.push(id);
    for (const kid of kids.get(id) || []) grouped.push(kid);
  }
  return grouped.length === openIds.length ? grouped : openIds;
}

function Icon({ icon }) {
  if (!icon) return <span className="workbench-icon-fallback" aria-hidden="true">◇</span>;
  if (isValidElement(icon)) return <span className="workbench-icon" aria-hidden="true">{icon}</span>;
  const Component = icon;
  return <span className="workbench-icon" aria-hidden="true"><Component size={18} strokeWidth={1.7} /></span>;
}

const groupLabel = group => ({ work: 'کارها', tasks: 'کارها', finance: 'مالی', inventory: 'انبار', report: 'گزارش‌ها', management: 'مدیریت', admin: 'مدیریت' }[group] || group || 'کارها');
const groupOrder = ['کارها', 'مالی', 'انبار', 'گزارش‌ها', 'مدیریت'];
const tabId = (prefix, id) => `${prefix}-tab-${encodeURIComponent(id)}`;
const panelId = prefix => `${prefix}-panel`;
const validItems = items => (items || []).filter((item, index, list) => item && typeof item.id === 'string' && item.id && list.findIndex(entry => entry?.id === item.id) === index);

// Sub-items nest under the parent that is actually in this group; an orphan becomes a root so nothing disappears.
function navBranches(groupItems) {
  const present = new Set(groupItems.map(item => item.id));
  const kids = new Map();
  const roots = [];
  for (const item of groupItems) {
    const parent = item.parent && item.parent !== item.id && present.has(item.parent) ? item.parent : '';
    if (!parent) { roots.push(item); continue; }
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent).push(item);
  }
  return { roots, kids };
}

function TabStrip({ prefix, items, value, onChange, onClose, label, compact = false }) {
  const refs = useRef(new Map());
  const enabled = items.filter(item => !item.disabled);
  const focusable = enabled.some(item => item.id === value) ? value : enabled[0]?.id;
  function select(id) {
    onChange?.(id);
    refs.current.get(id)?.focus();
  }
  function close(id) {
    if (!onClose || items.length <= 1) return;
    const index = enabled.findIndex(item => item.id === id);
    const remaining = enabled.filter(item => item.id !== id);
    const target = value !== id && remaining.some(item => item.id === value) ? value : remaining[Math.min(Math.max(index, 0), remaining.length - 1)]?.id;
    onClose(id);
    refs.current.get(target)?.focus();
  }
  function keydown(event, id) {
    const next = shiftedTab(enabled, id, event.key);
    if (next) { event.preventDefault(); select(next); return; }
    if (event.key === 'Delete' && onClose) { event.preventDefault(); close(id); }
  }
  return <div className={`workbench-tabstrip${compact ? ' workbench-subtabstrip' : ''}`} role="tablist" aria-label={label} aria-orientation="horizontal" dir="rtl">
    {items.map(item => <div role="presentation" className={`workbench-tabwrap${item.id === value ? ' is-active' : ''}`} key={item.id}>
      <button type="button" className="workbench-tab" role="tab" id={tabId(prefix, item.id)} aria-controls={panelId(prefix)} aria-selected={item.id === value} disabled={item.disabled} tabIndex={item.id === focusable ? 0 : -1} ref={element => { if (element) refs.current.set(item.id, element); else refs.current.delete(item.id); }} onClick={() => select(item.id)} onKeyDown={event => keydown(event, item.id)}>
        {item.icon && <Icon icon={item.icon} />}<span>{item.label}</span>
      </button>
      {onClose && <button type="button" className="workbench-tab-close" aria-label={`بستن تب ${item.label}`} title={items.length <= 1 ? 'آخرین تب باز می‌ماند' : `بستن ${item.label} (Delete)`} tabIndex={-1} disabled={items.length <= 1} onClick={() => close(item.id)}><span aria-hidden="true">×</span></button>}
    </div>)}
  </div>;
}

export function WorkbenchShell({ items = [], activeId, openIds = [], onOpen, onClose, onLogout, children, userLabel = 'کاربر چاپخانه', userRole = '', station = '', link = '', server = '', serving = '', avatarUrl = '', onAvatarChange }) {
  const instance = useId();
  const prefix = `workbench-${instance}`;
  // Collapsing a branch only hides it; open tabs and their data are owned by the parent.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => globalThis.matchMedia?.('(max-width: 780px)').matches || false);
  const available = validItems(items);
  const tabs = unique(openIds).map(id => available.find(item => item.id === id)).filter(Boolean);
  const active = tabs.find(item => item.id === activeId);
  const groups = [...new Set(available.map(item => groupLabel(item.group)))].sort((a, b) => {
    const ai = groupOrder.indexOf(a), bi = groupOrder.indexOf(b);
    return (ai < 0 ? groupOrder.length : ai) - (bi < 0 ? groupOrder.length : bi);
  });
  const enabledTabs = tabs.filter(item => !item.disabled);
  const tabKey = enabledTabs.map(item => item.id).join('|');
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    function onKeydown(event) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      // A focused tab button owns its own keys; text entry, dialogs and the sidebar own theirs.
      if (target?.closest?.('[role="tab"]') || target?.closest?.('[role="dialog"], [aria-modal="true"]') || isTextEntry(target)) return;
      if (target !== document.body && !target?.closest?.('.workbench-workspace')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const next = shiftedTab(enabledTabs, activeId, event.key);
        if (!next || next === activeId) return;
        event.preventDefault();
        onOpen?.(next);
        document.getElementById(tabId(prefix, next))?.focus();
        return;
      }
      if (event.key === 'Delete' && onClose && enabledTabs.length > 1) {
        event.preventDefault();
        onClose(activeId);
      }
    }
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  }, [tabKey, activeId, prefix, onOpen, onClose]);
  return <div className={`workbench-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`} dir="rtl">
    <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(value => !value)} navItems={available} activeId={activeId} openIds={openIds} onNavigate={onOpen} user={{ name: userLabel, role: userRole, station }} link={link} server={server} serving={serving} avatarUrl={avatarUrl} onAvatarChange={onAvatarChange} onLogout={onLogout} />
    <div className="workbench-workspace">
      <header className="workbench-header"><div><span className="workbench-eyebrow">کارتابل چاپخانه</span><h1>{active?.label || 'میز کار'}</h1></div><div className="workbench-breadcrumb" aria-label="مسیر بخش">{(() => {
        const parent = active?.parent ? available.find(item => item.id === active.parent) : undefined;
        const group = active && !parent && groupLabel(active.group) !== active.label ? groupLabel(active.group) : '';
        return <>میز کار{group && <><span aria-hidden="true">/</span><strong>{group}</strong></>}{parent && <><span aria-hidden="true">/</span><span>{parent.label}</span></>}{active && <><span aria-hidden="true">/</span><span>{active.label}</span></>}</>;
      })()}</div></header>
      <TabStrip prefix={prefix} items={tabs} value={activeId} onChange={onOpen} onClose={onClose} label="بخش‌های باز کارتابل" />
      <main className="workbench-content" role="tabpanel" id={panelId(prefix)} aria-labelledby={active ? tabId(prefix, active.id) : undefined} aria-label={active ? undefined : 'محتوای کارتابل'} tabIndex={0}>{children}</main>
      <footer className="workbench-statusbar"><span><span className="workbench-status-mark" aria-hidden="true" />{active?.label || 'بخشی انتخاب نشده است'}</span><span>{tabs.length.toLocaleString('fa-IR')} تب باز</span></footer>
    </div>
  </div>;
}

/** Reusable controlled sections. Parent keeps forms mounted inside children. */
export function DeskTabs({ id, items = [], value, onChange, children }) {
  const instance = useId();
  const prefix = `desk-${encodeURIComponent(id || instance)}`;
  const available = validItems(items);
  const active = available.find(item => item.id === value);
  return <section className="workbench-desktabs" dir="rtl">
    <TabStrip prefix={prefix} compact items={available} value={value} onChange={onChange} label="بخش‌های این صفحه" />
    <div className="workbench-deskpanel" role="tabpanel" id={panelId(prefix)} aria-labelledby={active ? tabId(prefix, active.id) : undefined} aria-label={active ? undefined : 'محتوای بخش'} tabIndex={0}>{children}</div>
  </section>;
}

export default WorkbenchShell;
