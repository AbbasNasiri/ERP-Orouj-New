import { isValidElement, useId, useRef, useState } from 'react';
import { LogOut, Minus, PanelRightClose, PanelRightOpen, Plus } from 'lucide-react';
import './sidebar.css';

const groupName = value => ({ work: 'کارها', tasks: 'کارها', finance: 'مالی', inventory: 'انبار', report: 'گزارش‌ها', management: 'مدیریت', admin: 'مدیریت' }[value] || value || 'کارها');
function Icon({ icon }) {
  if (isValidElement(icon)) return <span className="workbench-icon" aria-hidden="true">{icon}</span>;
  const Component = icon;
  return <span className="workbench-icon" aria-hidden="true">{Component ? <Component size={18} strokeWidth={1.7}/> : '◇'}</span>;
}
export default function Sidebar({ collapsed, onToggle, navItems = [], activeId, openIds = [], onNavigate, user = {}, link = '', server = '', serving = '', avatarUrl, onAvatarChange, onLogout }) {
  const prefix = `nav-${useId()}`;
  const [openBranches, setOpenBranches] = useState(() => []);
  const input = useRef(null);
  /* بند ث: «سرور این ماشین» با «ایستگاهِ وصل‌شده» یکی نیست. روی کامپیوتر سرور، نشانی‌ای که
     ایستگاه‌ها باید در client.json بگذارند در همین یک خط دیده می‌شود. */
  const linkText = serving ? 'سرور این ماشین روشن است' : ({ local: 'بانک روی همین کامپیوتر', up: 'وصل به سرور', down: 'سرور قطع است', checking: 'در حال بررسی' }[link] || '');
  const linkTitle = serving ? `ایستگاه‌ها به این نشانی وصل می‌شوند: ${serving}` : server ? `سرور: ${server}` : linkText;
  const dot = serving ? 'up' : (['up', 'down', 'checking', 'local'].includes(link) ? link : 'none');
  const groupOrder = ['کارها', 'مالی', 'انبار', 'گزارش‌ها', 'مدیریت'];
  const groups = [...new Set(navItems.map(item => groupName(item.group)))].sort((a, b) => groupOrder.indexOf(a) - groupOrder.indexOf(b));
  const navigate = item => {
    onNavigate?.(item.id);
    if (collapsed && navItems.some(child => child.parent === item.id && child.id !== item.id)) { onToggle?.(); setOpenBranches(prev => prev.includes(item.id) ? prev : [...prev, item.id]); }
  };
  const navButton = (item, child = false) => <button type="button" key={item.id} className={`workbench-navitem${child ? ' sidebar-child' : ' sidebar-main'}${item.id === activeId ? ' is-active' : ''}`} disabled={item.disabled} aria-label={item.label} aria-current={item.id === activeId ? 'page' : undefined} title={collapsed ? item.label : undefined} onClick={() => navigate(item)}><Icon icon={item.icon}/><span className="workbench-navlabel">{item.label}</span>{openIds.includes(item.id) && <span className="workbench-open-dot" aria-label="تب باز"/>}</button>;
  return <aside className="workbench-sidebar" aria-label="بخش‌های کارتابل">
    <div className="sidebar-toolbar"><strong className="sidebar-slider-label">کارتابل‌ها</strong><button type="button" className="sidebar-slider" data-sidebar-toggle="true" onClick={onToggle} aria-expanded={!collapsed} aria-controls={`${prefix}-navigation`} aria-label={collapsed ? 'باز کردن نوار کناری' : 'جمع کردن نوار کناری'} title={collapsed ? 'باز کردن نوار کناری' : 'جمع کردن نوار کناری'}>{collapsed ? <PanelRightOpen size={18}/> : <PanelRightClose size={18}/>}</button></div>
    <div className="workbench-user" aria-label="کاربر فعال"><button type="button" className="sidebar-avatar-button" disabled={!onAvatarChange} onClick={() => input.current?.click()} aria-label="انتخاب تصویر کاربر" title="انتخاب تصویر کاربر"><span className="workbench-user-avatar">{avatarUrl ? <img src={avatarUrl} alt=""/> : String(user.name || 'ک').trim().slice(0, 1)}</span></button><div className="sidebar-profile-text"><strong>{user.name || 'کاربر چاپخانه'}</strong><span>{user.role || 'کارتابل و مسئولیت‌های شما'}</span>{(user.station || linkText) && <span className="sidebar-station" title={linkTitle}><span className="sidebar-link-dot" data-link={dot} aria-hidden="true"/>{[user.station ? `ایستگاه ${user.station}` : '', linkText].filter(Boolean).join(' · ')}</span>}{avatarUrl && <button type="button" className="sidebar-avatar-remove" onClick={() => onAvatarChange?.(null)}>حذف تصویر</button>}</div><input ref={input} className="sidebar-avatar-file" type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-label="فایل تصویر کاربر" onChange={event => { const file = event.target.files?.[0]; if (file) onAvatarChange?.(file); event.target.value = ''; }}/></div>
    <nav id={`${prefix}-navigation`} className="workbench-navigation" aria-label="دسترسی به بخش‌ها">{groups.map(group => {
      const entries = navItems.filter(item => groupName(item.group) === group);
      const ids = new Set(entries.map(item => item.id));
      const roots = entries.filter(item => !item.parent || item.parent === item.id || !ids.has(item.parent));
      return <section className="workbench-navgroup" key={group} aria-label={group}><div className="workbench-navgroup-title" aria-hidden="true">{group}</div>{roots.map(item => {
        const children = entries.filter(child => child.parent === item.id && child.id !== item.id);
        if (!children.length) return navButton(item);
        const open = openBranches.includes(item.id);
        const childrenId = `${prefix}-children-${encodeURIComponent(item.id)}`;
        return <div className={`workbench-navbranch${children.some(child => child.id === activeId) ? ' has-active-child' : ''}`} key={item.id}><div className="workbench-navrow">{navButton(item)}<button type="button" className="workbench-navdisclose" aria-expanded={open && !collapsed} aria-controls={childrenId} aria-label={`${open ? 'بستن' : 'باز کردن'} زیرمجموعهٔ ${item.label}`} title={`${open ? 'بستن' : 'باز کردن'} زیرمجموعهٔ ${item.label}`} onClick={() => { setOpenBranches(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id]); if (collapsed) onToggle?.(); }}><span className="workbench-navdisclose-glyph" aria-hidden="true">{open ? <Minus size={13} strokeWidth={2.6}/> : <Plus size={13} strokeWidth={2.6}/>}</span></button></div><div className="workbench-navchildren" id={childrenId} role="group" aria-label={`زیرمجموعهٔ ${item.label}`} hidden={collapsed || !open}>{children.map(child => navButton(child, true))}</div></div>;
      })}</section>;
    })}</nav>
    <div className="workbench-sidebar-footer"><button type="button" className="workbench-logout" onClick={onLogout} disabled={!onLogout} aria-label="خروج از حساب" title="خروج از حساب"><LogOut size={17}/><span className="sidebar-logout-label">خروج</span></button></div>
  </aside>;
}
