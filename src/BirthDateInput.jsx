import { useEffect, useId, useState } from 'react';
import './birth-date-input.css';

const toLatin = value => String(value).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).replace(/\D/g, '');
const toFa = value => String(value).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
const partsOf = (value, fromIso) => {
  if (!value) return { year: '', month: '', day: '' };
  const date = fromIso(value);
  return { year: String(date.jy), month: String(date.jm), day: String(date.jd) };
};
const textOf = (parts) => (parts.year ? toFa([parts.year, parts.month, parts.day].map((v, i) => v.padStart(i === 0 ? 4 : 2, '0')).join('/')) : '');

export function birthDateResult(parts, { toIso, fromIso, isLeapYear, today }) {
  const { year, month, day } = parts;
  if (![year, month, day].some(Boolean)) return { valid: true, iso: '', error: '' };
  if (!year || !month || !day) return { valid: false, error: 'روز، ماه و سال را کامل وارد کنید.' };
  const y = Number(year), m = Number(month), d = Number(day);
  const latest = fromIso(today).jy;
  if (!Number.isInteger(y) || y < 1 || y > latest) return { valid: false, error: `سال باید از ۱ تا ${latest.toLocaleString('fa-IR', { useGrouping: false })} باشد.` };
  const limit = m <= 6 ? 31 : m <= 11 ? 30 : isLeapYear(y) ? 30 : 29;
  if (m < 1 || m > 12 || !Number.isInteger(d) || d < 1 || d > limit) return { valid: false, error: 'روز انتخاب‌شده در این ماه معتبر نیست.' };
  const iso = toIso(y, m, d);
  if (iso > today) return { valid: false, error: 'تاریخ تولد یا تأسیس نمی‌تواند در آینده باشد.' };
  return { valid: true, iso, error: '' };
}

export default function BirthDateInput({ value, onChange, onValidityChange, toIso, fromIso, isLeapYear, today, label = 'تاریخ تولد' }) {
  const [text, setText] = useState(() => textOf(partsOf(value, fromIso)));
  const [error, setError] = useState('');
  const hintId = useId();
  useEffect(() => { setText(textOf(partsOf(value, fromIso))); setError(''); onValidityChange?.(true); }, [value]);
  function type(raw) {
    const digits = toLatin(raw).slice(0, 8);
    setText(toFa(digits.slice(0, 4) + (digits.length > 4 ? '/' + digits.slice(4, 6) : '') + (digits.length > 6 ? '/' + digits.slice(6, 8) : '')));
    if (!digits.length) { setError(''); onValidityChange?.(true); onChange(''); return; }
    const parts = { year: digits.slice(0, 4), month: digits.slice(4, 6).replace(/^0/, '') || '0', day: digits.slice(6, 8).replace(/^0/, '') || '0' };
    const result = digits.length < 8 ? { valid: false, iso: '', error: '' } : birthDateResult(parts, { toIso, fromIso, isLeapYear, today });
    setError(result.error); onValidityChange?.(result.valid);
    if (result.valid) onChange(result.iso);
  }
  return <div className="birth-date-input" role="group" aria-describedby={hintId}>
    <input className="birth-date-field" aria-label={label} inputMode="numeric" maxLength={10} value={text}
      onChange={e => type(e.target.value)} placeholder="۱۳۵۰/۰۷/۱۵" aria-invalid={!!error}
      style={{ direction: 'ltr', textAlign: 'center', letterSpacing: 1 }} />
    <small id={hintId} role={error ? 'alert' : undefined} className={error ? 'birth-date-error' : ''}>{error}</small>
  </div>;
}
