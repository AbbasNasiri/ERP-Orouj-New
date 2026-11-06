import { useEffect, useState } from 'react';
import packageInfo from '../package.json';
import './app-status-bar.css';

const TIME_ZONE = 'Asia/Tehran';
const persianDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: TIME_ZONE, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});
const persianClock = new Intl.DateTimeFormat('fa-IR', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const minuteKey = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false });
const localDate = new Intl.DateTimeFormat('en-CA-u-ca-gregory', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

export function tehranDateKey(value) {
  const parts = Object.fromEntries(localDate.formatToParts(value).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatPersianDate(value) {
  const parts = Object.fromEntries(persianDate.formatToParts(value).map(part => [part.type, part.value]));
  return `${parts.weekday}، ${parts.day} ${parts.month} ${parts.year}`;
}

export function formatTehranClock(value) {
  const parts = Object.fromEntries(persianClock.formatToParts(value).map(part => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

export function tehranMinuteKey(value) {
  const parts = Object.fromEntries(minuteKey.formatToParts(value).map(part => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}`;
}

// Find the next local date change through Intl rather than assuming a UTC
// offset or a 24-hour day. Recompute after waking or returning to the window.
export function nextTehranMidnightDelay(value) {
  const timestamp = Number(value), today = tehranDateKey(timestamp);
  let low = timestamp, high = timestamp + 36 * 60 * 60 * 1000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (tehranDateKey(middle) === today) low = middle;
    else high = middle;
  }
  return high - timestamp + 25;
}

export default function AppStatusBar() {
  const [today, setToday] = useState(() => Date.now());
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    let timer;
    function update() {
      clearTimeout(timer);
      const now = Date.now();
      setClock(now);
      setToday(now);
      timer = setTimeout(update, nextTehranMidnightDelay(now));
    }
    const resume = () => { if (document.visibilityState === 'visible') update(); };
    update();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', update);
    };
  }, []);
  useEffect(() => {
    let timer;
    function tick() {
      const now = Date.now();
      setClock(now);
      timer = setTimeout(tick, 1000 - (now % 1000));
    }
    tick();
    return () => clearTimeout(timer);
  }, []);

  return <footer className="app-status-bar no-print" aria-label="اطلاعات برنامه">
    <span className="app-credits" dir="rtl">این نرم‌افزار با مدیریت عباس نصیری و توسط هوش مصنوعی GapGPT ، Claude راه‌اندازی و پیاده‌سازی شده است. لطفاً از طریق نشانی <bdi>asn.nasiri@hotmail.com</bdi> با ما در ارتباط باشید.</span>
    <div className="app-status-values"><span dir="rtl">نسخه <bdi>{packageInfo.version}</bdi></span>
    <time dir="rtl" dateTime={tehranDateKey(today)}>{formatPersianDate(today)}</time>
    <time dir="rtl" aria-label="ساعت" dateTime={tehranMinuteKey(clock)}>{formatTehranClock(clock)}</time></div>
  </footer>;
}
