import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { CUTS as ENGINE_CUTS, PRESSES as ENGINE_PRESSES } from './print-engine.mjs';
import PrintPreview from './PrintPreview.jsx';
import OfficialInvoice from './OfficialInvoice.jsx';
import BirthDateInput from './BirthDateInput.jsx';
import AppStatusBar from './AppStatusBar.jsx';
import { TRIM_SIZES as DEFAULT_TRIM_SIZES, PAPER_KINDS as DEFAULT_PAPER_KINDS, DEFAULT_BINDING_TYPES, DEFAULT_PRINT_COLORS, DEFAULT_BOOK_LIKE_TYPES, lexicon, applyBank, parseOrderText, analyzeItem, estimateCost, costContext, numberToWords, cleanNumber, formatTyping, mergeSettings, normalizeDigits, faDigits, colourDraftOf, bookCutPlan } from './smart.js';
import { CELLO_OPTIONS, celloComboOf, celloPatch, celloLabel } from './cellophane.js';
import { UNITS, LETTER_TYPES, LEAVE_TYPES, URGENCY, LETTER_STATUS, unitForRole, composeLetter, nextLetterNumber, validLetter } from './letters.js';
import { bandWeightKg, usesKgPrice } from './kgprice.js';
import { PAY_STATES, PAY_ORDER, emptyReceipt, receiptAmount, validReceipt, applyReceipt, reverseReceipt, filterReceipts, receiptSummary } from './suppliers.js';
import { COMMISSION_MODES, defaultCommission, marketerStatement, daysToBirthday } from './marketing.js';
import { saveWorkbook } from './excel.js';
import { QuoteEditor, lineDescriptionSuggestions } from './QuoteEditor.jsx';
import CustomerEligibility from './CustomerEligibility.jsx';
import { hiddenCount, partyActive, partyBadge, partyReview, pickable, protectedParty, usableParty, workList } from './party-cycle.js';
import CustomerRequestForm from './CustomerRequestForm.jsx';
import CustomerFinancePanel from './CustomerFinancePanel.jsx';
import { useCreditFile, useCreditFiles, CreditFileStrip, CreditApprovalForm, ApprovalDocument } from './CreditFile.jsx';
import CreditFilesPanel from './CreditFilesPanel.jsx';
import MoneyReceiptLedger from './MoneyReceipts.jsx';
import { orderGrandTotal, orderPaid, orderTax, orderPayable, orderBalance, orderDiscount, invoiceRows, moneyError, hasQuotePricing } from './quote-money.mjs';
import { coverRun, textRun } from './print-run.mjs';
import { EmergencyStopForm, OrderWorkflowPanel, WorkflowNotifications } from './workflow.jsx';
import { splitOrderText, extractItems, suggestMethod, suggestPrinters, pressLabelFor, partnersFor, emptyPlan, PLAN_STEPS, OUTSOURCE, AI_DEFAULT_MODEL } from './smartorder.js';
import { withoutWorkflowWrites } from './order-payload.js';
import { CATEGORY_FIELDS, FIELD_LABELS, SIZE_LABEL_BY_CAT, NAME_PLACEHOLDER, CATEGORY_DEFAULT_UNIT, fieldsFor, extractInventory, inventoryErrors } from './inventorysmart.js';
import { applyJobTemplate, FINISHING_STEPS } from './job-templates.js';
import { FORMULA_VARS, FORMULA_FUNCS, DEFAULT_FORMULAS, PARTNER_FORMULAS, UNIT_ORDER, UNIT_META, PRESETS, mergeUnits, makeEntry, makePartner, priceEntry, entryParts, entryHasPrice, entryHasTiers, normTierList } from './units.js';
import {
  LayoutDashboard, ClipboardList, Package, Plus, Search, X, Trash2, Pencil,
  AlertTriangle, Save, Boxes, Printer, ArrowRight, ArrowLeft, Layers, LogOut,
  Users, Truck, Wallet, FileText, FileInput, Mails, Receipt, BookOpen, Settings, Archive, Check, RotateCcw, Sparkles, Lock, ShieldCheck, Info, Library,
  NotebookPen, SquareKanban, Inbox, Calculator, FileCheck, ScrollText, BookUser, Megaphone, PackagePlus, ArrowLeftRight, Factory, Building, ListOrdered, Sheet, Cpu, RefreshCw, BarChart3,
} from 'lucide-react';
import { GuardedModal as Modal, useUnsavedChanges } from './ExitGuard.jsx';
import AnalysisPanel from './AnalysisPanel.jsx';
import AboutDesk from './AboutDesk.jsx';
import OrderItemsTable, { stockSizeWarning } from './OrderItemsTable.jsx';
import { latestCloseBlocker, registerCloseBlocker, requestGuardedAction } from './close-registry.mjs';
import { createUndoStack } from './undo.mjs';
import CatalogTransfer from './CatalogTransfer.jsx';
import { catalogSchemas } from './catalog-workbook.mjs';
import { loadAvatar, saveAvatar } from './avatar.mjs';
import { WorkbenchShell, workbenchReducer, DeskTabs } from './Workbench.jsx';
import './form-field.css';
import './engine-ask.css';
import NumberingSettings from './NumberingSettings.jsx';
import LexiconDesk from './LexiconDesk.jsx';
import OrderResetPanel from './OrderResetPanel.jsx';
import FinancialDocuments from './FinancialDocuments.jsx';
import ItemDeliveryCounts from './ItemDeliveryCounts.jsx';
import InventoryMovements from './InventoryMovements.jsx';
import UnfinishedWorkReport from './UnfinishedWorkReport.jsx';
import DeliveryReport from './DeliveryReport.jsx';
import FinanceReport from './FinanceReport.jsx';
import logoUrl from './assets/logo.png';

const COLORS = {
  primary: '#7A2048', primaryDark: '#551531', accent: '#C9A227', accentLight: '#F4E9C9',
  cream: '#FBF6EC', altRow: '#F1E6D8', border: '#E3D6BC', text: '#2B2320', sub: '#8A7A66',
  danger: '#B3261E', dangerBg: '#FBEAE8', success: '#2E7D32', successBg: '#EAF4EA',
  warn: '#B4740E', warnBg: '#FBF0DC',
};

/* ---------------- Jalali (Shamsi) calendar — verified conversion ---------------- */
function div(a, b) { return ~~(a / b); }
function mod(a, b) { return a - ~~(a / b) * b; }
function jalCal(jy) {
  const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  const bl = breaks.length; let gy = jy + 621, leapJ = -14, jp = breaks[0], jm, jump, n, i;
  for (i = 1; i < bl; i += 1) {
    jm = breaks[i]; jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}
function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}
function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}
function d2j(jdn) {
  const gy = d2g(jdn).gy; let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f, jm, jd;
  if (k >= 0) {
    if (k <= 185) { jm = 1 + div(k, 31); jd = mod(k, 31) + 1; return { jy, jm, jd }; }
    k -= 186;
  } else { jy -= 1; k += 179; if (r.leap === 1) k += 1; }
  jm = 7 + div(k, 30); jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}
function toJalaali(gy, gm, gd) { return d2j(g2d(gy, gm, gd)); }
function toGregorian(jy, jm, jd) { return d2g(j2d(jy, jm, jd)); }
function isLeapJy(jy) { return jalCal(jy).leap === 0; }
const JMONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
function pad2(n) { return String(n).padStart(2, '0'); }
function isoFromJ(jy, jm, jd) { const g = toGregorian(jy, jm, jd); return `${g.gy}-${pad2(g.gm)}-${pad2(g.gd)}`; }
function jFromIso(iso) { if (!iso) return null; const [gy, gm, gd] = iso.split('-').map(Number); return toJalaali(gy, gm, gd); }
/* نمایشِ تاریخ شمسی با رقمِ فارسی (بند ۳/۶ — تصمیم کارفرما «فارسی»): ذخیره همان ISOٔ لاتین می‌ماند. */
function faDate(iso) { const j = jFromIso(iso); return j ? faDigits(`${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`) : '—'; }
function todayIso() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function todayJalali() { return jFromIso(todayIso()); }

/* ---------------- helpers ---------------- */
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmt(n) { const v = Number(n) || 0; return v.toLocaleString('en-US'); }
function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00'); const t = new Date(todayIso() + 'T00:00:00');
  return Math.round((d - t) / 86400000);
}
function urgency(order) {
  if (order.status === 'بایگانی') return { color: COLORS.sub, label: 'بایگانی' };
  if (['تحویل شده', 'لغو شده'].includes(order.status)) return { color: COLORS.sub, label: 'بسته شده' };
  const d = daysUntil(order.deliveryDate);
  if (d === null) return { color: COLORS.sub, label: 'بدون تاریخ تحویل' };
  if (d < 0) return { color: COLORS.danger, label: `${Math.abs(d)} روز عقب‌افتاده` };
  if (d === 0) return { color: COLORS.danger, label: 'تحویل امروز' };
  if (d <= 2) return { color: COLORS.warn, label: `${d} روز مانده` };
  if (d <= 5) return { color: '#C9A227', label: `${d} روز مانده` };
  return { color: COLORS.success, label: `${d} روز مانده` };
}

const REQUEST_STATUS = 'درخواست مشتری';
const STATUS_LIST = [REQUEST_STATUS, 'در انتظار تایید', 'تایید شده', 'در حال طراحی', 'در حال چاپ', 'در حال صحافی', 'آماده تحویل', 'تحویل شده', 'لغو شده', 'بایگانی'];
const PRODUCTION_STATUSES = ['تایید شده', 'در حال طراحی', 'در حال چاپ', 'در حال صحافی', 'آماده تحویل', 'تحویل شده', 'لغو شده'];
const STATUS_STYLE = {
  [REQUEST_STATUS]: { bg: '#FBE3E0', fg: '#B3261E' }, 'در انتظار تایید': { bg: '#F4E9C9', fg: '#6B5417' }, 'در حال طراحی': { bg: '#E3DCF4', fg: '#4A3A82' },
  'در حال چاپ': { bg: '#DCEAF7', fg: '#1F4E79' }, 'در حال صحافی': { bg: '#E4D9C9', fg: '#6B4417' },
  'آماده تحویل': { bg: '#DDF0DD', fg: '#215B21' }, 'تحویل شده': { bg: '#E4E4E0', fg: '#4A4A44' }, 'لغو شده': { bg: '#F7DCDC', fg: '#7A2222' },
  'تایید شده': { bg: '#E3F1E9', fg: '#1E6B3A' }, 'بایگانی': { bg: '#E9E4DC', fg: '#6A5F52' },
};
const START_STAGE = 'ثبت سفارش';
const FINAL_STAGE = 'کنترل کیفیت و تحویل به مشتری';
const DELIVERY_STAGE = 'تحویل';
/* اصلاحات ۱۷/بند ۳ (تصمیم کارفرما به پرسش ۱): کنترل کیفیت شغلِ خودش است — «ناظر کیفیت»؛
   در سرور هم تنها همین نقش «تعداد سالم» را می‌نویسد (electron/workflow.js QUALITY_ROLES). */
const QC_ROLE = 'ناظر کیفیت';
const OFFSET_PATH = [START_STAGE, 'طراحی و پروف', 'لیتوگرافی و زینک', 'چاپ افست', 'صحافی و تکمیلی', FINAL_STAGE];
const DIGITAL_PATH = [START_STAGE, 'طراحی و پروف', 'چاپ دیجیتال', 'برش و تکمیلی', FINAL_STAGE];
const LEGACY_PATH = [START_STAGE, 'طراحی', 'پروف', 'لیتوگرافی', 'چاپ', 'صحافی', 'خدمات تکمیلی', 'کنترل کیفیت', DELIVERY_STAGE];
const ALL_STAGES = [...new Set([...OFFSET_PATH, ...DIGITAL_PATH, ...LEGACY_PATH])];
function migrateOrders(list) { return (list || []).map(o => ({ ...o, items: (o.items || []).map(it => it.stage === 'برش' ? { ...it, stage: 'خدمات تکمیلی' } : it) })); }
// UI mirror of electron/workflow.js stagesFor(); the server stays the authority and refuses any move outside the item's own path.
const pathKeyOf = (item) => (item && item.spec && item.spec.printMethod === 'دیجیتال' ? 'digital' : 'offset');
const pathLabelOf = (item) => pathKeyOf(item) === 'digital' ? 'دیجیتال' : 'افست';
function stagesFor(item) {
  const stage = (item && item.stage) || START_STAGE;
  if (stage !== START_STAGE && LEGACY_PATH.includes(stage)) return LEGACY_PATH;
  const own = pathKeyOf(item) === 'digital' ? DIGITAL_PATH : OFFSET_PATH;
  const other = own === DIGITAL_PATH ? OFFSET_PATH : DIGITAL_PATH;
  return own.includes(stage) ? own : (other.includes(stage) ? other : own);
}
const isDeliveryStage = (stage) => stage === FINAL_STAGE || stage === DELIVERY_STAGE;
const finalStageFor = (item) => { const list = stagesFor(item); return list[list.length - 1]; };
const STAGE_COLORS = {
  'ثبت سفارش': '#7A2048', 'طراحی و پروف': '#5B4B8A', 'لیتوگرافی و زینک': '#1F7A6C', 'چاپ افست': '#2E7D32',
  'چاپ دیجیتال': '#B4740E', 'صحافی و تکمیلی': '#8A7A17', 'برش و تکمیلی': '#8A7A17', [FINAL_STAGE]: '#A34A1F',
  'طراحی': '#5B4B8A', 'پروف': '#2C6E8F', 'لیتوگرافی': '#1F7A6C', 'چاپ': '#2E7D32',
  'خدمات تکمیلی': '#8A7A17', 'صحافی': '#B4740E', 'کنترل کیفیت': '#A34A1F', 'تحویل': '#555555',
};
// UI mirror of electron/workflow.js STAGE_COMPLETE_ROLES; the server remains the authority.
const STAGE_COMPLETE_ROLES = {
  [START_STAGE]: ['کارشناس سفارشات'], [FINAL_STAGE]: ['کارشناس سفارشات', 'مدیر مالی'],
  'طراحی و پروف': ['کارشناس سفارشات'], 'لیتوگرافی و زینک': ['سرپرست لیتوگرافی'],
  'چاپ افست': ['سرپرست چاپ'], 'چاپ دیجیتال': ['سرپرست چاپ دیجیتال'],
  'صحافی و تکمیلی': ['سرپرست صحافی'], 'برش و تکمیلی': ['سرپرست صحافی'],
  'طراحی': ['کارشناس سفارشات'], 'پروف': ['کارشناس سفارشات'],
  'لیتوگرافی': ['سرپرست لیتوگرافی'], 'چاپ': ['سرپرست چاپ', 'سرپرست چاپ دیجیتال'],
  'صحافی': ['سرپرست صحافی'], 'خدمات تکمیلی': ['سرپرست صحافی'], 'کنترل کیفیت': ['سرپرست صحافی'],
  'تحویل': ['کارشناس سفارشات', 'مدیر مالی'],
};
const canCompleteStage = (role, stage) => role === 'مدیر چاپخانه' || (STAGE_COMPLETE_ROLES[stage] || []).includes(role);
/* اصلاحات ۱۷/بند ۳/۳: آینهٔ UI از COUNT_STAGESِ electron/workflow.js — «سالم» و «تحویل»
   فقط در کنترل کیفیت و تحویل نوشته می‌شوند. سرور همچنان مرجع است و هر ثبتِ بی‌مجوز را رد می‌کند.
   اصلاحات ۱۷/بند ۳/۵ (پرسش ۱): این دو عدد دو شغلِ جدا دارند — «سالم» فقط ناظر کیفیت،
   ردیفِ تحویل همان امضاکنندگانِ مرحلهٔ تحویل. */
const COUNT_STAGES = ['کنترل کیفیت', FINAL_STAGE, DELIVERY_STAGE];
const canRecordQuality = (role, stage) => COUNT_STAGES.includes(stage) && role === QC_ROLE;
const canRecordDelivery = (role, stage) => COUNT_STAGES.includes(stage) && canCompleteStage(role, stage);
const isStageCompleted = (item, stage) => !!(item && item.stageCompletions && item.stageCompletions[stage]);
const stageCompletionLabel = (rec) => {
  if (!rec || !rec.at) return '—';
  const d = new Date(rec.at);
  return `${faDate(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`)} ${d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })} — ${(rec.by && rec.by.name) || '—'}`;
};
const PAPER_LIKE = ['کاغذ', 'مقوا'];
const NOT_PAPER = (i) => !PAPER_LIKE.includes(i.category);
const REQUIRED_INV_CATEGORIES = ['کاغذ', 'مقوا', 'مرکب', 'زینک', 'سلفون', 'فویل طلا'];
const SHOP_NAME = 'موسسه چاپ و نشر عروج';
const PRESS_TYPES = ['GTO', '2 ورقی', '4.5 ورقی'];
const COLOR_MODES = ['تک‌رنگ', 'دورنگ', 'چهاررنگ (CMYK)', 'رنگی + طلاکوب'];
const DEFAULT_QTY_UNITS = ['عدد', 'بسته', 'دست', 'رول', 'نسخه'];
const DEFAULT_SERVICE_TYPES = ['لترپرس', 'یووی موضعی', 'برجسته‌کاری', 'پانچ', 'منگنه فلزی'];
const DEFAULT_INV_CATEGORIES = ['کاغذ', 'مقوا', 'مرکب', 'زینک', 'سلفون', 'فویل طلا', 'سایر'];
const DEFAULT_PRODUCT_TYPES = ['کتاب', 'مجله', 'کاتالوگ', 'بروشور', 'تراکت', 'فلایر', 'پوستر', 'کارت ویزیت', 'کارت پستال', 'سربرگ', 'ست اداری', 'پاکت نامه', 'فولدر', 'دفترچه', 'تقویم', 'برچسب و لیبل', 'جعبه', 'بنر', 'سایر'];
const printColorsFromMap = (map) => Object.entries(map || {}).map(([code, label]) => [Number(code), label]).filter(([code]) => Number.isInteger(code) && code > 0).sort((a, b) => a[0] - b[0]);
const printColorsToMap = (pairs) => Object.fromEntries(pairs.map(([code, label]) => [String(code), label]));
const trimSizesFromMap = (map) => {
  const out = {};
  for (const [name, dim] of Object.entries(map || {})) {
    const w = Number(Array.isArray(dim) ? dim[0] : NaN), h = Number(Array.isArray(dim) ? dim[1] : NaN);
    if (name && w > 0 && h > 0) out[name] = [w, h];
  }
  return Object.keys(out).length ? out : DEFAULT_TRIM_SIZES;
};
const SIMPLE_UNITS = ['کیلوگرم', 'عدد', 'متر', 'متر مربع', 'لیتر'];
const REP_ROLES = ['مدیرعامل', 'معاون', 'راننده', 'ناظر فنی', 'کارشناس فروش', 'سایر'];

/* ---------------- inventory stock helpers ---------------- */
function stockLevel(item) {
  if (item.unitMode === 'band_sheet') return Number(item.bandCount) || 0;
  if (item.unitMode === 'roll_kg') return Number(item.weightKg) || 0;
  return Number(item.quantity) || 0;
}
function stockUnitLabel(item) {
  if (item.unitMode === 'band_sheet') return 'بند';
  if (item.unitMode === 'roll_kg') return 'کیلوگرم';
  return item.simpleUnit || '';
}
function sheetCount(item) { return (Number(item.bandCount) || 0) * (Number(item.sheetsPerBand) || 0); }
function isLow(item) { return Number(item.minThreshold) > 0 && stockLevel(item) <= Number(item.minThreshold); }
function ownerLabel(item, customers) {
  if (!item) return '—';
  if (item.ownerType === 'مشتری') { const c = customers.find(c => c.id === item.ownerCustomerId); return `مشتری: ${c ? c.name : '—'}`; }
  return 'چاپخانه';
}
function supplierSourceLabel(item, customers, suppliers) {
  if (item.supplierSource === 'مشتری') { const c = customers.find(c => c.id === item.ownerCustomerId); return `خود مشتری${c ? ' (' + c.name + ')' : ''}`; }
  if (item.supplierSource === 'تامین‌کننده') { const s = suppliers.find(s => s.id === item.supplierId); return s ? s.name : '—'; }
  return 'چاپخانه (تولید داخلی)';
}
function itemValue(item) { return stockLevel(item) * (Number(item.unitValue) || 0); }

/* ---------------- empty-object factories ---------------- */
function emptyMaterialUse() { return { id: uid(), inventoryItemId: '', description: '', qty: '', qtyUnit: 'بند', unitLabel: '', ownerName: '', owner: 'چاپخانه', ownerCustomerId: '' }; }
function emptyService(defaultType) { return { id: uid(), serviceType: defaultType || '', notes: '', price: '' }; }
function emptyLineItem() {
  return {
    id: uid(), productName: '', productType: '', stage: 'ثبت سفارش', materialsDeducted: false, plan: emptyPlan(), fromSmart: false,
    qty: '', qtyUnit: 'عدد', colorMode: 'چهاررنگ (CMYK)',
    papers: [emptyMaterialUse()],
    hasDesign: false, designDescription: '', designPrice: '',
    press: '2 ورقی', formDesc: '', waste: '',
    lithoMaterials: [emptyMaterialUse()],
    bindingType: 'بدون صحافی', bindingNotes: '',
    bindingMaterials: [emptyMaterialUse()],
    services: [], unitPrice: '',
    spec: { sizeKey: '', w: '', h: '', pages: '', textKind: '', textGsm: '', textColors: 4, textSides: 1, coverKind: '', coverGsm: '', coverColors: 4, coverSides: 1, cellophane: '', freeText: '', printMethod: 'افست' }, analysis: null,
    coverEnabled: false, coverType: 'نرم (شومیز)', coverColorMode: 'چهاررنگ (CMYK)', coverPress: 'GTO',
    coverPapers: [emptyMaterialUse()], coverLining: [emptyMaterialUse()], coverCellophane: [emptyMaterialUse()],
  };
}
function emptyOrder() {
  return {
    id: uid(), orderNumber: '', date: todayIso(), deliveryDate: '',
    title: '', description: '',
    customerId: '', customerName: '', phone: '', status: 'در انتظار تایید',
    items: [], discount: '', payments: [], createdAt: Date.now(),
    source: 'مشتری', intent: 'proforma', onHold: false, holdReason: '', procurement: null, smartText: '',
    quoteRev: 1, history: [], vatPercent: '', archive: null,
    marketerCode: '', mobile: '', delivery: { method: 'تحویل حضوری در چاپخانه', address: '', receiver: '', phone: '' }, shippingCost: '', otherCost: '', otherLabel: '',
  };
}
function emptyInventoryItem() {
  return {
    id: uid(), category: 'کاغذ', name: '', gramaj: '', size: '', caliperMm: '', brand: '',
    color: '', finish: '', ownerType: 'چاپخانه', ownerCustomerId: '', purpose: '', linkedOrderNumber: '',
    unitMode: 'band_sheet', bandCount: '', sheetsPerBand: '', weightKg: '', quantity: '', simpleUnit: 'کیلوگرم',
    unitValue: '', priceBasis: 'unit', pricePerKg: '', minThreshold: '', location: '', supplierSource: 'چاپخانه', supplierId: '',
    purposeScope: 'all', rollCount: '', kgPerRoll: '', movements: [],
  };
}
function emptyCustomer() { return { id: uid(), entityType: 'حقیقی', name: '', phone: '', mobile: '', address: '', note: '', nationalCode: '', nationalId: '', registerNo: '', economicCode: '', postalCode: '', birthDate: '', repName: '', repRole: 'مدیرعامل', repPhone: '', marketerId: '', isMarketer: false, commission: defaultCommission() }; }
function emptySupplier() {
  return {
    id: uid(), entityType: 'حقوقی', name: '', phone: '', address: '', postalCode: '',
    nationalId: '', registerNo: '', economicCode: '', materials: '', note: '',
    repName: '', repPhone: '', repRole: 'مدیرعامل',
  };
}

/* ---------------- money helpers ---------------- */
function lineTotal(item) { return (Number(item.qty) || 0) * (Number(item.unitPrice) || 0); }
function itemAllMaterials(it) {
  return [...(it.papers || []), ...(it.lithoMaterials || []), ...(it.bindingMaterials || []),
    ...(it.coverPapers || []), ...(it.coverLining || []), ...(it.coverCellophane || [])];
}

function servicesTotal(it) { return (it.services || []).reduce((s, x) => s + (Number(x.price) || 0), 0); }
function itemTotal(it) { return lineTotal(it) + servicesTotal(it) + (it.hasDesign ? (Number(it.designPrice) || 0) : 0); }
function usageInStockUnit(m, inv) {
  const q = Number(m.qty) || 0;
  if (inv && inv.unitMode === 'band_sheet' && m.qtyUnit === 'ورق') { const spb = Number(inv.sheetsPerBand) || 0; return spb ? q / spb : 0; }
  return q;
}
function usageUnitLabel(m, inv) {
  if (!inv) return '';
  if (inv.unitMode === 'band_sheet') return m.qtyUnit === 'ورق' ? 'ورق' : 'بند';
  return stockUnitLabel(inv);
}

/* ---------------- basic UI atoms ---------------- */
function Field({ label, children }) {
  return <label className="psx-field">
    {label ? <span className="psx-field-label">{label}:</span> : null}
    <span className="psx-field-control">{children}</span>
  </label>;
}
const inputStyle = { border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '4px 9px', fontSize: 13, color: COLORS.text, background: '#fff', outline: 'none', width: '100%', boxSizing: 'border-box' };
function NumInput({ value, onChange, style, min, max, step, ...rest }) {
  const raw = value === undefined || value === null ? '' : String(value);
  return (
    <input {...rest} type="text" inputMode="decimal" dir="ltr" value={formatTyping(raw)}
      onChange={e => onChange && onChange({ target: { value: cleanNumber(e.target.value) } })}
      style={{ ...inputStyle, textAlign: 'right', ...(style || {}) }} />
  );
}
function TextInput({ type, ...props }) {
  if (type === 'number') return <NumInput {...props} />;
  return <input type={type} {...props} style={{ ...inputStyle, ...(props.style || {}) }} />;
}
function Select({ options, ...props }) {
  return <select {...props} style={{ ...inputStyle, ...(props.style || {}) }}>{options.map(o => <option key={o} value={o}>{o}</option>)}</select>;
}
function NamedSelect({ items, value, onChange, placeholder, style }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, ...(style || {}) }}>
      <option value="">{placeholder || '— انتخاب —'}</option>
      {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
    </select>
  );
}
function Badge({ text, bg, fg }) { return <span className="psx-badge" style={{ background: bg, color: fg, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>{text}</span>; }
function Dot({ color, title }) { return <span title={title} style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 999, background: color }} />; }
function KpiCard({ label, value, accent }) {
  return (
    <div className="psx-kpi" style={{ background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '14px 16px', flex: 1, minWidth: 150 }}>
      <div className="psx-kpi-label" style={{ fontSize: 12, color: COLORS.sub, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div className="psx-kpi-value" style={{ fontSize: 22, fontWeight: 800, color: accent || COLORS.text }}>{value}</div>
    </div>
  );
}
function SectionTitle({ children, small, color }) {
  return <div data-section-title={small ? 'small' : 'true'} style={{ background: small ? COLORS.accentLight : (color || COLORS.primary), color: small ? COLORS.primaryDark : '#fff', fontWeight: 700, fontSize: small ? 12 : 14, padding: small ? '6px 12px' : '8px 14px', borderRadius: 8, marginBottom: 10 }}>{children}</div>;
}
function IconButton({ icon: Icon, onClick, danger, title }) {
  return <button onClick={onClick} title={title} style={{ border: `1px solid ${danger ? COLORS.danger : COLORS.border}`, background: danger ? COLORS.dangerBg : '#fff', color: danger ? COLORS.danger : COLORS.text, borderRadius: 6, padding: 6, display: 'flex', cursor: 'pointer' }}><Icon size={15} /></button>;
}
function PrimaryButton({ children, onClick, icon: Icon, style, disabled }) {
  return <button disabled={disabled} onClick={onClick} style={{ background: COLORS.primary, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, ...style }}>{Icon && <Icon size={15} />}{children}</button>;
}
function GhostButton({ children, onClick, icon: Icon, style, disabled }) {
  return <button disabled={disabled} onClick={onClick} style={{ background: '#fff', color: COLORS.primary, border: `1px solid ${COLORS.primary}`, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, ...style }}>{Icon && <Icon size={14} />}{children}</button>;
}
/* editable select — lets the user add (and optionally remove) options of a shared persisted list inline */
function EditableSelect({ options, value, onChange, onAddOption, onRemoveOption, protectedOptions = [], placeholder, ariaLabel }) {
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [draft, setDraft] = useState('');
  function commitAdd() {
    const t = draft.trim();
    if (t) { onAddOption(t); onChange(t); }
    setAdding(false); setDraft('');
  }
  if (adding) {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <TextInput autoFocus value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitAdd(); } }} placeholder={placeholder || 'مورد جدید...'} />
        <button type="button" onClick={commitAdd}
          style={{ background: COLORS.primary, color: '#fff', border: 'none', borderRadius: 8, padding: '0 10px', cursor: 'pointer', fontSize: 12 }}>✓</button>
        <button type="button" onClick={() => { setAdding(false); setDraft(''); }} style={{ background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '0 10px', cursor: 'pointer', fontSize: 12 }}>✕</button>
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 4 }}>
        <select aria-label={ariaLabel} value={value} onChange={e => { if (e.target.value === '__add__') setAdding(true); else onChange(e.target.value); }} style={inputStyle}>
          <option value="">— انتخاب —</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
          <option value="__add__">➕ افزودن مورد جدید...</option>
        </select>
        {onRemoveOption && (
          <button type="button" aria-label={`مدیریت فهرست ${ariaLabel || 'این ستون'}`} title="حذف موارد این لیست" onClick={() => setManaging(m => !m)}
            style={{ background: managing ? COLORS.accentLight : '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '0 9px', cursor: 'pointer', fontSize: 14 }}>⚙</button>
        )}
      </div>
      {managing && onRemoveOption && (
        <div style={{ marginTop: 6, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 8, background: '#fff', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: COLORS.sub, fontWeight: 500 }}>حذف از لیست (سفارش‌های قبلی تغییری نمی‌کنند):</div>
          {options.map(o => (
            <div key={o} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: COLORS.text }}>
              <span>{o}</span>
              {protectedOptions.includes(o)
                ? <span style={{ color: COLORS.sub, fontSize: 11 }}>ثابت</span>
                : <button type="button" onClick={() => { if (confirm(`«${o}» از لیست حذف شود؟`)) { onRemoveOption(o); if (value === o) onChange(''); } }}
                    style={{ background: COLORS.dangerBg, color: COLORS.danger, border: `1px solid ${COLORS.danger}`, borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '1px 8px' }}>حذف</button>}
            </div>
          ))}
          {options.length === 0 && <div style={{ fontSize: 11, color: COLORS.sub }}>لیست خالی است.</div>}
        </div>
      )}
    </div>
  );
}

/* Jalali date picker built from three selects (empty value stays empty until the user picks something) */
const FA_WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
function jalaliDigitsToIso(d) {
  if (!d || d.length !== 8) return null;
  const jy = Number(d.slice(0, 4)), jm = Number(d.slice(4, 6)), jd = Number(d.slice(6, 8));
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1) return null;
  const maxD = jm <= 6 ? 31 : (jm <= 11 ? 30 : (isLeapJy(jy) ? 30 : 29));
  return jd > maxD ? null : isoFromJ(jy, jm, jd);
}
/* تاریخ شمسی در «یک کادر»: فقط عدد بنویسید (۱۴۰۵۰۷۲۷ یا ۱۴۰۵/۰۷/۲۷)؛ اسلش خودکار می‌آید. دکمه‌های میانبر (امروز، ۷ روز ...) اختیاری */
function JalaliDateInput({ value, onChange, quick }) {
  const [text, setText] = useState(value ? faDate(value) : '');
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(value ? faDate(value) : ''); setBad(false); }, [value]);
  function type(raw) {
    const d = normalizeDigits(raw).replace(/\D/g, '').slice(0, 8);
    setText(d.slice(0, 4) + (d.length > 4 ? '/' + d.slice(4, 6) : '') + (d.length > 6 ? '/' + d.slice(6, 8) : ''));
    if (d.length === 0) { setBad(false); onChange(''); }
    else if (d.length === 8) { const iso = jalaliDigitsToIso(d); if (iso) { setBad(false); onChange(iso); } else setBad(true); }
    else setBad(false);
  }
  const wd = value ? FA_WEEKDAYS[new Date(value + 'T12:00:00').getDay()] : '';
  return (
    <div className="jalali-input">
      <div className="jalali-input-main">
        <input value={text} onChange={e => type(e.target.value)} placeholder="۱۴۰۵/۰۷/۲۷" inputMode="numeric" maxLength={10}
          style={{ ...inputStyle, direction: 'ltr', textAlign: 'center', letterSpacing: 1, borderColor: bad ? COLORS.danger : undefined, width: 130 }} />
        {wd && !bad && <span style={{ fontSize: 12, color: COLORS.sub, whiteSpace: 'nowrap' }}>{wd}</span>}
        {bad && <span style={{ fontSize: 11, color: COLORS.danger, whiteSpace: 'nowrap' }}>تاریخ معتبر نیست</span>}
      </div>
      {quick && (
        <div className="jalali-quick">
          {quick.map(n => <button key={n} type="button" onClick={() => onChange(addDaysIso(todayIso(), n))} style={{ border: `1px solid ${COLORS.border}`, background: '#fff', borderRadius: 999, padding: '1px 7px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', color: COLORS.sub }}>{n === 0 ? 'امروز' : `${n} روز`}</button>)}
        </div>
      )}
    </div>
  );
}

/* ---------------- material-use row editor (always picks from inventory) ---------------- */
function MaterialUseEditor({ title, rows, categories, inventory, customers, onChange }) {
  const matches = typeof categories === 'function' ? categories : (i => categories.includes(i.category));
  const candidates = inventory.filter(matches);
  function update(id, patch) { onChange(rows.map(r => r.id === id ? { ...r, ...patch } : r)); }
  function remove(id) { onChange(rows.filter(r => r.id !== id)); }
  function add() { onChange([...rows, emptyMaterialUse()]); }
  function pickInventory(id, invId) {
    const item = inventory.find(i => i.id === invId);
    if (!item) { update(id, { inventoryItemId: '', description: '', unitLabel: '', ownerName: '' }); return; }
    update(id, {
      inventoryItemId: invId,
      description: `${item.name}${item.gramaj ? ' - گراماژ ' + item.gramaj : ''}${item.size ? ' - سایز ' + item.size : ''}`,
      owner: item.ownerType, ownerCustomerId: item.ownerCustomerId,
      ownerName: ownerLabel(item, customers),
      qtyUnit: 'بند', unitLabel: item.unitMode === 'band_sheet' ? 'بند' : stockUnitLabel(item),
    });
  }
  return (
    <div style={{ marginBottom: 10 }}>
      {title && <SectionTitle small>{title}</SectionTitle>}
      {rows.map(r => {
        const invItem = inventory.find(i => i.id === r.inventoryItemId);
        const short = invItem && r.qty && usageInStockUnit(r, invItem) > stockLevel(invItem) + 1e-9;
        return (
          <div key={r.id} style={{ marginBottom: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1.5fr 1.4fr auto', gap: 6, alignItems: 'end' }}>
              <Field label="انتخاب از انبار">
                <select value={r.inventoryItemId} onChange={e => pickInventory(r.id, e.target.value)} style={inputStyle}>
                  <option value="">— انتخاب کنید —</option>
                  {candidates.map(i => <option key={i.id} value={i.id}>{i.name}{i.gramaj ? ` (${i.gramaj}g)` : ''}{i.size ? ` - ${i.size}` : ''} — {ownerLabel(i, customers)} — موجودی {fmt(stockLevel(i))} {stockUnitLabel(i)}</option>)}
                </select>
              </Field>
              <Field label={`مقدار مصرفی${invItem ? ' (' + usageUnitLabel(r, invItem) + ')' : ''}`}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <TextInput type="number" min="0" value={r.qty} onChange={e => update(r.id, { qty: e.target.value })} />
                  {invItem && invItem.unitMode === 'band_sheet' && (
                    <select value={r.qtyUnit || 'بند'} onChange={e => update(r.id, { qtyUnit: e.target.value, unitLabel: e.target.value })} style={{ ...inputStyle, width: 72, padding: '7px 4px' }}>
                      <option value="بند">بند</option><option value="ورق">ورق</option>
                    </select>
                  )}
                </div>
              </Field>
              <Field label="مالکیت"><TextInput readOnly value={invItem ? ownerLabel(invItem, customers) : '—'} style={{ background: COLORS.altRow }} /></Field>
              <IconButton icon={Trash2} danger title="حذف" onClick={() => remove(r.id)} />
            </div>
            {short && <div style={{ fontSize: 11, color: COLORS.danger, marginTop: 3 }}>موجودی کافی نیست — موجودی فعلی: {fmt(stockLevel(invItem))} {stockUnitLabel(invItem)}</div>}
          </div>
        );
      })}
      {candidates.length === 0 && <div style={{ fontSize: 11, color: COLORS.danger, marginBottom: 6 }}>هیچ موجودی مناسبی از این نوع در انبار ثبت نشده است.</div>}
      <GhostButton icon={Plus} onClick={add} style={{ fontSize: 12, padding: '5px 10px' }}>افزودن ماده</GhostButton>
    </div>
  );
}

function ServiceEditor({ rows, serviceTypes, onChange, onAddType, onRemoveType }) {
  function update(id, patch) { onChange(rows.map(r => r.id === id ? { ...r, ...patch } : r)); }
  function remove(id) { onChange(rows.filter(r => r.id !== id)); }
  function add() { onChange([...rows, emptyService()]); }
  return (
    <div style={{ marginBottom: 10 }}>
      <SectionTitle small>خدمات تکمیلی (لترپرس، یووی موضعی و ...)</SectionTitle>
      {rows.map(r => (
        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 6, marginBottom: 6, alignItems: 'start' }}>
          <Field label="نوع خدمت (با ⚙ می‌توانید از لیست حذف کنید)"><EditableSelect options={serviceTypes} value={r.serviceType} onChange={v => update(r.id, { serviceType: v })} onAddOption={onAddType} onRemoveOption={onRemoveType} placeholder="نام خدمت جدید" /></Field>
          <Field label="توضیحات"><TextInput value={r.notes} onChange={e => update(r.id, { notes: e.target.value })} /></Field>
          <div style={{ paddingTop: 20 }}><IconButton icon={Trash2} danger title="حذف" onClick={() => remove(r.id)} /></div>
        </div>
      ))}
      <GhostButton icon={Plus} onClick={add} style={{ fontSize: 12, padding: '5px 10px' }}>افزودن خدمت</GhostButton>
    </div>
  );
}

const colorLabel = (n) => (lexicon.printColors.find(o => o[0] === Number(n)) || lexicon.printColors.find(o => o[0] === 4) || ['', 'چهاررنگ (CMYK)'])[1];
const colorModeFor = (n) => ({ 1: 'تک‌رنگ', 2: 'دورنگ', 4: 'چهاررنگ (CMYK)' }[Number(n)] || 'چهاررنگ (CMYK)');

function makeMatRow(inv, qty, unit, customers) {
  return {
    ...emptyMaterialUse(), inventoryItemId: inv.id,
    description: `${inv.name}${inv.gramaj ? ' - گراماژ ' + inv.gramaj : ''}${inv.size ? ' - سایز ' + inv.size : ''}`,
    owner: inv.ownerType, ownerCustomerId: inv.ownerCustomerId, ownerName: ownerLabel(inv, customers),
    qty: qty === '' ? '' : String(qty), qtyUnit: unit === 'ورق' ? 'ورق' : 'بند',
    unitLabel: inv.unitMode === 'band_sheet' ? (unit === 'ورق' ? 'ورق' : 'بند') : stockUnitLabel(inv),
  };
}

/* ===================== ثبت سفارش هوشمند ===================== */
function analyzeAndFill(base, { inventory, customerId, settings, customers }) {
  const book = lexicon.bookLikeTypes.includes(base.productType);
  const specForCalc = { ...base.spec, coverEnabled: book && base.coverEnabled };
  const res = analyzeItem({ ...base, spec: specForCalc }, { inventory, customerId, settings, isBook: book });
  const analysis = { ok: res.ok, errors: res.errors, warnings: res.warnings, waiting: res.waiting || [], steps: res.steps, numbers: res.numbers, invIds: res.invIds };
  const next = { ...base, analysis };
  let needDetails = false;
  if (res.ok) {
    const rowsOf = (list) => list.map(r => makeMatRow(r.inv, r.qty, r.unit, customers));
    if (res.rows.papers.length) next.papers = rowsOf(res.rows.papers);
    if (res.rows.litho.length) next.lithoMaterials = rowsOf(res.rows.litho);
    if (book && base.coverEnabled) {
      if (res.rows.coverPapers.length) next.coverPapers = rowsOf(res.rows.coverPapers);
      next.coverCellophane = res.rows.cellophane.length ? rowsOf(res.rows.cellophane) : [emptyMaterialUse()];
    } else if (res.rows.cellophane.length) next.bindingMaterials = rowsOf(res.rows.cellophane);
    next.formDesc = book ? ((res.numbers.engine && res.numbers.engine.instructions.length) ? res.numbers.engine.instructions.join(" | ") : res.numbers.formDesc) : `${res.numbers.forms} فرم`;
    next.colorMode = colorModeFor(base.spec.textColors);
    next.coverColorMode = colorModeFor(base.spec.coverColors);
    if (res.warnings.some(w => w.includes('پیدا نشد') || w.includes('ثبت نشده'))) needDetails = true;
  }
  return { item: next, needDetails };
}
/* «شرح محصول» ردیف جدول باید چیزی باشد که مشتری گفته، نه فقط نام نوع؛ اولین بندِ متن تا ویرگول */
function describeSegment(segment) {
  const head = normalizeDigits(String(segment || '')).split(/[،,؛;\n]/)[0].replace(/\s+/g, ' ').trim();
  return head.length > 3 ? head.slice(0, 60) : '';
}
function applyParsedToItem(item, p, { serviceTypes }) {
  const sp = item.spec || {};
  const spec = { ...sp }; const next = { ...item }; const found = [];
  if (p.productType) { next.productType = p.productType; if (!item.productName.trim()) next.productName = p.productName || p.productType; found.push(`نوع: ${p.productType}`); }
  /* متن صفحه‌دار ولی بی‌نوع: «کتاب» فرض می‌شود تا صفحات، بلوک رنگ و فرم معنا پیدا کنند؛ در فهرست نوع قابل تغییر است. */
  const assumedBook = !next.productType && Number(p.pages) > 0;
  if (assumedBook) next.productType = 'کتاب';
  if (p.qty) { next.qty = String(p.qty); found.push(`شمارگان: ${fmt(p.qty)}`); }
  if (p.sizeKey) { spec.sizeKey = p.sizeKey; found.push(`قطع: ${p.sizeKey}`); }
  else if (p.custom) { spec.sizeKey = 'سفارشی'; spec.w = String(p.custom[0]); spec.h = String(p.custom[1]); found.push(`قطع: ${p.custom[0]}×${p.custom[1]}`); }
  if (p.pages) { spec.pages = String(p.pages); found.push(`${fmt(p.pages)} صفحه`); }
  if (p.text.kind) spec.textKind = p.text.kind;
  if (p.text.gsm) spec.textGsm = String(p.text.gsm);
  if (p.text.kind || p.text.gsm) found.push(`کاغذ متن: ${p.text.kind} ${p.text.gsm || ''} گرم`);
  if (p.text.colors) { spec.textColors = p.text.colors; found.push(`چاپ: ${colorLabel(p.text.colors)}`); }
  if (p.text.sides) spec.textSides = p.text.sides;
  if (p.text.frontPages) {
    spec.frontColorPages = String(p.text.frontPages);
    spec.frontColors = p.text.frontColors || 4;
    found.push(`صفحه‌های اول: ${p.text.frontPages} صفحه ${colorLabel(spec.frontColors)}`);
  }
  if (p.printMethod) spec.printMethod = p.printMethod;
  const book = lexicon.bookLikeTypes.includes(next.productType);
  if (p.cover.enabled && book) {
    next.coverEnabled = true;
    if (p.cover.kind) spec.coverKind = p.cover.kind;
    if (p.cover.gsm) spec.coverGsm = String(p.cover.gsm);
    if (p.cover.colors) spec.coverColors = p.cover.colors;
    if (p.cover.sides) spec.coverSides = p.cover.sides;
    found.push(`جلد: ${p.cover.kind || ''} ${p.cover.gsm ? p.cover.gsm + ' گرم' : ''} ${p.cover.colors ? colorLabel(p.cover.colors) : ''}`);
  }
  if (p.cover.cellophane) { spec.cellophane = p.cover.cellophane; if (p.cover.celloKind) spec.celloKind = p.cover.celloKind; if (p.cover.celloVariant) spec.celloVariant = p.cover.celloVariant; found.push(`سلفون ${celloLabel(spec)}`); }
  if (p.binding) { next.bindingType = p.binding; if (book) next.coverType = p.binding.startsWith('گالینگور') ? 'سخت (گالینگور)' : 'نرم (شومیز)'; found.push(`صحافی: ${p.binding}`); }
  const newSvc = p.services.filter(s => !(item.services || []).some(x => x.serviceType === s));
  if (newSvc.length) { next.services = [...(item.services || []), ...newSvc.map(s => emptyService(s))]; found.push(`خدمات: ${newSvc.join('، ')}`); }
  // فرض‌های برنامه برای چیزی که در متن نبود (کتاب): جلد، کاغذ متن، رنگ، صحافی، ماشین
  const assumptions = [];
  if (assumedBook) assumptions.push('نوع محصول در متن نبود؛ «کتاب» فرض شد — اگر چیز دیگری است از فهرست «نوع محصول» عوض کنید.');
  const isBook = lexicon.bookLikeTypes.includes(next.productType);
  if (isBook) {
    if (!p.cover.enabled && !next.coverEnabled) { next.coverEnabled = true; assumptions.push('جلد ذکر نشد؛ جلد گلاسه ۲۵۰ گرم چهاررنگ یک‌رو فرض شد.'); }
    if (next.coverEnabled) {
      if (!spec.coverKind) { spec.coverKind = 'گلاسه'; }
      if (!spec.coverGsm) { spec.coverGsm = '250'; if (p.cover.enabled) assumptions.push('گرماژ جلد ذکر نشد؛ ۲۵۰ گرم فرض شد.'); }
      if (!spec.coverColors) { spec.coverColors = 4; spec.coverSides = spec.coverSides || 1; }
    }
    if (!spec.textKind && !spec.textGsm) { spec.textKind = 'تحریر'; spec.textGsm = '70'; assumptions.push('کاغذ متن ذکر نشد؛ تحریر ۷۰ گرم فرض شد.'); }
    else if (!spec.textKind) { spec.textKind = 'تحریر'; assumptions.push('نوع کاغذ متن ذکر نشد؛ تحریر فرض شد.'); }
    if (!spec.textColors) { spec.textColors = 1; assumptions.push('رنگ چاپ متن ذکر نشد؛ تک‌رنگ فرض شد.'); }
    if (!spec.textSides) spec.textSides = 2;
    if (!next.bindingType || next.bindingType === 'بدون صحافی') { if (!p.binding) { next.bindingType = 'شومیز (چسب گرم)'; next.coverType = 'نرم (شومیز)'; assumptions.push('صحافی ذکر نشد؛ شومیز (چسب گرم) فرض شد.'); } }
    if (!sp.sizeKey && !spec.sizeKey) { spec.sizeKey = 'وزیری'; assumptions.push('قطع ذکر نشد؛ وزیری فرض شد.'); }
  }
  if ((spec.printMethod || 'افست') !== 'دیجیتال') { if (!next.press) next.press = '2 ورقی'; if (isBook) assumptions.push(`ماشین چاپ: ${next.press} (پیش‌فرض)؛ در بخش «هر قلم چگونه اجرا شود» می‌توانید عوض کنید و زینک و هزینه بر همان اساس دوباره محاسبه می‌شود.`); }
  // متن تازه = سؤال تازه: تأیید قبلی بلوک رنگ/فرم‌بندی با داده‌های تازه معنا ندارد.
  if (p.pages || p.text.colors || p.text.frontPages) { delete spec.colourUniform; delete spec.colourBlocks; delete spec.colourConfirmed; }
  if (p.sizeKey || p.custom) { delete spec.cutForm; delete spec.cutFormConfirmed; }
  next.assumptions = assumptions;
  next.spec = spec;
  return { next, found };
}
const isBlankItem = (it) => !String(it.productName || '').trim() && !(Number(it.qty) > 0) && !it.analysis;

function orderShortages(o, inventory) {
  const need = {}; const notFound = [];
  (o.items || []).forEach((it, idx) => {
    if (it.materialsDeducted) return;
    const plan = it.plan || {};
    let mats = [...(it.papers || []), ...(it.coverPapers || []), ...(it.coverLining || [])];
    if (!(plan.litho && plan.litho.mode === OUTSOURCE)) mats = mats.concat(it.lithoMaterials || []);
    if (!(plan.binding && plan.binding.mode === OUTSOURCE)) mats = mats.concat(it.bindingMaterials || [], it.coverCellophane || []);
    touchedRows(mats).forEach(r => { const inv = inventory.find(i => i.id === r.inventoryItemId); if (inv) need[inv.id] = (need[inv.id] || 0) + usageInStockUnit(r, inv); });
    ((it.analysis && it.analysis.warnings) || []).filter(w => /پیدا نشد|ثبت نشده/.test(w)).forEach(w => notFound.push(`قلم ${idx + 1}: ${w}`));
  });
  const shortages = Object.entries(need).map(([id, q]) => { const inv = inventory.find(i => i.id === id); return { inv, need: q, have: stockLevel(inv), missing: q - stockLevel(inv) }; }).filter(x => x.missing > 1e-9);
  return { shortages, notFound: [...new Set(notFound)] };
}

function SmartOrderPanel({ o, setO, settings, inventory, customers, productTypes, serviceTypes }) {
  const [open, setOpen] = useState(o.items.length === 0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const ai = settings.ai || {};
  const aiOn = !!(ai.enabled && ai.apiKey);
  async function run() {
    const text = (o.smartText || '').trim();
    if (!text) { setMsg({ ok: false, t: 'ابتدا سفارش را همان‌طور که مشتری می‌گوید بنویسید.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await extractItems(text, { ai, opts: { productTypes, serviceTypes, bindingTypes: lexicon.bindingTypes } });
      if (!res.items.length) { setMsg({ ok: false, t: 'قلمی از متن تشخیص داده نشد. نوع محصول، تیراژ و مشخصات را کامل‌تر بنویسید یا قلم را دستی اضافه کنید.' }); setBusy(false); return; }
      const built = res.items.map(({ segment, parsed }) => {
        const base = { ...emptyLineItem(), fromSmart: true };
        base.spec = { ...base.spec, freeText: segment || '' };
        base.productName = describeSegment(segment) || base.productName;
        const { next } = applyParsedToItem(base, parsed, { serviceTypes });
        return analyzeAndFill(next, { inventory, customerId: o.customerId, settings, customers }).item;
      });
      setO(prev => {
        const kept = prev.items.filter(it => !isBlankItem(it));
        const title = prev.title.trim() ? prev.title : (built.length === 1 ? `${built[0].productName || built[0].productType}${prev.customerName ? ' — ' + prev.customerName : ''}` : `${built.length} قلم سفارش${prev.customerName ? ' — ' + prev.customerName : ''}`);
        return { ...prev, items: [...kept, ...built], title, smartDone: true };
      });
      const parts = [`${built.length} قلم ساخته شد`, res.source === 'ai' ? 'با هوش مصنوعی (آنلاین)' : 'با تحلیل آفلاین'];
      setMsg({ ok: true, t: parts.join(' — ') + '.', note: res.note, questions: res.questions });
    } catch (e) { setMsg({ ok: false, t: `خطا در تحلیل: ${e.message}` }); }
    setBusy(false);
  }
  return (
    <div style={{ border: `1.5px solid ${COLORS.primary}`, borderRadius: 12, padding: 12, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={15} /> مشخصات سفارش</div>
        <Badge text={aiOn ? 'هوش مصنوعی آنلاین' : 'آفلاین'} bg={aiOn ? COLORS.successBg : '#eee'} fg={aiOn ? COLORS.success : '#666'} />
      </div>
      {!open && <GhostButton icon={Plus} onClick={() => setOpen(true)} style={{ padding: '4px 12px', fontSize: 12 }}>افزودن محصول دیگر با متن هوشمند</GhostButton>}
      {open && <>
        <textarea rows={4} value={o.smartText || ''} onChange={e => setO(prev => ({ ...prev, smartText: e.target.value }))}
          placeholder={'سفارش را همان‌طور که مشتری می‌گوید بنویسید. مثلاً:\nکتاب رحلی ۴۰۰ صفحه، متن ۴۰۰ صفحه‌ای دو رنگ، جلد ۲۵۰ گرم، تیراژ ۲۰۰۰ نسخه'}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.9 }} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <PrimaryButton icon={Sparkles} onClick={run} style={{ opacity: busy ? 0.6 : 1 }}>{busy ? 'در حال محاسبه...' : 'ثبت و محاسبه'}</PrimaryButton>
          <span style={{ fontSize: 11, color: COLORS.sub }}>چند محصول: هر کدام در یک خط.</span>
          {msg && <span style={{ fontSize: 12, color: msg.ok ? COLORS.success : COLORS.danger, fontWeight: 700 }}>{msg.t}</span>}
        </div>
        {msg && msg.note && <div style={{ fontSize: 12, color: COLORS.warn, marginTop: 6 }}>⚠ {msg.note}</div>}
        {msg && msg.questions && msg.questions.length > 0 && (
          <div style={{ fontSize: 12, color: COLORS.primaryDark, marginTop: 6, lineHeight: 1.9 }}>پیشنهاد هوش مصنوعی برای پرسش از مشتری: {msg.questions.map((q, i) => <div key={i}>• {q}</div>)}</div>
        )}
      </>}
    </div>
  );
}

function PlanStepEditor({ step, item, units, onChange, canSeeUnits }) {
  const plan = item.plan || emptyPlan();
  const st = plan[step.key] || { mode: 'داخلی' };
  const method = (item.spec && item.spec.printMethod) || 'افست';
  const partners = partnersFor(units, step.key, method);
  const setStep = (patch) => onChange({ ...item, plan: { ...plan, [step.key]: { ...st, ...patch } } });
  const printers = step.key === 'print' ? suggestPrinters(item, item.analysis, units, entryHasPrice) : [];
  const chosen = printers.find(p => p.entry.id === st.machineId);
  const sm = step.key === 'print' ? suggestMethod(item, item.analysis) : null;
  function pickMachine(id) {
    const p = printers.find(x => x.entry.id === id);
    const spec = { ...(item.spec || {}), machineId: id };
    const patch = { ...item, spec, plan: { ...plan, print: { ...st, machineId: id } } };
    if (p && p.kind === 'offset') patch.press = pressLabelFor(p.entry);
    onChange(patch);
  }
  function switchMethod(m) {
    onChange({ ...item, spec: { ...(item.spec || {}), printMethod: m, machineId: '' }, plan: { ...plan, print: { ...st, machineId: '', partnerId: '' } } });
  }
  return (
    <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 8, background: '#fff', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 12, color: COLORS.primaryDark, minWidth: 110 }}>{step.label}{step.key === 'print' ? ` (${method})` : ''}</div>
        <div style={{ width: 150 }}><Select options={['داخلی', OUTSOURCE]} value={st.mode} onChange={e => setStep({ mode: e.target.value })} /></div>
        {st.mode === OUTSOURCE && (partners.length > 0
          ? <div style={{ width: 240 }}><select value={st.partnerId || ''} onChange={e => setStep({ partnerId: e.target.value })} style={inputStyle}><option value="">— پیمانکار —</option>{partners.map(p => <option key={p.id} value={p.id}>{p.name}{p.service ? ` — ${p.service}` : ''}</option>)}</select></div>
          : <span style={{ fontSize: 12, color: COLORS.warn }}>پیمانکاری برای این بخش ثبت نشده{canSeeUnits ? ' — از «واحدهای تولید ← برون‌سپاری» اضافه کنید.' : '؛ از مدیر بخواهید ثبت کند.'}</span>)}
        {step.key === 'print' && st.mode !== OUTSOURCE && (
          <select value={st.machineId || ''} onChange={e => pickMachine(e.target.value)} style={{ ...inputStyle, width: 320 }}>
            <option value="">— انتخاب ماشین (پیشنهاد برنامه بالاست) —</option>
            {printers.map(p => <option key={p.entry.id} value={p.entry.id}>{p.entry.name}</option>)}
          </select>
        )}
      </div>
      {step.key === 'print' && st.mode !== OUTSOURCE && chosen && chosen.reasons.length > 0 && <div style={{ fontSize: 11, color: COLORS.sub }}>{chosen.reasons.join(' — ')}</div>}
      {step.key === 'print' && st.mode !== OUTSOURCE && !st.machineId && printers[0] && <div style={{ fontSize: 11, color: COLORS.primaryDark }}>پیشنهاد برنامه: <strong>{printers[0].entry.name}</strong>{printers[0].reasons.length ? ` (${printers[0].reasons.join('، ')})` : ''} <button type="button" onClick={() => pickMachine(printers[0].entry.id)} style={{ marginInlineStart: 6, background: COLORS.accentLight, border: `1px solid ${COLORS.accent}`, borderRadius: 6, padding: '1px 8px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>همین را انتخاب کن</button></div>}
      {step.key === 'print' && sm && sm.method !== method && <div style={{ fontSize: 11, color: COLORS.warn }}>💡 {sm.reason} <button type="button" onClick={() => switchMethod(sm.method)} style={{ marginInlineStart: 6, background: '#fff', border: `1px solid ${COLORS.warn}`, borderRadius: 6, padding: '1px 8px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>تغییر به {sm.method}</button></div>}
      {step.key === 'print' && printers.length === 0 && st.mode !== OUTSOURCE && <div style={{ fontSize: 11, color: COLORS.warn }}>ماشین چاپ {method} در «واحدهای تولید» ثبت نشده؛ محاسبه با نرخ‌های قدیمی انجام می‌شود.</div>}
    </div>
  );
}

function OrderAssistant({ o, setO, inventory, customers, units, perms, updateItem }) {
  const { shortages, notFound } = orderShortages(o, inventory);
  const analyzed = o.items.filter(it => it.analysis && it.analysis.ok);
  if (!o.items.some(it => !isBlankItem(it))) return null;
  const proc = o.procurement || null;
  const card = { background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 };
  const q = { fontWeight: 800, fontSize: 12, color: COLORS.primaryDark };
  const choice = (active, onClick, text, color) => (
    <button type="button" onClick={onClick} style={{ border: `1.5px solid ${active ? (color || COLORS.primary) : COLORS.border}`, background: active ? (color ? color + '18' : COLORS.accentLight) : '#fff', borderRadius: 9, padding: '7px 12px', cursor: 'pointer', fontSize: 12, fontWeight: active ? 800 : 600, fontFamily: 'inherit', color: COLORS.text }}>{active ? '● ' : '○ '}{text}</button>
  );
  const setProc = (decision) => {
    const tomorrow = addDaysIso(todayIso(), 1);
    if (decision === 'tomorrow') setO(p => ({ ...p, procurement: { decision, date: tomorrow }, onHold: false, holdReason: '' }));
    if (decision === 'hold') setO(p => ({ ...p, procurement: { decision, date: '' }, onHold: true, holdReason: 'در انتظار تامین مواد اولیه' }));
    if (decision === 'after') setO(p => ({ ...p, procurement: { decision, date: '' }, onHold: false, holdReason: '', intent: 'proforma' }));
  };
  const planSteps = (it) => PLAN_STEPS.filter(s => (s.key === 'design' ? it.hasDesign : s.key === 'binding' ? ((it.bindingType && it.bindingType !== 'بدون صحافی') || (it.services || []).length > 0 || (it.spec && it.spec.cellophane)) : true));
  return (
    <div style={{ border: `1.5px solid ${COLORS.primary}`, borderRadius: 12, padding: 12, background: '#FFFDF8', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={15} /> دستیار سفارش — چند سؤال تا سفارش کامل شود</div>

      <div style={card}>
        <div style={q}>۱) هدف از ثبت این سفارش چیست؟</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {choice((o.intent || 'proforma') === 'proforma', () => setO(p => ({ ...p, intent: 'proforma' })), 'فقط پیش‌فاکتور بدهم و منتظر تایید مشتری باشم')}
          {choice(o.intent === 'confirmed', () => setO(p => ({ ...p, intent: 'confirmed' })), 'مشتری قصد ثبت سفارش قطعی دارد', COLORS.success)}
        </div>
        <div style={{ fontSize: 11, color: COLORS.sub }}>با ذخیره، سفارش وارد تولید نمی‌شود. پس از قیمت‌گذاری، تأیید مشتری و سپس اجازهٔ مدیر چاپخانه باید جداگانه در گردش سفارش ثبت شوند.</div>
      </div>

      <div style={card}>
        <div style={q}>۲) موجودی مواد اولیه</div>
        {analyzed.length === 0 && <div style={{ fontSize: 12, color: COLORS.sub }}>پس از تحلیل اقلام، وضعیت کاغذ و زینک و سلفون از انبار بررسی می‌شود.</div>}
        {analyzed.length > 0 && shortages.length === 0 && notFound.length === 0 && <div style={{ fontSize: 12, color: COLORS.success, fontWeight: 700 }}>✓ کاغذ، زینک و سایر مواد این سفارش در انبار موجود است.</div>}
        {notFound.map((w, i) => <div key={i} style={{ fontSize: 12, color: COLORS.warn }}>⚠ {w}</div>)}
        {shortages.map(s => (
          <div key={s.inv.id} style={{ fontSize: 12, color: COLORS.danger, fontWeight: 700 }}>✗ «{s.inv.name}{s.inv.gramaj ? ` ${s.inv.gramaj} گرم` : ''}»: نیاز {fmt(Math.round(s.need * 100) / 100)} {stockUnitLabel(s.inv)} — موجودی {fmt(s.have)} — کمبود {fmt(Math.round(s.missing * 100) / 100)}</div>
        ))}
        {(shortages.length > 0 || notFound.length > 0) && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700 }}>می‌توانید مواد کم‌موجود را تا فردا ({faDate(addDaysIso(todayIso(), 1))}) تامین کنید؟</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {choice(proc && proc.decision === 'tomorrow', () => setProc('tomorrow'), 'بله، تا فردا تامین می‌کنم', COLORS.success)}
              {choice(proc && proc.decision === 'after', () => setProc('after'), 'فعلاً مهم نیست؛ فقط پیش‌فاکتور، تامین بعد از تایید مشتری')}
              {choice(proc && proc.decision === 'hold', () => setProc('hold'), 'نه؛ سفارش معلق بماند تا مواد تامین شود', COLORS.warn)}
            </div>
            {perms && perms.tabs.includes('suppliers') && <div style={{ fontSize: 11, color: COLORS.sub }}>برای تامین، به بخش «تامین‌کنندگان» و «موجودی و کالاها» مراجعه کنید.</div>}
            {o.onHold && <div style={{ fontSize: 12, color: COLORS.warn, fontWeight: 700 }}>این سفارش با وضعیت «معلق» ثبت می‌شود و تا رفع تعلیق وارد تولید نمی‌شود.</div>}
          </>
        )}
      </div>

      {analyzed.length > 0 && (
        <div style={card}>
          <div style={q}>۳) هر قلم چگونه اجرا شود؟ (داخلی یا برون‌سپاری، ماشین چاپ)</div>
          {o.items.filter(it => it.analysis && it.analysis.ok).map((it) => (
            <div key={it.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 8, background: COLORS.altRow, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: COLORS.primaryDark }}>{it.productName || it.productType} — {fmt(it.qty)} {it.qtyUnit}{it.analysis.numbers ? ` — ${fmt(it.analysis.numbers.forms)} فرم، ${fmt(it.analysis.numbers.totalPlates)} زینک` : ''}</div>
              {planSteps(it).map(s => <PlanStepEditor key={s.key} step={s} item={it} units={units} canSeeUnits={perms && perms.tabs.includes('units')} onChange={(next) => updateItem(it.id, next)} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AiSettingsCard({ ai, onSave }) {
  const [d, setD] = useState({ enabled: false, apiKey: '', model: AI_DEFAULT_MODEL, ...ai });
  const [state, setState] = useState(null);
  const [testing, setTesting] = useState(false);
  const card = { background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 820 };
  async function test() {
    setTesting(true); setState(null);
    try {
      const api = window.printshopApi;
      if (!api || !api.aiComplete) { setState({ ok: false, t: 'آزمایش اتصال فقط در نسخه‌ی نصبی (exe) ممکن است.' }); }
      else {
        const r = await api.aiComplete({ apiKey: d.apiKey, model: d.model || AI_DEFAULT_MODEL, system: 'Reply with the single word OK.', user: 'ping' });
        setState(r && r.ok ? { ok: true, t: 'اتصال برقرار است ✓' } : { ok: false, t: `اتصال برقرار نشد: ${(r && r.error) || 'نامشخص'}` });
      }
    } catch (e) { setState({ ok: false, t: `اتصال برقرار نشد: ${e.message}` }); }
    setTesting(false);
  }
  return (
    <div style={card}>
      <SectionTitle>هوش مصنوعی (تحلیل آنلاین سفارش)</SectionTitle>
      <div style={{ fontSize: 12, color: COLORS.sub, lineHeight: 2 }}>با کلید API، متن سفارش با هوش مصنوعی تحلیل می‌شود و دقت برداشت از جمله‌های پیچیده بالاتر می‌رود. اگر اینترنت قطع باشد یا هوش مصنوعی پاسخ ندهد، برنامه خودکار به تحلیل آفلاین برمی‌گردد و کار متوقف نمی‌شود. کلید فقط روی همین رایانه ذخیره می‌شود.</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}><input type="checkbox" checked={!!d.enabled} onChange={e => setD({ ...d, enabled: e.target.checked })} /> استفاده از هوش مصنوعی آنلاین</label>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <Field label="کلید API"><TextInput type="password" value={d.apiKey} onChange={e => setD({ ...d, apiKey: e.target.value })} style={{ direction: 'ltr', textAlign: 'left' }} placeholder="sk-ant-..." /></Field>
        <Field label="مدل"><TextInput value={d.model} onChange={e => setD({ ...d, model: e.target.value })} style={{ direction: 'ltr', textAlign: 'left' }} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <PrimaryButton icon={Save} onClick={() => { onSave({ ...d, apiKey: d.apiKey.trim(), model: (d.model || '').trim() || AI_DEFAULT_MODEL }); setState({ ok: true, t: 'ذخیره شد ✓' }); }}>ذخیره</PrimaryButton>
        <GhostButton onClick={test}>{testing ? 'در حال آزمایش...' : 'آزمایش اتصال'}</GhostButton>
        {state && <span style={{ fontSize: 12, fontWeight: 700, color: state.ok ? COLORS.success : COLORS.danger }}>{state.t}</span>}
      </div>
    </div>
  );
}

const SUG_STYLE = { border: '1px dashed #D2A437', background: '#FFFDF4', boxShadow: 'inset 0 0 0 1px #F3E4BE' };
const faNum = n => Number(n || 0).toLocaleString('fa-IR');

/* پرسش بلوک رنگ: پیشنهاد مستقیم در فیلدها؛ تا «تأیید پیشنهاد» جواب حساب نمی‌شود. */
function ColourBlockAsk({ spec, pages, textColors, onConfirm, onEdit }) {
  const draft = colourDraftOf(spec, pages, textColors);
  const [mode, setMode] = useState(() => (spec.colourConfirmed === true ? (spec.colourUniform === true ? 'uniform' : 'blocks') : (draft.uniform ? 'uniform' : 'blocks')));
  const [rows, setRows] = useState(() => (draft.blocks.length
    ? draft.blocks.map(b => ({ ...b, from: String(b.from), to: String(b.to) }))
    : [{ from: '1', to: String(pages), colors: textColors, label: 'متن' }]));
  const span = r => { const f = Number(r.from), t = Number(r.to); return f >= 1 && t >= f ? t - f + 1 : 0; };
  const sum = rows.reduce((s, r) => s + span(r), 0);
  const inRange = rows.length > 0 && rows.every(r => span(r) > 0 && Number(r.to) <= pages);
  const sorted = [...rows].sort((a, b) => Number(a.from) - Number(b.from));
  const contiguous = sorted.every((r, i) => (i === 0 ? Number(r.from) === 1 : Number(r.from) === Number(sorted[i - 1].to) + 1));
  const sumOk = inRange && contiguous && sum === pages;
  const setRow = (i, patch) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows(rs => [...rs, { from: '', to: '', colors: textColors, label: '' }]);
  const delRow = i => setRows(rs => rs.filter((_, k) => k !== i));
  const clear = () => { setMode('blocks'); setRows([{ from: '', to: '', colors: textColors, label: '' }]); };
  const approve = () => {
    if (mode === 'uniform') { onConfirm({ colourConfirmed: true, colourUniform: true, colourBlocks: [] }); return; }
    if (!sumOk) return;
    onConfirm({
      colourConfirmed: true, colourUniform: false,
      colourBlocks: rows.map(r => ({ from: String(r.from), to: String(r.to), colors: Number(r.colors) || textColors, label: String(r.label || '') })),
    });
  };
  if (spec.colourConfirmed === true) {
    const uniform = spec.colourUniform === true;
    const blocks = Array.isArray(spec.colourBlocks) ? spec.colourBlocks : [];
    return <div className="engine-ask-done">
      <b>✓ بلوک رنگ:</b>
      <span>{uniform ? `همهٔ ${faNum(pages)} صفحه یکدست با ${faNum(textColors)} رنگ` : blocks.map(b => `${faNum(b.from)}–${faNum(b.to)}: ${faNum(b.colors)} رنگ${b.label ? ` (${b.label})` : ''}`).join(' · ') || '—'}</span>
      <button type="button" className="ea-link" onClick={() => onEdit({ colourConfirmed: false })}>ویرایش</button>
    </div>;
  }
  const colorOptions = lexicon.printColors.map(([v, l]) => <option key={v} value={String(v)}>{l}</option>);
  return <div className="engine-ask">
    <div className="engine-ask-head"><span className="ea-qmark">؟</span><h3>پرسش موتور — بلوک رنگ</h3><span className="ea-chip">پیشنهاد آماده — تأیید نشده</span></div>
    <div className="ea-q">
      <div className="ea-q-top"><b>همهٔ متن هم‌رنگ است یا بخشی از صفحه‌ها رنگ بیشتری دارد؟</b><span className="ea-sug-flag">پیشنهاد برنامه</span></div>
      <p>پیشنهاد از متن سفارش ساخته شد و مستقیم در فیلدها نشسته است. اگر درست است فقط «تأیید پیشنهاد» را بزنید؛ اگر نه، همین فیلدها را تغییر بدهید. تا تأیید نکنید، جواب حساب نمی‌شود.</p>
      <div className="ea-chips">
        <button type="button" className={`ea-chip-opt${mode === 'uniform' ? ' on' : ''}`} onClick={() => setMode('uniform')}><span className="ea-dot" /> همهٔ {faNum(pages)} صفحه یکدست با {faNum(textColors)} رنگ</button>
        <button type="button" className={`ea-chip-opt${mode === 'blocks' ? ' on' : ''}`} onClick={() => setMode('blocks')}><span className="ea-dot" /> بخشی از صفحه‌ها رنگ متفاوت دارد {mode === 'blocks' && <span className="ea-sug-flag">پیشنهاد</span>}</button>
      </div>
      {mode === 'blocks' && <div className="ea-ranges">
        <table>
          <thead><tr><th style={{ width: 86 }}>صفحه از</th><th style={{ width: 86 }}>تا</th><th style={{ width: 130 }}>رنگ</th><th>یادداشت</th><th style={{ width: 40 }}></th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>
            <td><TextInput type="number" style={SUG_STYLE} value={r.from} onChange={e => setRow(i, { from: e.target.value })} /></td>
            <td><TextInput type="number" style={SUG_STYLE} value={r.to} onChange={e => setRow(i, { to: e.target.value })} /></td>
            <td><select className="ea-sug" style={{ ...inputStyle, ...SUG_STYLE }} value={String(r.colors)} onChange={e => setRow(i, { colors: Number(e.target.value) })}>{colorOptions}</select></td>
            <td><TextInput style={SUG_STYLE} value={r.label || ''} onChange={e => setRow(i, { label: e.target.value })} /></td>
            <td><button type="button" className="ea-del" title="حذف بلوک" onClick={() => delRow(i)}>×</button></td>
          </tr>)}</tbody>
        </table>
        <div className="ea-ranges-foot">
          <span className={`ea-sum${sumOk ? '' : ' bad'}`}>جمع: {faNum(sum)} صفحه {sumOk ? '= تعداد کل صفحات ✓' : `از ${faNum(pages)} صفحه`}</span>
          <button type="button" className="ea-link" onClick={addRow}>+ افزودن بلوک</button>
        </div>
      </div>}
      <div className="ea-approve-row">
        <button type="button" className="ea-btn" disabled={mode === 'blocks' && !sumOk} onClick={approve}>تأیید پیشنهاد</button>
        <button type="button" className="ea-btn ghost" onClick={clear}>پاک کردن پیشنهاد</button>
        <span className="ea-note">اگر «پاک کردن» را بزنید، فیلدها خالی می‌شوند و خودتان پر می‌کنید.</span>
      </div>
    </div>
    <div className="ea-foot">جواب با همین قلم ذخیره می‌شود. تا تأیید نشود، ستون «فرم» و «زینک» خالی می‌ماند — نه عددِ خاموش.</div>
  </div>;
}

function parseSizeText(text) {
  const nums = normalizeDigits(String(text || '')).split(/[^0-9.]+/).map(Number).filter(n => n > 0);
  return nums.length === 2 ? nums : null;
}
const sizeText = s => (Array.isArray(s) && s.length === 2 ? `${s[0]} × ${s[1]}` : '');
const sheetText = s => (Array.isArray(s) && s.length === 2 ? `${faNum(s[0])}×${faNum(s[1])}` : '—');

/* پرسش فرم‌بندی قطع: چهار عدد پیشنهادی در فیلدها؛ تا تأیید نشود فرم و زینک ساخته نمی‌شود. */
function CutFormAsk({ spec, plan, onConfirm, onEdit }) {
  const s = plan.suggestion;
  const [formPages, setFormPages] = useState(s ? String(s.formPages) : '');
  const [paperPages, setPaperPages] = useState(s ? String(s.paperPages) : '');
  const [formSheet, setFormSheet] = useState(sizeText(s && s.formSheet));
  const [paperSheet, setPaperSheet] = useState(sizeText(s && s.paperSheet));
  const clear = () => { setFormPages(''); setPaperPages(''); setFormSheet(''); setPaperSheet(''); };
  const fp = Number(formPages), pp = Number(paperPages);
  const fs = parseSizeText(formSheet), ps = parseSizeText(paperSheet);
  const ok = Number.isInteger(fp) && fp > 0 && Number.isInteger(pp) && pp >= fp && !!fs && !!ps;
  const approve = () => { if (ok) onConfirm({ cutFormConfirmed: true, cutForm: { formPages: fp, paperPages: pp, formSheet: fs, paperSheet: ps } }); };
  if (spec.cutFormConfirmed === true && spec.cutForm) {
    const cf = spec.cutForm;
    return <div className="engine-ask-done">
      <b>✓ فرم‌بندی «{spec.sizeKey}»:</b>
      <span>{faNum(cf.formPages)} صفحه در فرم · {faNum(cf.paperPages)} صفحه در ورق · فرم {sheetText(cf.formSheet)} · ورق {sheetText(cf.paperSheet)}</span>
      <button type="button" className="ea-link" onClick={() => onEdit({ cutFormConfirmed: false })}>ویرایش</button>
    </div>;
  }
  return <div className="engine-ask">
    <div className="engine-ask-head"><span className="ea-qmark">؟</span><h3>پرسش موتور — فرم‌بندی قطع</h3><span className="ea-chip">پیشنهاد آماده — تأیید نشده</span></div>
    <div className="ea-q">
      <div className="ea-q-top"><b>{plan.reason}</b>{s && <span className="ea-sug-flag">پیشنهاد از قطع {s.source}</span>}</div>
      <p>چهار عددِ فرم و ورق، پیشنهاد برنامه است و در فیلدها نشسته. اگر با تجربهٔ شما جور است تأیید کنید؛ اگر نه، عدد درست را بگذارید. برنامه خودش حدس نمی‌زند.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        <Field label="صفحه در هر فرم"><TextInput type="number" style={SUG_STYLE} value={formPages} onChange={e => setFormPages(e.target.value)} /></Field>
        <Field label="هر ورق چند صفحهٔ کتاب"><TextInput type="number" style={SUG_STYLE} value={paperPages} onChange={e => setPaperPages(e.target.value)} /></Field>
        <Field label="سایز فرم (سانتی‌متر)"><TextInput style={SUG_STYLE} value={formSheet} onChange={e => setFormSheet(e.target.value)} placeholder="۶۰ × ۴۵" /></Field>
        <Field label="سایز ورق کاغذ"><TextInput style={SUG_STYLE} value={paperSheet} onChange={e => setPaperSheet(e.target.value)} placeholder="۶۰ × ۹۰" /></Field>
      </div>
      {s && <div className="ea-suggest-note"><span className="ea-sug-flag">پیشنهاد</span><span>همان فرم‌بندی قطع «{s.source}»: {faNum(s.formPages)} صفحه در فرم، {faNum(s.paperPages)} صفحه در ورق، فرم {sheetText(s.formSheet)}، ورق {sheetText(s.paperSheet)}.</span></div>}
      <div className="ea-approve-row">
        <button type="button" className="ea-btn" disabled={!ok} onClick={approve}>تأیید پیشنهاد برای همین سفارش</button>
        <button type="button" className="ea-btn ghost" onClick={clear}>پاک کردن پیشنهاد</button>
        <button type="button" className="ea-btn" disabled title="در این گام فعال نیست">ذخیره در بانک دانش (برای همهٔ سفارش‌های بعدی)</button>
      </div>
      <div className="ea-note" style={{ marginTop: 7 }}>ذخیره در بانک فعلاً از این فرم انجام نمی‌شود؛ در گام بعد به میز دایرةالمعارف وصل می‌شود.</div>
    </div>
    <div className="ea-foot">تا این چهار عدد تأیید نشود، ستون «فرم» و «زینک» خالی می‌ماند.</div>
  </div>;
}

function LineItemCard({ item, index, inventory, customers, customerId, settings, qtyUnits, serviceTypes, productTypes, onAddQtyUnit, onAddServiceType, onAddProductType, onRemoveQtyUnit, onRemoveServiceType, onRemoveProductType, onChange, onRemove, inTable }) {
  const set = (k, v) => onChange({ ...item, [k]: v });
  const sp = item.spec || {};
  const setSpec = (patch) => onChange({ ...item, spec: { ...sp, ...patch } });
  const isBookLike = lexicon.bookLikeTypes.includes(item.productType);
  const [showDetails, setShowDetails] = useState(!!item.fromSmart);
  const [msg, setMsg] = useState('');
  const [showText, setShowText] = useState(!item.fromSmart && !(item.analysis && item.analysis.ok));
  const grid = (cols) => ({ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 8, marginBottom: 8 });
  const askPages = Math.max(0, Math.round(Number(sp.pages) || 0));
  const askColors = Number(sp.textColors) || 1;
  const cutPlan = isBookLike ? bookCutPlan(sp) : { needed: false };
  const showCutAsk = isBookLike && !!(cutPlan.needed || sp.cutFormConfirmed === true);
  const showColourAsk = isBookLike && askPages > 0 && askColors >= 2;
  const patchSpecAnalyzed = (patch) => onChange(runAnalysis({ ...item, spec: { ...sp, ...patch } }));
  const resetSpecKeys = (keys, patch) => {
    const next = { ...sp, ...patch };
    keys.forEach(k => delete next[k]);
    onChange({ ...item, spec: next });
  };

  function runAnalysis(base) {
    const r = analyzeAndFill(base, { inventory, customerId, settings, customers });
    if (r.needDetails) setShowDetails(true);
    return r.item;
  }

  function understand() {
    const text = sp.freeText || '';
    if (!text.trim()) { setMsg('ابتدا توضیح سفارش را بنویسید.'); return; }
    const p = parseOrderText(text, { productTypes, serviceTypes });
    const { next, found } = applyParsedToItem(item, p, { serviceTypes });
    onChange(runAnalysis(next));
    setMsg(found.length ? 'برداشت برنامه: ' + found.join(' — ') : 'چیزی از متن تشخیص داده نشد؛ مشخصات را دستی وارد کنید.');
  }

  const sel = (value, onCh, children) => <select value={value} onChange={onCh} style={inputStyle}>{children}</select>;

  return (
    <div style={{ background: '#fff', border: `1px solid ${inTable ? '#e7ddca' : COLORS.border}`, borderRadius: inTable ? 10 : 12, padding: inTable ? 12 : 14, marginBottom: inTable ? 0 : 12 }}>
      {!inTable && <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: COLORS.primaryDark }}>قلم {index + 1}</div>
          <IconButton icon={Trash2} danger title="حذف این قلم" onClick={onRemove} />
        </div>
        <div style={grid(4)}>
          <Field label="شرح محصول"><TextInput value={item.productName} onChange={e => set('productName', e.target.value)} placeholder="مثلاً کتاب آموزشی" /></Field>
          <Field label="نوع محصول"><EditableSelect options={productTypes} value={item.productType} onChange={v => onChange(applyJobTemplate({ ...item, productType: v }))} onAddOption={onAddProductType} onRemoveOption={onRemoveProductType} placeholder="نوع جدید" /></Field>
          <Field label="شمارگان (تیراژ)"><TextInput type="number" value={item.qty} onChange={e => set('qty', e.target.value)} /></Field>
          <Field label="واحد"><EditableSelect options={qtyUnits} value={item.qtyUnit} onChange={v => set('qtyUnit', v)} onAddOption={onAddQtyUnit} onRemoveOption={onRemoveQtyUnit} placeholder="واحد جدید" /></Field>
        </div>
      </>}

      {!showText && <div style={{ marginBottom: 10, fontSize: 12, color: COLORS.sub }}>این قلم از «ثبت هوشمند سفارش» بالای فرم ساخته شد. <button type="button" onClick={() => setShowText(true)} style={{ background: 'transparent', border: 'none', color: COLORS.primary, cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit', fontSize: 12 }}>تحلیل متنی دوباره‌ی همین قلم</button></div>}
      {showText && <div style={{ background: COLORS.accentLight, border: `1px dashed ${COLORS.accent}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 12, color: COLORS.primaryDark, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={14} /> تحلیل هوشمند این قلم — همان‌طور که مشتری می‌گوید بنویسید</div>
        <textarea rows={3} value={sp.freeText || ''} onChange={e => setSpec({ freeText: e.target.value })}
          placeholder="مثلاً: کتاب قطع وزیری ۳۲۰ صفحه، داخل تحریر ۷۰ گرم تک‌رنگ مشکی، جلد گلاسه تمام‌رنگی با سلفون براق، صحافی شومیز، تیراژ ۱۰۰۰ نسخه"
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.9 }} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
          <PrimaryButton icon={Sparkles} onClick={understand}>تحلیل و محاسبه</PrimaryButton>
          {msg && <span style={{ fontSize: 12, color: COLORS.primaryDark, lineHeight: 1.8 }}>{msg}</span>}
        </div>
      </div>}

      <SectionTitle small>مشخصات فنی (برداشت برنامه — قابل ویرایش)</SectionTitle>
      {inTable ? <>
        {sp.sizeKey === 'سفارشی' && <div style={grid(2)}>
          <Field label="عرض (سانتی‌متر)"><TextInput type="number" value={sp.w || ''} onChange={e => setSpec({ w: e.target.value })} /></Field>
          <Field label="ارتفاع (سانتی‌متر)"><TextInput type="number" value={sp.h || ''} onChange={e => setSpec({ h: e.target.value })} /></Field>
        </div>}
        {!isBookLike && <div style={grid(1)}><Field label="رو / پشت">{sel(String(sp.textSides || 1), e => setSpec({ textSides: Number(e.target.value) }), <><option value="1">یک‌رو</option><option value="2">دورو (رو و پشت)</option></>)}</Field></div>}
      </> : <>
        <div style={grid(isBookLike ? 4 : 3)}>
          <Field label="قطع">{sel(sp.sizeKey || '', e => resetSpecKeys(['cutForm', 'cutFormConfirmed', 'colourUniform', 'colourBlocks', 'colourConfirmed'], { sizeKey: e.target.value }), <><option value="">— انتخاب —</option>{Object.keys(lexicon.trimSizes).map(k => <option key={k} value={k}>{k} ({lexicon.trimSizes[k][0]}×{lexicon.trimSizes[k][1]})</option>)}<option value="سفارشی">سفارشی...</option></>)}</Field>
          {sp.sizeKey === 'سفارشی' && <>
            <Field label="عرض (سانتی‌متر)"><TextInput type="number" value={sp.w || ''} onChange={e => setSpec({ w: e.target.value })} /></Field>
            <Field label="ارتفاع (سانتی‌متر)"><TextInput type="number" value={sp.h || ''} onChange={e => setSpec({ h: e.target.value })} /></Field>
          </>}
          {isBookLike && <Field label="تعداد صفحات"><TextInput type="number" value={sp.pages || ''} onChange={e => resetSpecKeys(['colourUniform', 'colourBlocks', 'colourConfirmed'], { pages: e.target.value })} /></Field>}
        </div>
        <div style={grid(4)}>
          <Field label={isBookLike ? 'نوع کاغذ متن' : 'نوع کاغذ'}><Select options={['', ...lexicon.paperKinds]} value={sp.textKind || ''} onChange={e => setSpec({ textKind: e.target.value })} /></Field>
          <Field label="گرماژ"><TextInput type="number" value={sp.textGsm || ''} onChange={e => setSpec({ textGsm: e.target.value })} /></Field>
          <Field label={isBookLike ? 'رنگ چاپ متن' : 'رنگ چاپ'}>{sel(String(sp.textColors || 4), e => resetSpecKeys(['colourUniform', 'colourBlocks', 'colourConfirmed'], { textColors: Number(e.target.value) }), lexicon.printColors.map(([v, l]) => <option key={v} value={String(v)}>{l}</option>))}</Field>
          {!isBookLike && <Field label="رو / پشت">{sel(String(sp.textSides || 1), e => setSpec({ textSides: Number(e.target.value) }), <><option value="1">یک‌رو</option><option value="2">دورو (رو و پشت)</option></>)}</Field>}
        </div>
        {showCutAsk && <CutFormAsk key={`cut-${sp.sizeKey}`} spec={sp} plan={cutPlan} onConfirm={patchSpecAnalyzed} onEdit={patchSpecAnalyzed} />}
        {showColourAsk && <ColourBlockAsk key={`colour-${askPages}-${askColors}`} spec={sp} pages={askPages} textColors={askColors} onConfirm={patchSpecAnalyzed} onEdit={patchSpecAnalyzed} />}
      </>}
      {isBookLike && (
        <div style={{ border: `1px dashed ${COLORS.primary}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: COLORS.primaryDark, marginBottom: item.coverEnabled ? 8 : 0 }}>
            <input type="checkbox" checked={item.coverEnabled} onChange={e => set('coverEnabled', e.target.checked)} /> جلد دارد
          </label>
          {item.coverEnabled && (
            <div style={grid(inTable ? 2 : 4)}>
              {!inTable && <>
                <Field label="نوع کاغذ / مقوای جلد"><Select options={['', ...lexicon.paperKinds]} value={sp.coverKind || ''} onChange={e => setSpec({ coverKind: e.target.value })} /></Field>
                <Field label="گرماژ جلد"><TextInput type="number" value={sp.coverGsm || ''} onChange={e => setSpec({ coverGsm: e.target.value })} placeholder={String(settings.calc.defaultCoverGsm)} /></Field>
              </>}
              <Field label="رنگ چاپ جلد">{sel(String(sp.coverColors || 4), e => setSpec({ coverColors: Number(e.target.value) }), lexicon.printColors.map(([v, l]) => <option key={v} value={String(v)}>{l}</option>))}</Field>
              <Field label="رو / پشت جلد">{sel(String(sp.coverSides || 1), e => setSpec({ coverSides: Number(e.target.value) }), <><option value="1">فقط رو</option><option value="2">رو و پشت</option></>)}</Field>
            </div>
          )}
        </div>
      )}
      <div style={grid(inTable ? 1 : 4)}>
        {!inTable && <>
          <Field label="سلفون">{sel(celloComboOf(sp), e => setSpec(celloPatch(e.target.value)), <><option value="">بدون سلفون</option>{CELLO_OPTIONS.map(o => <option key={o.value} value={o.value}>{'سلفون '+o.label}</option>)}</>)}</Field>
          <Field label="نوع صحافی"><Select options={lexicon.bindingTypes} value={item.bindingType} onChange={e => onChange({ ...item, bindingType: e.target.value, coverType: e.target.value.startsWith('گالینگور') ? 'سخت (گالینگور)' : 'نرم (شومیز)' })} /></Field>
          <Field label="روش چاپ"><Select options={['افست', 'دیجیتال']} value={sp.printMethod || 'افست'} onChange={e => setSpec({ printMethod: e.target.value })} /></Field>
        </>}
        <div style={{ display: 'flex', alignItems: 'end' }}><GhostButton icon={Sparkles} onClick={() => { onChange(runAnalysis(item)); setMsg(''); }}>محاسبه‌ی مجدد با مشخصات بالا</GhostButton></div>
      </div>

      {item.assumptions && item.assumptions.length > 0 && (
        <div style={{ background: COLORS.warnBg, border: `1px solid ${COLORS.warn}`, borderRadius: 9, padding: '6px 10px', marginBottom: 8, fontSize: 12, lineHeight: 1.9, color: COLORS.warn }}>
          <strong>فرض‌های برنامه (اگر درست نیست، اصلاح کنید):</strong>
          {item.assumptions.map((a, k) => <div key={k}>• {a}</div>)}
        </div>
      )}
      <AnalysisPanel a={item.analysis} />

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
        <input type="checkbox" checked={item.hasDesign} onChange={e => set('hasDesign', e.target.checked)} /> نیاز به طراحی دارد
      </label>
      {item.hasDesign && <div style={{ marginBottom: 10 }}><Field label="شرح طراحی"><TextInput value={item.designDescription} onChange={e => set('designDescription', e.target.value)} /></Field></div>}
      <ServiceEditor rows={item.services} serviceTypes={serviceTypes} onChange={v => set('services', v)} onAddType={onAddServiceType} onRemoveType={onRemoveServiceType} />
      <Field label="مراحل تکمیلی"><div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', paddingTop: 6 }}>{FINISHING_STEPS.map(st => { const on = (item.finishingSteps || []).includes(st); return <label key={st} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={on} onChange={e => set('finishingSteps', e.target.checked ? [...(item.finishingSteps || []), st] : (item.finishingSteps || []).filter(x => x !== st))} /> {st}</label>; })}</div></Field>      <Field label="توضیحات صحافی / تولید"><TextInput value={item.bindingNotes} onChange={e => set('bindingNotes', e.target.value)} /></Field>

      <div style={{ marginTop: 10 }}>
        <button type="button" onClick={() => setShowDetails(v => !v)} style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: COLORS.primaryDark }}>
          {showDetails ? '▲ بستن' : '▼ نمایش'} جزئیات تولید و مواد مصرفی از انبار (خودکار — قابل ویرایش)
        </button>
      </div>
      {showDetails && (
        <div style={{ marginTop: 10, background: COLORS.altRow, borderRadius: 10, padding: 10 }}>
          <SectionTitle small>{isBookLike ? 'متن — کاغذ و مقوا مصرفی' : 'کاغذ و مقوا مصرفی'}</SectionTitle>
          <MaterialUseEditor title="" rows={item.papers} categories={PAPER_LIKE} inventory={inventory} customers={customers} onChange={v => set('papers', v)} />
          <SectionTitle small>لیتوگرافی</SectionTitle>
          <div style={grid(3)}>
            <Field label="دستگاه"><Select options={PRESS_TYPES} value={item.press} onChange={e => set('press', e.target.value)} /></Field>
            <Field label="شرح و تعداد فرم"><TextInput value={item.formDesc} onChange={e => set('formDesc', e.target.value)} /></Field>
            <Field label={`تعداد باطله (${item.qtyUnit || 'نسخه'})`}><TextInput type="number" value={item.waste} onChange={e => set('waste', e.target.value)} /></Field>
          </div>
          <MaterialUseEditor title="مواد مصرفی لیتوگرافی (زینک و ...)" rows={item.lithoMaterials} categories={NOT_PAPER} inventory={inventory} customers={customers} onChange={v => set('lithoMaterials', v)} />
          {isBookLike && item.coverEnabled && (
            <>
              <SectionTitle small>جلد</SectionTitle>
              <div style={grid(2)}>
                <Field label="نوع جلد"><Select options={['نرم (شومیز)', 'سخت (گالینگور)']} value={item.coverType} onChange={e => set('coverType', e.target.value)} /></Field>
                <Field label="دستگاه چاپ جلد"><Select options={PRESS_TYPES} value={item.coverPress} onChange={e => set('coverPress', e.target.value)} /></Field>
              </div>
              <MaterialUseEditor title="مقوا / کاغذ جلد" rows={item.coverPapers} categories={PAPER_LIKE} inventory={inventory} customers={customers} onChange={v => set('coverPapers', v)} />
              {item.coverType.startsWith('سخت') && <MaterialUseEditor title="استر (لایه داخلی جلد سخت)" rows={item.coverLining} categories={PAPER_LIKE.concat(['سایر'])} inventory={inventory} customers={customers} onChange={v => set('coverLining', v)} />}
              <MaterialUseEditor title="سلفون جلد" rows={item.coverCellophane} categories={['سلفون']} inventory={inventory} customers={customers} onChange={v => set('coverCellophane', v)} />
            </>
          )}
          <MaterialUseEditor title="مواد مصرفی صحافی (سلفون، فویل طلا و ...)" rows={item.bindingMaterials} categories={NOT_PAPER} inventory={inventory} customers={customers} onChange={v => set('bindingMaterials', v)} />
        </div>
      )}
    </div>
  );
}

function touchedRows(list) { return (list || []).filter(r => r.inventoryItemId || String(r.qty ?? '').trim() !== ''); }

/* پرسش‌های موتورِ همین قلم — همان شرطی که کارت‌های «ویرایش کامل قلم» را نشان می‌دهد. */
function engineAsksOf(item) {
  const sp = item.spec || {};
  if (!lexicon.bookLikeTypes.includes(item.productType)) return { any: false };
  const pages = Math.max(0, Math.round(Number(sp.pages) || 0));
  const colors = Number(sp.textColors) || 1;
  const cutPlan = bookCutPlan(sp);
  const cut = !!(cutPlan.needed || sp.cutFormConfirmed === true);
  const colour = pages > 0 && colors >= 2;
  return { any: cut || colour, cut, colour, cutPlan, pages, colors };
}

function OrderForm({ initial, units, perms, settings, customers: baseCustomers, inventory, qtyUnits, serviceTypes, productTypes, role, onAddQtyUnit, onAddServiceType, onAddProductType, onRemoveQtyUnit, onRemoveServiceType, onRemoveProductType, orders, onSave, onCancel, onAddCustomer, onAddStock, onDirtyChange }) {
  const [stagedCustomers, setStagedCustomers] = useState([]);
  const customers = useMemo(() => [...stagedCustomers, ...baseCustomers], [stagedCustomers, baseCustomers]);
  const [o, setO] = useState(initial);
  const initialJson = useRef(JSON.stringify(initial));
  const isDirty = stagedCustomers.length > 0 || JSON.stringify(o) !== initialJson.current;
  useEffect(() => { if (onDirtyChange) onDirtyChange(isDirty); }, [isDirty]);
  useEffect(() => () => { if (onDirtyChange) onDirtyChange(false); }, []);
  const [errors, setErrors] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [warnAcked, setWarnAcked] = useState(false);
  const [newCust, setNewCust] = useState(null);
  const [newCustErr, setNewCustErr] = useState('');
  const [fullItem, setFullItem] = useState(null);
  const editorRef = useRef(null);
  useEffect(() => { if (fullItem) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [fullItem]);
  const msgRef = useRef(null);
  const set = (k, v) => setO(prev => ({ ...prev, [k]: v }));
  const updateItem = (id, next) => set('items', o.items.map(it => it.id === id ? next : it));
  const addItem = () => set('items', [...o.items, emptyLineItem()]);
  const removeItem = (id) => set('items', o.items.filter(it => it.id !== id));
  const updateItemRe = (id, next) => updateItem(id, analyzeAndFill(next, { inventory, customerId: o.customerId, settings, customers }).item);

  /* کارفرما (۱۴۰۵/۰۸/۰۹): «نمیشه برگشت» بزرگ‌ترین ترس اپراتور است. هر ویرایش روی این فرم باید همان‌جا عقب زده
     شود، بدون بستن فرم و بدون «بستن بدون ثبت». پشته پیش از هر ریزش (burst) از ویرایش، عکسِ حالتِ قبل را می‌گیرد. */
  const undoRef = useRef(null);
  if (!undoRef.current) undoRef.current = createUndoStack({ start: initialJson.current });
  const [undoDepth, setUndoDepth] = useState(0);
  useEffect(() => { setUndoDepth(undoRef.current.record(JSON.stringify(o))); }, [o]);
  const goBack = json => { if (json === undefined || json === null) return; setO(JSON.parse(json)); setUndoDepth(undoRef.current.depth); };
  const undoEdit = () => goBack(undoRef.current.undo());
  const rewindForm = () => goBack(undoRef.current.rewind(initialJson.current));
  useEffect(() => {
    const onKey = e => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || !undoRef.current.depth) return;
      /* داخل فیلد متنی خودِ ویندوز حرف‌به‌حرف برمی‌گرداند؛ برگشتِ «یک تغییر کامل» همان دکمهٔ بالای فرم است */
      const tag = (document.activeElement || {}).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      undoEdit();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => { if ((errors.length || warnings.length) && msgRef.current) msgRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [errors, warnings]);

  const selectedCustomer = customers.find(c => c.id === o.customerId);
  /* اصلاحات ۱۷/بند ۱: هیچ عددِ بدهی‌ای در این فرم حساب نمی‌شود. پروندهٔ اعتباری و تصمیمِ «این سفارش
     از سقف عبور می‌کند یا نه» را سرور می‌سازد. مبلغِ سفارشِ در حال ثبت را فقط نقشی می‌فرستد که
     خودش قیمت را می‌بیند؛ کارشناس سفارشات بی‌رقم و فقط با «نیازمند مجوز / کافی است» کار می‌کند. */
  const seesMoney = role === 'مدیر چاپخانه' || role === 'مدیر مالی';
  const newAmount = seesMoney && moneyError(o) === null ? Math.max(0, Math.round(orderPayable(o))) : 0;
  const credit = useCreditFile({ customerId: o.customerId, orderId: o.id, newAmount });
  const verdict = (credit.data && credit.data.verdict) || null;
  const approval = credit.data && credit.data.approval;
  /* سفارشی که اجازهٔ تولیدش ثبت شده — یا پیش از این با همان تیکِ مدیر عبور کرده — تعهدش را
     پیش‌تر ساخته؛ ویرایشِ متنیِ آن نباید پشت دروازهٔ مجوز بماند. دروازه برای «تعهد تازه» است. */
  const authorized = !!(o.workflow && o.workflow.productionAuthorization) || o.managerOverrideDebt === true;
  const needsDoc = !!verdict && verdict.needsApproval === true && !approval && !authorized;

  function pickCustomer(id) {
    if (id === '__new__') { setNewCust(emptyCustomer()); setNewCustErr(''); return; }
    const c = customers.find(c => c.id === id);
    const mk = c && c.marketerId ? customers.find(x => x.id === c.marketerId) : null;
    setO(prev => ({ ...prev, customerId: id, customerCode: c?.customerCode || '', customerName: c ? c.name : '', phone: c ? c.phone : '', mobile: c ? (c.mobile || '') : '', ...(mk ? { source: 'بازاریاب', marketerId: mk.id, marketerCode: mk.name, marketerAuto: true } : (prev.marketerAuto ? { source: 'مشتری', marketerId: '', marketerCode: '', marketerAuto: false } : {})) }));
  }
  function saveNewCustomer() {
    if (!newCust.name.trim()) { setNewCustErr('نام مشتری را وارد کنید.'); return; }
    if (!newCust.phone.trim()) { setNewCustErr('شماره تماس مشتری را وارد کنید.'); return; }
    const c = { ...newCust, name: newCust.name.trim(), phone: newCust.phone.trim() };
    setStagedCustomers(prev => [c, ...prev]);
    setO(prev => ({ ...prev, customerId: c.id, customerCode: c.customerCode || '', customerName: c.name, phone: c.phone }));
    setNewCust(null);
  }

  function collectIssues() {
    const errs = [], warns = [];
    const num = String(o.orderNumber || '').trim();
    /* شماره سفارش هنگام تأیید مشتری روی سرور صادر می‌شود؛ پیش از آن سفارش «معلق» و بی‌شماره است. */
    if (num && orders.some(x => x.id !== o.id && String(x.orderNumber) === num)) errs.push('این شماره سفارش قبلاً ثبت شده است.');
    if (!o.customerId && !o.customerName.trim()) errs.push('مشتری را از لیست انتخاب کنید یا با «مشتری جدید» ثبتش کنید.');
    if (!String(o.phone || '').trim()) errs.push('شماره تماس مشتری را وارد کنید.');
    if (!o.items.length) errs.push('سفارش را در کادر «مشخصات سفارش» بنویسید و «ثبت و محاسبه» را بزنید (یا قلم را دستی اضافه کنید).');
    if (!o.title.trim() && !o.items.length) errs.push('عنوان سفارش را وارد کنید.');
    if (!o.deliveryDate) errs.push('تاریخ تحویل را مشخص کنید.');
    else if (o.deliveryDate < o.date) errs.push('تاریخ تحویل نمی‌تواند قبل از تاریخ سفارش باشد.');
    if (needsDoc) errs.push(credit.data && credit.data.canDecide
      ? 'این سفارش از سقف اعتبار مشتری عبور می‌کند؛ دلیل و رمز مدیر را در کادر «مجوز مستند بدهی» همین صفحه ثبت کنید تا سفارش قابل ثبت شود.'
      : 'این مشتری بدهی باز دارد و سفارش از سقف او عبور می‌کند؛ تا مدیر چاپخانه سند مجوز را ثبت نکند، این سفارش ذخیره نمی‌شود.');
    const need = {};
    o.items.forEach((it, idx) => {
      const n = `قلم ${idx + 1}`;
      const isBook = lexicon.bookLikeTypes.includes(it.productType);
      if (!it.productName.trim()) errs.push(`${n}: شرح محصول را وارد کنید.`);
      if (!it.productType) errs.push(`${n}: نوع محصول را انتخاب کنید.`);
      if (!(Number(it.qty) > 0)) errs.push(`${n}: شمارگان (تیراژ) را وارد کنید.`);
      if (!it.qtyUnit) errs.push(`${n}: واحد را انتخاب کنید.`);
      if (it.hasDesign && !it.designDescription.trim()) errs.push(`${n}: شرح طراحی را وارد کنید.`);
      PLAN_STEPS.forEach(stp => { const ps = (it.plan || {})[stp.key]; if (ps && ps.mode === OUTSOURCE && !ps.partnerId) errs.push(`${n}: برای برون‌سپاری «${stp.label}» پیمانکار را انتخاب کنید (یا روی «داخلی» بگذارید).`); });
      (it.services || []).forEach(s => { if (!s.serviceType) errs.push(`${n}: نوع خدمت تکمیلی را انتخاب کنید (یا ردیف خالی را حذف کنید).`); });
      const groups = [['کاغذ و مقوا', it.papers, true], ['مواد لیتوگرافی', it.lithoMaterials, false], ['مواد صحافی', it.bindingMaterials, false]];
      if (isBook && it.coverEnabled) {
        groups.push(['مقوا / کاغذ جلد', it.coverPapers, true]);
        if (it.coverType.startsWith('سخت')) groups.push(['استر جلد', it.coverLining, false]);
        groups.push(['سلفون جلد', it.coverCellophane, false]);
      }
      groups.forEach(([label, list, required]) => {
        const rows = touchedRows(list);
        if (required && rows.length === 0) errs.push(`${n}: حداقل یک مورد «${label}» را از انبار انتخاب کنید.`);
        rows.forEach(r => {
          if (!r.inventoryItemId) { errs.push(`${n} (${label}): کالا را از انبار انتخاب کنید.`); return; }
          if (!(Number(r.qty) > 0)) { errs.push(`${n} (${label}): مقدار مصرفی را وارد کنید.`); return; }
          const inv = inventory.find(i => i.id === r.inventoryItemId);
          if (!inv) { errs.push(`${n} (${label}): کالای انتخاب‌شده دیگر در انبار نیست.`); return; }
          if (!it.materialsDeducted) need[inv.id] = (need[inv.id] || 0) + usageInStockUnit(r, inv);
          if (inv.ownerType === 'مشتری' && o.customerId && inv.ownerCustomerId && inv.ownerCustomerId !== o.customerId) warns.push(`${n}: «${inv.name}» متعلق به مشتری دیگری (${ownerLabel(inv, customers)}) است.`);
          if (label === 'کاغذ و مقوا' || label === 'مقوا / کاغذ جلد') {
            const nums = (it.analysis && it.analysis.numbers) || {};
            const sw = stockSizeWarning(inv, [label === 'کاغذ و مقوا' ? nums.sheet : nums.coverSheet]);
            if (sw) warns.push(`${n} (${label}): «${inv.name}» — ${sw}`);
          }
          if (inv.ownerType === 'مشتری' && inv.linkedOrderNumber && inv.linkedOrderNumber !== num) warns.push(`${n}: «${inv.name}» برای سفارش شماره ${inv.linkedOrderNumber} آورده شده است.`);
        });
      });
    });
    Object.entries(need).forEach(([id, q]) => {
      const inv = inventory.find(i => i.id === id);
      if (inv && q > stockLevel(inv) + 1e-9) warns.push(`موجودی «${inv.name}» کافی نیست (نیاز: ${fmt(q)} ${stockUnitLabel(inv)}، موجودی: ${fmt(stockLevel(inv))} ${stockUnitLabel(inv)}).`);
    });
    return { errs: [...new Set(errs)], warns: [...new Set(warns)] };
  }

  function cleanOrder(x) {
    return {
      ...x, orderNumber: String(x.orderNumber || '').trim(), customerName: x.customerName.trim(), phone: String(x.phone).trim(), title: x.title.trim(),
      items: x.items.map(it => {
        const coverOn = lexicon.bookLikeTypes.includes(it.productType) && it.coverEnabled;
        return {
          ...it, productName: it.productName.trim(),
          papers: touchedRows(it.papers),
          lithoMaterials: (it.plan && it.plan.litho && it.plan.litho.mode === OUTSOURCE) ? [] : touchedRows(it.lithoMaterials),
          bindingMaterials: (it.plan && it.plan.binding && it.plan.binding.mode === OUTSOURCE) ? [] : touchedRows(it.bindingMaterials),
          coverEnabled: coverOn,
          coverPapers: coverOn ? touchedRows(it.coverPapers) : [],
          coverLining: coverOn && it.coverType.startsWith('سخت') ? touchedRows(it.coverLining) : [],
          coverCellophane: coverOn && !(it.plan && it.plan.binding && it.plan.binding.mode === OUTSOURCE) ? touchedRows(it.coverCellophane) : [],
          designDescription: it.hasDesign ? it.designDescription : '',
        };
      }),
    };
  }

  function handleSave() {
    const { errs, warns } = collectIssues();
    setErrors(errs);
    if (errs.length) { setWarnings([]); setWarnAcked(false); return; }
    if (warns.length && !warnAcked) { setWarnings(warns); setWarnAcked(true); return; }
    const first = o.items[0] || {};
    const autoTitle = o.items.length > 1 ? `${o.items.length} قلم سفارش${o.customerName ? ' — ' + o.customerName : ''}` : `${first.productName || first.productType || 'سفارش'}${o.customerName ? ' — ' + o.customerName : ''}`;
    const used = new Set([o.customerId, o.marketerId]);
    const toAdd = stagedCustomers.filter(c => used.has(c.id));
    if (toAdd.length) onAddCustomer(toAdd);
    onSave(cleanOrder({ ...o, title: o.title.trim() || autoTitle }));
  }

  return (
    <div className="order-form" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {(undoDepth > 0 || isDirty) && (
        <div style={{ background: '#F3F0E8', border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: '6px 10px', fontSize: 12, color: COLORS.sub, lineHeight: 1.9 }}>
          <strong style={{ color: COLORS.primaryDark }}>برگشت به فرم قبلی:</strong> هر تغییر در این فرم با دکمهٔ «یک مرحله عقب» پایین همین صفحه (یا Ctrl+Z) برمی‌گردد؛ تا «ذخیره سفارش» را نزنید هیچ چیزی ثبت نشده است.
        </div>
      )}
      {o.requestText && (
        <div style={{ background: '#FFF4F2', border: `1.5px solid ${COLORS.danger}`, borderRadius: 10, padding: 10, fontSize: 12, lineHeight: 2 }}>
          <strong style={{ color: COLORS.danger }}>درخواست ثبت‌شده توسط مشتری:</strong>
          <div style={{ whiteSpace: 'pre-wrap' }}>{o.requestText}</div>
          {!o.smartText && <GhostButton icon={Sparkles} onClick={() => set('smartText', o.requestText)} style={{ padding: '3px 10px', fontSize: 12, marginTop: 4 }}>این متن را در کادر مشخصات سفارش بگذار</GhostButton>}
        </div>
      )}
      <div className="order-date-grid" style={{ background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 8 }}>
        <Field label="تاریخ ثبت سفارش"><JalaliDateInput value={o.date} onChange={v => set('date', v)} /></Field>
        <Field label="تاریخ تحویل *"><JalaliDateInput value={o.deliveryDate} onChange={v => set('deliveryDate', v)} quick={[0, 3, 7, 14, 30]} /></Field>
      </div>

      <div>
        <div style={{ background: COLORS.primary, color: '#fff', borderRadius: 9, padding: '8px 14px', fontWeight: 800, fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>مشخصات مشتری</span>
          <span title="شماره‌ی سفارش هنگام تأیید مشتری صادر می‌شود و قابل تغییر نیست؛ تا آن زمان سفارش معلق است" style={{ background: '#FFF4C2', color: COLORS.primaryDark, borderRadius: 8, padding: '2px 14px', fontWeight: 800 }}>شماره سفارش: {o.orderNumber || 'معلق (پس از تأیید مشتری)'}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
          <Field label="مشتری *">
            <select value={o.customerId} onChange={e => pickCustomer(e.target.value)} style={inputStyle}>
              <option value="">— انتخاب کنید —</option>
              {pickable(customers, o.customerId).map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>)}
              <option value="__new__">➕ مشتری جدید...</option>
            </select>
          </Field>
          <Field label="شماره تماس *"><TextInput value={o.phone} onChange={e => set('phone', e.target.value)} /></Field>
          <Field label="همراه"><TextInput value={o.mobile || ''} onChange={e => set('mobile', e.target.value)} /></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <Field label="این سفارش را چه کسی آورده؟"><Select options={['مشتری', 'بازاریاب']} value={o.source || 'مشتری'} onChange={e => { const val = e.target.value; setO(prev => ({ ...prev, source: val, marketerAuto: false, ...(val === 'مشتری' ? { marketerId: '', marketerCode: '' } : {}) })); }} /></Field>
          {(o.source === 'بازاریاب') && (
            <Field label="بازاریاب">
              <select value={o.marketerId || ''} onChange={e => { const m = customers.find(c => c.id === e.target.value); setO(prev => ({ ...prev, marketerId: e.target.value, marketerCode: m ? m.name : '', marketerAuto: false })); }} style={inputStyle}>
                <option value="">— انتخاب بازاریاب —</option>
                {pickable(customers.filter(c => c.isMarketer), o.marketerId).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {workList(customers.filter(c => c.isMarketer)).length === 0 && <div style={{ fontSize: 11, color: COLORS.warn, marginTop: 4 }}>بازاریاب تأییدشده‌ای وجود ندارد؛ در «مشتریان» یک رکورد را بازاریاب کنید و سپس با دکمهٔ «بررسی و تأیید» در همان ردیف، آن را تأیید نمایید.</div>}
            </Field>
          )}
        </div>
        {newCust && (
          <div style={{ marginTop: 10, border: `1px dashed ${COLORS.primary}`, borderRadius: 9, padding: 10, background: '#fff' }}>
            <SectionTitle small>ثبت مشتری جدید</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1.5fr 1fr 2fr', gap: 8 }}>
              <Field label="نوع"><Select options={['حقیقی', 'حقوقی']} value={newCust.entityType} onChange={e => setNewCust({ ...newCust, entityType: e.target.value })} /></Field>
              <Field label="نام مشتری / شرکت *"><TextInput value={newCust.name} onChange={e => setNewCust({ ...newCust, name: e.target.value })} /></Field>
              <Field label="شماره تماس *"><TextInput value={newCust.phone} onChange={e => setNewCust({ ...newCust, phone: e.target.value })} /></Field>
              <Field label="آدرس"><TextInput value={newCust.address} onChange={e => setNewCust({ ...newCust, address: e.target.value })} /></Field>
            </div>
            {newCustErr && <div style={{ color: COLORS.danger, fontSize: 12, marginTop: 6 }}>{newCustErr}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <GhostButton onClick={() => setNewCust(null)}>انصراف</GhostButton>
              <PrimaryButton icon={Save} onClick={saveNewCustomer}>ثبت و انتخاب مشتری</PrimaryButton>
            </div>
          </div>
        )}

        {selectedCustomer && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 10, fontSize: 12 }}>
              <strong>{selectedCustomer.name}</strong> ({selectedCustomer.entityType}) — {selectedCustomer.phone || 'بدون تلفن'}{selectedCustomer.address ? ` — ${selectedCustomer.address}` : ''}
            </div>
            {credit.error && <div style={{ color: COLORS.danger, fontSize: 12 }}>{credit.error}</div>}
            {credit.data && <CreditFileStrip data={credit.data} fmt={fmt} faDate={faDate} compact heading={`پروندهٔ اعتباری — ${selectedCustomer.name}`} />}
            {approval && <ApprovalDocument approval={approval} fmt={fmt} faDate={faDate} />}
            {needsDoc && (credit.data && credit.data.canDecide ? (
              <CreditApprovalForm customerId={o.customerId} orderId={o.id} summary={verdict.text || verdict.shortText} onDone={credit.reload} />
            ) : (
              <div style={{ border: `1px dashed ${COLORS.danger}`, borderRadius: 9, padding: 10, fontSize: 12, color: COLORS.danger, background: COLORS.dangerBg }}>
                ثبت این سفارش به سندِ مجوز نیاز دارد و نوشتنِ آن فقط با حسابِ مدیر چاپخانه ممکن است — رمزِ مدیر به‌تنهایی دیگر کافی نیست.
              </div>
            ))}
            {authorized && verdict && verdict.needsApproval && !approval && (
              <div style={{ fontSize: 11, color: COLORS.sub }}>این سفارش پیش از این با اجازهٔ تولید ثبت شده است؛ برای تعهد تازه، سند مجوز در «پروندهٔ اعتباری مشتری‌ها» ثبت می‌شود.</div>
            )}
          </div>
        )}
      </div>

      <SmartOrderPanel o={o} setO={setO} settings={settings} inventory={inventory} customers={customers} productTypes={productTypes} serviceTypes={serviceTypes} />

      {o.items.length > 0 && (
        <div>
          <SectionTitle>اقلام و محاسبه ({o.items.length})</SectionTitle>
          <OrderItemsTable
            items={o.items} productTypes={productTypes} qtyUnits={qtyUnits} bindingTypes={lexicon.bindingTypes} bookLikeTypes={lexicon.bookLikeTypes} colorOpts={lexicon.printColors}
            pressTypes={PRESS_TYPES} inventory={inventory} customers={customers} canAddStock={!!(perms && perms.addStock)} onAddStock={onAddStock}
            onAddProductType={onAddProductType} onRemoveProductType={onRemoveProductType} onAddQtyUnit={onAddQtyUnit} onRemoveQtyUnit={onRemoveQtyUnit}
            optionSelect={props => <EditableSelect {...props} />}
            onChangeItem={next => updateItem(next.id, next)} onRemoveItem={removeItem} onAddItem={addItem}
            onRecalc={it => updateItem(it.id, analyzeAndFill(it, { inventory, customerId: o.customerId, settings, customers }).item)}
            onOpenItem={it => setFullItem(it.id)} />
        </div>
      )}
      {o.items.length === 0 && <div><GhostButton icon={Plus} onClick={addItem} style={{ padding: '4px 12px', fontSize: 12 }}>افزودن قلم دستی (بدون متن هوشمند)</GhostButton></div>}

      {/* کارفرما (۱۴۰۵/۰۸/۰۳): ویرایش کامل قلم همان‌جای همین صفحه باز می‌شود، نه در فرمی روی فرم */}
      {fullItem && (() => {
        const live = o.items.find(it => it.id === fullItem);
        if (!live) return null;
        return <div ref={editorRef} style={{ marginBottom: 4, scrollMarginTop: 56 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: COLORS.primaryDark }}>ویرایش کامل قلم — {live.productName || live.productType || 'بدون نام'}</div>
            <GhostButton onClick={() => setFullItem(null)}>بستن ویرایش</GhostButton>
          </div>
          <LineItemCard item={live} index={o.items.indexOf(live)} inventory={inventory} customers={customers} customerId={o.customerId} settings={settings} qtyUnits={qtyUnits} serviceTypes={serviceTypes} productTypes={productTypes}
            onAddQtyUnit={onAddQtyUnit} onAddServiceType={onAddServiceType} onAddProductType={onAddProductType}
            onRemoveQtyUnit={onRemoveQtyUnit} onRemoveServiceType={onRemoveServiceType} onRemoveProductType={onRemoveProductType}
            onChange={(next) => updateItem(live.id, next)} onRemove={() => { removeItem(live.id); setFullItem(null); }} />
        </div>;
      })()}

      {(() => {
        const asked = o.items.map((it, idx) => ({ it, idx, ask: engineAsksOf(it) })).filter(x => x.ask.any && x.it.id !== fullItem);
        if (!asked.length) return null;
        const answer = (it, patch) => updateItemRe(it.id, { ...it, spec: { ...(it.spec || {}), ...patch } });
        return <div>
          <SectionTitle>پرسش‌های موتور — پیش از عدد نهایی</SectionTitle>
          <div style={{ fontSize: 11, color: COLORS.sub, lineHeight: 1.9, marginBottom: 8 }}>پاسخ این پرسش‌ها کاغذ، زینک و فرم را می‌سازد؛ تا تأیید نشود آن ستون‌ها خالی می‌مانند.</div>
          {asked.map(({ it, idx, ask }) => <div key={it.id} style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: COLORS.primaryDark, marginBottom: 6 }}>قلم {faNum(idx + 1)} — {it.productName || it.productType || 'بدون نام'}</div>
            {ask.cut && <CutFormAsk key={`cut-${it.id}-${(it.spec || {}).sizeKey || ''}-${(it.spec || {}).cutFormConfirmed ? 'done' : 'ask'}`} spec={it.spec || {}} plan={ask.cutPlan} onConfirm={patch => answer(it, patch)} onEdit={patch => answer(it, patch)} />}
            {ask.colour && <ColourBlockAsk key={`colour-${it.id}-${ask.pages}-${ask.colors}`} spec={it.spec || {}} pages={ask.pages} textColors={ask.colors} onConfirm={patch => answer(it, patch)} onEdit={patch => answer(it, patch)} />}
          </div>)}
        </div>;
      })()}

      <OrderAssistant o={o} setO={setO} inventory={inventory} customers={customers} units={units} perms={perms} updateItem={updateItemRe} />

      <div>
        <SectionTitle>اطلاعات تکمیلی</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <Field label="عنوان سفارش (اختیاری؛ خودکار ساخته می‌شود)"><TextInput value={o.title} onChange={e => set('title', e.target.value)} placeholder="مثلاً چاپ کتاب آموزشی" /></Field>
          <Field label="نحوه تحویل">
            <Select options={['تحویل حضوری در چاپخانه', 'ارسال به نشانی مشتری']} value={(o.delivery || {}).method || 'تحویل حضوری در چاپخانه'} onChange={e => set('delivery', { ...(o.delivery || {}), method: e.target.value })} />
          </Field>
        </div>
        {(o.delivery || {}).method === 'ارسال به نشانی مشتری' && (
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginTop: 10 }}>
            <Field label="نشانی تحویل محصول"><TextInput value={(o.delivery || {}).address || ''} onChange={e => set('delivery', { ...o.delivery, address: e.target.value })} placeholder={selectedCustomer ? selectedCustomer.address : ''} /></Field>
            <Field label="نام تحویل‌گیرنده"><TextInput value={(o.delivery || {}).receiver || ''} onChange={e => set('delivery', { ...o.delivery, receiver: e.target.value })} /></Field>
            <Field label="تلفن تحویل‌گیرنده"><TextInput value={(o.delivery || {}).phone || ''} onChange={e => set('delivery', { ...o.delivery, phone: e.target.value })} /></Field>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: COLORS.sub, background: COLORS.altRow, borderRadius: 8, padding: 10 }}>
        قیمت‌گذاری هر قلم و مبلغ کل سفارش در بخش «خلاصه مالی» انجام می‌شود، نه اینجا.
      </div>

      <div ref={msgRef}>
        {errors.length > 0 && (
          <div style={{ background: COLORS.dangerBg, border: `1px solid ${COLORS.danger}`, borderRadius: 9, padding: 10, color: COLORS.danger, fontSize: 12, lineHeight: 1.9 }}>
            <strong>تا موارد زیر تکمیل نشود سفارش ثبت نمی‌شود:</strong>
            {errors.map((e, i) => <div key={i}>• {e}</div>)}
          </div>
        )}
        {warnings.length > 0 && errors.length === 0 && (
          <div style={{ background: COLORS.warnBg, border: `1px solid ${COLORS.warn}`, borderRadius: 9, padding: 10, color: COLORS.warn, fontSize: 12, lineHeight: 1.9 }}>
            <strong>هشدار (در صورت تایید می‌توانید با دکمه‌ی زیر ثبت کنید):</strong>
            {warnings.map((e, i) => <div key={i}>• {e}</div>)}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: `1px solid ${COLORS.border}`, paddingTop: 14 }}>
        {undoDepth > 0 && <GhostButton icon={RotateCcw} onClick={undoEdit}>یک مرحله عقب ({faNum(undoDepth)})</GhostButton>}
        {isDirty && <GhostButton icon={RotateCcw} onClick={rewindForm}>برگرد به حالت اول فرم</GhostButton>}
        <GhostButton onClick={onCancel}>انصراف</GhostButton>
        <PrimaryButton icon={Save} onClick={handleSave}>{warnAcked && warnings.length ? 'تایید هشدارها و ثبت سفارش' : 'ذخیره سفارش'}</PrimaryButton>
      </div>
    </div>
  );
}

/* ===================== انبار هوشمند ===================== */
function invSummary(item) {
  const bits = [`${fmt(stockLevel(item))} ${stockUnitLabel(item)}`];
  if (item.unitMode === 'band_sheet') bits.push(`(${fmt(sheetCount(item))} ورق)`);
  if (item.gramaj) bits.push(`${item.gramaj} گرم`);
  if (item.size) bits.push(item.size);
  if (item.color) bits.push(item.color);
  if (item.finish) bits.push(item.finish);
  return bits.join(' — ');
}

function InventorySmartEntry({ drafts, setDrafts, customers, suppliers, categories, ai, onRegister, onEdit }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const aiOn = !!(ai && ai.enabled && ai.apiKey);
  async function run() {
    if (!text.trim()) { setMsg({ ok: false, t: 'بنویسید چه چیزی آمده یا چه موجودی دارید.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await extractInventory(text, { ai, ctx: { customers, suppliers, categories } });
      const mapped = res.drafts.map(d => ({ id: uid(), warnings: d.warnings, item: { ...emptyInventoryItem(), ...d.draft, name: d.draft.name } }));
      if (!mapped.length) { setMsg({ ok: false, t: 'کالایی تشخیص داده نشد. مقدار و نوع کالا را بنویسید؛ مثلاً «۵ بند گلاسه ۹۰ گرم ۷۰×۱۰۰».' }); }
      else {
        setDrafts(prev => [...prev, ...mapped]);
        setMsg({ ok: true, t: `${mapped.length} کالا شناسایی شد — ${res.source === 'ai' ? 'با هوش مصنوعی' : 'تحلیل آفلاین'}. پایین بررسی و ثبت کنید.`, note: res.note, skipped: res.skipped });
        setText('');
      }
    } catch (e) { setMsg({ ok: false, t: `خطا: ${e.message}` }); }
    setBusy(false);
  }
  const withErr = drafts.map(d => ({ ...d, errors: inventoryErrors(d.item, true) }));
  const valid = withErr.filter(d => d.errors.length === 0);
  return (
    <div style={{ background: COLORS.accentLight, border: `1px dashed ${COLORS.accent}`, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={15} /> ثبت هوشمند — بنویسید چه چیزی آمده یا چه دارید</div>
        <Badge text={aiOn ? 'هوش مصنوعی آنلاین فعال' : 'حالت آفلاین'} bg={aiOn ? COLORS.successBg : '#eee'} fg={aiOn ? COLORS.success : '#666'} />
      </div>
      <div style={{ fontSize: 12, color: COLORS.sub, lineHeight: 1.9 }}>چند کالا را یک‌جا بنویسید؛ برنامه برای هر کدام یک ردیف پیش‌نویس می‌سازد. اگر درست بود ثبت کنید، اگر نیاز به تغییر داشت «اصلاح» را بزنید. اگر مشتری آورده، نام مشتری را بنویسید.</div>
      <textarea rows={3} value={text} onChange={e => setText(e.target.value)} placeholder={'مثلاً: ۵ بند گلاسه ۹۰ گرم ۷۰×۱۰۰ از آقای فتاح، ۲۰ کیلو مرکب قرمز، ۱۰۰ زینک ۵۲×۴۶\n۱۰ کیلو مرکب آبی مشتری آورده انتشارات چتردانش'} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.9 }} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <PrimaryButton icon={Sparkles} onClick={run} style={{ opacity: busy ? 0.6 : 1 }}>{busy ? 'در حال تحلیل...' : 'تحلیل و ساخت فهرست'}</PrimaryButton>
        {msg && <span style={{ fontSize: 12, fontWeight: 700, color: msg.ok ? COLORS.success : COLORS.danger }}>{msg.t}</span>}
      </div>
      {msg && msg.note && <div style={{ fontSize: 12, color: COLORS.warn }}>⚠ {msg.note}</div>}
      {msg && msg.skipped && msg.skipped.length > 0 && <div style={{ fontSize: 12, color: COLORS.warn }}>بخش‌های نامفهوم نادیده گرفته شد: {msg.skipped.join(' | ')}</div>}
      {withErr.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {withErr.map(d => (
            <div key={d.id} style={{ background: '#fff', border: `1px solid ${d.errors.length ? COLORS.danger : COLORS.border}`, borderRadius: 9, padding: 8, display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, lineHeight: 1.9 }}>
                <strong>{d.item.name}</strong> <span style={{ color: COLORS.sub }}>({d.item.category})</span> — {invSummary(d.item)}
                {d.item.ownerType === 'مشتری' && <div style={{ color: COLORS.primaryDark }}>آورده‌ی مشتری: <strong>{(customers.find(c => c.id === d.item.ownerCustomerId) || {}).name || 'انتخاب نشده'}</strong></div>}
                {d.item.supplierSource === 'تامین‌کننده' && d.item.supplierId && <div style={{ color: COLORS.sub }}>تامین‌کننده: {(suppliers.find(s => s.id === d.item.supplierId) || {}).name}</div>}
                {d.warnings.map((w, i) => <div key={i} style={{ color: COLORS.warn }}>⚠ {w}</div>)}
                {d.errors.map((w, i) => <div key={i} style={{ color: COLORS.danger, fontWeight: 700 }}>✗ {w}</div>)}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <GhostButton icon={Pencil} onClick={() => onEdit(d)} style={{ padding: '4px 10px', fontSize: 12 }}>اصلاح</GhostButton>
                <IconButton icon={Trash2} danger title="حذف از فهرست" onClick={() => setDrafts(prev => prev.filter(x => x.id !== d.id))} />
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <PrimaryButton icon={Check} onClick={() => { onRegister(valid.map(d => d.item)); setDrafts(prev => prev.filter(x => !valid.some(v => v.id === x.id))); setMsg({ ok: true, t: `${valid.length} کالا در انبار ثبت شد.` }); }} style={{ opacity: valid.length ? 1 : 0.5 }}>ثبت {valid.length} مورد معتبر در انبار</PrimaryButton>
            {valid.length < withErr.length && <span style={{ fontSize: 12, color: COLORS.danger }}>{withErr.length - valid.length} مورد نیاز به اصلاح دارد.</span>}
            <GhostButton onClick={() => setDrafts([])} style={{ marginInlineStart: 'auto' }}>پاک‌کردن فهرست</GhostButton>
          </div>
        </div>
      )}
    </div>
  );
}

function InventoryTable({ inventory, customers, suppliers, settings, onEdit, onDelete, onExport, onImport, onReceive, canReceive }) {
  const blank = { q: '', category: '', gramaj: '', size: '', color: '', stock: '', owner: '', source: '' };
  const [f, setF] = useState(blank);
  const [sort, setSort] = useState({ key: '', dir: 1 });
  const colorOf = (i) => i.color || i.finish || '';
  const stockState = (i) => (stockLevel(i) <= 0 ? 'صفر' : isLow(i) ? 'کم‌موجود' : 'موجود');
  const distinct = (fn) => [...new Set(inventory.map(fn).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'fa', { numeric: true }));
  const rows = useMemo(() => {
    let list = inventory.filter(i =>
      (!f.q.trim() || `${i.name} ${i.brand || ''} ${i.location || ''}`.includes(f.q.trim())) &&
      (!f.category || i.category === f.category) && (!f.gramaj || String(i.gramaj) === f.gramaj) && (!f.size || i.size === f.size) &&
      (!f.color || colorOf(i) === f.color) && (!f.stock || stockState(i) === f.stock) &&
      (!f.owner || ownerLabel(i, customers) === f.owner) && (!f.source || supplierSourceLabel(i, customers, suppliers) === f.source));
    if (sort.key) {
      const val = { name: i => i.name, category: i => i.category, gramaj: i => Number(i.gramaj) || 0, size: i => i.size || '', color: i => colorOf(i), stock: i => stockLevel(i), value: i => itemValue(i), owner: i => ownerLabel(i, customers), source: i => supplierSourceLabel(i, customers, suppliers) }[sort.key];
      list = [...list].sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'fa', { numeric: true })) * sort.dir; });
    }
    return list;
  }, [inventory, customers, suppliers, f, sort]);
  const total = rows.reduce((s, i) => s + itemValue(i), 0);
  const active = Object.values(f).some(Boolean);
  const th = { padding: '8px 8px', textAlign: 'right', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' };
  const head = (key, label) => <th key={key} style={th} onClick={() => setSort(s => ({ key, dir: s.key === key ? -s.dir : 1 }))}>{label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>;
  const sel = (key, options) => (
    <select value={f[key]} onChange={e => setF({ ...f, [key]: e.target.value })} style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, width: '100%' }}>
      <option value="">همه</option>{options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  const cats = distinct(i => i.category);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {cats.map(c => { const n = inventory.filter(i => i.category === c).length; const on = f.category === c; return <button key={c} onClick={() => setF({ ...f, category: on ? '' : c })} style={{ border: `1px solid ${on ? COLORS.primary : COLORS.border}`, background: on ? COLORS.primary : '#fff', color: on ? '#fff' : COLORS.text, borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{c} ({n})</button>; })}
        <div style={{ flex: 1 }} />
        {active && <GhostButton onClick={() => setF(blank)} style={{ padding: '4px 10px', fontSize: 12 }}>پاک‌کردن فیلترها</GhostButton>}
        {onImport && <GhostButton icon={Sheet} onClick={onImport} style={{ padding: '4px 10px', fontSize: 12 }}>ورود از اکسل</GhostButton>}
        <GhostButton icon={FileText} onClick={() => onExport(rows)} style={{ padding: '4px 10px', fontSize: 12 }}>{active ? `خروجی اکسل (${rows.length} نتیجه‌ی فیلترشده)` : 'خروجی اکسل'}</GhostButton>
        <PrintReportButton settings={settings} title="گزارش موجودی انبار" subtitle={active ? 'نتیجه‌ی فیلترشده' : 'همه‌ی کالاها'} signatures={['انباردار', 'مدیر چاپخانه']}>{() => <PrintTable head={['ردیف', 'شرح', 'دسته', 'گراماژ', 'سایز', 'رنگ / نوع', 'موجودی', 'ارزش کل (ریال)', 'مالکیت', 'منبع تامین']} widths={['4%', '20%', '8%', '6%', '8%', '8%', '14%', '12%', '10%', '10%']} rows={rows.map((i, n) => [n + 1, i.name, i.category, i.gramaj ? `${i.gramaj}g` : '—', i.size || '—', colorOf(i) || '—', `${fmt(stockLevel(i))} ${stockUnitLabel(i)}`, fmt(itemValue(i)), ownerLabel(i, customers), supplierSourceLabel(i, customers, suppliers)])} foot={['', `${fmt(rows.length)} ردیف`, '', '', '', '', '', fmt(Math.round(total)), '', '']} />}</PrintReportButton>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: COLORS.primary, color: '#fff' }}>
              {head('name', 'شرح')}{head('category', 'دسته')}{head('gramaj', 'گراماژ')}{head('size', 'سایز')}{head('color', 'رنگ / نوع')}{head('stock', 'موجودی')}{head('value', 'ارزش کل')}{head('owner', 'مالکیت')}{head('source', 'منبع تامین')}{canReceive ? <th key="receipt" style={{ ...th, cursor: 'default' }}>رسید امانت</th> : null}<th style={th}></th>
            </tr>
            <tr style={{ background: COLORS.accentLight }}>
              <th style={{ padding: 4 }}><input value={f.q} onChange={e => setF({ ...f, q: e.target.value })} placeholder="جستجو..." style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, width: '100%' }} /></th>
              <th style={{ padding: 4 }}>{sel('category', cats)}</th>
              <th style={{ padding: 4 }}>{sel('gramaj', distinct(i => String(i.gramaj || '')))}</th>
              <th style={{ padding: 4 }}>{sel('size', distinct(i => i.size))}</th>
              <th style={{ padding: 4 }}>{sel('color', distinct(colorOf))}</th>
              <th style={{ padding: 4 }}>{sel('stock', ['موجود', 'کم‌موجود', 'صفر'])}</th>
              <th style={{ padding: 4 }}></th>
              <th style={{ padding: 4 }}>{sel('owner', distinct(i => ownerLabel(i, customers)))}</th>
              <th style={{ padding: 4 }}>{sel('source', distinct(i => supplierSourceLabel(i, customers, suppliers)))}</th>
              {canReceive ? <th style={{ padding: 4 }}></th> : null}
              <th style={{ padding: 4 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i, idx) => {
              const low = isLow(i);
              return (
                <tr key={i.id} style={{ background: low ? COLORS.dangerBg : (idx % 2 ? COLORS.altRow : '#fff') }}>
                  <td style={{ padding: '7px 8px', fontWeight: 700 }}>{i.name}{i.brand ? <span style={{ color: COLORS.sub, fontWeight: 400 }}> — {i.brand}</span> : null}</td>
                  <td style={{ padding: '7px 8px' }}>{i.category}</td>
                  <td style={{ padding: '7px 8px' }}>{i.gramaj ? `${i.gramaj} g` : '—'}</td>
                  <td style={{ padding: '7px 8px' }}>{i.size || '—'}</td>
                  <td style={{ padding: '7px 8px' }}>{colorOf(i) || '—'}</td>
                  <td style={{ padding: '7px 8px', fontWeight: 800, color: low ? COLORS.danger : COLORS.text }}>{fmt(stockLevel(i))} {stockUnitLabel(i)}{i.unitMode === 'band_sheet' && <span style={{ fontWeight: 400, color: COLORS.sub }}> ({fmt(sheetCount(i))} ورق)</span>}</td>
                  <td style={{ padding: '7px 8px' }}>{fmt(itemValue(i))}</td>
                  <td style={{ padding: '7px 8px', color: i.ownerType === 'مشتری' ? COLORS.primaryDark : COLORS.text, fontWeight: i.ownerType === 'مشتری' ? 700 : 400 }}>{ownerLabel(i, customers)}</td>
                  <td style={{ padding: '7px 8px' }}>{supplierSourceLabel(i, customers, suppliers)}</td>
                  {canReceive ? <td style={{ padding: '7px 8px' }}>{i.ownerType === 'مشتری' ? <IconButton icon={PackagePlus} title="ثبت رسید تحویل کالا از مشتری" onClick={() => onReceive(i)} /> : <span style={{ color: COLORS.sub, fontSize: 11 }}>—</span>}</td> : null}
                  <td style={{ padding: '7px 8px' }}><div style={{ display: 'flex', gap: 6 }}><IconButton icon={Pencil} title="ویرایش" onClick={() => onEdit(i)} /><IconButton icon={Trash2} danger title="حذف" onClick={() => onDelete(i.id)} /></div></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={canReceive ? 11 : 10} style={{ padding: 20, textAlign: 'center', color: COLORS.sub }}>{inventory.length === 0 ? 'هنوز کالایی به انبار اضافه نشده است.' : 'هیچ کالایی با این فیلترها پیدا نشد.'}</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr style={{ background: COLORS.accentLight, fontWeight: 800 }}><td colSpan={6} style={{ padding: '8px' }}>{fmt(rows.length)} ردیف{active ? ' (فیلترشده)' : ''}</td><td colSpan={canReceive ? 5 : 4} style={{ padding: '8px' }}>جمع ارزش: {fmt(Math.round(total))} ریال</td></tr></tfoot>}
        </table>
      </div>
    </div>
  );
}

/* بند ۵/الف: ساعت در «یک کادر» — فقط عدد (۱۴۳۰)، دونقطه خودکار می‌آید. */
function ClockField({ value, onChange }) {
  const [text, setText] = useState(value || '');
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(value || ''); }, [value]);
  function type(raw) {
    const d = normalizeDigits(raw).replace(/\D/g, '').slice(0, 4);
    setText(d.slice(0, 2) + (d.length > 2 ? ':' + d.slice(2) : ''));
    if (d.length === 4) { const ok = Number(d.slice(0, 2)) < 24 && Number(d.slice(2)) < 60; setBad(!ok); if (ok) onChange(`${d.slice(0, 2)}:${d.slice(2)}`); }
    else setBad(false);
  }
  return <input value={text} onChange={e => type(e.target.value)} inputMode="numeric" maxLength={5} placeholder="۱۴:۳۰"
    style={{ ...inputStyle, direction: 'ltr', textAlign: 'center', letterSpacing: 1, width: 90, borderColor: bad ? COLORS.danger : undefined }} />;
}

/* رسید «تحویل کالا از مشتری»: شمارش روز امانت از همین رکورد تاریخ‌دار انجام می‌شود.
   تاریخ، ساعت و تحویل‌گیرنده را سرور می‌نویسد؛ هیچ‌کدام در این فرم قابل جعل نیست. */
function ConsignmentReceiptModal({ item, receipts, customers, settings, actor, onClose, onSaved }) {
  const units = item.unitMode === 'band_sheet' ? ['بند', 'ورق'] : item.unitMode === 'roll_kg' ? ['کیلوگرم', 'رول'] : [item.simpleUnit || ''];
  const [draft, setDraft] = useState({ date: todayIso(), time: `${pad2(new Date().getHours())}:${pad2(new Date().getMinutes())}`, qty: '', unit: units[0], orderNumber: item.linkedOrderNumber || '', receivedBy: actor || '', note: '' });
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(null);
  const set = (k, val) => setDraft(prev => ({ ...prev, [k]: val }));
  const mine = (receipts || []).filter(r => r.inventoryItemId === item.id).sort((a, b) => (`${a.date} ${a.time}` < `${b.date} ${b.time}` ? 1 : -1));
  const first = mine.length ? mine[mine.length - 1] : null;
  const days = first ? Math.floor((new Date(`${todayIso()}T00:00:00`) - new Date(`${first.date}T00:00:00`)) / 86400000) : null;
  async function submit() {
    const errs = [];
    if (!draft.date) errs.push('تاریخ رسید را کامل وارد کنید.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) errs.push('ساعت رسید را به شکل ۱۴:۳۰ وارد کنید.');
    if (!(Number(normalizeDigits(draft.qty)) > 0)) errs.push('مقدار تحویلی باید عددی بزرگ‌تر از صفر باشد.');
    if (!draft.receivedBy.trim()) errs.push('نام تحویل‌گیرنده را وارد کنید.');
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    const result = await (window.printshopApi?.consignReceipt
      ? window.printshopApi.consignReceipt({ inventoryItemId: item.id, ownerCustomerId: item.ownerCustomerId, ...draft })
      : Promise.resolve({ ok: false, error: 'رسید امانت فقط در نسخهٔ پایگاه دادهٔ امن ثبت می‌شود.' }));
    setBusy(false);
    if (!result.ok) { setErrors([result.error || 'رسید ثبت نشد.']); return; }
    await onSaved(result.receipt);
    onClose();
  }
  const th = { padding: '5px 8px', textAlign: 'right', borderBottom: `1px solid ${COLORS.border}` };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: COLORS.accentLight, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: COLORS.primaryDark, fontWeight: 700 }}>
        {item.name} — {ownerLabel(item, customers)}{first ? ` · نخستین رسید: ${faDate(first.date)} (روز ${fmt(days)} نزد چاپخانه)` : ' · نخستین رسید: هنوز ثبت نشده — تا این ثبت نشود شمارش روز امانت ممکن نیست'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <Field label="تاریخ تحویل کالا *"><JalaliDateInput value={draft.date} onChange={v => set('date', v)} /></Field>
        <Field label="ساعت تحویل *"><ClockField value={draft.time} onChange={v => set('time', v)} /></Field>
        <Field label="مقدار تحویلی *"><TextInput type="number" min="0" value={draft.qty} onChange={e => set('qty', e.target.value)} /></Field>
        <Field label="واحد"><Select options={units} value={draft.unit} onChange={e => set('unit', e.target.value)} /></Field>
        <Field label="شماره سفارش (اختیاری)"><TextInput value={draft.orderNumber} onChange={e => set('orderNumber', e.target.value)} /></Field>
        <Field label="تحویل‌گیرنده در چاپخانه *"><TextInput value={draft.receivedBy} onChange={e => set('receivedBy', e.target.value)} placeholder={actor || ''} /></Field>
      </div>
      <Field label="شرح رسید"><TextInput value={draft.note} onChange={e => set('note', e.target.value)} placeholder="مثلاً: ۴ بند کاغذ تحریر، سالم و بسته‌بندی" /></Field>
      <div>
        <SectionTitle small>رسیدهای این کالا</SectionTitle>
        {mine.length === 0 ? <div style={{ fontSize: 12, color: COLORS.sub, padding: '6px 0' }}>هنوز رسیدی برای این کالا ثبت نشده است.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: COLORS.primary, color: '#fff' }}>{['شماره رسید', 'تاریخ', 'ساعت', 'مقدار', 'واحد', 'تحویل‌گیرنده', 'سفارش', 'اقدام'].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'right' }}>{h}</th>)}</tr></thead>
              <tbody>{mine.map(r => (
                <tr key={r.id}>
                  <td style={th}>{faDigits(r.receiptNumber) || '—'}</td><td style={th}>{faDate(r.date)}</td><td style={th}><bdi>{faDigits(r.time)}</bdi></td>
                  <td style={th}>{fmt(r.qty)}</td><td style={th}>{r.unit}</td><td style={th}>{r.receivedBy}</td>
                  <td style={th}>{r.orderNumber || '—'}</td>
                  <td style={th}><GhostButton icon={Printer} onClick={() => setPrinting(r)} style={{ padding: '3px 8px', fontSize: 11 }}>چاپ</GhostButton></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      {errors.length > 0 && (
        <div style={{ background: COLORS.dangerBg, border: `1px solid ${COLORS.danger}`, borderRadius: 9, padding: 10, color: COLORS.danger, fontSize: 12, lineHeight: 1.9 }}>
          {errors.map((e, i) => <div key={i}>• {e}</div>)}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: `1px solid ${COLORS.border}`, paddingTop: 14 }}>
        <GhostButton onClick={onClose}>انصراف</GhostButton>
        <PrimaryButton icon={PackagePlus} onClick={submit} disabled={busy}>{busy ? 'در حال ثبت…' : 'ثبت رسید و افزودن به موجودی'}</PrimaryButton>
      </div>
      {printing && <ConsignmentReceiptPrint receipt={printing} item={item} settings={settings} onClose={() => setPrinting(null)} />}
    </div>
  );
}

function ConsignmentReceiptPrint({ receipt, item, settings, onClose }) {
  const co = (settings && settings.company) || {};
  const rows = [
    ['مشتری', receipt.customerName || '—'],
    ['کالای تحویلی', `${receipt.itemName || item.name}${item.gramaj ? ` — ${item.gramaj}g` : ''}${item.size ? ` — ${item.size}` : ''}`],
    ['مقدار و واحد', `${fmt(receipt.qty)} ${receipt.unit}`],
    ['سفارش مرتبط', receipt.orderNumber || '—'],
    ['تاریخ و ساعت تحویل', `${faDate(receipt.date)} — ${faDigits(receipt.time)}`],
    ['تحویل‌گیرنده در چاپخانه', receipt.receivedBy || '—'],
    ['شرح', receipt.note || '—'],
  ];
  return <PrintOverlay onClose={onClose} initialPaper="A5" pdfName={`رسید-امانت-${receipt.receiptNumber || receipt.id}`}>
    <div style={{ padding: 16, fontSize: 12, color: '#000' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: '2px solid #000', paddingBottom: 8 }}>
        {co.logo ? <img src={co.logo} alt="" style={{ height: 42, maxWidth: 80, objectFit: 'contain' }} /> : null}
        <div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: 15 }}>{co.name || '—'}</div><div style={{ fontSize: 10 }}>{[co.phone, co.mobile, co.address].filter(Boolean).join(' | ') || '—'}</div></div>
        <div style={{ textAlign: 'left', fontSize: 11 }}><div style={{ fontWeight: 800 }}>رسید تحویل کالای امانی</div><div>شماره: <bdi>{faDigits(receipt.receiptNumber) || '—'}</bdi></div></div>
      </div>
      <table className="financial-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
        <tbody>{rows.map(([label, value]) => (
          <tr key={label}><th style={{ width: '32%', textAlign: 'right', padding: '5px 6px', borderBottom: '1px solid #bbb' }}>{label}</th><td style={{ padding: '5px 6px', borderBottom: '1px solid #bbb' }}>{value}</td></tr>
        ))}</tbody>
      </table>
      <div style={{ display: 'flex', gap: 24, marginTop: 26 }}>
        <div style={{ flex: 1, borderTop: '1px solid #000', paddingTop: 4, textAlign: 'center' }}>امضای تحویل‌دهنده (مشتری)</div>
        <div style={{ flex: 1, borderTop: '1px solid #000', paddingTop: 4, textAlign: 'center' }}>امضای تحویل‌گیرنده (چاپخانه)</div>
      </div>
      <p style={{ fontSize: 10, marginTop: 14, lineHeight: 1.8 }}>این رسید گواه تحویل کالا به امانت در چاپخانه است. کالای امانی تنها برای سفارش خود مشتری مصرف می‌شود و با هر مرحلهٔ تولید، مقدار مصرف‌شده در کاردکس همان کالا ثبت می‌گردد.</p>
    </div>
  </PrintOverlay>;
}

function InventoryForm({ initial, isNew, customers, suppliers, categories, onAddCategory, onRemoveCategory, onAddCustomer, onAddSupplier, onSave, onCancel }) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState([]);
  const [newCust, setNewCust] = useState(null);
  const [newSupp, setNewSupp] = useState(null);
  const set = (k, val) => setV(prev => ({ ...prev, [k]: val }));
  useEffect(() => {
    if (!usesKgPrice(v)) return;
    const next = String(Math.round(bandWeightKg(v) * (Number(v.pricePerKg) || 0)));
    if (next !== String(v.unitValue)) setV(prev => ({ ...prev, unitValue: next }));
  }, [v.priceBasis, v.pricePerKg, v.size, v.gramaj, v.sheetsPerBand, v.unitMode]);
  const isPaperLike = PAPER_LIKE.includes(v.category);
  const modeOptions = isPaperLike
    ? [['band_sheet', 'ورقی — بر حسب بند و تعداد ورق'], ['roll_kg', 'رول — تبدیل به کیلوگرم']]
    : [['simple', 'ساده (کیلوگرم / عدد / متر / لیتر)'], ['roll_kg', 'رول — تبدیل به کیلوگرم']];

  function setCategory(val) {
    setV(prev => {
      const paper = PAPER_LIKE.includes(val);
      const unitMode = prev.unitMode === 'roll_kg' ? 'roll_kg' : (paper ? 'band_sheet' : 'simple');
      const simpleUnit = !paper && CATEGORY_DEFAULT_UNIT[val] && (isNew || !prev.quantity) ? CATEGORY_DEFAULT_UNIT[val] : prev.simpleUnit;
      const priceBasis = unitMode === 'band_sheet' && val === 'مقوا' && isNew && !prev.unitValue && !prev.pricePerKg ? 'kg' : prev.priceBasis;
      return { ...prev, category: val, unitMode, simpleUnit, priceBasis };
    });
  }
  function setRoll(k, val) {
    setV(prev => {
      const n = { ...prev, [k]: val };
      const rc = Number(n.rollCount), kg = Number(n.kgPerRoll);
      if (k !== 'weightKg' && rc > 0 && kg > 0) n.weightKg = String(Math.round(rc * kg * 1000) / 1000);
      return n;
    });
  }

  function handleSave() {
    const errs = inventoryErrors(v, isNew);
    setErrors(errs);
    if (errs.length) return;
    const out = { ...v, name: v.name.trim() };
    const keep = fieldsFor(v.category);
    ['gramaj', 'size', 'color', 'finish', 'brand'].forEach(k => { if (!keep.includes(k)) out[k] = ''; });
    if (out.ownerType === 'مشتری') out.supplierSource = 'مشتری';
    if (out.ownerType !== 'مشتری') { out.ownerCustomerId = ''; out.purpose = ''; out.linkedOrderNumber = ''; out.purposeScope = 'all'; }
    else if (out.purposeScope !== 'order') { out.purpose = 'همه کارهای این مشتری'; out.linkedOrderNumber = ''; out.purposeScope = 'all'; }
    onSave(out);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <Field label="دسته (جنس کالا) *"><EditableSelect options={categories} protectedOptions={REQUIRED_INV_CATEGORIES} value={v.category} onChange={setCategory} onAddOption={onAddCategory} onRemoveOption={onRemoveCategory} placeholder="دسته جدید" /></Field>
        <Field label="شرح *"><TextInput value={v.name} onChange={e => set('name', e.target.value)} placeholder={NAME_PLACEHOLDER[v.category] || 'نام کالا'} /></Field>
        {fieldsFor(v.category).includes('gramaj') && <Field label={FIELD_LABELS.gramaj}><TextInput value={v.gramaj} onChange={e => set('gramaj', e.target.value)} /></Field>}
        {fieldsFor(v.category).includes('size') && <Field label={SIZE_LABEL_BY_CAT[v.category] || FIELD_LABELS.size}><TextInput value={v.size} onChange={e => set('size', e.target.value)} /></Field>}
        {['کاغذ', 'مقوا'].includes(v.category) && <Field label="ضخامت واقعی یک برگ (میلی‌متر، اختیاری)"><TextInput type="number" step="0.001" min="0" value={v.caliperMm || ''} onChange={e => set('caliperMm', e.target.value)} placeholder="مثلاً 0.09 — برای عطف دقیق" /></Field>}
        {fieldsFor(v.category).includes('color') && <Field label={FIELD_LABELS.color}><TextInput value={v.color || ''} onChange={e => set('color', e.target.value)} placeholder="مثلاً قرمز" /></Field>}
        {fieldsFor(v.category).includes('finish') && <Field label={FIELD_LABELS.finish}><Select options={['', 'مات', 'براق']} value={v.finish || ''} onChange={e => set('finish', e.target.value)} /></Field>}
        {fieldsFor(v.category).includes('brand') && <Field label={FIELD_LABELS.brand}><TextInput value={v.brand} onChange={e => set('brand', e.target.value)} /></Field>}
        <Field label="محل نگهداری"><TextInput value={v.location} onChange={e => set('location', e.target.value)} /></Field>
      </div>

      <SectionTitle small>مالکیت و منبع تامین *</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <Field label="مالک موجودی"><Select options={['چاپخانه', 'مشتری']} value={v.ownerType} onChange={e => setV(prev => ({ ...prev, ownerType: e.target.value, supplierSource: e.target.value === 'مشتری' ? 'مشتری' : (prev.supplierSource === 'مشتری' ? 'چاپخانه' : prev.supplierSource) }))} /></Field>
        {v.ownerType === 'مشتری'
          ? <Field label="مشتری‌ای که این کالا را آورده *">
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ flex: 1 }}><NamedSelect items={pickable(customers, v.ownerCustomerId)} value={v.ownerCustomerId} onChange={val => set('ownerCustomerId', val)} /></div>
                <GhostButton icon={Plus} onClick={() => setNewCust(emptyCustomer())} style={{ padding: '6px 10px', fontSize: 12 }}>مشتری جدید</GhostButton>
              </div>
            </Field>
          : <Field label="این کالا را چه کسی تامین کرده"><Select options={['چاپخانه', 'تامین‌کننده']} value={v.supplierSource === 'تامین‌کننده' ? 'تامین‌کننده' : 'چاپخانه'} onChange={e => set('supplierSource', e.target.value)} /></Field>}
      </div>
      {v.ownerType === 'مشتری' && v.ownerCustomerId && (
        <div style={{ background: COLORS.successBg, color: COLORS.success, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700 }}>آورنده‌ی کالا: {(customers.find(c => c.id === v.ownerCustomerId) || {}).name}</div>
      )}
      {v.ownerType !== 'مشتری' && v.supplierSource === 'تامین‌کننده' && (
        <Field label="نام تامین‌کننده *">
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ flex: 1 }}><NamedSelect items={pickable(suppliers, v.supplierId)} value={v.supplierId} onChange={val => set('supplierId', val)} /></div>
            <GhostButton icon={Plus} onClick={() => setNewSupp(emptySupplier())} style={{ padding: '6px 10px', fontSize: 12 }}>تامین‌کننده جدید</GhostButton>
          </div>
        </Field>
      )}
      {v.ownerType === 'مشتری' && (
        <>
          <SectionTitle small>این موجودی برای چه کاری آورده شده؟ (برای کاردکس انبار مشتری)</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <Field label="کاربرد">
              <Select options={['همه کارهای این مشتری', 'یک سفارش / کار مشخص']} value={v.purposeScope === 'order' ? 'یک سفارش / کار مشخص' : 'همه کارهای این مشتری'}
                onChange={e => set('purposeScope', e.target.value.startsWith('یک') ? 'order' : 'all')} />
            </Field>
            {v.purposeScope === 'order' && <Field label="شماره سفارش (اگر ثبت شده)"><TextInput value={v.linkedOrderNumber} onChange={e => set('linkedOrderNumber', e.target.value)} /></Field>}
          </div>
          {v.purposeScope === 'order' && <Field label="شرح کار (اگر هنوز سفارش ثبت نشده)"><TextInput value={v.purpose} onChange={e => set('purpose', e.target.value)} placeholder="مثلاً برای چاپ کاتالوگ سال آینده" /></Field>}
        </>
      )}

      <SectionTitle small>نحوه اندازه‌گیری موجودی *</SectionTitle>
      <Field label="نوع موجودی">
        <select value={v.unitMode} onChange={e => set('unitMode', e.target.value)} style={inputStyle}>
          {modeOptions.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      </Field>
      {v.unitMode === 'band_sheet' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <Field label="تعداد بند *"><TextInput type="number" min="0" value={v.bandCount} onChange={e => set('bandCount', e.target.value)} /></Field>
          <Field label="تعداد ورق در هر بند *"><TextInput type="number" min="0" value={v.sheetsPerBand} onChange={e => set('sheetsPerBand', e.target.value)} /></Field>
          <Field label="جمع تعداد ورق (خودکار)"><TextInput readOnly value={fmt(sheetCount(v))} style={{ background: COLORS.altRow }} /></Field>
        </div>
      )}
      {v.unitMode === 'roll_kg' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <Field label="تعداد رول"><TextInput type="number" min="0" value={v.rollCount} onChange={e => setRoll('rollCount', e.target.value)} /></Field>
          <Field label="وزن هر رول (کیلوگرم)"><TextInput type="number" min="0" value={v.kgPerRoll} onChange={e => setRoll('kgPerRoll', e.target.value)} /></Field>
          <Field label="وزن کل (کیلوگرم) *"><TextInput type="number" min="0" value={v.weightKg} onChange={e => setRoll('weightKg', e.target.value)} /></Field>
        </div>
      )}
      {v.unitMode === 'simple' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="موجودی *"><TextInput type="number" min="0" value={v.quantity} onChange={e => set('quantity', e.target.value)} /></Field>
          <Field label="واحد *"><Select options={SIMPLE_UNITS} value={v.simpleUnit} onChange={e => set('simpleUnit', e.target.value)} /></Field>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <Field label={`حداقل موجودی (هشدار) — بر حسب ${v.unitMode === 'band_sheet' ? 'بند' : (v.unitMode === 'roll_kg' ? 'کیلوگرم' : v.simpleUnit)}`}><TextInput type="number" min="0" value={v.minThreshold} onChange={e => set('minThreshold', e.target.value)} /></Field>
        {v.unitMode === 'band_sheet' ? <Field label="مبنای قیمت">
          <select value={v.priceBasis === 'kg' ? 'kg' : 'unit'} onChange={e => set('priceBasis', e.target.value)} style={inputStyle}>
            <option value="unit">قیمت هر بند</option>
            <option value="kg">قیمت هر کیلوگرم (مثل مقوا)</option>
          </select>
        </Field> : null}
        {usesKgPrice(v)
          ? <Field label="فی هر کیلوگرم (ریال)"><TextInput type="number" min="0" value={v.pricePerKg} onChange={e => set('pricePerKg', e.target.value)} /></Field>
          : <Field label={v.unitMode === 'band_sheet' ? 'ارزش هر بند (ریال)' : 'ارزش هر واحد (ریال)'}><TextInput type="number" min="0" value={v.unitValue} onChange={e => set('unitValue', e.target.value)} /></Field>}
      </div>
      {usesKgPrice(v) ? <div style={{ background: COLORS.accentLight, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: COLORS.primaryDark, lineHeight: 1.9 }}>
        {bandWeightKg(v) > 0
          ? <>وزن هر بند: <strong>{fmt(Math.round(bandWeightKg(v) * 1000) / 1000)} کیلوگرم</strong> — ارزش هر بند: <strong>{fmt(Math.round(bandWeightKg(v) * (Number(v.pricePerKg) || 0)))} ریال</strong> — هر ورق: <strong>{fmt(Math.round(bandWeightKg(v) * (Number(v.pricePerKg) || 0) / (Number(v.sheetsPerBand) || 1)))} ریال</strong></>
          : 'برای محاسبهٔ وزن، «سایز» (مثل ۱۰۰×۷۰)، «گراماژ» و «تعداد ورق در هر بند» را وارد کنید.'}
      </div> : null}
      <div style={{ background: COLORS.accentLight, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: COLORS.primaryDark, fontWeight: 700 }}>
        ارزش کل این قلم: {fmt(itemValue(v))} ریال
      </div>

      {errors.length > 0 && (
        <div style={{ background: COLORS.dangerBg, border: `1px solid ${COLORS.danger}`, borderRadius: 9, padding: 10, color: COLORS.danger, fontSize: 12, lineHeight: 1.9 }}>
          <strong>تا موارد زیر تکمیل نشود ذخیره نمی‌شود:</strong>
          {errors.map((e, i) => <div key={i}>• {e}</div>)}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: `1px solid ${COLORS.border}`, paddingTop: 14 }}>
        <GhostButton onClick={onCancel}>انصراف</GhostButton>
        <PrimaryButton icon={Save} onClick={handleSave}>ذخیره</PrimaryButton>
      </div>
      {newCust && (
        <Modal title="مشتری جدید" onClose={() => setNewCust(null)}>
          <CustomerForm initial={newCust} marketers={workList(customers.filter(c => c.isMarketer))} onSave={(c) => { onAddCustomer(c); set('ownerCustomerId', c.id); setNewCust(null); }} onCancel={() => setNewCust(null)} />
        </Modal>
      )}
      {newSupp && (
        <Modal title="تامین‌کننده جدید" onClose={() => setNewSupp(null)} wide>
          <SupplierForm initial={newSupp} onSave={(sp) => { onAddSupplier(sp); set('supplierId', sp.id); set('supplierSource', 'تامین‌کننده'); setNewSupp(null); }} onCancel={() => setNewSupp(null)} />
        </Modal>
      )}
    </div>
  );
}

/* ===================== مشتریان و بازاریاب‌ها ===================== */
const isoDigits = (v) => normalizeDigits(String(v || '')).replace(/\D/g, '');
function CustomerForm({ initial, marketers = [], onSave, onCancel }) {
  const [v, setV] = useState({ ...emptyCustomer(), ...initial, commission: initial.commission || defaultCommission() });
  const [birthDateValid, setBirthDateValid] = useState(true);
  const [errs, setErrs] = useState([]);
  const set = (k, val) => setV(prev => ({ ...prev, [k]: val }));
  const legal = v.entityType === 'حقوقی';
  const setTier = (i, patch) => set('commission', { ...v.commission, tiers: v.commission.tiers.map((t, j) => j === i ? { ...t, ...patch } : t) });
  function handleSave() {
    const e = [];
    if (!v.name.trim()) e.push('نام را وارد کنید.');
    if (!birthDateValid) e.push('تاریخ تولد یا تأسیس را کامل و صحیح وارد کنید یا آن را پاک کنید.');
    if (!legal && v.nationalCode && isoDigits(v.nationalCode).length !== 10) e.push('کد ملی باید ۱۰ رقم باشد.');
    if (legal && v.nationalId && isoDigits(v.nationalId).length !== 11) e.push('شناسه ملی شرکت باید ۱۱ رقم باشد.');
    if (v.isMarketer && !v.commission.tiers.some(t => Number(isoDigits(t.percent)) > 0 || /[1-9]/.test(normalizeDigits(String(t.percent || ''))))) e.push('برای بازاریاب، حداقل یک درصد پورسانت وارد کنید.');
    setErrs(e); if (e.length) return;
    onSave({ ...v, name: v.name.trim(), nationalCode: legal ? '' : isoDigits(v.nationalCode), nationalId: legal ? isoDigits(v.nationalId) : '', marketerId: v.marketerId === v.id ? '' : v.marketerId });
  }
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 12px' };
  const spanAll = { gridColumn: '1 / -1' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SectionTitle small>مشخصات هویتی</SectionTitle>
      <div style={grid}>
        <Field label="نوع"><Select options={['حقیقی', 'حقوقی']} value={v.entityType} onChange={e => set('entityType', e.target.value)} /></Field>
        <div style={{ gridColumn: 'span 2' }}><Field label={legal ? 'نام شرکت *' : 'نام و نام‌خانوادگی *'}><TextInput value={v.name} onChange={e => set('name', e.target.value)} /></Field></div>
        {!legal && <Field label="کد ملی"><TextInput value={v.nationalCode || ''} onChange={e => set('nationalCode', e.target.value)} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>}
        {!legal && <Field label="تاریخ تولد"><BirthDateInput label="تاریخ تولد" value={v.birthDate || ''} onChange={val => set('birthDate', val)} onValidityChange={setBirthDateValid} toIso={isoFromJ} fromIso={jFromIso} isLeapYear={isLeapJy} today={todayIso()} /></Field>}
        {legal && <Field label="شناسه ملی شرکت"><TextInput value={v.nationalId || ''} onChange={e => set('nationalId', e.target.value)} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>}
        {legal && <Field label="شماره ثبت"><TextInput value={v.registerNo || ''} onChange={e => set('registerNo', e.target.value)} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>}
        {legal && <Field label="تاریخ تأسیس"><BirthDateInput label="تاریخ تأسیس" value={v.birthDate || ''} onChange={val => set('birthDate', val)} onValidityChange={setBirthDateValid} toIso={isoFromJ} fromIso={jFromIso} isLeapYear={isLeapJy} today={todayIso()} /></Field>}
        <Field label="کد اقتصادی"><TextInput value={v.economicCode || ''} onChange={e => set('economicCode', e.target.value)} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
      </div>
      <SectionTitle small>تماس و نشانی</SectionTitle>
      <div style={grid}>
        <Field label="شماره تماس"><TextInput value={v.phone} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="همراه"><TextInput value={v.mobile || ''} onChange={e => set('mobile', e.target.value)} /></Field>
        <Field label="کد پستی"><TextInput value={v.postalCode || ''} onChange={e => set('postalCode', e.target.value)} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
        <Field label="استان"><TextInput value={v.province || ''} onChange={e => set('province', e.target.value)} /></Field>
        <Field label="شهر"><TextInput value={v.city || ''} onChange={e => set('city', e.target.value)} /></Field>
        <div style={spanAll}><Field label="نشانی کامل"><textarea value={v.address || ''} onChange={e => set('address', e.target.value)} rows={2} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.9 }} /></Field></div>
      </div>
      {legal && (
        <>
          <SectionTitle small>نماینده‌ی شرکت</SectionTitle>
          <div style={grid}>
            <Field label="نام نماینده"><TextInput value={v.repName || ''} onChange={e => set('repName', e.target.value)} /></Field>
            <Field label="سمت"><Select options={['مدیرعامل', 'عضو هیئت‌مدیره', 'مدیر خرید', 'کارشناس', 'سایر']} value={v.repRole || 'مدیرعامل'} onChange={e => set('repRole', e.target.value)} /></Field>
            <Field label="تلفن نماینده"><TextInput value={v.repPhone || ''} onChange={e => set('repPhone', e.target.value)} /></Field>
          </div>
        </>
      )}
      <SectionTitle small>بازاریابی</SectionTitle>
      <div style={grid}>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="این مشتری را کدام بازاریاب آورده؟">
            <select value={v.marketerId || ''} onChange={e => set('marketerId', e.target.value)} style={inputStyle}>
              <option value="">— بدون بازاریاب —</option>
              {marketers.filter(m => m.id !== v.id).map(m => <option key={m.id} value={m.id}>{m.name} ({m.entityType})</option>)}
            </select>
          </Field>
        </div>
        <label className="psx-check"><input type="checkbox" checked={!!v.isMarketer} onChange={e => set('isMarketer', e.target.checked)} /> این مشتری خودش بازاریاب است<span className="psx-hint">برای مشتریانی که می‌آورد پورسانت می‌گیرد</span></label>
        {v.isMarketer && (
          <div style={spanAll} className="psx-subpanel">
            <Field label="روش محاسبه‌ی پورسانت">
              <select value={v.commission.mode} onChange={e => set('commission', { ...v.commission, mode: e.target.value })} style={inputStyle}>{COMMISSION_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </Field>
            <div className="psx-hint psx-hint-block">درصد بر اساس «مجموع فاکتورهای مشتریانی که این بازاریاب آورده» (مبلغ بعد از تخفیف و قبل از مالیات) تعیین می‌شود. ردیف آخر را بدون سقف بگذارید تا برای بالاتر از آن هم درصد داشته باشد.</div>
            {v.commission.tiers.map((t, i) => (
              <div key={i} className="psx-tier-row">
                <span>{t.open ? 'بالاتر از ردیف‌های قبل (بدون سقف)' : 'مجموع فاکتورها تا سقف'}</span>
                {!t.open && <NumInput className="psx-tier-upto" value={t.upTo} onChange={e => setTier(i, { upTo: e.target.value })} placeholder="سقف (ریال)" />}
                <NumInput className="psx-tier-pct" value={t.percent} onChange={e => setTier(i, { percent: e.target.value })} placeholder="درصد" /><span className="psx-tier-sign">٪</span>
                <IconButton icon={X} danger title="حذف ردیف" onClick={() => set('commission', { ...v.commission, tiers: v.commission.tiers.filter((_, j) => j !== i) })} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <GhostButton icon={Plus} onClick={() => { const t = v.commission.tiers; const oi = t.findIndex(x => x.open); const nt = { upTo: '', percent: '', open: false }; set('commission', { ...v.commission, tiers: oi < 0 ? [...t, nt] : [...t.slice(0, oi), nt, ...t.slice(oi)] }); }} style={{ padding: '4px 10px', fontSize: 12 }}>افزودن ردیف سقف‌دار</GhostButton>
              {!v.commission.tiers.some(x => x.open) && <GhostButton icon={Plus} onClick={() => set('commission', { ...v.commission, tiers: [...v.commission.tiers, { upTo: '', percent: '', open: true }] })} style={{ padding: '4px 10px', fontSize: 12 }}>افزودن ردیف بدون سقف</GhostButton>}
            </div>
          </div>
        )}
      </div>
      <Field label="یادداشت"><TextInput value={v.note} onChange={e => set('note', e.target.value)} /></Field>
      {errs.length > 0 && <div style={{ background: COLORS.dangerBg, color: COLORS.danger, borderRadius: 8, padding: 10, fontSize: 12 }}>{errs.map((x, i) => <div key={i}>• {x}</div>)}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: `1px solid ${COLORS.border}`, paddingTop: 14 }}>
        <GhostButton onClick={onCancel}>انصراف</GhostButton>
        <PrimaryButton icon={Save} onClick={handleSave}>ذخیره</PrimaryButton>
      </div>
    </div>
  );
}

const birthdayFns = { jFromIso, isoFromJ, todayIso, todayJalali };
function CustomersPanel({ customers, settings, onNew, onEdit, onDelete, onLedger, onImport, canReview, onReview, onToggleActive }) {
  const [f, setF] = useState({ q: '', type: '', marketer: '', only: false });
  const [view, setView] = useState('work');
  const marketerName = (c) => (customers.find(m => m.id === c.marketerId) || {}).name || '';
  const inView = {
    work: usableParty,
    pending: c => partyReview(c) === 'pending',
    rejected: c => partyReview(c) === 'rejected',
    inactive: c => !partyActive(c),
    all: () => true,
  }[view];
  const rows = customers.filter(inView).filter(c =>
    (!f.q.trim() || `${c.name} ${c.phone || ''} ${c.mobile || ''} ${c.nationalCode || ''} ${c.nationalId || ''}`.includes(f.q.trim())) &&
    (!f.type || c.entityType === f.type) && (!f.only || c.isMarketer) &&
    (!f.marketer || (f.marketer === '__none__' ? !c.marketerId : c.marketerId === f.marketer)));
  const viewCounts = { work: workList(customers).length, pending: customers.filter(c => partyReview(c) === 'pending').length, rejected: customers.filter(c => partyReview(c) === 'rejected').length, inactive: customers.filter(c => !partyActive(c)).length, all: customers.length };
  function exportExcel() {
    saveWorkbook('مشتریان.xlsx', [{ name: 'مشتریان', rows: [['نام', 'نوع', 'کد ملی', 'شناسه ملی', 'شماره ثبت', 'کد اقتصادی', 'تاریخ تولد/تاسیس', 'تلفن', 'همراه', 'کد پستی', 'نشانی', 'نماینده', 'سمت', 'تلفن نماینده', 'بازاریاب', 'خودش بازاریاب است', 'یادداشت'],
      ...rows.map(c => [c.name, c.entityType, c.nationalCode || '', c.nationalId || '', c.registerNo || '', c.economicCode || '', c.birthDate ? faDate(c.birthDate) : '', c.phone, c.mobile || '', c.postalCode || '', c.address, c.repName || '', c.repName ? (c.repRole || '') : '', c.repPhone || '', marketerName(c), c.isMarketer ? 'بله' : '', c.note])] }]);
  }
  const th = { padding: '8px 10px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6 }}><Users size={18} /> مشتریان</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onImport && <GhostButton icon={Sheet} onClick={onImport}>ورود از اکسل</GhostButton>}
          <GhostButton icon={FileText} onClick={exportExcel}>خروجی اکسل{(f.q || f.type || f.marketer || f.only) ? ' (فیلترشده)' : ''}</GhostButton>
          <PrintReportButton settings={settings} title="فهرست مشتریان" signatures={['مدیر سفارشات', 'مدیر چاپخانه']}>{() => <PrintTable head={['ردیف', 'نام', 'نوع', 'کد ملی / شناسه ملی', 'تلفن', 'همراه', 'بازاریاب', 'نشانی']} widths={['4%', '18%', '7%', '13%', '11%', '11%', '12%', '24%']} rows={rows.map((c, n) => [n + 1, c.name, c.entityType, (c.entityType === 'حقوقی' ? c.nationalId : c.nationalCode) || '—', c.phone, c.mobile || '—', marketerName(c) || '—', c.address])} />}</PrintReportButton>
          <PrimaryButton icon={Plus} onClick={onNew}>مشتری جدید</PrimaryButton>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {[['work', 'فهرست کاری'], ['pending', 'در انتظار بررسی'], ['rejected', 'رد شده'], ['inactive', 'غیرفعال'], ['all', 'همهٔ بانک']].map(([key, name]) => (
          <button key={key} type="button" onClick={() => setView(key)} aria-pressed={view === key} style={{ padding: '5px 11px', borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: 'pointer', font: 'inherit', border: `1px solid ${view === key ? COLORS.primaryDark : COLORS.border}`, background: view === key ? COLORS.primary : '#fff', color: view === key ? '#fff' : COLORS.text }}>
            {name} ({fmt(viewCounts[key])})
          </button>
        ))}
        {view === 'work' && hiddenCount(customers) > 0 && <span style={{ fontSize: 11, color: COLORS.sub }}>{fmt(hiddenCount(customers))} رکورد تأییدنشده یا غیرفعال از این فهرست بیرون است؛ با چیپ «همهٔ بانک» دیده می‌شود و هیچ اطلاعاتی پاک نشده است.</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: '6px 10px', width: 260 }}>
          <Search size={14} color={COLORS.sub} />
          <input value={f.q} onChange={e => setF({ ...f, q: e.target.value })} placeholder="نام، تلفن، کد ملی..." style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, background: 'transparent', fontFamily: 'inherit' }} />
        </div>
        <select value={f.type} onChange={e => setF({ ...f, type: e.target.value })} style={{ ...inputStyle, width: 130 }}><option value="">همه‌ی انواع</option><option>حقیقی</option><option>حقوقی</option></select>
        <select value={f.marketer} onChange={e => setF({ ...f, marketer: e.target.value })} style={{ ...inputStyle, width: 190 }}>
          <option value="">همه‌ی بازاریاب‌ها</option><option value="__none__">بدون بازاریاب</option>
          {customers.filter(c => c.isMarketer && inView(c)).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700 }}><input type="checkbox" checked={f.only} onChange={e => setF({ ...f, only: e.target.checked })} /> فقط بازاریاب‌ها</label>
        <span style={{ fontSize: 12, color: COLORS.sub }}>{fmt(rows.length)} از {fmt(customers.length)}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: COLORS.primary, color: '#fff' }}>{['نام', 'نوع', 'کد ملی / شناسه ملی', 'تلفن', 'همراه', 'تاریخ تولد', 'بازاریاب', 'نشانی', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((c, idx) => {
              const d = c.birthDate ? daysToBirthday(c.birthDate, birthdayFns) : null;
              return (
                <tr key={c.id} style={{ background: idx % 2 ? COLORS.altRow : '#fff' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 700 }}>{c.name} {c.isMarketer && <Badge text="بازاریاب" bg={COLORS.accentLight} fg={COLORS.primaryDark} />}{c.customerCode && <Badge text={c.customerCode} bg="#e9eef6" fg="#1d3557" />}{!usableParty(c) && <Badge text={partyBadge(c)} bg={partyActive(c) ? COLORS.warnBg : '#e6e2dc'} fg={partyActive(c) ? COLORS.warn : '#5a5148'} />}</td>
                  <td style={{ padding: '8px 10px' }}>{c.entityType}</td>
                  <td style={{ padding: '8px 10px', direction: 'ltr', textAlign: 'right' }}>{(c.entityType === 'حقوقی' ? c.nationalId : c.nationalCode) || '—'}</td>
                  <td style={{ padding: '8px 10px' }}>{c.phone}</td>
                  <td style={{ padding: '8px 10px' }}>{c.mobile || '—'}</td>
                  <td style={{ padding: '8px 10px' }}>{c.birthDate ? faDate(c.birthDate) : '—'}{d !== null && d <= 7 && <> <Badge text={d === 0 ? 'امروز 🎂' : `${d} روز دیگر 🎂`} bg={COLORS.warnBg} fg={COLORS.warn} /></>}</td>
                  <td style={{ padding: '8px 10px' }}>{marketerName(c) || '—'}</td>
                  <td style={{ padding: '8px 10px', maxWidth: 260 }}>{c.address}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
                      {canReview && partyReview(c) !== 'approved' && <GhostButton onClick={() => onReview(c)} style={{ padding: '4px 8px', fontSize: 11 }}>بررسی و تأیید</GhostButton>}
                      {canReview && partyReview(c) === 'approved' && !c.customerCode && <GhostButton onClick={() => onReview(c)} style={{ padding: '4px 8px', fontSize: 11 }}>صدور کد یکتا</GhostButton>}
                      {canReview && partyReview(c) === 'approved' && !!c.customerCode && <GhostButton onClick={() => onToggleActive(c)} style={{ padding: '4px 8px', fontSize: 11 }}>{partyActive(c) ? 'غیرفعال کردن' : 'فعال کردن'}</GhostButton>}
                      <GhostButton onClick={() => onLedger(c)} style={{ padding: '4px 8px', fontSize: 11 }}>کاردکس انبار</GhostButton>
                      <IconButton icon={Pencil} title="ویرایش" onClick={() => onEdit(c)} />
                      <IconButton icon={Trash2} danger title="حذف" onClick={() => onDelete(c.id)} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: COLORS.sub }}>{customers.length === 0 ? 'هنوز مشتری‌ای ثبت نشده است.' : 'مشتری‌ای با این فیلترها پیدا نشد.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MarketerReport({ customers, orders, payments, settings, onAddPayment, onDeletePayment }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const [open, setOpen] = useState('');
  const [pay, setPay] = useState({ date: todayIso(), amount: '', note: '' });
  const [err, setErr] = useState('');
  const fns = { grandTotal: orderGrandTotal, discount: (o) => Number(o.discount) || 0 };
  const marketers = customers.filter(c => c.isMarketer && (usableParty(c) || orders.some(o => o.marketerId === c.id) || payments.some(p => p.marketerId === c.id)));
  const stmts = marketers.map(m => ({ m, s: marketerStatement(m, orders, customers, payments, range, fns) }));
  const tot = stmts.reduce((a, { s }) => ({ base: a.base + s.totalBase, comm: a.comm + s.commission, paid: a.paid + s.paid, bal: a.bal + s.balance }), { base: 0, comm: 0, paid: 0, bal: 0 });
  const stateStyle = (s) => (s.startsWith('طلبکار') ? [COLORS.dangerBg, COLORS.danger] : s === 'تسویه‌شده' ? [COLORS.successBg, COLORS.success] : s === 'بیش‌پرداخت' ? [COLORS.accentLight, COLORS.primaryDark] : ['#eee', '#666']);
  const invStyle = (s) => (s === 'پرداخت‌شده' ? [COLORS.successBg, COLORS.success] : s === 'پرداخت جزئی' ? [COLORS.warnBg, COLORS.warn] : s === 'پرداخت‌نشده' ? [COLORS.dangerBg, COLORS.danger] : ['#eee', '#666']);
  function addPay(m) {
    const amount = Number(cleanNumber(pay.amount));
    if (!(amount > 0)) { setErr('مبلغ پرداخت را وارد کنید.'); return; }
    if (!pay.date) { setErr('تاریخ پرداخت را انتخاب کنید.'); return; }
    onAddPayment({ id: uid(), marketerId: m.id, date: pay.date, amount, note: pay.note.trim() });
    setPay({ date: todayIso(), amount: '', note: '' }); setErr('');
  }
  function exportExcel() {
    const sum = [['بازاریاب', 'نوع', 'تعداد فاکتور', 'جمع فاکتورها', 'درصد', 'پورسانت', 'پرداخت‌شده', 'مانده', 'وضعیت'], ...stmts.map(({ m, s }) => [m.name, m.entityType, s.count, Math.round(s.totalBase), s.rate, s.commission, s.paid, Math.round(s.balance), s.state])];
    const inv = [['بازاریاب', 'شماره سفارش', 'تاریخ', 'مشتری', 'مبلغ فاکتور', 'پورسانت', 'پرداخت‌شده', 'وضعیت'], ...stmts.flatMap(({ m, s }) => s.rows.map(r => [m.name, r.order.orderNumber, faDate(r.order.date), r.order.customerName, Math.round(r.base), r.commission, r.paid, r.status]))];
    const pays = [['بازاریاب', 'تاریخ', 'مبلغ', 'توضیح'], ...stmts.flatMap(({ m, s }) => s.payments.map(p => [m.name, faDate(p.date), Number(p.amount), p.note || '']))];
    saveWorkbook('گزارش-بازاریاب‌ها.xlsx', [{ name: 'خلاصه', rows: sum }, { name: 'فاکتورها', rows: inv }, { name: 'پرداخت‌ها', rows: pays }]);
  }
  const th = { padding: '8px 10px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' };
  if (marketers.length === 0) return <div style={{ fontSize: 12, color: COLORS.sub, lineHeight: 2 }}>بازاریاب تأییدشده‌ای که سابقهٔ کار داشته باشد وجود ندارد. در «مشتریان» تیک «این مشتری خودش بازاریاب است» را بزنید، درصد پورسانت را وارد کنید و با دکمهٔ «بررسی و تأیید» در همان ردیف، رکورد را تأیید نمایید.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>بازه (اختیاری):</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 12 }}>از</span><JalaliDateInput value={range.from} onChange={v => setRange({ ...range, from: v })} /></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 12 }}>تا</span><JalaliDateInput value={range.to} onChange={v => setRange({ ...range, to: v })} /></div>
        {(range.from || range.to) && <GhostButton onClick={() => setRange({ from: '', to: '' })} style={{ padding: '4px 10px', fontSize: 12 }}>همه‌ی زمان‌ها</GhostButton>}
        <div style={{ flex: 1 }} />
        <GhostButton icon={FileText} onClick={exportExcel}>خروجی اکسل</GhostButton>
        <PrintReportButton settings={settings} title="گزارش پورسانت بازاریاب‌ها" subtitle={(range.from || range.to) ? `بازه: ${range.from ? faDate(range.from) : '…'} تا ${range.to ? faDate(range.to) : '…'}` : 'همه‌ی زمان‌ها'} signatures={['مدیر مالی', 'مدیر چاپخانه']}>{() => <><PrintTable head={['بازاریاب', 'فاکتور', 'جمع فاکتورها', 'درصد', 'پورسانت', 'پرداخت‌شده', 'مانده', 'وضعیت']} rows={stmts.map(({ m, s }) => [m.name, fmt(s.count), fmt(Math.round(s.totalBase)), s.count ? `${s.rate}٪` : '—', fmt(s.commission), fmt(s.paid), fmt(Math.round(s.balance)), s.state])} foot={['جمع', '', fmt(Math.round(tot.base)), '', fmt(tot.comm), fmt(tot.paid), fmt(Math.round(tot.bal)), '']} />{stmts.filter(({ s }) => s.rows.length > 0).map(({ m, s }) => <div key={m.id} style={{ marginTop: 10 }}><div style={{ fontWeight: 800, fontSize: 11, marginBottom: 3 }}>فاکتورهای {m.name}</div><PrintTable head={['سفارش', 'تاریخ', 'مشتری', 'مبلغ فاکتور', 'پورسانت', 'پرداخت‌شده', 'وضعیت']} rows={s.rows.map(r => [r.order.orderNumber, faDate(r.order.date), r.order.customerName, fmt(Math.round(r.base)), fmt(r.commission), fmt(r.paid), r.status])} /></div>)}</>}</PrintReportButton>
      </div>
      <div style={{ fontSize: 11, color: COLORS.sub, lineHeight: 1.9 }}>فاکتورها از سفارش‌های تاییدشده‌ی مشتریانِ هر بازاریاب (مبلغ بعد از تخفیف و قبل از مالیات) حساب می‌شوند. پرداخت‌ها به ترتیب، از قدیمی‌ترین فاکتور کم می‌شوند.</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: COLORS.primary, color: '#fff' }}>{['بازاریاب', 'فاکتور', 'جمع فاکتورها', 'درصد', 'پورسانت', 'پرداخت‌شده', 'مانده', 'وضعیت', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {stmts.map(({ m, s }, idx) => {
              const [bg, fg] = stateStyle(s.state); const isOpen = open === m.id;
              return (
                <Fragment key={m.id}>
                  <tr style={{ background: idx % 2 ? COLORS.altRow : '#fff' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700 }}>{m.name} <span style={{ color: COLORS.sub, fontWeight: 400 }}>({m.entityType})</span></td>
                    <td style={{ padding: '8px 10px' }}>{fmt(s.count)}</td>
                    <td style={{ padding: '8px 10px' }}>{fmt(Math.round(s.totalBase))}</td>
                    <td style={{ padding: '8px 10px' }}>{s.count ? `${s.rate}٪` : '—'}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 700 }}>{fmt(s.commission)}</td>
                    <td style={{ padding: '8px 10px' }}>{fmt(s.paid)}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 800, color: s.balance > 0 ? COLORS.danger : COLORS.text }}>{fmt(Math.round(s.balance))}</td>
                    <td style={{ padding: '8px 10px' }}><Badge text={s.state} bg={bg} fg={fg} /></td>
                    <td style={{ padding: '8px 10px' }}><GhostButton onClick={() => { setOpen(isOpen ? '' : m.id); setErr(''); }} style={{ padding: '4px 10px', fontSize: 12 }}>{isOpen ? 'بستن' : 'فاکتورها و پرداخت'}</GhostButton></td>
                  </tr>
                  {isOpen && (
                    <tr><td colSpan={9} style={{ padding: 10, background: COLORS.warnBg }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead><tr style={{ background: COLORS.primaryDark, color: '#fff' }}>{['سفارش', 'تاریخ', 'مشتری', 'مبلغ فاکتور', 'پورسانت', 'پرداخت‌شده', 'وضعیت'].map(h => <th key={h} style={{ ...th, padding: '6px 8px' }}>{h}</th>)}</tr></thead>
                          <tbody>
                            {s.rows.map(r => { const [b2, f2] = invStyle(r.status); return (
                              <tr key={r.order.id} style={{ background: '#fff' }}>
                                <td style={{ padding: '6px 8px', fontWeight: 700 }}>{r.order.orderNumber}</td><td style={{ padding: '6px 8px' }}>{faDate(r.order.date)}</td><td style={{ padding: '6px 8px' }}>{r.order.customerName}</td>
                                <td style={{ padding: '6px 8px' }}>{fmt(Math.round(r.base))}</td><td style={{ padding: '6px 8px' }}>{fmt(r.commission)}</td><td style={{ padding: '6px 8px' }}>{fmt(r.paid)}</td>
                                <td style={{ padding: '6px 8px' }}><Badge text={r.status} bg={b2} fg={f2} /></td>
                              </tr>); })}
                            {s.rows.length === 0 && <tr><td colSpan={7} style={{ padding: 12, textAlign: 'center', color: COLORS.sub, background: '#fff' }}>فاکتوری در این بازه نیست.</td></tr>}
                          </tbody>
                        </table>
                        {s.payments.length > 0 && (
                          <div style={{ fontSize: 12 }}>
                            <div style={{ fontWeight: 800, marginBottom: 4 }}>پرداخت‌های انجام‌شده</div>
                            {s.payments.map(p => <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span>{faDate(p.date)}</span><strong>{fmt(p.amount)}</strong><span style={{ color: COLORS.sub }}>{p.note}</span><IconButton icon={Trash2} danger title="حذف پرداخت" onClick={() => { if (confirm('این پرداخت حذف شود؟')) onDeletePayment(p.id); }} /></div>)}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <Field label="تاریخ پرداخت"><JalaliDateInput value={pay.date} onChange={v => setPay({ ...pay, date: v })} /></Field>
                          <Field label="مبلغ پرداختی (ریال)"><NumInput value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} style={{ width: 170 }} /></Field>
                          <Field label="توضیح"><TextInput value={pay.note} onChange={e => setPay({ ...pay, note: e.target.value })} style={{ width: 200 }} /></Field>
                          <PrimaryButton icon={Plus} onClick={() => addPay(m)}>ثبت پرداخت پورسانت</PrimaryButton>
                        </div>
                        {err && <div style={{ color: COLORS.danger, fontSize: 12, fontWeight: 700 }}>{err}</div>}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot><tr style={{ background: COLORS.accentLight, fontWeight: 800 }}><td style={{ padding: 8 }}>جمع</td><td /><td style={{ padding: 8 }}>{fmt(Math.round(tot.base))}</td><td /><td style={{ padding: 8 }}>{fmt(tot.comm)}</td><td style={{ padding: 8 }}>{fmt(tot.paid)}</td><td style={{ padding: 8, color: tot.bal > 0 ? COLORS.danger : COLORS.text }}>{fmt(Math.round(tot.bal))}</td><td colSpan={2} /></tr></tfoot>
        </table>
      </div>
    </div>
  );
}

function orderTitleSummary(order) {
  const items = order.items || [];
  if (items.length === 0) return '—';
  const first = items[0].productName || 'بدون‌نام';
  return items.length > 1 ? `${first} + ${items.length - 1} قلم دیگر` : first;
}

function OrdersTable({ orders, onOpen, showMoney }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: COLORS.primary, color: '#fff' }}>
            {['', 'شماره', 'مشتری', 'اقلام سفارش', 'تحویل', 'وضعیت', ...(showMoney ? ['مبلغ کل', 'مانده'] : []), ''].map(h => (
              <th key={h} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((o, idx) => {
            const st = STATUS_STYLE[o.status] || { bg: '#eee', fg: '#333' };
            const u = urgency(o); const bal = orderBalance(o);
            return (
              <tr key={o.id} style={{ background: idx % 2 ? COLORS.altRow : '#fff' }}>
                <td style={{ padding: '8px 10px' }}><Dot color={u.color} title={u.label} /></td>
                <td style={{ padding: '8px 10px', fontWeight: 700 }}>{o.orderNumber || <span title="شماره هنگام تأیید مشتری صادر می‌شود" style={{ color: COLORS.sub, fontWeight: 400 }}>معلق</span>}</td>
                <td style={{ padding: '8px 10px' }}>{o.customerName}</td>
                <td style={{ padding: '8px 10px' }}>{orderTitleSummary(o)}</td>
                <td style={{ padding: '8px 10px' }}>{faDate(o.deliveryDate)}</td>
                <td style={{ padding: '8px 10px' }}><Badge text={o.status} bg={st.bg} fg={st.fg} />{o.onHold && <> <Badge text="معلق — تامین مواد" bg={COLORS.warnBg} fg={COLORS.warn} /></>}</td>
                {showMoney && <td style={{ padding: '8px 10px', fontWeight: 700 }}>{fmt(orderGrandTotal(o))}</td>}
                {showMoney && <td style={{ padding: '8px 10px', fontWeight: 700, color: bal > 0 ? COLORS.danger : COLORS.success }}>{fmt(bal)}</td>}
                <td style={{ padding: '8px 10px' }}><GhostButton icon={ArrowRight} onClick={() => onOpen(o)} style={{ padding: '5px 10px', fontSize: 12 }}>جزئیات</GhostButton></td>
              </tr>
            );
          })}
          {orders.length === 0 && <tr><td colSpan={showMoney ? 9 : 7} style={{ padding: 20, textAlign: 'center', color: COLORS.sub }}>سفارشی یافت نشد.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* generic print overlay — rendered in a portal so that printing outputs only this sheet (all pages),
   and triggered ONLY by the explicit button click */
function PrintOverlay(props) {
  useEffect(() => registerCloseBlocker(() => ({ title: 'پیش‌نمایش چاپ', dirty: false, close: props.onClose })), [props.onClose]);
  return <PrintPreview {...props} />;
}

function matLine(m) { return `${m.description || '—'} — ${m.qty || '—'} ${m.unitLabel || ''}${m.ownerName ? ` — ${m.ownerName}` : ''}`; }
function MatList({ label, list }) {
  const rows = (list || []).filter(m => m.inventoryItemId || m.description);
  if (!rows.length) return null;
  return (
    <div style={{ marginBottom: 4 }}>
      <strong>{label}:</strong>
      {rows.map(m => <div key={m.id} style={{ paddingInlineStart: 14 }}>• {matLine(m)}</div>)}
    </div>
  );
}

function addDaysIso(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

/* ---------- production form: mirrors the paper "فرم سفارش چاپ" (3 copies) ---------- */
function Chk({ on, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginInlineEnd: 12, whiteSpace: 'nowrap' }}>
      <span data-print-checked={on ? 'true' : undefined} style={{ display: 'inline-block', width: 10, height: 10, border: '1.3px solid #000', flexShrink: 0 }} />{children}
    </span>
  );
}
function FBox({ title, children, style, compact = false }) {
  return (
    <div style={{ border: '1.3px solid #000', borderRadius: 8, overflow: 'hidden', breakInside: 'avoid', pageBreakInside: 'avoid', ...(style || {}) }}>
      <div style={{ background: '#E6E6E6', textAlign: 'center', fontWeight: 800, fontSize: 12, padding: '3px 0', borderBottom: '1px solid #000' }}>{title}</div>
      <div style={{ padding: compact ? '3px 8px' : '6px 9px', fontSize: compact ? 10 : 10.5, lineHeight: compact ? 1.75 : 2.1 }}>{children}</div>
    </div>
  );
}
function Fld({ label, value, grow }) {
  return <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flex: grow ? 1 : 'none' }}><span style={{ whiteSpace: 'nowrap' }}>{label}:</span><span style={{ flex: 1, borderBottom: '1px dotted #555', minWidth: 60, padding: '0 6px', fontWeight: 700 }}>{value || '\u00A0'}</span></div>;
}

const BINDING_CHECKS = [
  { label: 'برش (سایز/تیراژ)', re: /برش/ },
  { label: 'تاکنی (نوع فرم/سایز/تیراژ)', re: /تاکنی/ },
  { label: 'ترتیب (تعداد فرم/سایز/تیراژ)', re: /ترتیب/ },
  { label: 'مفتولی یا منگنه (تعداد فرم/سایز/نوع/تیراژ)', re: /منگنه|مفتولی/ },
  { label: 'چسب گرم (تعداد فرم/سایز/نوع/تیراژ)', re: /شومیز|چسب/ },
  { label: 'جلدسازی: گالینگور / یوف / ترمو / چاپی', re: /گالینگور|جلد\s*سخت|یوف|ترمو/ },
  { label: 'فویل‌کوبی (رنگ فویل/سایز/تیراژ)', re: /طلاکوب|فویل/ },
  { label: 'کلیشه‌سازی (ابعاد/تعداد)', re: /کلیشه/ },
  { label: 'سرچسب (تعداد برگ/سایز/نوع/تعداد دسته)', re: /سرچسب/ },
  { label: 'سیمی / فنر (تعداد برگ/سایز/نوع/تیراژ)', re: /سیمی|فنر/ },
  { label: 'خط تا (فرم/سایز/تیراژ)', re: /خط\s*تا/ },
  { label: 'پرفراژ (فرم/سایز/تیراژ)', re: /پرفراژ/ },
  { label: 'شماره‌زنی (از ... تا ...)', re: /شماره/ },
];
function bindingText(it) {
  const t = it.bindingType === 'منگنه‌ای (مفتولی/سیمی)' ? 'مفتولی منگنه' : (it.bindingType || '');
  return `${t} ${it.bindingNotes || ''}`;
}
const FINISH_GROUPS = [
  { title: 'برش و قالب', rows: [
    { label: 'برش ساده (سایز/تیراژ)', re: /برش\s*ساده|^برش$/ },
    { label: 'قالب‌زنی (دایکات/لترپرس)', re: /قالب\s*زنی|دایکات|لترپرس(?!.*فویل)/ },
    { label: 'نیم‌تیغ (دایکات/لترپرس)', re: /نیم\s*تیغ/ },
    { label: 'خط تا (خط‌زن)', re: /خط\s*تا|خط\s*زن/ },
    { label: 'پوشال‌گیری', re: /پوشال/ },
  ] },
  { title: 'سلفون', rows: [
    { label: 'واتربیس (مات / براق)', re: /واتربیس|واتر/ },
    { label: 'حرارتی (مات / براق)', re: /حرارتی|سلفون/ },
  ] },
  { title: 'یووی', rows: [
    { label: 'کامل (مات / براق)', re: /یووی(?!.*موضعی)|uv/i, not: /موضعی/ },
    { label: 'موضعی (مات / براق)', re: /موضعی/ },
    { label: 'کلیشه یووی', re: /کلیشه.*یووی|یووی.*کلیشه/ },
    { label: 'شابلون', re: /شابلون/ },
  ] },
  { title: 'جعبه‌سازی', rows: [
    { label: 'جعبه‌سازی (تیراژ/سایز)', re: /جعبه/ },
    { label: 'برجسته', re: /برجسته/ },
  ] },
  { title: 'فویل‌کوب (لترپرس - بوبست)', rows: [
    { label: 'فویل‌کوبی (رنگ فویل/سایز/تیراژ)', re: /فویل|طلاکوب/ },
  ] },
];

/* ===================== چاپ: ورق A4 واحد با سربرگ، جای امضا و پاورقی ===================== */
function A4Sheet({ settings, title, subtitle, meta = [], signatures = [], children, footerExtra, logoOnly = false, subtitleGap = 0 }) {
  const co = settings.company;
  const small = { fontSize: 10.5, lineHeight: 1.9, color: '#222' };
  return (
    <div className="a4-sheet" style={{ width: '186mm', minHeight: '271mm', margin: '0 auto', display: 'flex', flexDirection: 'column', background: '#fff', color: '#000', direction: 'rtl', fontSize: 11 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10, borderBottom: `2.5px solid ${COLORS.primary}`, paddingBottom: 4, marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifySelf: 'start' }}>
          <img src={co.logo || logoUrl} alt="" style={{ maxHeight: 46, maxWidth: logoOnly ? 46 : 90, objectFit: 'contain' }} />
          {!logoOnly && <div style={{ fontWeight: 800, fontSize: 12.5, color: COLORS.primaryDark, lineHeight: 1.6 }}>{co.name}</div>}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: '#333', marginTop: subtitleGap }}>{subtitle}</div>}
        </div>
        <div style={{ ...small, justifySelf: 'end', textAlign: 'left' }}>
          {meta.map(([k, v]) => v ? <div key={k}>{k}: <strong>{v}</strong></div> : null)}
        </div>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
      {signatures.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(signatures.length, 5)}, 1fr)`, gap: 8, marginTop: 8, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          {signatures.map(s => (
            <div key={s} style={{ border: '1px solid #000', borderRadius: 6, height: 46, padding: '2px 6px', fontSize: 10.5, fontWeight: 700, textAlign: 'center' }}>{s}<div style={{ fontWeight: 400, fontSize: 9, color: '#666', marginTop: 2 }}>نام و امضاء</div></div>
          ))}
        </div>
      )}
      {footerExtra}
      <div style={{ borderTop: `1.5px solid ${COLORS.primary}`, marginTop: 6, paddingTop: 3, ...small, fontSize: 9.5, lineHeight: 1.7, textAlign: 'center' }}>
        {co.address ? `نشانی: ${co.address}` : ''}{co.postalCode ? ` — کدپستی: ${co.postalCode}` : ''}
        {(co.phone || co.mobile) && <div>{co.phone ? <>تلفن: <bdi>{co.phone}</bdi></> : null}{co.mobile ? <>{co.phone ? ' — ' : ''}همراه: <bdi>{co.mobile}</bdi></> : null}{co.website ? <> — <bdi>{co.website}</bdi></> : null}</div>}
        {co.footer && <div>{co.footer}</div>}
      </div>
    </div>
  );
}
function ReportPrint({ settings, title, subtitle, meta, signatures, children, onClose, toolbar }) {
  return (
    <PrintOverlay onClose={onClose} toolbar={toolbar} pdfName={`${title || 'گزارش'}`}>
      <A4Sheet settings={settings} title={title} subtitle={subtitle} meta={[['تاریخ گزارش', faDate(todayIso())], ...(meta || [])]} signatures={signatures}>{children}</A4Sheet>
    </PrintOverlay>
  );
}
function PrintReportButton({ settings, title, subtitle, signatures, meta, label = 'چاپ A4', compact, children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact
        ? <button type="button" title={`چاپ ${title || 'گزارش این بخش'}`} aria-label={`چاپ ${title || 'گزارش این بخش'}`} onClick={() => setOpen(true)} style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.55)', color: '#fff', borderRadius: 6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: 3 }}><Printer size={12} /></button>
        : <GhostButton icon={Printer} onClick={() => setOpen(true)} style={{ padding: '4px 10px', fontSize: 12 }}>{label}</GhostButton>}
      {open && <ReportPrint settings={settings} title={title} subtitle={subtitle} meta={meta} signatures={signatures} onClose={() => setOpen(false)}>{typeof children === 'function' ? children() : children}</ReportPrint>}
    </>
  );
}
function PrintTable({ head, rows, widths, foot }) {
  const th = { border: '1px solid #000', padding: '3px 4px', fontSize: 10, background: '#E6E6E6', fontWeight: 800, textAlign: 'center' };
  const td = { border: '1px solid #000', padding: '3px 4px', fontSize: 10, textAlign: 'center', verticalAlign: 'top' };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>{head.map((h, i) => <th key={i} style={{ ...th, width: widths ? widths[i] : undefined }}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>{r.map((c, j) => <td key={j} style={td}>{c}</td>)}</tr>)}
        {rows.length === 0 && <tr><td colSpan={head.length} style={{ ...td, padding: 14, color: '#666' }}>موردی برای نمایش نیست.</td></tr>}</tbody>
      {foot && <tfoot><tr>{foot.map((c, j) => <td key={j} style={{ ...td, fontWeight: 800, background: '#F3F3F3' }}>{c}</td>)}</tr></tfoot>}
    </table>
  );
}

/* ---------- فرم سفارش چاپ (A4، سه نسخه): فقط بخش‌هایی که برای این سفارش لازم است ---------- */
function PrintSlip({ order, settings, customer, inventory, units, initialCopy, lockCopy, onClose }) {
  const [copy, setCopy] = useState(lockCopy ? 1 : (initialCopy || 1));
  const prices = copy === 2;
  const items = order.items || [];
  const del = order.delivery || {};
  const mobile = order.mobile || (customer && customer.mobile) || '';
  const toolbar = lockCopy ? null : (
    <select value={copy} onChange={e => setCopy(Number(e.target.value))} style={{ ...inputStyle, width: 280 }}>
      <option value={1}>نسخه اول — سفارشات (بدون قیمت)</option>
      <option value={2}>نسخه دوم — حسابداری / مالی (با قیمت)</option>
      <option value={3}>نسخه سوم — بایگانی (بدون قیمت)</option>
    </select>
  );
  const nOf = (it) => (it.analysis && it.analysis.ok ? it.analysis.numbers : null);
  const allMats = (it) => [...(it.papers || []), ...(it.coverPapers || [])].filter(m => m.inventoryItemId || m.description);
  const zincSize = (it) => {
    const sizes = [...new Set((it.lithoMaterials || []).map(row => (inventory || []).find(entry => entry.id === row.inventoryItemId)?.size).filter(Boolean))];
    if (sizes.length) return sizes.join(' ، ');
    const n = nOf(it);
    if (n && n.zincSheet) return `${n.zincSheet.join('×')} سانتی‌متر — بر اساس ماشین ${n.zincPressName}${n.zincRegistered ? '' : '؛ زینک در انبار ثبت نشده'}`;
    return n && n.zincRegistered ? 'سایز این زینک در انبار ثبت نشده' : 'زینک در انبار ثبت نشده — سایز مشخص نیست';
  };
  const dimsOf = (it) => { const sp = it.spec || {}; return sp.sizeKey ? (sp.sizeKey === 'سفارشی' ? `${sp.w}×${sp.h}` : `${sp.sizeKey} (${lexicon.trimSizes[sp.sizeKey][0]}×${lexicon.trimSizes[sp.sizeKey][1]})`) : ''; };
  const machineName = (it) => { const id = (it.plan && it.plan.print && it.plan.print.machineId) || (it.spec && it.spec.machineId); const all = [...((units && units.offset && units.offset.items) || []), ...((units && units.digital && units.digital.items) || [])]; const m = all.find(x => x.id === id); return m ? m.name : (it.press || ''); };
  const partnerOf = (it, stepKey) => {
    const st = it.plan && it.plan[stepKey]; if (!st || st.mode !== OUTSOURCE) return null;
    const digital = (it.spec || {}).printMethod === 'دیجیتال';
    const unitKey = stepKey === 'print' ? (digital ? 'digital' : 'offset') : stepKey;
    return ((units && units[unitKey] && units[unitKey].outsource) || []).find(x => x.id === st.partnerId) || { name: 'پیمانکار مشخص نشده' };
  };
  const outLine = (p) => p ? ['برون‌سپاری', `${p.name}${p.phone ? ` — تلفن: ${p.phone}` : ''}${p.address ? ` — ${p.address}` : ''}`, true] : null;
  const R = (label, value, strong) => (value === '' || value === null || value === undefined || value === false ? null : [label, value, strong]);

  function sectionsFor(it) {
    const sp = it.spec || {}; const n = nOf(it); const digital = sp.printMethod === 'دیجیتال';
    const out = [];
    if (it.hasDesign || partnerOf(it, 'design')) out.push(['طراحی', [R('شرح', it.designDescription), outLine(partnerOf(it, 'design')), prices && Number(it.designPrice) > 0 ? R('هزینه (ریال)', fmt(Number(it.designPrice)), true) : null].filter(Boolean)]);
    const litho = partnerOf(it, 'litho');
    if (!digital && (n || litho)) {
      const rangeText = n && n.colorRanges ? n.colorRanges.filter(r => r.plates > 0).map(r => `${fmt(r.pages)} صفحه ${fmt(r.colors)} رنگ: ${fmt(r.plates)} زینک`).join(' + ') : '';
      const textPlates = n && n.textPlates ? `${fmt(n.textPlates)}${rangeText ? ` (${rangeText})` : (n.textColors ? ` (${fmt(n.textColors)} رنگ)` : '')}` : '';
      const coverPlates = n && n.coverPlates
        ? `${fmt(n.coverPlates)}${n.coverColors ? ` (${fmt(n.coverColors)} رنگ × ${Number(n.coverSides) === 2 ? 'دورو' : 'یک‌رو'})` : ''}`
        : (it.coverEnabled ? 'محاسبه نشد' : '');
      const formCount = n ? `${fmt(n.textFormsCharged)} فرم ${fmt(n.formPages)} صفحه‌ای${n.textFormsExact !== n.textFormsCharged ? ` (${fmt(n.textFormsExact)} فرم کامل و نیم‌فرم)` : ''}` : '';
      out.push(['لیتوگرافی', [R('تعداد فرم متن', formCount), R('سایز فرم (ورق ماشین)', n && (n.pressSheet || n.sheet) ? (n.pressSheet || n.sheet).join('×') : ''), R('سایز زینک', zincSize(it)),
        R('زینک متن', textPlates), R('زینک جلد', coverPlates), R('جمع زینک', n ? fmt(n.totalPlates) : '', true),
        ...((n && n.engine && n.engine.instructions && n.engine.instructions.length) ? n.engine.instructions.map(x => R('دستور فرم', x)) : [R('دستور فرم', n ? n.formDesc : it.formDesc)]), outLine(litho)].filter(Boolean)]);
    }
    const mats = allMats(it);
    if (mats.length) out.push(['کاغذ و مقوا', mats.map(m => {
      const inv = (inventory || []).find(entry => entry.id === m.inventoryItemId);
      const perBand = inv && inv.unitMode === 'band_sheet' ? Number(inv.sheetsPerBand) || 0 : 0;
      const bands = perBand ? ` — معادل ${fmt(Number((Number(m.qty) / perBand).toFixed(2)))} بند (هر بند ${fmt(perBand)} ورق)` : '';
      return [m.description || 'کالای انبار', `${fmt(m.qty)} ${m.unitLabel || ''}${bands} — ${m.owner === 'مشتری' ? `ارسالی از مشتری${m.ownerName ? ` (${m.ownerName})` : ''}` : 'مصرفی از انبار چاپخانه'}`];
    })]);
    const pp = partnerOf(it, 'print');
    const colors = (c, s) => `${colorLabel(c) || ''}${s ? ` — ${Number(s) === 2 ? 'دورو' : 'یک‌رو'}` : ''}`;
    const textDesc = n && n.colorRanges && n.colorRanges.length > 1
      ? `${n.colorRanges.map(r => `${fmt(r.pages)} صفحه ${fmt(r.colors)} رنگ`).join(' + ')} — ${Number(sp.textSides) === 2 ? 'دورو' : 'یک‌رو'} — ${fmt(n.textFormsCharged)} فرم`
      : colors(sp.textColors, sp.textSides) + (n ? ` — ${fmt(n.textFormsCharged)} فرم` : '');
    const tr = n ? { net: n.qty, waste: n.runWaste, total: n.runQty } : textRun(it.qty, it.waste);
    const cr = it.coverEnabled
      ? (n && n.coverSheetsTotal
        ? { press: n.coverPressName || it.press || '2 ورقی', coversPerSheet: n.coverFit, waste: n.coverWasteSheets, sheets: n.coverSheetsTotal, net: n.coverSheetsNet, sheetSize: n.coverSheet ? n.coverSheet.join('×') : '', machineSheets: n.coverMachineSheets, zincSheet: n.coverZincSheet, perZinc: n.coverPerZinc }
        : { ...coverRun(it.qty, it.coverPress), net: coverRun(it.qty, it.coverPress).sheetsNet })
      : null;
    const pressSize = n && (n.pressSheet || n.sheet) ? (n.pressSheet || n.sheet).join('×') : '';
    const planText = n && n.pressPlan && n.pressPlan.length
      ? n.pressPlan.map(p => `${p.forms > 1 ? `${fmt(p.forms)} فرم ${fmt(p.pages)} صفحه‌ای پشت‌ورو` : `۱ فرم ${fmt(p.pages)} صفحه‌ای روی خودش دورو`} — ${fmt(p.sheets)} ورق ${pressSize}`).join(' + ')
      : '';
    const engLines = n && n.engine && n.engine.instructions ? n.engine.instructions.filter(Boolean) : [];
    out.push(['چاپ', [R('روش', digital ? 'دیجیتال' : 'افست'), pp ? null : R('ماشین', machineName(it)),
      R('تیراژ متن (خالص)', `${fmt(tr.net)} ${it.qtyUnit || ''}`), R('باطله متن', `${fmt(tr.waste)} ${it.qtyUnit || ''}`), R('تیراژ چاپ', `${fmt(tr.total)} ${it.qtyUnit || ''}`, true),
      R('متن', textDesc),
      ...(engLines.length ? engLines.map((line, i) => R(i === 0 ? 'دستور چاپ' : '', line)) : [R('دستور چاپ', planText)]), R('ورق ماشین متن', n && n.pressSheets ? `${fmt(n.pressSheets)} ورق ${pressSize}` : ''),
      cr ? R('چاپ جلد', n && n.coverRunLabel ? n.coverRunLabel : `${colors(sp.coverColors, sp.coverSides)}${cr.press ? ` — ${cr.press}` : ''} — ${fmt(cr.coversPerSheet)} جلد در هر ورق`) : null,
      n && n.engine && n.engine.geometry ? R('عطف و جلد باز', (() => { const g = n.engine.geometry; return `عطف ${fmt(g.spineMm)} میلی‌متر — جلد باز ${fmt(g.openWidthCm)}×${fmt(g.openHeightCm)} سانتی‌متر`; })()) : null,
      cr ? R('تیراژ جلد', cr.machineSheets && cr.zincSheet
        ? `${fmt(cr.machineSheets)} ورق ${cr.zincSheet.join('×')} — از ${fmt(cr.sheets)} ورق ${cr.sheetSize} جلد (${fmt(cr.net)} خالص + ${fmt(cr.waste)} باطله)`
        : `${fmt(cr.net)} ورق خالص + ${fmt(cr.waste)} باطله = ${fmt(cr.sheets)} ورق`, true) : null,
      outLine(pp)].filter(Boolean)]);
    const bp = partnerOf(it, 'binding');
    const svc = (it.services || []);
    const bindRows = [];
    if (it.bindingType && it.bindingType !== 'بدون صحافی') bindRows.push(R('صحافی', it.bindingType + (it.bindingNotes ? ` — ${it.bindingNotes}` : ''), true));
    if ((it.finishingSteps || []).length) bindRows.push(R('مراحل تکمیلی', it.finishingSteps.join('، ')));
    if (n && n.bindingForms) bindRows.push(R('فرم صحافی', `${fmt(n.bindingFormText)} فرم متن + ${fmt(n.bindingFormCover)} فرم جلد = ${fmt(n.bindingForms)} فرم${n.bindingFormsCharged > n.bindingForms ? `؛ طبق «${n.bindingRule}»، ${fmt(n.bindingFormsCharged)} فرم محاسبه می‌شود` : ''}`, true));
    if (n && n.bindingFormsCharged) bindRows.push(R('تیراژ صحافی', `${fmt(n.runQty)} ${it.qtyUnit || 'نسخه'} × ${fmt(n.bindingFormsCharged)} فرم`));
    if (sp.cellophane) bindRows.push(R('سلفون', `${celloLabel(sp)}${it.coverEnabled ? ' (روی جلد)' : ''}`));
    svc.forEach(s => bindRows.push([s.serviceType, `${s.notes || ''}${prices && Number(s.price) > 0 ? ` — ${fmt(Number(s.price))} ریال` : ''}` || '✓']));
    if (bp) bindRows.push(outLine(bp));
    if (bindRows.length) out.push(['صحافی و خدمات تکمیلی', bindRows.filter(Boolean)]);
    return out.filter(([, rows]) => rows.length);
  }
  const Card = ({ title, rows }) => (
    <div style={{ border: '1.2px solid #000', borderRadius: 6, overflow: 'hidden', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
      <div style={{ background: '#E6E6E6', textAlign: 'center', fontWeight: 800, fontSize: 11, padding: '2px 0', borderBottom: '1px solid #000' }}>{title}</div>
      <div style={{ padding: '2px 7px', fontSize: 10, lineHeight: 1.7 }}>
        {rows.map(([label, value, strong], i) => <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', borderBottom: i < rows.length - 1 ? '1px dotted #bbb' : 'none', color: label === 'برون‌سپاری' ? '#8A1C1C' : '#000' }}><span style={{ flex: '0 1 auto', maxWidth: '45%', fontWeight: 700, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{label}:</span><span style={{ flex: '1 1 0', minWidth: 0, fontWeight: strong ? 800 : 400, textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</span></div>)}
      </div>
    </div>
  );
  const th = { border: '1px solid #000', padding: '3px 4px', fontSize: 10, background: '#E6E6E6', fontWeight: 800 };
  const td = { border: '1px solid #000', padding: '3px 4px', fontSize: 10, textAlign: 'center' };
  const custGoods = (inventory || []).filter(i => i.ownerType === 'مشتری' && order.customerId && i.ownerCustomerId === order.customerId && (i.purposeScope !== 'order' || !i.linkedOrderNumber || i.linkedOrderNumber === String(order.orderNumber)) && stockLevel(i) > 0);
  const warehouseMats = (() => {
    const grouped = new Map();
    for (const it of items) for (const m of allMats(it)) {
      if (m.owner === 'مشتری') continue;
      const key = `${m.inventoryItemId || m.description}|${m.unitLabel || ''}`;
      const previous = grouped.get(key);
      grouped.set(key, { label: m.description || 'کالای انبار', unit: m.unitLabel || '', qty: (previous?.qty || 0) + (Number(m.qty) || 0) });
    }
    return [...grouped.values()];
  })();
  const sending = del.method === 'ارسال به نشانی مشتری';
  const addr = (del.address || '').trim();
  const anyLitho = items.some(it => (it.spec || {}).printMethod !== 'دیجیتال' && !partnerOf(it, 'litho') && nOf(it));
  const sigs = ['مسئول سفارشات', ...(anyLitho ? ['مسئول لیتوگرافی'] : []), 'مسئول چاپ و صحافی', 'مسئول فنی', 'تایید مالی / تحویل‌گیرنده'];
  const copyName = ['', 'نسخه اول: سفارشات', 'نسخه دوم: حسابداری / مالی', 'نسخه سوم: بایگانی'][copy];
  const deliveryNote = sending
    ? `کار پس از آماده‌سازی${addr ? ` به نشانی «${addr}»` : ''} ارسال می‌شود؛${addr ? '' : ' نشانی ثبت نشده و باید پیش از ارسال با مشتری هماهنگ شود؛'}${del.receiver ? ` تحویل‌گیرنده: ${del.receiver}؛` : ''} هزینه حمل ${Number(order.shippingCost) > 0 ? `${fmt(order.shippingCost)} ریال` : 'در سفارش ثبت نشده است'} و پرداخت آن طبق توافق سفارش است.`
    : `کار پس از آماده‌سازی در چاپخانه و در تاریخ ${faDate(order.deliveryDate)} تحویل می‌شود؛${del.receiver ? ` تحویل‌گیرنده: ${del.receiver}؛` : ''} دریافت کار با امضای رسید انجام می‌شود.`;
  const blockTitle = { fontWeight: 800, borderBottom: '1px solid #000', marginBottom: 3 };
  const headMeta = [['شماره سفارش', `${order.orderNumber || 'معلق (پس از تأیید مشتری)'}${(order.quoteRev || 1) > 1 ? ` (نسخه ${order.quoteRev})` : ''}`], ['تاریخ', faDate(order.date)], ['تحویل', faDate(order.deliveryDate)]];
  const financeRows = invoiceRows(order, true);
  const financeBasis = hasQuotePricing(order)
    ? `مبالغ این برگه از قیمت‌گذاری ثبت‌شدهٔ سفارش (نسخهٔ ${order.quoteRev || 1}) گرفته شده است؛ تخفیف پیش از مالیات اعمال می‌شود و همهٔ مبالغ به ریال است.`
    : order.pricing
      ? 'قیمت‌گذاری ذخیره‌شدهٔ این سفارش معتبر نیست؛ مبالغ زیر از قیمت واحد اقلام محاسبه شده و مبنای تسویه نیست.'
      : 'این سفارش قیمت‌گذاری ثبت‌شده (پیش‌فاکتور ماشینی) ندارد؛ مبالغ زیر از قیمت واحد اقلام و خدمات ثبت‌شده محاسبه شده است.';
  const customerBox = (
    <FBox title="اطلاعات مشتری" style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', gap: 12 }}><Fld grow label="نام مشتری / شرکت" value={order.customerName} /><Fld grow label="عنوان سفارش" value={order.title} />{order.marketerCode ? <Fld label="بازاریاب" value={order.marketerCode} /> : null}</div>
      <div style={{ display: 'flex', gap: 12 }}><Fld grow label="نشانی" value={customer && customer.address} /><Fld label="تلفن" value={order.phone ? <bdi>{order.phone}</bdi> : ''} />{mobile ? <Fld label="همراه" value={<bdi>{mobile}</bdi>} /> : null}</div>
    </FBox>
  );
  const specsBox = (
    <FBox title="مشخصات سفارش" style={{ marginBottom: 4 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{[['ردیف', '4%'], ['عنوان سفارش', '28%'], ['تیراژ', '10%'], ['ابعاد (cm)', '9%'], ['صفحات', '7%'], ['نوع چاپ', '12%'], ['نوع کاغذ / مقوا / گرماژ', '30%']].map(([h, width]) => <th key={h} style={{ ...th, width, ...(h === 'ردیف' ? { writingMode: 'vertical-rl', padding: '2px 3px' } : null) }}>{h}</th>)}</tr></thead>
        <tbody>
          {items.map((it, i) => { const sp = it.spec || {}; const digital = sp.printMethod === 'دیجیتال'; return (
            <tr key={it.id}>
              <td style={td}>{i + 1}</td><td style={td}>{`${it.productName || ''}${it.productType ? ` (${it.productType})` : ''}`}</td>
              <td style={td}>{fmt(it.qty)} {it.qtyUnit}</td><td style={td}>{dimsOf(it)}</td><td style={td}>{sp.pages ? fmt(sp.pages) : ''}</td>
              <td style={td}><Chk on={!digital}>افست</Chk><Chk on={digital}>دیجیتال</Chk></td>
              <td style={td}>{allMats(it).map(m => m.description).join(' ، ')}</td>
            </tr>); })}
        </tbody>
      </table>
    </FBox>
  );
  const productionBox = (
    <div style={{ border: '1.3px solid #000', borderRadius: 7, marginBottom: 4 }}>
      <div style={{ background: '#CFCFCF', textAlign: 'center', fontWeight: 800, fontSize: 12, padding: '2px 0', borderBottom: '1px solid #000' }}>شرح تولید</div>
      <div style={{ padding: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((it, i) => (
          <div key={it.id}>
            {items.length > 1 && <div style={{ fontWeight: 800, fontSize: 11, marginBottom: 3 }}>قلم {i + 1}: {it.productName || it.productType} — {fmt(it.qty)} {it.qtyUnit}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {sectionsFor(it).map(([t, rows]) => <Card key={t} title={t} rows={rows} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  const warehouseBody = (
    <>
      <div style={{ fontSize: 9, marginBottom: 3 }}>مصرف از انبار چاپخانه که باید برای این سفارش صادر شود:</div>
      {warehouseMats.length === 0 && <div>ماده‌ای از انبار چاپخانه برای این سفارش ثبت نشده است.</div>}
      {warehouseMats.map((m, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, borderBottom: '1px dotted #888' }}><span>{m.label}</span><strong style={{ whiteSpace: 'nowrap' }}>{fmt(m.qty)} {m.unit}</strong></div>)}
    </>
  );
  const deliveryBody = (
    <>
      <div style={{ marginBottom: 3 }}>{sending ? 'ارسال به نشانی مشتری' : 'تحویل حضوری در چاپخانه'}{del.receiver ? ` — تحویل‌گیرنده: ${del.receiver}` : ''}{del.phone ? <> — تلفن: <bdi>{del.phone}</bdi></> : null}</div>
      {sending && <div style={{ marginBottom: 3 }}>نشانی: <strong>{addr || 'ثبت نشده'}</strong></div>}
      <div style={{ fontSize: 9, fontWeight: 700, lineHeight: 1.7 }}>{deliveryNote}</div>
    </>
  );
  const bottomBox = (
    <FBox title="انبار، مالی و تحویل" style={{ marginBottom: 4 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.3fr 1fr', gap: 10, alignItems: 'start' }}>
        <div>
          <div style={blockTitle}>انبار</div>
          {warehouseBody}
        </div>
        <div>
          <div style={blockTitle}>مالی</div>
          <div>اطلاعات مالی در نسخه دوم (حسابداری / مالی) درج می‌شود.</div>
        </div>
        <div>
          <div style={blockTitle}>تحویل</div>
          {deliveryBody}
        </div>
      </div>
    </FBox>
  );
  const payableRows = [
    ['جمع ردیف‌ها (پیش از تخفیف و مالیات)', orderGrandTotal(order)],
    ...(orderDiscount(order) > 0 ? [['تخفیف (کسر می‌شود)', orderDiscount(order)]] : []),
    ...(orderTax(order) > 0 ? [['مالیات ارزش افزوده', orderTax(order)]] : []),
    ['مبلغ قابل پرداخت', orderPayable(order)],
    ...(orderPaid(order) > 0 ? [['پرداخت‌شده', orderPaid(order)], ['مانده', orderPayable(order) - orderPaid(order)]] : []),
  ];
  const financeBox = (
    <FBox title="ریز هزینه‌ها و جمع‌بندی مالی" compact style={{ marginBottom: 4 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={{ ...th, width: '7%' }}>ردیف</th><th style={th}>شرح</th><th style={{ ...th, width: '11%' }}>مقدار</th><th style={{ ...th, width: '18%' }}>مبلغ واحد (ریال)</th><th style={{ ...th, width: '19%' }}>جمع (ریال)</th></tr></thead>
        <tbody>
          {financeRows.map((r, i) => (
            <tr key={r.key}>
              <td style={td}>{i + 1}</td>
              <td style={{ ...td, textAlign: 'right' }}>
                <div style={{ fontWeight: r.sub ? 400 : 700 }}>{r.desc}</div>
                {r.spec && <div style={{ fontSize: 9, color: '#444' }}>{r.spec}</div>}
              </td>
              <td style={td}>{r.qty}</td>
              <td style={td}>{r.price}</td>
              <td style={{ ...td, fontWeight: 700 }}>{fmt(r.total)}</td>
            </tr>
          ))}
          {financeRows.length === 0 && <tr><td colSpan={5} style={{ ...td, padding: 10 }}>ردیف قیمت‌گذاری برای این سفارش ثبت نشده است.</td></tr>}
        </tbody>
      </table>
      <div style={{ marginTop: 4 }}>
        {payableRows.map(([label, value], i) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderBottom: i < payableRows.length - 1 ? '1px dotted #999' : 'none', fontWeight: label === 'مبلغ قابل پرداخت' || label === 'مانده' ? 800 : 400 }}>
            <span>{label}</span><span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmt(value)}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 4, paddingTop: 3, borderTop: '1px dashed #777', fontSize: 9, fontWeight: 700, lineHeight: 1.8 }}>{financeBasis}</div>
    </FBox>
  );
  const customerGoodsBox = custGoods.length > 0 && <FBox title="کالای مشتری نزد چاپخانه" compact style={{ marginTop: 4 }}>
    {custGoods.map(c => <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, borderBottom: '1px dotted #888' }}><span>{c.name}{c.gramaj ? ` ${c.gramaj}g` : ''}{c.size ? ` ${c.size}` : ''}</span><strong style={{ whiteSpace: 'nowrap' }}>{fmt(stockLevel(c))} {stockUnitLabel(c)}</strong></div>)}
    <div style={{ fontSize: 9, fontWeight: 700, marginTop: 3, lineHeight: 1.7 }}>تا یک ماه کالای فوق به صورت امانت نزد چاپخانه خواهد بود؛ پس از آن چاپخانه هیچ مسئولیتی نسبت به آن ندارد. لطفاً نسبت به تعیین تکلیف کالا و صورت‌حساب اقدام نمایید.</div>
  </FBox>;
  return (
    <PrintOverlay onClose={onClose} toolbar={toolbar} pdfName={`فرم-سفارش-${order.orderNumber || 'بدون-شماره'}-نسخه-${copy || 1}`}>
      {prices ? (
        <A4Sheet settings={settings} title="فرم سفارش چاپ" subtitle="نسخه دوم: حسابداری / مالی" meta={headMeta} signatures={sigs} logoOnly subtitleGap="2.5mm">
          {customerBox}
          {specsBox}
          {financeBox}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, alignItems: 'start' }}>
            <FBox title="انبار چاپخانه" compact>{warehouseBody}</FBox>
            <FBox title="تحویل" compact>{deliveryBody}</FBox>
          </div>
          {customerGoodsBox}
        </A4Sheet>
      ) : (
        <A4Sheet settings={settings} title="فرم سفارش چاپ" subtitle={copyName} meta={headMeta} signatures={sigs} logoOnly subtitleGap="2.5mm">
          {customerBox}
          {specsBox}
          {productionBox}
          {bottomBox}
        </A4Sheet>
      )}
    </PrintOverlay>
  );
}

const ARCHIVE_REASONS = ['قیمت بالا بود', 'منصرف شد', 'فعلاً زمان ندارد (بعداً پیگیری شود)', 'پاسخی نداد', 'نزد رقیب سفارش داد', 'سایر'];

function CompleteStageButton({ order, item, onComplete, compact }) {
  const list = stagesFor(item);
  const stage = item.stage || START_STAGE;
  const next = list[list.indexOf(stage) + 1] || '';
  const delivery = isDeliveryStage(stage);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run() {
    if (busy) return;
    const question = delivery
      ? `تحویل سفارش ${order.orderNumber} به مشتری ثبت شود؟ پس از این، هیچ تغییری در این سفارش مجاز نیست.`
      : `مرحلهٔ «${stage}» (${pathLabelOf(item)}) پایان یابد و کار به «${next}» ارسال شود؟ پس از این، انجام کار در مرحلهٔ «${stage}» مجاز نیست.`;
    if (typeof window !== 'undefined' && !window.confirm(question)) return;
    setBusy(true); setError('');
    try {
      const result = await onComplete(order, item, stage, note.trim());
      if (!result || !result.ok) setError((result && result.error) || 'ثبت انجام نشد.');
      else setNote('');
    } catch (_) { setError('ثبت انجام نشد؛ وضعیت قبلی حفظ شد.'); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: compact ? 4 : 6 }}>
      <input value={note} onChange={e => setNote(e.target.value)} maxLength={2000} aria-label={delivery ? 'نام تحویل‌گیرنده یا شرح تحویل' : 'توضیح پایان مرحله'}
        placeholder={delivery ? 'نام تحویل‌گیرنده / شرح تحویل (اختیاری)' : 'توضیح پایان مرحله (اختیاری)'}
        style={{ ...inputStyle, padding: compact ? '3px 6px' : '5px 8px', fontSize: compact ? 10.5 : 12 }} />
      <PrimaryButton icon={Check} disabled={busy} onClick={run} style={compact ? { justifyContent: 'center', padding: '4px 6px', fontSize: 11 } : undefined}>{busy ? 'در حال ثبت…' : delivery ? 'ثبت تحویل به مشتری' : 'اتمام و تایید نهایی'}</PrimaryButton>
      {error && <div role="alert" style={{ color: COLORS.danger, fontSize: compact ? 10.5 : 12, lineHeight: 1.6 }}>{error}</div>}
    </div>
  );
}

function OrderDetail({ order, role, perms, units, onEdit, onDelete, onChangeStage, onCompleteStage, onRecordCounts, onPrint, onApprove, onArchive, onReopen, onChangeStatus, onReleaseHold, onConvertRequest, readOnly }) {
  const st = STATUS_STYLE[order.status] || { bg: '#eee', fg: '#333' };
  const isRequest = order.status === REQUEST_STATUS;
  const pending = order.status === 'در انتظار تایید';
  const archived = order.status === 'بایگانی';
  const canProduce = !pending && !archived && !isRequest && !['متوقف', 'لغو شده', 'تحویل شده'].includes(order.status) && !!order.workflow?.productionAuthorization;
  const frozenLabel = isRequest ? 'درخواست مشتری' : archived ? 'بایگانی' : ['تحویل شده', 'لغو شده', 'متوقف'].includes(order.status) ? order.status : 'متوقف';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
          <div><strong>تاریخ سفارش:</strong> {faDate(order.date)}</div>
          <div><strong>تاریخ تحویل:</strong> {faDate(order.deliveryDate)}</div>
          <div><strong>تماس:</strong> {order.phone || '—'}</div>
          {(order.quoteRev || 1) > 1 && <div><strong>نسخه پیش‌فاکتور:</strong> {order.quoteRev}</div>}
        </div>
        <Badge text={order.status} bg={st.bg} fg={st.fg} />
      </div>
      {readOnly && (
        <div style={{ background: COLORS.accentLight, border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 10, fontSize: 12, lineHeight: 1.9, color: COLORS.primaryDark }}>
          <strong>نمای تابلوی تولید — فقط نمایش.</strong> تغییر مرحله و اتمام کار از این نما انجام نمی‌شود؛ برای ثبت پایان مرحله به میز کار بخش خود (فرم‌های سفارش) بروید.
        </div>
      )}
      {order.status === 'تحویل شده' && (
        <div style={{ background: '#EFEFEB', border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 10, fontSize: 12, lineHeight: 1.9 }}>
          <strong>این سفارش تحویل شده است.</strong> کار جدید، تغییر مرحله یا ویرایش در آن مجاز نیست؛ فرم فقط برای مشاهده و چاپ در دسترس است.
        </div>
      )}
      {isRequest && (
        <div style={{ background: '#FFF4F2', border: `1.5px solid ${COLORS.danger}`, borderRadius: 10, padding: 10, lineHeight: 2, fontSize: 13 }}>
          <strong style={{ color: COLORS.danger }}>درخواست ثبت‌شده توسط مشتری:</strong>
          <div style={{ whiteSpace: 'pre-wrap' }}>{order.requestText || order.smartText}</div>
          <div style={{ fontSize: 12, color: COLORS.sub }}>تماس: {order.phone}</div>
          {perms.newOrder && <PrimaryButton icon={Sparkles} onClick={onConvertRequest} style={{ marginTop: 6 }}>تبدیل به سفارش (ثبت و محاسبه)</PrimaryButton>}
        </div>
      )}
      {order.title && !isRequest && <div style={{ fontSize: 13 }}><strong>عنوان:</strong> {order.title}</div>}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: COLORS.sub }}>
        <span>آورنده‌ی سفارش: <strong style={{ color: COLORS.text }}>{order.source === 'بازاریاب' ? `بازاریاب${order.marketerCode ? ` (${order.marketerCode})` : ''}` : 'مشتری'}</strong></span>
        {order.intent && <span>هدف ثبت: <strong style={{ color: COLORS.text }}>{order.intent === 'confirmed' ? 'سفارش قطعی' : 'پیش‌فاکتور'}</strong></span>}
        {order.procurement && order.procurement.decision && <span>تامین مواد: <strong style={{ color: COLORS.text }}>{order.procurement.decision === 'tomorrow' ? `تا ${faDate(order.procurement.date)}` : order.procurement.decision === 'after' ? 'بعد از تایید مشتری' : 'معلق تا تامین'}</strong></span>}
      </div>
      {order.onHold && (
        <div style={{ background: COLORS.warnBg, border: `1px solid ${COLORS.warn}`, borderRadius: 9, padding: 10, fontSize: 12, color: COLORS.warn, lineHeight: 1.9, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span><strong>سفارش معلق است:</strong> {order.holdReason || 'در انتظار تامین مواد اولیه'}. تا رفع تعلیق، تایید و شروع تولید ممکن نیست.</span>
          {perms.manageOrder && !readOnly && <GhostButton icon={Check} onClick={onReleaseHold}>مواد تامین شد — رفع تعلیق</GhostButton>}
        </div>
      )}

      {pending && (
        <div style={{ background: COLORS.warnBg, border: `1px solid ${COLORS.warn}`, borderRadius: 9, padding: 10, fontSize: 12, color: COLORS.warn, lineHeight: 1.9 }}>
          <strong>سفارش معلق است؛ تا تأیید مشتری شماره سفارش صادر نمی‌شود.</strong> پیش‌فاکتور وارد تولید نمی‌شود. تأیید مشتری را در بخش گردش سفارش ثبت کنید؛ با این ثبت، شماره سفارش صادر می‌شود و سپس مدیر چاپخانه با بررسی مواد و بدهی، جداگانه اجازهٔ شروع تولید می‌دهد. تا آن زمان می‌توانید این سفارش را حذف یا بایگانی کنید.
        </div>
      )}
      {archived && order.archive && (
        <div style={{ background: '#F3EEE6', border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 10, fontSize: 12, lineHeight: 1.9 }}>
          <strong>بایگانی‌شده در {faDate(order.archive.date)}</strong> — دلیل: {order.archive.reason}{order.archive.note ? ` (${order.archive.note})` : ''}
          {order.archive.followUp && <div>تاریخ پیگیری: <strong>{faDate(order.archive.followUp)}</strong></div>}
        </div>
      )}

      {(order.items || []).map((it, idx) => {
        const sp = it.spec || {};
        return (
          <div key={it.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 12, background: idx % 2 === 0 ? COLORS.altRow : '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
              <div style={{ fontWeight: 700, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Layers size={14} /> {it.productName || `قلم ${idx + 1}`} {it.productType ? `(${it.productType})` : ''}
                <span style={{ background: stagesFor(it) === LEGACY_PATH ? '#EDEDE8' : pathKeyOf(it) === 'digital' ? '#F3E0C8' : '#E7D9E2', color: stagesFor(it) === LEGACY_PATH ? '#5F5F58' : pathKeyOf(it) === 'digital' ? '#8A4A1C' : '#722444', borderRadius: 999, padding: '1px 9px', fontSize: 11, fontWeight: 800 }}>
                  {stagesFor(it) === LEGACY_PATH ? 'مسیر قدیمی' : `مسیر ${pathLabelOf(it)}`}
                </span>
              </div>
              {canProduce && perms.stage && !readOnly
                ? <Select options={stagesFor(it).slice(stagesFor(it).indexOf(it.stage || START_STAGE))} value={it.stage || START_STAGE} onChange={e => onChangeStage(it.id, e.target.value)} style={{ width: 190, padding: '4px 8px', fontSize: 12 }} />
                : <Badge text={canProduce ? (it.stage || START_STAGE) : (pending ? 'منتظر تایید' : frozenLabel)} bg={COLORS.accentLight} fg={COLORS.primaryDark} />}
            </div>
            {canProduce && !readOnly && onCompleteStage && canCompleteStage(role, it.stage || 'ثبت سفارش') && !isStageCompleted(it, it.stage || 'ثبت سفارش') && (
              <CompleteStageButton order={order} item={it} onComplete={onCompleteStage} />
            )}
            {/* اصلاحات ۱۷/بند ۳/۳: سه عددِ همین قلم در همان صفحه — «سالم» در کنترل کیفیت و
                ردیف‌های تحویل در تحویل؛ بی‌فرمِ تو در تو و بی‌عددِ ساخته‌شده در ایستگاه. */}
            {onRecordCounts && <ItemDeliveryCounts order={order} item={it} faDate={faDate}
              canRecordQuality={canProduce && !readOnly && canRecordQuality(role, it.stage || START_STAGE)}
              canRecordDelivery={canProduce && !readOnly && canRecordDelivery(role, it.stage || START_STAGE)} onAction={onRecordCounts} />}
            <div style={{ fontSize: 12, color: COLORS.text, lineHeight: 1.9 }}>
              شمارگان: {fmt(it.qty)} {it.qtyUnit} — رنگ {it.colorMode}{sp.sizeKey ? ` — قطع ${sp.sizeKey === 'سفارشی' ? `${sp.w}×${sp.h}` : sp.sizeKey}` : ''}{sp.pages ? ` — ${fmt(sp.pages)} صفحه` : ''}<br />
              کاغذ/مقوا: {(it.papers || []).filter(p => p.description).map(matLine).join(' | ') || '—'}<br />
              {it.hasDesign && <>طراحی: {it.designDescription || 'دارد'}<br /></>}
              لیتوگرافی: {it.press} — {it.formDesc || '—'}<br />
              {it.coverEnabled && <>جلد: {it.coverType}<br /></>}
              صحافی: {it.bindingType}{it.bindingNotes ? ` — ${it.bindingNotes}` : ''}<br />
              {(it.services || []).length > 0 && <>خدمات: {it.services.map(s => s.serviceType).join('، ')}<br /></>}
              {it.plan && (() => { const bits = PLAN_STEPS.map(stp => { const ps = it.plan[stp.key]; if (!ps) return null; if (ps.mode === OUTSOURCE) { const arr = stp.key === 'print' ? [...((units && units.offset && units.offset.outsource) || []), ...((units && units.digital && units.digital.outsource) || [])] : ((units && units[stp.key] && units[stp.key].outsource) || []); const pt = arr.find(x => x.id === ps.partnerId); return `${stp.label}: برون‌سپاری${pt ? ` (${pt.name})` : ''}`; } if (stp.key === 'print' && ps.machineId) { const arr = [...((units && units.offset && units.offset.items) || []), ...((units && units.digital && units.digital.items) || [])]; const m = arr.find(x => x.id === ps.machineId); return m ? `چاپ: ${m.name}` : null; } return null; }).filter(Boolean); return bits.length ? <>اجرا: {bits.join(' — ')}<br /></> : null; })()}
              {Object.keys(it.stageCompletions || {}).length > 0 && <span style={{ color: COLORS.sub }}>مراحل پایان‌یافته: {ALL_STAGES.filter(s => it.stageCompletions[s]).map(s => `${s} (${stageCompletionLabel(it.stageCompletions[s])})`).join(' | ')}</span>}
            </div>
          </div>
        );
      })}

      {(order.history || []).length > 0 && (
        <div style={{ fontSize: 12, color: COLORS.sub, lineHeight: 1.9 }}>
          <strong style={{ color: COLORS.primaryDark }}>تاریخچه:</strong>
          {[...order.history].reverse().map(h => <div key={h.id}>• {faDate(h.date)} — {h.text}{h.by ? ` (${h.by})` : ''}</div>)}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: `1px solid ${COLORS.border}`, paddingTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {!archived && !isRequest && perms.printForm && <GhostButton icon={Printer} onClick={onPrint}>چاپ فرم سفارش (فرم تولید)</GhostButton>}
        {!readOnly && perms.deleteOrder && !order.pricing && !(order.quoteHistory || []).length && !order.workflow?.customerConfirmation && !order.workflow?.productionAuthorization && !order.workflow?.stop && !(order.items || []).some(it => it.materialsDeducted || it.materialConsumption) && <GhostButton icon={Trash2} onClick={onDelete} style={{ borderColor: COLORS.danger, color: COLORS.danger }}>حذف سفارش</GhostButton>}
        {!readOnly && perms.manageOrder && pending && <GhostButton icon={Archive} onClick={onArchive}>بایگانی (تایید نشد)</GhostButton>}
        {perms.approveProduction && pending && !order.pricing && <GhostButton icon={Pencil} onClick={onEdit}>ویرایش سفارش</GhostButton>}
        {!readOnly && perms.manageOrder && archived && <PrimaryButton icon={RotateCcw} onClick={onReopen}>بازگشایی و پیش‌فاکتور جدید</PrimaryButton>}
      </div>
    </div>
  );
}

function ArchiveDialog({ order, onSave, onCancel }) {
  const [reason, setReason] = useState(ARCHIVE_REASONS[0]);
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, lineHeight: 2 }}>سفارش <strong>{order.orderNumber || 'معلق (بدون شماره)'}</strong> ({order.customerName}) به بایگانی منتقل می‌شود. هر زمان مشتری برگشت، می‌توانید آن را بازگشایی و پیش‌فاکتور جدید صادر کنید.</div>
      <Field label="دلیل"><Select options={ARCHIVE_REASONS} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <Field label="توضیحات (اختیاری)"><TextInput value={note} onChange={e => setNote(e.target.value)} /></Field>
      <div>
        <div style={{ fontSize: 12, color: COLORS.sub, fontWeight: 600, marginBottom: 4 }}>تاریخ پیگیری بعدی (اختیاری)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ width: 300 }}><JalaliDateInput value={followUp} onChange={setFollowUp} /></div>
          {[7, 10, 30].map(n => <GhostButton key={n} onClick={() => setFollowUp(addDaysIso(todayIso(), n))} style={{ padding: '5px 10px', fontSize: 12 }}>{n} روز دیگر</GhostButton>)}
          {followUp && <GhostButton onClick={() => setFollowUp('')} style={{ padding: '5px 10px', fontSize: 12 }}>بدون پیگیری</GhostButton>}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: `1px solid ${COLORS.border}`, paddingTop: 14 }}>
        <GhostButton onClick={onCancel}>انصراف</GhostButton>
        <PrimaryButton icon={Archive} onClick={() => onSave({ reason, note: note.trim(), followUp })}>انتقال به بایگانی</PrimaryButton>
      </div>
    </div>
  );
}

function ArchiveTable({ orders, onOpen, onReopen }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr style={{ background: COLORS.primary, color: '#fff' }}>{['شماره', 'مشتری', 'اقلام سفارش', 'تاریخ بایگانی', 'دلیل', 'پیگیری', ''].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>{h}</th>)}</tr></thead>
        <tbody>
          {orders.map((o, idx) => {
            const a = o.archive || {};
            const due = a.followUp && a.followUp <= todayIso();
            return (
              <tr key={o.id} style={{ background: idx % 2 ? COLORS.altRow : '#fff' }}>
                <td style={{ padding: '8px 10px', fontWeight: 700 }}>{o.orderNumber || <span title="شماره هنگام تأیید مشتری صادر می‌شود" style={{ color: COLORS.sub, fontWeight: 400 }}>معلق</span>}</td>
                <td style={{ padding: '8px 10px' }}>{o.customerName}</td>
                <td style={{ padding: '8px 10px' }}>{orderTitleSummary(o)}</td>
                <td style={{ padding: '8px 10px' }}>{faDate(a.date)}</td>
                <td style={{ padding: '8px 10px' }}>{a.reason || '—'}{a.note ? ` — ${a.note}` : ''}</td>
                <td style={{ padding: '8px 10px', fontWeight: 700, color: due ? COLORS.danger : COLORS.text }}>{a.followUp ? `${faDate(a.followUp)}${due ? ' (موعد رسیده)' : ''}` : '—'}</td>
                <td style={{ padding: '8px 10px' }}><div style={{ display: 'flex', gap: 6 }}>
                  <GhostButton icon={ArrowRight} onClick={() => onOpen(o)} style={{ padding: '5px 10px', fontSize: 12 }}>جزئیات</GhostButton>
                  {onReopen && <GhostButton icon={RotateCcw} onClick={() => onReopen(o)} style={{ padding: '5px 10px', fontSize: 12 }}>بازگشایی</GhostButton>}
                </div></td>
              </tr>
            );
          })}
          {orders.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: COLORS.sub }}>موردی یافت نشد.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const HOLD_LEGS = [
  { key: 'manager', title: 'عدم تأیید مدیر', who: 'مدیر چاپخانه — اجازهٔ شروع تولید' },
  { key: 'order', title: 'عدم تأیید سفارش', who: 'کارشناس سفارشات — تأیید مشتری و ارجاع قلم' },
  { key: 'finance', title: 'عدم تأیید مالی', who: 'مدیر مالی — صدور پیش‌فاکتور همین نسخه' },
];
const HOLD_TITLE = Object.fromEntries(HOLD_LEGS.map(l => [l.key, l.title]));
const LANE_TONE = { offset: '#722444', digital: '#8A4A1C', legacy: '#6B6B63', hold: '#8A6D1C', final: '#1F5E24' };
const laneStages = (laneKey) => (laneKey === 'digital' ? DIGITAL_PATH : laneKey === 'legacy' ? LEGACY_PATH : OFFSET_PATH).slice(1, -1);
const laneHasStage = (laneKey, stage) => (laneKey === 'legacy' ? LEGACY_PATH : laneKey === 'digital' ? DIGITAL_PATH : OFFSET_PATH).includes(stage);

function ProductionBoard({ orders, settings, role, onOpenOrder, onMoveStage, onCompleteStage, onRecordCounts }) {
  const [q, setQ] = useState('');
  const [onlyLate, setOnlyLate] = useState(false);
  const [myQueue, setMyQueue] = useState(false);
  const [period, setPeriod] = useState('today');
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState('');
  const [holds, setHolds] = useState([]);
  const [holdError, setHoldError] = useState('');
  const canOperate = role === 'مدیر چاپخانه';
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const periodStart = period === 'today' ? dayStart.getTime() : period === 'week' ? Date.now() - 7 * 86400000 : 0;
  const periodIso = period === 'all' ? '' : new Date(periodStart).toISOString().slice(0, 10);

  /* سه دلیل معلق را سرور از رکورد واقعی سفارش و سند پیش‌فاکتور می‌سازد؛ این تابلو فقط می‌خواند.
     در نسخهٔ بدون پایگاه داده، دلیل مالی قابل اثبات نیست و روی کادر همان توضیح می‌آید. */
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.printshopApi : null;
    if (!api || typeof api.productionBoard !== 'function') { setHolds([]); setHoldError('دلیل «عدم تأیید مالی» فقط در نسخهٔ پایگاه دادهٔ امن از سند پیش‌فاکتور خوانده می‌شود.'); return undefined; }
    let alive = true;
    api.productionBoard().then(r => {
      if (!alive) return;
      if (r && r.ok) { setHolds(r.holds || []); setHoldError(''); }
      else { setHolds([]); setHoldError((r && r.error) || 'دلیل‌های معلق از سرور خوانده نشد.'); }
    }).catch(() => { if (alive) { setHolds([]); setHoldError('دلیل‌های معلق از سرور خوانده نشد.'); } });
    return () => { alive = false; };
  }, [orders]);

  const orderById = new Map(orders.map(o => [o.id, o]));
  const holdRows = holds.filter(h => h && h.orderId && orderById.has(h.orderId));
  const productionOrders = orders.filter(o => !!o.workflow?.productionAuthorization && !['متوقف', 'لغو شده', 'در انتظار تایید', 'بایگانی', REQUEST_STATUS].includes(o.status));
  const all = [];
  const completed = [];
  productionOrders.forEach(o => (o.items || []).forEach(it => {
    const list = stagesFor(it);
    const legacy = list === LEGACY_PATH;
    const laneKey = legacy ? 'legacy' : pathKeyOf(it);
    const pathName = legacy ? 'قدیمی' : pathLabelOf(it);
    const current = it.stage || START_STAGE;
    if (o.status !== 'تحویل شده' && !isStageCompleted(it, current)) all.push({ order: o, item: it, u: urgency(o), stage: current, laneKey, pathName });
    Object.entries(it.stageCompletions || {}).forEach(([stage, rec]) => {
      if (!ALL_STAGES.includes(stage) || !rec || (rec.at || 0) < periodStart) return;
      completed.push({ order: o, item: it, stage, rec, laneKey, pathName });
    });
  }));
  const delivered = orders.filter(o => o.status === 'تحویل شده' && (!periodIso || String(o.deliveredAt || '').slice(0, 10) >= periodIso));
  const isLate = (c) => { const d = daysUntil(c.order.deliveryDate); return d !== null && d <= 0; };
  const needle = normalizeDigits(q).trim();
  const matches = ({ order, item }) => !needle || normalizeDigits(`${order.orderNumber} ${order.customerName} ${item.productName} ${item.productType}`).includes(needle);
  const cards = all.filter(c => matches(c) && (!onlyLate || isLate(c)) && (!myQueue || canCompleteStage(role, c.stage)));
  const done = completed.filter(matches);
  const holdCards = holdRows.filter(h => h.held !== false && (!needle || normalizeDigits(`${h.orderNumber} ${h.customerName}`).includes(needle)));
  const outsourcedSteps = (it) => PLAN_STEPS.filter(s => it.plan && it.plan[s.key] && it.plan[s.key].mode === OUTSOURCE).map(s => s.label);
  const lateCount = all.filter(isLate).length;
  const soonCount = all.filter(c => { const d = daysUntil(c.order.deliveryDate); return d !== null && d > 0 && d <= 2; }).length;
  const itemsOf = (o) => [...new Set(((o && o.items) || []).map(i => i.productName || i.productType).filter(Boolean))].join('، ') || '—';
  const btn = { border: `1px solid ${COLORS.border}`, background: '#fff', borderRadius: 6, cursor: 'pointer', display: 'flex', padding: 3 };
  const chip = (text, bg, fg) => <span style={{ background: bg, color: fg, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 800 }}>{text}</span>;
  const pathChip = (laneKey, pathName) => <span style={{ background: laneKey === 'digital' ? '#F6E7D2' : laneKey === 'legacy' ? '#E4E4E0' : '#EADCE6', color: laneKey === 'digital' ? '#8A4A1C' : laneKey === 'legacy' ? '#5F5F58' : '#722444', borderRadius: 999, padding: '0 7px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>{pathName}</span>;
  const reportRow = (c, state) => [state, c.order.orderNumber, c.order.customerName, c.item.productName || c.item.productType || '—', `${fmt(c.item.qty)} ${c.item.qtyUnit || ''}`, faDate(c.order.deliveryDate), c.pathName, state === 'تمام‌شده' ? `${stageCompletionLabel(c.rec)}${c.rec.note ? ` — ${c.rec.note}` : ''}` : outsourcedSteps(c.item).join('، ') || '—'];
  const holdReportRow = (h) => { const o = orderById.get(h.orderId) || {}; return ['معلق', h.orderNumber || '—', h.customerName || '—', itemsOf(o), '—', faDate(o.deliveryDate), HOLD_TITLE[h.primary] || '—', (h.reasons || []).map(r => r.detail || r.label).join(' | ')]; };
  const reportHead = ['وضعیت', 'سفارش', 'مشتری', 'محصول', 'تیراژ', 'تحویل', 'مسیر', 'تأیید / برون‌سپاری'];
  const reportWidths = ['9%', '9%', '14%', '17%', '8%', '9%', '8%', '26%'];
  const laneRows = (laneKey, cols) => cols.flatMap(st => [
    ...cards.filter(c => c.laneKey === laneKey && c.stage === st).map(c => reportRow(c, 'در جریان')),
    ...done.filter(c => c.laneKey === laneKey && c.stage === st).map(c => reportRow(c, 'تمام‌شده')),
  ]);
  const finalRows = () => [
    ...cards.filter(c => c.stage === FINAL_STAGE).map(c => reportRow(c, 'در جریان')),
    ...done.filter(c => c.stage === FINAL_STAGE).map(c => reportRow(c, 'تمام‌شده')),
    ...delivered.map(o => ['تحویل شده', o.orderNumber, o.customerName, itemsOf(o), '—', faDate(o.deliveredAt), pathLabelOf((o.items || [])[0] || {}), '—']),
  ];
  const boardRows = () => [...holdCards.map(holdReportRow), ...laneRows('offset', laneStages('offset')), ...laneRows('digital', laneStages('digital')), ...laneRows('legacy', laneStages('legacy')), ...finalRows()];
  const column = (laneKey, stage, si) => {
    const col = cards.filter(c => laneKey === 'final' ? c.stage === FINAL_STAGE : c.laneKey === laneKey && c.stage === stage);
    const doneCol = done.filter(c => laneKey === 'final' ? c.stage === FINAL_STAGE : c.laneKey === laneKey && c.stage === stage);
    const color = STAGE_COLORS[stage] || COLORS.primary;
    const key = `${laneKey}:${stage}`;
    return (
      <div key={stage} onDragOver={e => { if (canOperate && drag && laneHasStage(laneKey, stage)) { e.preventDefault(); setOver(key); } }} onDragLeave={() => setOver('')}
        onDrop={e => {
          if (!canOperate) return;
          e.preventDefault(); setOver('');
          const list = drag && stagesFor(drag.item);
          if (drag && laneHasStage(laneKey, stage) && list.includes(stage) && list.indexOf(stage) > list.indexOf(drag.item.stage || START_STAGE)) onMoveStage(drag.order, drag.item, stage);
          setDrag(null);
        }}
        style={{ minWidth: 0 }}>
        <div style={{ background: color, color: '#fff', fontWeight: 800, fontSize: 12, padding: '7px 8px', borderRadius: '8px 8px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 999, width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>{si + 1}</span>{stage}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 999, padding: '0 7px', fontSize: 11 }}>{col.length}{doneCol.length > 0 ? ` + ${doneCol.length}` : ''}</span>
            <PrintReportButton settings={settings} title={`گزارش بخش ${stage}`} subtitle="کارهای در جریان و پایان‌یافتهٔ همین بخش" signatures={['مدیر چاپخانه']} compact>
              {() => <PrintTable head={reportHead} widths={reportWidths} rows={[
                ...col.map(c => reportRow(c, 'در جریان')),
                ...doneCol.map(c => reportRow(c, 'تمام‌شده')),
              ]} />}
            </PrintReportButton>
          </span>
        </div>
        <div style={{ background: over === key ? COLORS.accentLight : COLORS.altRow, outline: over === key ? `2px dashed ${color}` : 'none', borderRadius: '0 0 8px 8px', padding: 5, minHeight: 140, display: 'flex', flexDirection: 'column', gap: 5, borderTop: `3px solid ${color}` }}>
          {col.map(({ order, item, u, stage: current, laneKey: lk, pathName }) => {
            const list = stagesFor(item); const idx = list.indexOf(current); const out = outsourcedSteps(item);
            return (
              <div key={`${order.id}:${item.id}`} draggable={canOperate} onDragStart={() => setDrag({ order, item })} onDragEnd={() => { setDrag(null); setOver(''); }}
                style={{ background: '#fff', border: `1px solid ${COLORS.border}`, borderInlineStart: `4px solid ${u.color}`, borderRadius: 8, padding: '6px 7px', fontSize: 11, cursor: canOperate ? 'grab' : 'default', opacity: drag && drag.item.id === item.id ? 0.5 : 1 }}>
                <div style={{ fontWeight: 800, lineHeight: 1.5, wordBreak: 'break-word', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>{item.productName || item.productType || '—'}</span>{pathChip(lk, pathName)}
                </div>
                <div style={{ color: COLORS.sub, lineHeight: 1.6 }}>سفارش {order.orderNumber} — {order.customerName}</div>
                <div style={{ color: COLORS.sub, display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}><Dot color={u.color} title={u.label} /><span>{u.label}</span></div>
                {out.length > 0 && <div style={{ marginTop: 3, background: COLORS.warnBg, color: COLORS.warn, borderRadius: 6, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>برون‌سپاری: {out.join('، ')}</div>}
                {canOperate && onCompleteStage && canCompleteStage(role, current) && <CompleteStageButton compact order={order} item={item} onComplete={onCompleteStage} />}
                {onRecordCounts && <ItemDeliveryCounts compact order={order} item={item} faDate={faDate}
                  canRecordQuality={canOperate && canRecordQuality(role, current)}
                  canRecordDelivery={canOperate && canRecordDelivery(role, current)} onAction={onRecordCounts} />}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 }}>
                  <button onClick={() => onOpenOrder(order)} style={{ background: 'transparent', border: 'none', color: COLORS.primary, fontSize: 11, cursor: 'pointer', fontWeight: 700, padding: 0 }}>جزئیات</button>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {role === 'مدیر چاپخانه' && idx > -1 && idx < list.length - 1 && <button title="عبور مدیر بدون ثبت اتمام" onClick={() => onMoveStage(order, item, list[idx + 1])} style={btn}><ArrowLeft size={12} /></button>}
                  </div>
                </div>
              </div>
            );
          })}
          {doneCol.length > 0 && <div style={{ fontSize: 10.5, fontWeight: 800, color: '#6B6B63', textAlign: 'center', padding: '2px 0' }}>تمام‌شده — فقط گزارش</div>}
          {doneCol.map(({ order, item, stage: doneStage, rec }) => (
            <div key={`${order.id}:${item.id}:${doneStage}`} style={{ background: '#EDEDE8', border: '1px solid #D8D8D0', borderInlineStart: '4px solid #A9A9A1', borderRadius: 8, padding: '6px 7px', fontSize: 11, color: '#5F5F58' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4, alignItems: 'center' }}>
                <span style={{ fontWeight: 800, lineHeight: 1.5, wordBreak: 'break-word' }}>{item.productName || item.productType || '—'}</span>
                <span style={{ background: '#D8D8D0', borderRadius: 999, padding: '0 6px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>تمام‌شده</span>
              </div>
              <div style={{ lineHeight: 1.6 }}>سفارش {order.orderNumber} — {order.customerName}</div>
              <div style={{ lineHeight: 1.6 }}>{stageCompletionLabel(rec)}</div>
              {rec.note && <div style={{ lineHeight: 1.6, color: '#6B6B63' }}>{rec.note}</div>}
            </div>
          ))}
          {col.length === 0 && doneCol.length === 0 && <div style={{ color: COLORS.sub, fontSize: 11, textAlign: 'center', padding: 10 }}>خالی</div>}
        </div>
      </div>
    );
  };
  const holdColumn = (leg) => {
    const rows = holdCards.filter(h => (h.primary || 'manager') === leg.key);
    return (
      <div key={leg.key} style={{ minWidth: 0 }}>
        <div style={{ background: LANE_TONE.hold, color: '#fff', fontWeight: 800, fontSize: 12, padding: '7px 8px', borderRadius: '8px 8px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
          <span>{leg.title}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 999, padding: '0 7px', fontSize: 11 }}>{rows.length}</span>
            <PrintReportButton settings={settings} title={`گزارش معلق — ${leg.title}`} subtitle="سفارش‌هایی که همین دلیل باز دارند" signatures={['مدیر چاپخانه']} compact>
              {() => <PrintTable head={reportHead} widths={reportWidths} rows={rows.map(holdReportRow)} />}
            </PrintReportButton>
          </span>
        </div>
        <div style={{ background: COLORS.altRow, borderRadius: '0 0 8px 8px', padding: 5, minHeight: 140, display: 'flex', flexDirection: 'column', gap: 5, borderTop: `3px solid ${LANE_TONE.hold}` }}>
          {rows.map(h => {
            const o = orderById.get(h.orderId);
            const late = typeof h.idleDays === 'number' && h.idleDays > 3;
            return (
              <div key={h.orderId} style={{ background: '#fff', border: `1px solid ${COLORS.border}`, borderInlineStart: `4px solid ${COLORS.warn}`, borderRadius: 8, padding: '6px 7px', fontSize: 11 }}>
                <div style={{ fontWeight: 800, lineHeight: 1.5, wordBreak: 'break-word' }}>{itemsOf(o)}</div>
                <div style={{ color: COLORS.sub, lineHeight: 1.6 }}>{h.orderNumber ? `سفارش ${h.orderNumber}` : `تاریخ ثبت ${faDate(h.date) || '—'}`} — {h.customerName}</div>
                <div style={{ color: '#5F5F58', lineHeight: 1.6 }}>{(h.reasons || []).map(r => r.detail).filter(Boolean).join(' | ') || leg.who}</div>
                {h.unreferredItems > 0 && <div style={{ color: COLORS.sub, lineHeight: 1.6 }}>{fmt(h.unreferredItems)} قلم هنوز به مرحلهٔ بعدی ارجاع نشده است</div>}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', marginTop: 3 }}>
                  {typeof h.idleDays === 'number' && <span style={{ background: late ? COLORS.dangerBg : COLORS.warnBg, color: late ? COLORS.danger : COLORS.warn, borderRadius: 999, padding: '0 7px', fontSize: 10, fontWeight: 800 }}>{fmt(h.idleDays)} روز بی‌تحرک</span>}
                  {(h.reasons || []).filter(r => r.key !== h.primary).map(r => <span key={r.key} style={{ background: '#EDEDE8', color: '#5F5F58', borderRadius: 999, padding: '0 7px', fontSize: 10, fontWeight: 800 }}>{r.label}</span>)}
                </div>
                <div style={{ marginTop: 4, fontSize: 10.5, color: COLORS.sub }}>منتظر: {leg.who}</div>
                <button onClick={() => onOpenOrder(o)} style={{ background: 'transparent', border: 'none', color: COLORS.primary, fontSize: 11, cursor: 'pointer', fontWeight: 700, padding: 0, marginTop: 3, textAlign: 'right' }}>جزئیات و ثبت تأیید</button>
              </div>
            );
          })}
          {rows.length === 0 && <div style={{ color: COLORS.sub, fontSize: 11, textAlign: 'center', padding: 10 }}>خالی</div>}
        </div>
      </div>
    );
  };
  const lane = (laneKey, title, columns, legend) => (
    <div>
      <div style={{ background: LANE_TONE[laneKey], color: '#fff', fontWeight: 800, fontSize: 12, padding: '6px 9px', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span>{title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700 }}>
          {columns.map((st, i) => <span key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ background: 'rgba(255,255,255,0.22)', borderRadius: 999, padding: '1px 8px' }}>{i + 1}. {st}</span>
            {i < columns.length - 1 && <span aria-hidden="true">←</span>}
          </span>)}
        </span>
      </div>
      <div style={{ fontSize: 11, color: COLORS.sub, margin: '0 2px 6px' }}>{legend}</div>
      {/* سقفِ عرضِ ستون: کادرِ تک‌ستونه (قدیمی و مشترک) نباید تا تمامِ عرضِ صفحه کشیده شود. */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${laneKey === 'hold' ? 210 : 150}px, ${laneKey === 'hold' ? 430 : 330}px))`, gap: 8, alignItems: 'start' }}>
        {laneKey === 'hold' ? HOLD_LEGS.map(leg => holdColumn(leg)) : columns.map((st, i) => column(laneKey, st, i))}
      </div>
    </div>
  );
  const legacyCols = laneStages('legacy').filter(st => cards.some(c => c.laneKey === 'legacy' && c.stage === st) || done.some(c => c.laneKey === 'legacy' && c.stage === st));
  const laneCounts = (laneKey) => cards.filter(c => c.laneKey === laneKey).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {chip(`${fmt(all.length)} قلم در تولید`, COLORS.accentLight, COLORS.primaryDark)}
        {chip(`${fmt(holdCards.length)} سفارش معلق`, COLORS.warnBg, COLORS.warn)}
        {done.length > 0 && chip(`${fmt(done.length)} قلم پایان‌یافته`, '#EDEDE8', '#55554E')}
        {delivered.length > 0 && chip(`${fmt(delivered.length)} سفارش تحویل‌شده`, '#DDF0DD', '#215B21')}
        {lateCount > 0 && chip(`${fmt(lateCount)} قلم عقب‌افتاده یا تحویل امروز`, COLORS.dangerBg, COLORS.danger)}
        {soonCount > 0 && chip(`${fmt(soonCount)} قلم تا ۲ روز دیگر`, COLORS.warnBg, COLORS.warn)}
        {laneCounts('legacy') > 0 && chip(`${fmt(laneCounts('legacy'))} قلم در مسیر قدیمی`, '#E4E4E0', '#4A4A44')}
        {!canOperate && chip('فقط نمایش', '#EDEDE8', '#55554E')}
        <div style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700 }}>ردیف‌های تمام‌شده:
          <select value={period} onChange={e => setPeriod(e.target.value)} style={{ ...inputStyle, padding: '4px 6px', fontSize: 12, width: 100 }}>
            <option value="today">امروز</option><option value="week">۷ روز اخیر</option><option value="all">همه</option>
          </select>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: '5px 10px', width: 230 }}>
          <Search size={14} color={COLORS.sub} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="سفارش، مشتری، محصول..." style={{ border: 'none', outline: 'none', fontSize: 12, flex: 1, background: 'transparent', fontFamily: 'inherit' }} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700 }}><input type="checkbox" checked={onlyLate} onChange={e => setOnlyLate(e.target.checked)} /> فقط عقب‌افتاده</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700 }}><input type="checkbox" checked={myQueue} onChange={e => setMyQueue(e.target.checked)} /> صفِ من ({role})</label>
        <PrintReportButton settings={settings} title="گزارش تابلوی تولید" subtitle="معلق، افست، دیجیتال و تحویل — به تفکیک مرحله" signatures={['مدیر چاپخانه']}>
          {() => <PrintTable head={reportHead} widths={reportWidths} rows={boardRows()} />}
        </PrintReportButton>
      </div>
      <div style={{ fontSize: 11, color: COLORS.sub, lineHeight: 1.9 }}>
        هر قلم فقط در مسیر روش چاپ خودش جلو می‌رود: افست «طراحی و پروف» ← «لیتوگرافی و زینک» ← «چاپ افست» ← «صحافی و تکمیلی»؛ دیجیتال «طراحی و پروف» ← «چاپ دیجیتال» ← «برش و تکمیلی» و لیتوگرافی ندارد. «کنترل کیفیت و تحویل به مشتری» کادر مشترک هر دو مسیر است.
        {canOperate ? ' جابه‌جایی با کشیدن کارت فقط رو به جلو و فقط داخل کادر خودش؛ عبور از چند مرحله دلیل مدیر می‌خواهد.' : ' این تابلو برای شما فقط نمایشی است؛ اتمام کار هر مرحله از میز کار همان بخش (فرم سفارش) انجام می‌شود.'}
        {holdError && <span style={{ color: COLORS.warn }}> {holdError}</span>}
      </div>
      {lane('hold', 'معلق — ثبت سفارش انجام شده اما تأیید شروع نگرفته است', HOLD_LEGS.map(l => l.title), 'تا این سه تأیید کامل نشود قلم وارد مسیر افست یا دیجیتال نمی‌شود، ولی در تابلو دیده و پیگیری می‌شود. تأییدها از همان فرم سفارش ثبت می‌شوند.')}
      {lane('offset', 'کادر چاپ افست', laneStages('offset'), 'اتمام «طراحی و پروف» همان تأیید مشتری است؛ از آنجا قلم افست به لیتوگرافی و زینک می‌رود.')}
      {lane('digital', 'کادر چاپ دیجیتال', laneStages('digital'), 'قلم دیجیتال وارد لیتوگرافی و زینک نمی‌شود؛ کاغذ و برگ اجرای آن در «چاپ دیجیتال» ثبت می‌شود.')}
      {legacyCols.length > 0 && lane('legacy', 'مسیر قدیمی — در انتظار تعیین تکلیف یک‌بارهٔ مدیر', legacyCols, 'این قلم‌ها همان مسیر نه‌مرحله‌ای قبلی را ادامه می‌دهند؛ انتقال دسته‌جمعی به مسیر جدید گام بعدی است و هنوز ساخته نشده.')}
      {lane('final', 'کادر مشترک کنترل کیفیت و تحویل به مشتری', [FINAL_STAGE], 'هر قلم از آخرین مرحلهٔ مسیر خودش به همین کادر می‌آید؛ با ثبت تحویل سفارش بسته می‌شود.')}
      {delivered.length > 0 && (
        <div>
          <div style={{ background: LANE_TONE.final, color: '#fff', fontWeight: 800, fontSize: 12, padding: '6px 9px', borderRadius: 8, marginBottom: 6 }}>تحویل شده — {period === 'today' ? 'امروز' : period === 'week' ? '۷ روز اخیر' : 'همه'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 330px))', gap: 8 }}>
            {delivered.map(o => (
              <div key={o.id} style={{ background: '#EDEDE8', border: '1px solid #D8D8D0', borderInlineStart: '4px solid #1F5E24', borderRadius: 8, padding: '6px 7px', fontSize: 11, color: '#5F5F58' }}>
                <div style={{ fontWeight: 800, lineHeight: 1.5, wordBreak: 'break-word', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>{itemsOf(o)}</span>{pathChip(((o.items || [])[0] && stagesFor(o.items[0]) === LEGACY_PATH) ? 'legacy' : pathKeyOf((o.items || [])[0] || {}), pathLabelOf((o.items || [])[0] || {}))}
                </div>
                <div style={{ lineHeight: 1.6 }}>سفارش {o.orderNumber} — {o.customerName}</div>
                <div style={{ lineHeight: 1.6 }}>تحویل {faDate(o.deliveredAt)}{o.deliveredBy && o.deliveredBy.name ? ` — ${o.deliveredBy.name}` : ''}</div>
                <button onClick={() => onOpenOrder(o)} style={{ background: 'transparent', border: 'none', color: COLORS.primary, fontSize: 11, cursor: 'pointer', fontWeight: 700, padding: 0, marginTop: 3 }}>جزئیات</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InvoicePrint({ document, settings, onClose }) {
  if (document.type === 'invoice' && document.snapshot.invoice) return <OfficialInvoice document={document} onClose={onClose} formatDate={faDate} />;
  settings = document.snapshot.printSettings ? { ...mergeSettings(document.snapshot.printSettings), company: document.snapshot.printSettings.company || {}, quote: { validityDays: 0, vatPercent: 0, terms: '', ...document.snapshot.printSettings.quote } } : settings;
  const order = document.snapshot.order, customer = document.snapshot.customer;
  const mode = document.type === 'quote' ? 'quote' : 'detailed';
  const q = settings.quote;
  const total = orderGrandTotal(order), discount = orderDiscount(order), tax = orderTax(order), payable = orderPayable(order), paid = orderPaid(order), bal = orderBalance(order);
  const detailed = mode !== 'summary';
  const isQuote = mode === 'quote';
  const rows = invoiceRows(order, detailed);
  const heading = document.type === 'statement' ? 'صورت وضعیت سفارش' : isQuote ? 'پیش‌فاکتور فروش' : 'فاکتور فروش';
  const subtitle = mode === 'detailed' ? '(تفصیلی)' : (mode === 'summary' ? '(خلاصه)' : '');
  const number = document.number;
  const quoteDate = new Date(document.createdAt).toISOString().slice(0, 10);
  const validUntil = addDaysIso(quoteDate || todayIso(), Number(q.validityDays) || 0);
  const th = { padding: '4px 5px', background: '#E6E6E6', color: '#000', fontSize: 10.5, textAlign: 'center', border: '1px solid #000', fontWeight: 800 };
  const td = { padding: '3px 5px', fontSize: 10.5, border: '1px solid #999', verticalAlign: 'top' };
  const totLine = (label, value, strong) => <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 8px', fontSize: strong ? 12 : 10.5, fontWeight: strong ? 800 : 500, background: strong ? '#F2F2F2' : 'transparent', borderBottom: strong ? 'none' : '1px dotted #bbb' }}><span>{label}</span><span>{fmt(value)} ریال</span></div>;
  const finalAmount = isQuote ? payable : bal;
  const docTitle = { quote: 'پیش‌فاکتور', invoice: 'فاکتور', statement: 'صورت‌وضعیت' }[document.type] || 'برگه';
  return (
    <PrintOverlay onClose={onClose} orientation="portrait" lockedPaper="A4" pdfName={`${docTitle}-${document.number || order.orderNumber || ''}`.trim()}>
      {document.type === 'invoice' && <p>سند قدیمی؛ مشخصات فروشنده و ردیف‌های قالب جدید هنگام صدور تثبیت نشده‌اند. این چاپ نیازمند بررسی سوابق است.</p>}
      <A4Sheet settings={settings} logoOnly title={`${heading} ${subtitle}`.trim()}
        meta={[['شماره', faDigits(number)], ['تاریخ', faDate(quoteDate)], ...(isQuote && Number(q.validityDays) > 0 ? [['اعتبار تا', faDate(validUntil)]] : []), ['مرجع سفارش', document.orderNumber]]}
        signatures={['مهر و امضای فروشنده', isQuote ? 'تایید و امضای خریدار' : 'امضای خریدار']}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 6, marginBottom: 7, breakInside: 'avoid' }}>
          <div style={{ border: '1px solid #000', borderRadius: 6, padding: '4px 8px', fontSize: 10.5, lineHeight: 1.8 }}>
            <div><strong>خریدار:</strong> {order.customerName}{order.phone || customer?.phone ? <> — تلفن: <bdi>{order.phone || customer?.phone}</bdi></> : null}</div>
            {customer?.address && <div>نشانی: {customer.address}</div>}
          </div>
          <div style={{ border: '1px solid #000', borderRadius: 6, padding: '4px 8px', fontSize: 10.5, lineHeight: 1.8 }}>
            <div><strong>موضوع:</strong> {order.title || '—'}</div>
            <div><strong>سفارش:</strong> {document.orderNumber || order.orderNumber || '—'}</div>
          </div>
        </div>

        <table className="financial-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 7 }}>
          <colgroup><col style={{ width: '7%' }} /><col style={{ width: detailed ? '46%' : '63%' }} /><col style={{ width: '12%' }} />{detailed && <col style={{ width: '17%' }} />}<col style={{ width: '18%' }} /></colgroup>
          <thead>
            <tr><th style={th}>ردیف</th><th style={th}>شرح کالا / خدمت</th><th style={th}>شمارگان</th>{detailed && <th style={th}>قیمت واحد (ریال)</th>}<th style={th}>مبلغ (ریال)</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} style={{ background: r.sub ? '#F7F7F2' : '#fff', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                <td style={{ ...td, textAlign: 'center' }}>{i + 1}</td>
                <td style={{ ...td, paddingInlineStart: r.sub ? 18 : 5 }}>
                  <span style={{ fontWeight: r.sub ? 400 : 700 }}>{r.desc}</span>
                  {r.spec && <span style={{ color: '#555', fontSize: 9.5 }}> — {r.spec}</span>}
                </td>
                <td style={td}>{r.qty}</td>
                {detailed && <td style={td}>{r.price}</td>}
                <td style={{ ...td, fontWeight: 700 }}>{fmt(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginBottom: 6, breakInside: 'avoid' }}>
          <div style={{ flex: 1, fontSize: 10.5, lineHeight: 1.9, border: '1px dashed #999', borderRadius: 6, padding: '4px 8px' }}>
            <div style={{ fontWeight: 700 }}>{isQuote ? 'مبلغ قابل پرداخت به حروف:' : 'مانده قابل پرداخت به حروف:'}</div>
            <div>{numberToWords(finalAmount)} ریال</div>
          </div>
          <div style={{ width: 290, border: '1px solid #000', borderRadius: 6, padding: '3px 4px' }}>
            {totLine('جمع کل', total)}
            {discount > 0 && totLine('تخفیف', discount)}
            {tax > 0 && totLine(`مالیات بر ارزش افزوده (${fmt(order.pricing?.result?.taxPercent ?? order.vatPercent)}٪)`, tax)}
            {totLine(isQuote ? 'مبلغ قابل پرداخت' : 'مبلغ نهایی', payable, true)}
            {!isQuote && totLine('پرداخت‌شده', paid)}
            {!isQuote && totLine('مانده', bal, true)}
          </div>
        </div>

        {!isQuote && (order.payments || []).length > 0 && (
          <div style={{ marginBottom: 6, fontSize: 10, lineHeight: 1.8 }}>
            <strong>دریافت‌ها:</strong>
            {order.payments.map(p => <span key={p.id}> {faDate(p.date)} — {p.method} — {fmt(p.amount)} ریال؛</span>)}
          </div>
        )}

        {isQuote && q.terms && (
          <div style={{ fontSize: 9.5, lineHeight: 1.9, color: '#333', border: '1px solid #ccc', borderRadius: 6, padding: '4px 8px', whiteSpace: 'pre-line' }}>
            <strong>شرایط:</strong>{'\n'}{q.terms}
          </div>
        )}
      </A4Sheet>
    </PrintOverlay>
  );
}

function FinancialOrderView({ order, customer, settings, inventory, recentOrders = [], canApprove, onApprove, onPrintForm, onPreviewQuote, onSaveQuote, onOpenDocuments, onMoneyChanged }) {
  const [financialTab, setFinancialTab] = useState('pricing');
  const problem = moneyError(order);
  const pending = order.status === 'در انتظار تایید';
  const printable = !problem && (hasQuotePricing(order) || !pending);
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <SectionTitle>قیمت‌گذاری سفارش {order.orderNumber || 'معلق'} — {order.customerName}</SectionTitle>
    <DeskTabs id={'financial-' + order.id} items={[{id:'pricing',label:'قیمت‌گذاری'},{id:'payments',label:'دریافت‌ها'},{id:'history',label:'سوابق قیمت'}]} value={financialTab} onChange={setFinancialTab}>
    <div hidden={financialTab !== 'pricing'}><QuoteEditor order={order} inventory={inventory} suggestions={lineDescriptionSuggestions(recentOrders)} onPreview={onPreviewQuote} onSave={onSaveQuote} />
    </div><div hidden={financialTab !== 'history'}>
    {(order.quoteHistory || []).length > 0 && <details className="quote-editor"><summary>سوابق نسخه‌های قبلی پیش‌فاکتور</summary>{order.quoteHistory.map(snapshot => <p key={snapshot.revision}>نسخهٔ {fmt(snapshot.revision)} — {faDate(new Date(snapshot.createdAt).toISOString().slice(0, 10))} — مبلغ نهایی: {fmt(snapshot.result.total)} ریال</p>)}</details>}
    </div><div hidden={financialTab !== 'payments'}>
    {problem && <p role="alert" className="quote-error">{problem}</p>}
    {!order.pricing && !pending && <p className="quote-warning">این سفارش از قیمت‌گذاری قدیمی استفاده می‌کند؛ مبالغ قبلی خودکار تغییر نمی‌کنند.</p>}
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <KpiCard label="مبلغ نهایی — ریال" value={fmt(orderPayable(order))} accent={COLORS.primary} />
      <KpiCard label="پرداخت‌شده — ریال" value={fmt(orderPaid(order))} accent={COLORS.primary} />
      <KpiCard label="مانده — ریال" value={fmt(orderBalance(order))} accent={COLORS.primary} />
    </div>
    <SectionTitle small>ردیف پرداختِ این سفارش — بازتابِ دفتر رسید</SectionTitle>
    {(order.payments || []).length > 0
      ? <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
        {(order.payments || []).map(p => <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{faDate(p.date)} — {p.method}{p.statusLabel ? ` — ${p.statusLabel}` : ''}{p.receiptNumber ? ` — رسید ${faDigits(p.receiptNumber)}` : ''}</span><strong>{fmt(p.amount)} ریال</strong></div>)}
      </div>
      : <p className="quote-muted">ردیفی ثبت نشده است.</p>}
    <p className="quote-muted">این ردیف‌ها را سرور از دفترِ رسید می‌نویسد؛ دریافت تازه از همین صفحه ثبت می‌شود و از این جدول چیزی پاک یا اضافه نمی‌شود.</p>
    <MoneyReceiptLedger customerId={order.customerId} order={order} fmt={fmt} faDate={faDate} DateInput={JalaliDateInput} onChanged={onMoneyChanged} />
    </div></DeskTabs>
    {!printable && <p className="quote-muted">برای چاپ پیش‌فاکتور، قیمت معتبر همین نسخه را محاسبه و ذخیره کنید.</p>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <GhostButton icon={FileText} onClick={onOpenDocuments}>کارتابل صدور اسناد مالی</GhostButton>
      <GhostButton icon={Printer} onClick={onPrintForm}>فرم سفارش — نسخه حسابداری</GhostButton>
      {canApprove && pending && <PrimaryButton icon={Check} onClick={onApprove}>بررسی تأیید مشتری و اجازهٔ تولید</PrimaryButton>}
    </div>
  </div>;
}

function purposeText(i) {
  if (i.purposeScope === 'order') return [i.linkedOrderNumber ? `سفارش ${i.linkedOrderNumber}` : '', i.purpose || ''].filter(Boolean).join(' — ') || '—';
  return i.purpose || 'همه کارهای این مشتری';
}

function CustomerLedgerModal({ customer, inventory, consignments = [], settings, onClose }) {
  const [printing, setPrinting] = useState(false);
  const items = inventory.filter(i => i.ownerType === 'مشتری' && i.ownerCustomerId === customer.id);
  const receiptsOf = id => consignments.filter(r => r.inventoryItemId === id).sort((a, b) => (`${a.date} ${a.time}` > `${b.date} ${b.time}` ? 1 : -1));
  function exportKardex() {
    const stock = [['کالا', 'دسته', 'گراماژ', 'سایز', 'کاربرد', 'موجودی فعلی', 'واحد', 'تعداد ورق']];
    const moves = [['کالا', 'تاریخ', 'نوع', 'مقدار', 'واحد', 'شرح']];
    items.forEach(i => {
      stock.push([i.name, i.category, i.gramaj, i.size, purposeText(i), stockLevel(i), stockUnitLabel(i), i.unitMode === 'band_sheet' ? sheetCount(i) : '']);
      (i.movements || []).forEach(m => moves.push([i.name, faDate(m.date), m.type === 'in' ? 'ورود' : 'خروج', Number(m.qty), stockUnitLabel(i), m.note || '']));
    });
    saveWorkbook(`کاردکس-${customer.name}.xlsx`, [{ name: 'موجودی', rows: stock }, { name: 'گردش', rows: moves }]);
  }
  const th = { padding: '6px 10px', textAlign: 'right' };
  const body = (
    items.length === 0 ? <div style={{ color: COLORS.sub, fontSize: 13, textAlign: 'center', padding: 20 }}>موجودی ثبت‌شده‌ای برای این مشتری نیست.</div> : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {items.map(i => {
          let run = 0;
          const arr = receiptsOf(i.id);
          const daysAt = arr.length ? Math.floor((new Date(`${todayIso()}T00:00:00`) - new Date(`${arr[0].date}T00:00:00`)) / 86400000) : null;
          return (
            <div key={i.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: 'hidden', pageBreakInside: 'avoid' }}>
              <div style={{ background: COLORS.accentLight, padding: '8px 12px', fontSize: 12, color: COLORS.primaryDark, lineHeight: 1.9 }}>
                <strong>{i.name}</strong> ({i.category}{i.gramaj ? ` — ${i.gramaj}g` : ''}{i.size ? ` — ${i.size}` : ''}) — موجودی فعلی: <strong>{fmt(stockLevel(i))} {stockUnitLabel(i)}</strong>{i.unitMode === 'band_sheet' ? ` (${fmt(sheetCount(i))} ورق)` : ''}
                <div>کاربرد: {purposeText(i)}</div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: COLORS.primary, color: '#fff' }}>{['تاریخ', 'نوع', 'مقدار', 'شرح', 'مانده'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {(i.movements || []).map((m, idx) => {
                    run += m.type === 'in' ? Number(m.qty) : -Number(m.qty);
                    return (
                      <tr key={m.id} style={{ background: idx % 2 ? COLORS.altRow : '#fff' }}>
                        <td style={th}>{faDate(m.date)}</td>
                        <td style={{ ...th, color: m.type === 'in' ? COLORS.success : COLORS.danger, fontWeight: 700 }}>{m.type === 'in' ? 'ورود' : 'خروج'}</td>
                        <td style={th}>{fmt(m.qty)} {stockUnitLabel(i)}</td>
                        <td style={th}>{m.note || '—'}</td>
                        <td style={th}>{fmt(Math.round(run * 1000) / 1000)}</td>
                      </tr>
                    );
                  })}
                  {(i.movements || []).length === 0 && <tr><td colSpan={5} style={{ ...th, color: COLORS.sub, textAlign: 'center' }}>گردشی ثبت نشده است.</td></tr>}
                </tbody>
              </table>
              <div style={{ borderTop: `1px solid ${COLORS.border}`, padding: '8px 12px', fontSize: 12, background: '#fff' }}>
                {arr.length ? (
                  <div style={{ fontWeight: 700, color: COLORS.primaryDark, marginBottom: 6 }}>
                    {`نخستین رسید: ${faDate(arr[0].date)} — `}ساعت <bdi>{arr[0].time}</bdi>{` — روز نزد چاپخانه: ${fmt(daysAt)}`}
                  </div>
                ) : <div style={{ fontWeight: 700, color: COLORS.danger, marginBottom: 6 }}>رسید تحویل کالا از مشتری ثبت نشده است — تا این رسید ثبت نشود، شمارش روز امانت ممکن نیست.</div>}
                {arr.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr style={{ background: COLORS.primary, color: '#fff' }}>{['شماره رسید', 'تاریخ', 'ساعت', 'مقدار', 'واحد', 'تحویل‌گیرنده', 'سفارش'].map(h => <th key={h} style={{ padding: '5px 8px', textAlign: 'right' }}>{h}</th>)}</tr></thead>
                    <tbody>{arr.map(r => (
                      <tr key={r.id}><td style={th}>{faDigits(r.receiptNumber) || '—'}</td><td style={th}>{faDate(r.date)}</td><td style={th}><bdi>{faDigits(r.time)}</bdi></td><td style={th}>{fmt(r.qty)}</td><td style={th}>{r.unit}</td><td style={th}>{r.receivedBy}</td><td style={th}>{r.orderNumber || '—'}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            </div>
          );
        })}
      </div>
    )
  );
  if (printing) return <ReportPrint settings={settings} title={`کاردکس انبار — ${customer.name}`} signatures={['انباردار', 'مدیر چاپخانه']} onClose={() => setPrinting(false)}>{body}</ReportPrint>;
  return (
    <Modal title={`کاردکس انبار — ${customer.name}`} onClose={onClose} wide>
      <div style={{ marginBottom: 10, display: 'flex', gap: 8 }}><GhostButton icon={Printer} onClick={() => setPrinting(true)}>چاپ کاردکس</GhostButton><GhostButton icon={FileText} onClick={exportKardex}>خروجی اکسل</GhostButton></div>
      {body}
    </Modal>
  );
}

function InventoryChecklist({ inventory }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {REQUIRED_INV_CATEGORIES.map(c => {
        const ok = inventory.some(i => i.category === c);
        return <Badge key={c} text={`${ok ? '✓' : '✗'} ${c}`} bg={ok ? COLORS.successBg : COLORS.dangerBg} fg={ok ? COLORS.success : COLORS.danger} />;
      })}
    </div>
  );
}

function SettingsPanel({ settings, onSave, managerPin, onChangePin }) {
  const [d, setD] = useState(() => mergeSettings(settings));
  const [saved, setSaved] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const [msg, setMsg] = useState(null);
  const [path, setPath] = useState('');
  useEffect(() => { if (window.printshopApi && window.printshopApi.dataPath) window.printshopApi.dataPath().then(setPath).catch(() => {}); }, []);
  const setCo = (k, v) => { setSaved(false); setD(p => ({ ...p, company: { ...p.company, [k]: v } })); };
  const setQ = (k, v) => { setSaved(false); setD(p => ({ ...p, quote: { ...p.quote, [k]: v } })); };
  const setC = (k, v) => { setSaved(false); setD(p => ({ ...p, calc: { ...p.calc, [k]: v } })); };
  const co = d.company, q = d.quote, c = d.calc;

  function pickLogo(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 420 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        setCo('logo', cv.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  }
  function savePin() {
    if (oldPin.trim() !== String(managerPin)) { setMsg({ ok: false, t: 'رمز فعلی اشتباه است.' }); return; }
    if (newPin.trim().length < 4) { setMsg({ ok: false, t: 'رمز جدید باید حداقل ۴ کاراکتر باشد.' }); return; }
    if (newPin !== newPin2) { setMsg({ ok: false, t: 'تکرار رمز جدید یکسان نیست.' }); return; }
    onChangePin(newPin.trim()); setOldPin(''); setNewPin(''); setNewPin2(''); setMsg({ ok: true, t: 'رمز مدیر تغییر کرد.' });
  }
  const card = { background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 };
  const g = (cols) => ({ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 10 });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 820 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6 }}><Settings size={18} /> تنظیمات</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {saved && <span style={{ color: COLORS.success, fontWeight: 700, fontSize: 12 }}>✓ ذخیره شد</span>}
          <PrimaryButton icon={Save} onClick={() => { onSave(mergeSettings(d)); setSaved(true); }}>ذخیره تنظیمات</PrimaryButton>
        </div>
      </div>

      <div style={card}>
        <SectionTitle>اطلاعات شرکت (در سربرگ همه‌ی چاپ‌ها)</SectionTitle>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          {co.logo ? <img src={co.logo} alt="" style={{ maxHeight: 80, maxWidth: 140, objectFit: 'contain', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 4 }} /> : <div style={{ width: 80, height: 80, border: `1px dashed ${COLORS.border}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.sub, fontSize: 11 }}>بدون لوگو</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="file" accept="image/*" onChange={pickLogo} style={{ fontSize: 12 }} />
            {co.logo && <GhostButton icon={Trash2} onClick={() => setCo('logo', '')} style={{ padding: '5px 10px', fontSize: 12 }}>حذف لوگو</GhostButton>}
          </div>
        </div>
        <div style={g(2)}>
          <Field label="نام شرکت / چاپخانه"><TextInput value={co.name} onChange={e => setCo('name', e.target.value)} /></Field>
          <Field label="نشانی"><TextInput value={co.address} onChange={e => setCo('address', e.target.value)} /></Field>
        </div>
        <div style={g(4)}>
          <Field label="نوع شخص فروشنده"><Select options={['حقیقی', 'حقوقی']} value={co.entityType || ''} onChange={e => setCo('entityType', e.target.value)} /></Field>
          <Field label="کد ملی فروشنده حقیقی"><TextInput value={co.nationalCode || ''} onChange={e => setCo('nationalCode', e.target.value)} /></Field>
          <Field label="شماره ثبت"><TextInput value={co.registerNo || ''} onChange={e => setCo('registerNo', e.target.value)} /></Field>
          <Field label="استان"><TextInput value={co.province || ''} onChange={e => setCo('province', e.target.value)} /></Field>
          <Field label="شهر"><TextInput value={co.city || ''} onChange={e => setCo('city', e.target.value)} /></Field>
          <Field label="نمابر"><TextInput value={co.fax || ''} onChange={e => setCo('fax', e.target.value)} /></Field>
          <Field label="تلفن"><TextInput value={co.phone} onChange={e => setCo('phone', e.target.value)} /></Field>
          <Field label="موبایل"><TextInput value={co.mobile} onChange={e => setCo('mobile', e.target.value)} /></Field>
          <Field label="کدپستی"><TextInput value={co.postalCode} onChange={e => setCo('postalCode', e.target.value)} /></Field>
          <Field label="شناسه ملی"><TextInput value={co.nationalId} onChange={e => setCo('nationalId', e.target.value)} /></Field>
          <Field label="کد اقتصادی"><TextInput value={co.economicCode} onChange={e => setCo('economicCode', e.target.value)} /></Field>
          <Field label="ایمیل"><TextInput value={co.email} onChange={e => setCo('email', e.target.value)} /></Field>
          <Field label="وب‌سایت"><TextInput value={co.website} onChange={e => setCo('website', e.target.value)} /></Field>
          <Field label="متن پایین فاکتور"><TextInput value={co.footer} onChange={e => setCo('footer', e.target.value)} /></Field>
        </div>
      </div>

      <div style={card}>
        <SectionTitle>پیش‌فاکتور و فاکتور</SectionTitle>
        <div style={g(2)}>
          <Field label="مدت اعتبار پیش‌فاکتور (روز)"><TextInput type="number" value={q.validityDays} onChange={e => setQ('validityDays', e.target.value)} /></Field>
          <Field label="مالیات بر ارزش افزوده‌ی پیش‌فرض (٪) — برای سفارش‌های جدید"><TextInput type="number" value={q.vatPercent} onChange={e => setQ('vatPercent', e.target.value)} /></Field>
        </div>
        <Field label="شرایط پیش‌فاکتور (زیر جدول چاپ می‌شود)"><textarea rows={4} value={q.terms} onChange={e => setQ('terms', e.target.value)} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.9 }} /></Field>
      </div>

      <div style={card}>
        <SectionTitle>پارامترهای عمومی محاسبه</SectionTitle>
        <div style={{ fontSize: 12, color: COLORS.sub, lineHeight: 1.9 }}>نرخ‌ها و هزینه‌ی ماشین‌ها و خدمات دیگر اینجا وارد نمی‌شود؛ از «واحدهای تولید» (نرخ و فرمول هر ماشین و خدمت) و «موجودی و کالاها» (قیمت مواد) گرفته می‌شود. این‌ها فقط پارامترهای فنی مشترک برای محاسبه‌ی ورق و پیشنهاد قیمت‌اند.</div>
        <div style={g(4)}>
          <Field label="ضایعات کاغذ (٪)"><TextInput type="number" value={c.wastePercent} onChange={e => setC('wastePercent', e.target.value)} /></Field>
          <Field label="باطله پیش‌فرض هر سفارش (نسخه)"><TextInput type="number" value={c.runWasteCopies ?? ''} onChange={e => setC('runWasteCopies', e.target.value)} placeholder="100" /></Field>
          <Field label="ورق آماده‌سازی هر فرم"><TextInput type="number" value={c.makeReadyPerForm} onChange={e => setC('makeReadyPerForm', e.target.value)} /></Field>
          <Field label="حاشیه ورق (سانتی‌متر)"><TextInput type="number" value={c.sheetMarginCm} onChange={e => setC('sheetMarginCm', e.target.value)} /></Field>
          <Field label="افزوده‌ی ابعاد جلد (سانتی‌متر)"><TextInput type="number" value={c.coverExtraCm} onChange={e => setC('coverExtraCm', e.target.value)} /></Field>
          <Field label="ضخامت برگ به ازای هر گرم (میلی‌متر)"><TextInput type="number" value={c.leafThicknessFactor} onChange={e => setC('leafThicknessFactor', e.target.value)} /></Field>
          <Field label="گرماژ پیش‌فرض جلد"><TextInput type="number" value={c.defaultCoverGsm} onChange={e => setC('defaultCoverGsm', e.target.value)} /></Field>
          <Field label="عرض رول سلفون (سانتی‌متر)"><TextInput type="number" value={c.cellophaneRollWidthCm} onChange={e => setC('cellophaneRollWidthCm', e.target.value)} /></Field>
          <Field label="سود پیشنهادی (٪)"><TextInput type="number" value={c.marginPercent} onChange={e => setC('marginPercent', e.target.value)} /></Field>
        </div>
      </div>

      <div style={card}>
        <SectionTitle>رمز تایید مدیر (برای ثبت سفارش مشتریان بدهکار)</SectionTitle>
        <div style={{ fontSize: 12, color: COLORS.sub }}>رمز پیش‌فرض ۱۲۳۴ است؛ لطفاً بعد از اولین ورود تغییرش بدهید.</div>
        <div style={g(3)}>
          <Field label="رمز فعلی"><TextInput type="password" value={oldPin} onChange={e => setOldPin(e.target.value)} /></Field>
          <Field label="رمز جدید"><TextInput type="password" value={newPin} onChange={e => setNewPin(e.target.value)} /></Field>
          <Field label="تکرار رمز جدید"><TextInput type="password" value={newPin2} onChange={e => setNewPin2(e.target.value)} /></Field>
        </div>
        {msg && <div style={{ color: msg.ok ? COLORS.success : COLORS.danger, fontSize: 12, fontWeight: 700 }}>{msg.t}</div>}
        <div><PrimaryButton icon={Save} onClick={savePin}>تغییر رمز</PrimaryButton></div>
      </div>

      {path && (
        <div style={card}>
          <SectionTitle>محل ذخیره اطلاعات</SectionTitle>
          <div dir="ltr" style={{ fontSize: 12, background: COLORS.altRow, borderRadius: 8, padding: 10, wordBreak: 'break-all', textAlign: 'left' }}>{path}</div>
          <div style={{ fontSize: 12, color: COLORS.sub }}>برای پشتیبان‌گیری، پوشه‌ی این فایل (PrintShopData) را کپی کنید. هر روز یک نسخه‌ی پشتیبان خودکار در پوشه‌ی backups داخل همین پوشه ساخته می‌شود.</div>
        </div>
      )}
    </div>
  );
}

/* ===================== تامین‌کنندگان و کاردکس ===================== */
const PAY_SELECT_STYLE = (st) => ({ border: `1px solid ${st.fg}`, background: st.bg, color: st.fg, borderRadius: 999, padding: '3px 8px', fontSize: 11, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' });
function PayBadge({ status }) { const st = PAY_STATES[status] || PAY_STATES.unpaid; return <Badge text={st.short} bg={st.bg} fg={st.fg} />; }
function invLabel(i) { return `${i.name}${i.gramaj ? ` ${i.gramaj}g` : ''}${i.size ? ` ${i.size}` : ''}${i.color ? ` ${i.color}` : ''}`; }
function receiptLinesText(r, inventory) {
  return (r.lines || []).filter(l => l.inventoryItemId).map(l => { const i = inventory.find(x => x.id === l.inventoryItemId); return i ? `${invLabel(i)} × ${fmt(Number(l.qty))} ${stockUnitLabel(i)}` : `کالای حذف‌شده × ${fmt(Number(l.qty))}`; }).join('، ');
}
function receiptsToRows(list, suppliers, inventory) {
  const name = (id) => (suppliers.find(s => s.id === id) || {}).name || '—';
  return [['تامین‌کننده', 'شماره رسید', 'تاریخ ورود', 'شماره فاکتور تأمین‌کننده', 'اقلام', 'مبلغ فاکتور (ریال)', 'نام راننده', 'شماره ماشین', 'تلفن راننده', 'وضعیت پرداخت', 'تاریخ پرداخت', 'توضیح'],
    ...list.map(r => [name(r.supplierId), faDate(r.date), r.invoiceNo, receiptLinesText(r, inventory), receiptAmount(r) || '', r.driverName, r.plate, r.driverPhone, (PAY_STATES[r.payStatus] || PAY_STATES.unpaid).long, r.payDate ? faDate(r.payDate) : '', r.note || ''])];
}

function ReceiptForm({ initial, supplier, inventory, canPay, isEdit, onSave, onCancel }) {
  const [v, setV] = useState(initial);
  const [errs, setErrs] = useState([]);
  const [avg, setAvg] = useState(true);
  const set = (k, val) => setV(prev => ({ ...prev, [k]: val }));
  const setLine = (id, patch) => setV(prev => ({ ...prev, lines: prev.lines.map(l => l.id === id ? { ...l, ...patch } : l) }));
  const mine = inventory.filter(i => i.supplierId === supplier.id);
  const others = inventory.filter(i => i.supplierId !== supplier.id);
  const unitOf = (id) => { const i = inventory.find(x => x.id === id); return i ? stockUnitLabel(i) : ''; };
  function save() {
    const e = isEdit ? (v.date ? [] : ['تاریخ ورود کالا را انتخاب کنید.']) : validReceipt(v);
    setErrs(e); if (e.length) return;
    onSave({ ...v, lines: isEdit ? v.lines : v.lines.filter(l => l.inventoryItemId && Number(cleanNumber(l.qty)) > 0).map(l => ({ ...l, qty: Number(cleanNumber(l.qty)), unitPrice: Number(cleanNumber(l.unitPrice)) || '' })) }, avg);
  }
  const box = { background: COLORS.altRow, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 };
  return (
    <div style={{ ...box, border: `1.5px solid ${COLORS.primary}`, background: '#FFFDF8' }}>
      <div style={{ fontWeight: 800, fontSize: 13, color: COLORS.primaryDark }}>{isEdit ? 'ویرایش اطلاعات ورود کالا' : 'ثبت ورود کالا از این تامین‌کننده'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Field label="تاریخ ورود کالا به انبار *"><JalaliDateInput value={v.date} onChange={val => set('date', val)} /></Field>
        <Field label="شماره فاکتور"><TextInput value={v.invoiceNo} onChange={e => set('invoiceNo', e.target.value)} /></Field>
        <Field label="مبلغ کل فاکتور (ریال) — خالی = جمع ردیف‌ها"><NumInput value={v.amount} onChange={e => set('amount', e.target.value)} /></Field>
        <Field label="نام راننده"><TextInput value={v.driverName} onChange={e => set('driverName', e.target.value)} /></Field>
        <Field label="شماره ماشین راننده"><TextInput value={v.plate} onChange={e => set('plate', e.target.value)} placeholder="مثلاً ۱۲ ب ۳۴۵ ایران ۶۷" /></Field>
        <Field label="شماره تلفن راننده"><TextInput value={v.driverPhone} onChange={e => set('driverPhone', e.target.value)} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Field label="وضعیت پرداخت به تامین‌کننده">
          <select value={v.payStatus} disabled={!canPay} onChange={e => set('payStatus', e.target.value)} style={{ ...inputStyle, ...(PAY_STATES[v.payStatus] ? { borderColor: PAY_STATES[v.payStatus].fg } : {}) }}>
            {PAY_ORDER.map(k => <option key={k} value={k}>{PAY_STATES[k].long}</option>)}
          </select>
          {!canPay && <div style={{ fontSize: 11, color: COLORS.sub, marginTop: 3 }}>وضعیت پرداخت را مدیر یا مدیر مالی تعیین می‌کند.</div>}
        </Field>
        {v.payStatus === 'paid' && <Field label="تاریخ پرداخت"><JalaliDateInput value={v.payDate} onChange={val => set('payDate', val)} /></Field>}
        <Field label="توضیحات"><TextInput value={v.note} onChange={e => set('note', e.target.value)} /></Field>
      </div>
      <div style={{ fontWeight: 800, fontSize: 12, color: COLORS.primaryDark }}>اقلام وارد‌شده{isEdit ? ' (برای تغییر اقلام، این ورود را حذف و دوباره ثبت کنید)' : ''}</div>
      {v.lines.map(l => (
        <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '2.4fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
          <Field label="کالا">
            <select value={l.inventoryItemId} disabled={isEdit} onChange={e => setLine(l.id, { inventoryItemId: e.target.value })} style={inputStyle}>
              <option value="">— انتخاب کالا از انبار —</option>
              {mine.length > 0 && <optgroup label="کالاهای این تامین‌کننده">{mine.map(i => <option key={i.id} value={i.id}>{invLabel(i)}</option>)}</optgroup>}
              <optgroup label={mine.length ? 'سایر کالاها' : 'کالاها'}>{others.map(i => <option key={i.id} value={i.id}>{invLabel(i)}</option>)}</optgroup>
            </select>
          </Field>
          <Field label={`مقدار${unitOf(l.inventoryItemId) ? ` (${unitOf(l.inventoryItemId)})` : ''}`}><NumInput value={l.qty} disabled={isEdit} onChange={e => setLine(l.id, { qty: e.target.value })} /></Field>
          <Field label="قیمت واحد (ریال) — اختیاری"><NumInput value={l.unitPrice} disabled={isEdit} onChange={e => setLine(l.id, { unitPrice: e.target.value })} /></Field>
          {!isEdit && <IconButton icon={X} danger title="حذف ردیف" onClick={() => set('lines', v.lines.length > 1 ? v.lines.filter(x => x.id !== l.id) : v.lines)} />}
        </div>
      ))}
      {!isEdit && <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <GhostButton icon={Plus} onClick={() => set('lines', [...v.lines, { id: uid(), inventoryItemId: '', qty: '', unitPrice: '' }])} style={{ padding: '4px 10px', fontSize: 12 }}>افزودن ردیف کالا</GhostButton>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}><input type="checkbox" checked={avg} onChange={e => setAvg(e.target.checked)} /> اگر قیمت واحد وارد شد، قیمت واحد انبار با میانگین موزون به‌روز شود</label>
      </div>}
      {!isEdit && <div style={{ fontSize: 11, color: COLORS.sub }}>با ذخیره، مقدارها به موجودی انبار اضافه و در کاردکس کالا ثبت می‌شود.</div>}
      {errs.length > 0 && <div style={{ background: COLORS.dangerBg, color: COLORS.danger, borderRadius: 8, padding: 8, fontSize: 12 }}>{errs.map((x, i) => <div key={i}>• {x}</div>)}</div>}
      <div style={{ display: 'flex', gap: 8 }}><PrimaryButton icon={Save} onClick={save}>{isEdit ? 'ذخیره‌ی تغییرات' : 'ثبت ورود کالا'}</PrimaryButton><GhostButton onClick={onCancel}>انصراف</GhostButton></div>
    </div>
  );
}

function ReceiptTable({ receipts, suppliers, inventory, showSupplier, canPay, onStatus, onEdit, onDelete }) {
  const th = { padding: '8px 8px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' };
  const nameOf = (id) => (suppliers.find(s => s.id === id) || {}).name || '—';
  const sorted = [...receipts].sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt || 0) - (a.createdAt || 0));
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr style={{ background: COLORS.primary, color: '#fff' }}>{[...(showSupplier ? ['تامین‌کننده'] : []), 'شماره رسید', 'تاریخ ورود', 'شماره فاکتور تأمین‌کننده', 'اقلام', 'مبلغ (ریال)', 'راننده', 'شماره ماشین', 'تلفن راننده', 'وضعیت پرداخت', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {sorted.map((r, idx) => {
            const st = PAY_STATES[r.payStatus] || PAY_STATES.unpaid;
            return (
              <tr key={r.id} style={{ background: idx % 2 ? COLORS.altRow : '#fff', borderRight: `5px solid ${st.fg}` }}>
                {showSupplier && <td style={{ padding: '8px', fontWeight: 700 }}>{nameOf(r.supplierId)}</td>}
                <td style={{ padding: '8px' }}><bdi>{faDigits(r.receiptNumber) || 'قدیمی'}</bdi></td><td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{faDate(r.date)}</td>
                <td style={{ padding: '8px', fontWeight: 700 }}>{r.invoiceNo || '—'}</td>
                <td style={{ padding: '8px', minWidth: 190 }}>{receiptLinesText(r, inventory)}</td>
                <td style={{ padding: '8px' }}>{receiptAmount(r) ? fmt(receiptAmount(r)) : '—'}</td>
                <td style={{ padding: '8px' }}>{r.driverName || '—'}</td>
                <td style={{ padding: '8px' }}>{r.plate || '—'}</td>
                <td style={{ padding: '8px', direction: 'ltr', textAlign: 'right' }}>{r.driverPhone || '—'}</td>
                <td style={{ padding: '8px' }}>
                  {canPay && onStatus
                    ? <select value={r.payStatus || 'unpaid'} onChange={e => onStatus(r, e.target.value)} style={PAY_SELECT_STYLE(st)}>{PAY_ORDER.map(k => <option key={k} value={k}>{PAY_STATES[k].short}</option>)}</select>
                    : <PayBadge status={r.payStatus} />}
                  {r.payStatus === 'paid' && r.payDate && <div style={{ fontSize: 11, color: COLORS.sub }}>{faDate(r.payDate)}</div>}
                </td>
                <td style={{ padding: '8px' }}><div style={{ display: 'flex', gap: 6 }}>{onEdit && <IconButton icon={Pencil} title="ویرایش" onClick={() => onEdit(r)} />}{onDelete && <IconButton icon={Trash2} danger title="حذف" onClick={() => onDelete(r)} />}</div></td>
              </tr>
            );
          })}
          {sorted.length === 0 && <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', color: COLORS.sub }}>ورودی ثبت نشده است.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
function ReceiptSummaryChips({ receipts }) {
  const sm = receiptSummary(receipts);
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {PAY_ORDER.map(k => <div key={k} style={{ background: PAY_STATES[k].bg, color: PAY_STATES[k].fg, borderRadius: 10, padding: '6px 12px', fontSize: 12, fontWeight: 800 }}>{PAY_STATES[k].short}: {fmt(sm[k].count)} فاکتور{sm[k].amount ? ` — ${fmt(sm[k].amount)} ریال` : ''}</div>)}
    </div>
  );
}

function SupplierLedgerModal({ supplier, suppliers, inventory, receipts, settings, canPay, onAddReceipt, onUpdateReceipt, onDeleteReceipt, onClose }) {
  const [printing, setPrinting] = useState(false);
  const [form, setForm] = useState(null);
  const mine = receipts.filter(r => r.supplierId === supplier.id);
  const items = inventory.filter(i => i.supplierSource === 'تامین‌کننده' && i.supplierId === supplier.id);
  const receiptBody = <ReceiptTable receipts={mine} suppliers={suppliers} inventory={inventory} canPay={false} />;
  const stockBody = items.length === 0 ? null : (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr style={{ background: COLORS.primaryDark, color: '#fff' }}>{['نام کالا', 'دسته', 'موجودی فعلی', 'ارزش کل'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'right' }}>{h}</th>)}</tr></thead>
      <tbody>{items.map((i, idx) => (
        <tr key={i.id} style={{ background: idx % 2 ? COLORS.altRow : '#fff' }}>
          <td style={{ padding: '8px 10px', fontWeight: 700 }}>{invLabel(i)}</td><td style={{ padding: '8px 10px' }}>{i.category}</td>
          <td style={{ padding: '8px 10px' }}>{fmt(stockLevel(i))} {stockUnitLabel(i)}</td><td style={{ padding: '8px 10px' }}>{fmt(itemValue(i))} ریال</td>
        </tr>))}</tbody>
    </table>
  );
  function exportExcel() { saveWorkbook(`کاردکس-${supplier.name}.xlsx`, [{ name: 'ورودی‌ها', rows: receiptsToRows(mine, suppliers, inventory) }]); }
  if (printing) return <ReportPrint settings={settings} title={`کاردکس تامین‌کننده — ${supplier.name}`} signatures={['انباردار', 'مدیر سفارشات', 'مدیر چاپخانه']} onClose={() => setPrinting(false)}><PrintTable head={['شماره رسید', 'تاریخ ورود', 'شماره فاکتور تأمین‌کننده', 'اقلام', 'مبلغ (ریال)', 'راننده', 'شماره ماشین', 'تلفن راننده', 'وضعیت پرداخت']} widths={['8%', '10%', '12%', '20%', '10%', '10%', '10%', '10%', '10%']} rows={[...mine].sort((a, b) => String(a.date).localeCompare(String(b.date))).map(r => [faDigits(r.receiptNumber) || '—', faDate(r.date), r.invoiceNo || '—', receiptLinesText(r, inventory), receiptAmount(r) ? fmt(receiptAmount(r)) : '—', r.driverName || '—', r.plate || '—', r.driverPhone || '—', (PAY_STATES[r.payStatus] || PAY_STATES.unpaid).short])} />{items.length > 0 && <div style={{ marginTop: 10 }}><div style={{ fontWeight: 800, fontSize: 11, marginBottom: 3 }}>موجودی فعلی کالاهای این تامین‌کننده</div><PrintTable head={['نام کالا', 'دسته', 'موجودی فعلی', 'ارزش کل (ریال)']} rows={items.map(i => [invLabel(i), i.category, `${fmt(stockLevel(i))} ${stockUnitLabel(i)}`, fmt(itemValue(i))])} /></div>}</ReportPrint>;
  return (
    <Modal title={`کاردکس تامین‌کننده — ${supplier.name}`} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <PrimaryButton icon={Plus} onClick={() => setForm({ mode: 'new', data: emptyReceipt(supplier.id, todayIso()) })}>ثبت ورود کالا</PrimaryButton>
          <GhostButton icon={Printer} onClick={() => setPrinting(true)}>چاپ کاردکس</GhostButton>
          <GhostButton icon={FileText} onClick={exportExcel}>خروجی اکسل</GhostButton>
        </div>
        <ReceiptSummaryChips receipts={mine} />
        {form && <ReceiptForm key={form.data.id} initial={form.data} isEdit={form.mode === 'edit'} supplier={supplier} inventory={inventory} canPay={canPay}
          onCancel={() => setForm(null)} onSave={(r, avg) => { if (form.mode === 'edit') onUpdateReceipt(r); else onAddReceipt(r, avg); setForm(null); }} />}
        <ReceiptTable receipts={mine} suppliers={suppliers} inventory={inventory} canPay={canPay} onStatus={(r, st) => onUpdateReceipt({ ...r, payStatus: st, payDate: st === 'paid' ? (r.payDate || todayIso()) : r.payDate })}
          onEdit={(r) => setForm({ mode: 'edit', data: r })} onDelete={(r) => onDeleteReceipt(r)} />
        {stockBody && <div><SectionTitle small>موجودی فعلی کالاهای این تامین‌کننده</SectionTitle>{stockBody}</div>}
      </div>
    </Modal>
  );
}

function SuppliersPanel({ suppliers, inventory, receipts, settings, canPay, onNew, onEdit, onDelete, onLedger, onUpdateReceipt, onDeleteReceipt, onImport, canReview, onReview, onToggleActive }) {
  const [view, setView] = useState('list');
  const [bankView, setBankView] = useState('work');
  const [q, setQ] = useState('');
  const [rf, setRf] = useState({ supplierId: '', status: '', from: '', to: '', q: '' });
  const names = Object.fromEntries(suppliers.map(s => [s.id, s.name]));
  const bankFilters = { work: usableParty, pending: s => partyReview(s) === 'pending', rejected: s => partyReview(s) === 'rejected', inactive: s => !partyActive(s), all: () => true };
  const shown = suppliers.filter(bankFilters[bankView]).filter(s => !q.trim() || `${s.name} ${s.phone} ${s.materials} ${s.nationalId || ''} ${s.repName || ''}`.includes(q.trim()));
  const bankCounts = { work: workList(suppliers).length, pending: suppliers.filter(s => partyReview(s) === 'pending').length, rejected: suppliers.filter(s => partyReview(s) === 'rejected').length, inactive: suppliers.filter(s => !partyActive(s)).length, all: suppliers.length };
  const rlist = filterReceipts(receipts, rf, names);
  const tabBtn = (id, label) => <button key={id} onClick={() => setView(id)} style={{ padding: '7px 16px', borderRadius: 9, border: `1px solid ${view === id ? COLORS.primary : COLORS.border}`, background: view === id ? COLORS.primary : '#fff', color: view === id ? '#fff' : COLORS.text, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>;
  function exportSuppliers() {
    saveWorkbook('تامین‌کنندگان.xlsx', [{ name: 'تامین‌کنندگان', rows: [['نام', 'نوع', 'شناسه ملی', 'شماره ثبت', 'کد اقتصادی', 'تلفن', 'کد پستی', 'نشانی', 'مواد قابل تامین', 'نماینده', 'سمت', 'تلفن نماینده', 'یادداشت'],
      ...shown.map(s => [s.name, s.entityType, s.nationalId || '', s.registerNo || '', s.economicCode || '', s.phone, s.postalCode, s.address, s.materials, s.repName || '', s.repName ? (s.repRole || '') : '', s.repPhone || '', s.note || ''])] }]);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6 }}><Truck size={18} /> تامین‌کنندگان</div>
        <div style={{ display: 'flex', gap: 8 }}>{tabBtn('list', 'فهرست تامین‌کنندگان')}{tabBtn('receipts', `ورودی‌ها و پرداخت‌ها (${receipts.length})`)}</div>
      </div>
      {view === 'list' && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {[['work', 'فهرست کاری'], ['pending', 'در انتظار بررسی'], ['rejected', 'رد شده'], ['inactive', 'غیرفعال'], ['all', 'همهٔ بانک']].map(([key, name]) => (
              <button key={key} type="button" onClick={() => setBankView(key)} aria-pressed={bankView === key} style={{ padding: '5px 11px', borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: 'pointer', font: 'inherit', border: `1px solid ${bankView === key ? COLORS.primaryDark : COLORS.border}`, background: bankView === key ? COLORS.primary : '#fff', color: bankView === key ? '#fff' : COLORS.text }}>
                {name} ({fmt(bankCounts[key])})
              </button>
            ))}
            {bankView === 'work' && hiddenCount(suppliers) > 0 && <span style={{ fontSize: 11, color: COLORS.sub }}>{fmt(hiddenCount(suppliers))} رکورد تأییدنشده یا غیرفعال بیرون است؛ هیچ اطلاعاتی پاک نشده است.</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: '6px 10px', width: 260 }}>
              <Search size={14} color={COLORS.sub} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="نام، تلفن، مواد..." style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, background: 'transparent', fontFamily: 'inherit' }} />
            </div>
            <div style={{ flex: 1 }} />
            {onImport && <GhostButton icon={Sheet} onClick={onImport}>ورود از اکسل</GhostButton>}
            <GhostButton icon={FileText} onClick={exportSuppliers}>خروجی اکسل</GhostButton>
            <PrimaryButton icon={Plus} onClick={onNew}>تامین‌کننده جدید</PrimaryButton>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: COLORS.primary, color: '#fff' }}>{['نام', 'نوع', 'تلفن', 'نماینده', 'مواد قابل تامین', 'فاکتور پرداخت‌نشده', ''].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>{h}</th>)}</tr></thead>
              <tbody>
                {shown.map((s, idx) => {
                  const unpaid = receipts.filter(r => r.supplierId === s.id && (r.payStatus || 'unpaid') !== 'paid');
                  return (
                    <tr key={s.id} style={{ background: idx % 2 ? COLORS.altRow : '#fff' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 700 }}>{s.name}{s.supplierCode && <Badge text={s.supplierCode} bg="#e9eef6" fg="#1d3557" />}{!usableParty(s) && <Badge text={partyBadge(s)} bg={partyActive(s) ? COLORS.warnBg : '#e6e2dc'} fg={partyActive(s) ? COLORS.warn : '#5a5148'} />}</td>
                      <td style={{ padding: '8px 10px' }}>{s.entityType}</td>
                      <td style={{ padding: '8px 10px' }}>{s.phone}</td>
                      <td style={{ padding: '8px 10px' }}>{s.repName ? `${s.repName} (${s.repRole})` : '—'}</td>
                      <td style={{ padding: '8px 10px' }}>{s.materials}</td>
                      <td style={{ padding: '8px 10px' }}>{unpaid.length ? <Badge text={`${unpaid.length} فاکتور`} bg={PAY_STATES.unpaid.bg} fg={PAY_STATES.unpaid.fg} /> : '—'}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
                          {canReview && partyReview(s) !== 'approved' && <GhostButton onClick={() => onReview(s)} style={{ padding: '4px 8px', fontSize: 11 }}>بررسی و تأیید</GhostButton>}
                          {canReview && partyReview(s) === 'approved' && !s.supplierCode && <GhostButton onClick={() => onReview(s)} style={{ padding: '4px 8px', fontSize: 11 }}>صدور کد یکتا</GhostButton>}
                          {canReview && partyReview(s) === 'approved' && !!s.supplierCode && <GhostButton onClick={() => onToggleActive(s)} style={{ padding: '4px 8px', fontSize: 11 }}>{partyActive(s) ? 'غیرفعال کردن' : 'فعال کردن'}</GhostButton>}
                          <GhostButton onClick={() => onLedger(s)} style={{ padding: '4px 8px', fontSize: 11 }}>کاردکس</GhostButton>
                          <IconButton icon={Pencil} title="ویرایش" onClick={() => onEdit(s)} />
                          <IconButton icon={Trash2} danger title="حذف" onClick={() => onDelete(s.id)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: COLORS.sub }}>{suppliers.length === 0 ? 'هنوز تامین‌کننده‌ای ثبت نشده است.' : 'تامین‌کننده‌ای پیدا نشد.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      {view === 'receipts' && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={rf.supplierId} onChange={e => setRf({ ...rf, supplierId: e.target.value })} style={{ ...inputStyle, width: 200 }}><option value="">همه‌ی تامین‌کنندگان</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <select value={rf.status} onChange={e => setRf({ ...rf, status: e.target.value })} style={{ ...inputStyle, width: 190 }}><option value="">همه‌ی وضعیت‌های پرداخت</option>{PAY_ORDER.map(k => <option key={k} value={k}>{PAY_STATES[k].short}</option>)}</select>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 12 }}>از</span><JalaliDateInput value={rf.from} onChange={v => setRf({ ...rf, from: v })} /></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 12 }}>تا</span><JalaliDateInput value={rf.to} onChange={v => setRf({ ...rf, to: v })} /></div>
            <input value={rf.q} onChange={e => setRf({ ...rf, q: e.target.value })} placeholder="شماره فاکتور، راننده، پلاک..." style={{ ...inputStyle, width: 220 }} />
            {(rf.supplierId || rf.status || rf.from || rf.to || rf.q) && <GhostButton onClick={() => setRf({ supplierId: '', status: '', from: '', to: '', q: '' })} style={{ padding: '4px 10px', fontSize: 12 }}>پاک‌کردن فیلترها</GhostButton>}
            <div style={{ flex: 1 }} />
            <GhostButton icon={FileText} onClick={() => saveWorkbook('ورودی-و-پرداخت-تامین‌کنندگان.xlsx', [{ name: 'ورودی‌ها', rows: receiptsToRows([...rlist].sort((a, b) => String(b.date).localeCompare(String(a.date))), suppliers, inventory) }])}>خروجی اکسل ({fmt(rlist.length)} ردیف)</GhostButton>
            <PrintReportButton settings={settings} title="گزارش ورودی کالا و پرداخت به تامین‌کنندگان" signatures={['انباردار', 'مدیر مالی', 'مدیر چاپخانه']}>{() => <PrintTable head={['تامین‌کننده', 'تاریخ ورود', 'فاکتور', 'اقلام', 'مبلغ (ریال)', 'راننده / ماشین', 'وضعیت پرداخت']} widths={['13%', '9%', '9%', '25%', '12%', '16%', '12%']} rows={[...rlist].sort((a, b) => String(a.date).localeCompare(String(b.date))).map(r => [names[r.supplierId] || '—', faDate(r.date), r.invoiceNo || '—', receiptLinesText(r, inventory), receiptAmount(r) ? fmt(receiptAmount(r)) : '—', `${r.driverName || '—'}${r.plate ? ` / ${r.plate}` : ''}`, (PAY_STATES[r.payStatus] || PAY_STATES.unpaid).short])} foot={['', '', '', `${fmt(rlist.length)} ورود`, fmt(receiptSummary(rlist).total.amount), '', '']} />}</PrintReportButton>
          </div>
          <ReceiptSummaryChips receipts={rlist} />
          <div style={{ fontSize: 11, color: COLORS.sub }}>رنگ‌ها: <span style={{ color: PAY_STATES.paid.fg, fontWeight: 800 }}>سبز</span> پرداخت‌شده — <span style={{ color: PAY_STATES.processing.fg, fontWeight: 800 }}>آبی</span> تایید شده و در شرف پرداخت — <span style={{ color: PAY_STATES.unpaid.fg, fontWeight: 800 }}>قرمز</span> هنوز اقدامی نشده.{canPay ? ' وضعیت را مستقیم از ستون آخر عوض کنید.' : ''}</div>
          <ReceiptTable receipts={rlist} suppliers={suppliers} inventory={inventory} showSupplier canPay={canPay} onStatus={(r, st) => onUpdateReceipt({ ...r, payStatus: st, payDate: st === 'paid' ? (r.payDate || todayIso()) : r.payDate })} onDelete={(r) => onDeleteReceipt(r)} />
        </>
      )}
    </div>
  );
}

function SupplierForm({ initial, onSave, onCancel }) {
  const [v, setV] = useState({ registerNo: '', ...initial });
  const set = (k, val) => setV(prev => ({ ...prev, [k]: val }));
  const legal = v.entityType === 'حقوقی';
  function handleSave() { if (!v.name.trim()) { alert('نام تامین‌کننده را وارد کنید.'); return; } onSave(v); }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <Field label="نوع شخصیت"><Select options={['حقیقی', 'حقوقی']} value={v.entityType} onChange={e => set('entityType', e.target.value)} /></Field>
        <Field label="نام تامین‌کننده"><TextInput value={v.name} onChange={e => set('name', e.target.value)} /></Field>
      </div>
      {legal && (
        <>
          <SectionTitle small>اطلاعات حقوقی</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <Field label="شماره ثبت"><TextInput value={v.registerNo || ''} onChange={e => set('registerNo', e.target.value)} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
            <Field label="شناسه ملی"><TextInput value={v.nationalId} onChange={e => set('nationalId', e.target.value)} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
            <Field label="کد اقتصادی"><TextInput value={v.economicCode} onChange={e => set('economicCode', e.target.value)} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
          </div>
        </>
      )}
      <SectionTitle small>تماس و نشانی</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <Field label="شماره تماس"><TextInput value={v.phone} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="کد پستی"><TextInput value={v.postalCode} onChange={e => set('postalCode', e.target.value)} /></Field>
        <div style={{ gridColumn: 'span 2' }}><Field label="آدرس"><TextInput value={v.address} onChange={e => set('address', e.target.value)} /></Field></div>
        <div style={{ gridColumn: 'span 2' }}><Field label="مواد قابل تامین"><TextInput value={v.materials} onChange={e => set('materials', e.target.value)} /></Field></div>
      </div>
      {legal && (
        <>
          <SectionTitle small>نماینده شرکت</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <Field label="نام نماینده"><TextInput value={v.repName} onChange={e => set('repName', e.target.value)} /></Field>
            <Field label="شماره تماس نماینده"><TextInput value={v.repPhone} onChange={e => set('repPhone', e.target.value)} /></Field>
            <Field label="سمت"><Select options={REP_ROLES} value={v.repRole} onChange={e => set('repRole', e.target.value)} /></Field>
          </div>
        </>
      )}
      <Field label="یادداشت"><TextInput value={v.note} onChange={e => set('note', e.target.value)} /></Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: `1px solid ${COLORS.border}`, paddingTop: 14 }}>
        <GhostButton onClick={onCancel}>انصراف</GhostButton>
        <PrimaryButton icon={Save} onClick={handleSave}>ذخیره</PrimaryButton>
      </div>
    </div>
  );
}


/* ===================== کاربران و سطح دسترسی ===================== */
const ALL_TABS = ['dashboard', 'orders', 'production', 'archive', 'inventory', 'customers', 'suppliers', 'units', 'finance', 'report', 'letters', 'excel', 'settings'];
const SUPERVISOR_ROLES = ['سرپرست لیتوگرافی', 'سرپرست چاپ دیجیتال', 'سرپرست چاپ', 'سرپرست صحافی'];
/* اصلاحات ۱۷/بند ۳ (تصمیم کارفرما به پرسش ۱): «ناظر کیفیت» نقشِ کنترل کیفیت است —
   این‌جا در فهرست نقش‌ها و سطح‌دسترسی‌ها می‌آید؛ گیتِ واقعیِ «سالم» در سرور است. */
const STAFF_ROLES = ['مدیر چاپخانه', 'کارشناس سفارشات', 'انباردار', 'مدیر مالی', QC_ROLE, ...SUPERVISOR_ROLES];
const ROLE_PERMS = {
  'مدیر چاپخانه': { tabs: ALL_TABS, newOrder: true, manageOrder: true, approveProduction: true, deleteOrder: true, stage: true, printForm: true, anyCopy: true, users: true, addStock: true },
  'کارشناس سفارشات': { tabs: ['orders', 'production', 'report', 'letters', 'excel'], newOrder: true },
  'انباردار': { tabs: ['inventory', 'suppliers', 'production', 'letters', 'excel'] },
  'مدیر مالی': { tabs: ['finance', 'report', 'orders', 'production', 'inventory', 'suppliers', 'letters', 'excel'], manageOrder: true, printForm: true, anyCopy: true },
  'ناظر کیفیت': { tabs: ['orders', 'production', 'report', 'letters'] },
  'مشتری': { tabs: ['request', 'myfinance'], customer: true },
};
SUPERVISOR_ROLES.forEach(r => { ROLE_PERMS[r] = { tabs: ['forms', 'production', 'report', 'letters'], formsOnly: true, stage: true, printForm: true }; });
const NO_PERMS = { tabs: [] };
const permsFor = (role) => ROLE_PERMS[role] || NO_PERMS;
const ROLE_NOTES = {
  'مدیر چاپخانه': 'دسترسی به همه‌ی بخش‌ها',
  'مشتری': 'ثبت درخواست سفارش + مالی خودِ خودش (فقط نمایش، فقط رکوردهای خودش)',
  'کارشناس سفارشات': 'فقط ثبت سفارش؛ تابلوی تولید فقط نمایشی',
  'انباردار': 'انبار و تامین‌کنندگان + تابلوی تولید (فقط نمایش، بدون هیچ مبلغی)',
  'مدیر مالی': 'انبار، تامین‌کنندگان، پیش‌فاکتور و فاکتور، اصلاح سفارش (بدون ثبت سفارش جدید)؛ تابلوی تولید فقط نمایشی',
  'ناظر کیفیت': 'ثبت «تعداد سالم» در کنترل کیفیت (بدون هیچ مبلغی)؛ تحویل و فاکتور را این نقش ثبت نمی‌کند',
  'سرپرست لیتوگرافی': 'فقط مشاهده و چاپ فرم سفارش (بدون مبلغ)؛ تابلوی تولید فقط نمایشی',
  'سرپرست چاپ دیجیتال': 'فقط مشاهده و چاپ فرم سفارش (بدون مبلغ)؛ تابلوی تولید فقط نمایشی',
  'سرپرست چاپ': 'فقط مشاهده و چاپ فرم سفارش (بدون مبلغ)؛ تابلوی تولید فقط نمایشی',
  'سرپرست صحافی': 'فقط مشاهده و چاپ فرم سفارش (بدون مبلغ)؛ تابلوی تولید فقط نمایشی',
};
const isSecure = () => typeof window !== 'undefined' && !!(window.printshopApi && window.printshopApi.secure);
function hashPass(p) {
  let h1 = 0xdeadbeef ^ 7, h2 = 0x41c6ce57 ^ 7;
  const str = 'ps|' + String(p);
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'h' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const DEFAULT_ADMIN = { id: 'u_admin', name: 'مدیر چاپخانه', username: 'admin', passHash: hashPass('1234'), role: 'مدیر چاپخانه', active: true };
const normUser = (v) => String(v || '').trim().toLowerCase();

function LoginScreen({ company, firstHint, warning, onSubmit }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (busy) return;
    setBusy(true);
    const r = await onSubmit(username, password);
    setBusy(false);
    if (r && !r.ok) setErr(r.error || 'ورود ممکن نشد.');
  }
  const onKey = (e) => { if (e.key === 'Enter') submit(); };
  return (
    <div dir="rtl" style={{ fontFamily: "'Vazirmatn', Tahoma, Arial, sans-serif", background: COLORS.cream, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: 380, background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 26, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign: 'center' }}>
          <img src={(company && company.logo) || logoUrl} alt="" style={{ height: 78, maxWidth: 200, objectFit: 'contain' }} />
          <div style={{ fontWeight: 800, fontSize: 16, color: COLORS.primaryDark, marginTop: 8 }}>{(company && company.name) || SHOP_NAME}</div>
          <div style={{ fontSize: 12, color: COLORS.sub }}>سامانه مدیریت سفارش، انبار و مالی</div>
        </div>
        <Field label="نام کاربری"><TextInput value={username} onChange={e => { setUsername(e.target.value); setErr(''); }} onKeyDown={onKey} autoFocus style={{ direction: 'ltr', textAlign: 'left' }} /></Field>
        <Field label="رمز عبور"><TextInput type="password" value={password} onChange={e => { setPassword(e.target.value); setErr(''); }} onKeyDown={onKey} style={{ direction: 'ltr', textAlign: 'left' }} /></Field>
        {err && <div style={{ color: COLORS.danger, fontSize: 12, fontWeight: 700, lineHeight: 1.9 }}>{err}</div>}
        <PrimaryButton icon={Lock} onClick={submit} style={{ justifyContent: 'center', opacity: busy ? 0.6 : 1 }}>{busy ? 'در حال ورود...' : 'ورود'}</PrimaryButton>
        {firstHint && <div style={{ fontSize: 11, color: COLORS.sub, lineHeight: 1.9, background: COLORS.altRow, borderRadius: 8, padding: 8 }}>اولین ورود: نام کاربری <strong>admin</strong> و رمز <strong>1234</strong>. بلافاصله بعد از ورود از شما رمز جدید خواسته می‌شود.</div>}
        {warning && <div style={{ fontSize: 11, color: COLORS.danger, lineHeight: 1.9, background: COLORS.dangerBg, borderRadius: 8, padding: 8 }}>{warning}</div>}
        <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 10, fontSize: 11, color: COLORS.sub, lineHeight: 1.9, textAlign: 'center' }}>برای ثبت سفارش آنلاین، نام کاربری و رمز را از چاپخانه بگیرید.</div>
      </div>
    </div>
  );
}

function ForcePassword({ user, onSave }) {
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState('');
  async function save() {
    if (a.length < 6) { setErr('رمز جدید باید حداقل ۶ کاراکتر باشد.'); return; }
    if (a === '1234' || a.toLowerCase() === 'admin') { setErr('این رمز قابل حدس است؛ رمز دیگری انتخاب کنید.'); return; }
    if (a !== b) { setErr('تکرار رمز با رمز جدید یکی نیست.'); return; }
    const r = await onSave(a);
    if (r && !r.ok) setErr(r.error || 'ذخیره‌ی رمز ممکن نشد.');
  }
  return (
    <div dir="rtl" style={{ fontFamily: "'Vazirmatn', Tahoma, Arial, sans-serif", background: COLORS.cream, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: 400, background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={18} /> تغییر رمز الزامی است</div>
        <div style={{ fontSize: 12, color: COLORS.sub, lineHeight: 2 }}>با رمز پیش‌فرض وارد شده‌اید. برای امنیت اطلاعات چاپخانه، همین حالا رمز جدید انتخاب کنید (حداقل ۶ کاراکتر). بدون این کار نمی‌توانید ادامه دهید.</div>
        <Field label="رمز جدید"><TextInput type="password" value={a} onChange={e => { setA(e.target.value); setErr(''); }} style={{ direction: 'ltr', textAlign: 'left' }} autoFocus /></Field>
        <Field label="تکرار رمز جدید"><TextInput type="password" value={b} onChange={e => { setB(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') save(); }} style={{ direction: 'ltr', textAlign: 'left' }} /></Field>
        {err && <div style={{ color: COLORS.danger, fontSize: 12, fontWeight: 700 }}>{err}</div>}
        <PrimaryButton icon={Save} onClick={save} style={{ justifyContent: 'center' }}>ذخیره‌ی رمز و ادامه</PrimaryButton>
      </div>
    </div>
  );
}

/* ===================== درخواست سفارش توسط مشتری (فقط ثبت متن؛ هیچ اطلاعات دیگری دیده نمی‌شود) ===================== */
function UsersManager({ users, currentUser, onSave, customers = [] }) {
  const blank = { name: '', username: '', password: '', role: 'کارشناس سفارشات', station: '', customerId: '' };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState(null);
  const [resetFor, setResetFor] = useState(null);
  const [newPass, setNewPass] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const eligibleCustomers = customers.filter(c => !!c.customerCode && c.eligibility?.status === 'approved' && c.active !== false);
  async function saveList(next) {
    if (saving.current) return false;
    saving.current = true; setBusy(true); setMsg(null);
    try {
      const result = await onSave(next);
      if (!result?.ok) { setMsg({ ok: false, t: result?.error || 'ذخیره انجام نشد.' }); return false; }
      setMsg({ ok: true, t: 'تغییرات کاربران ثبت شد.' }); return true;
    } catch (_) { setMsg({ ok: false, t: 'ذخیره انجام نشد؛ دوباره تلاش کنید.' }); return false; }
    finally { saving.current = false; setBusy(false); }
  }
  const card = { background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 };
  const managers = users.filter(u => u.role === 'مدیر چاپخانه' && u.active !== false);
  async function add() {
    const username = f.username.trim();
    if (!f.name.trim() || !username || f.password.length < 4) { setMsg({ ok: false, t: 'نام، نام کاربری و رمز (حداقل ۴ کاراکتر) را کامل وارد کنید.' }); return; }
    if (users.some(u => normUser(u.username) === normUser(username))) { setMsg({ ok: false, t: 'این نام کاربری قبلاً ثبت شده است.' }); return; }
    if (f.role === 'مشتری' && !f.customerId) { setMsg({ ok: false, t: 'برای کاربر مشتری، مشتری مربوطه را از فهرست انتخاب کنید.' }); return; }
    if (f.role === 'مشتری' && !eligibleCustomers.some(c => c.id === f.customerId)) { setMsg({ ok: false, t: 'ابتدا شمارهٔ یکتا و تأیید صلاحیت مشتری را در بخش مشتریان ثبت کنید.' }); return; }
    if (await saveList([...users, { id: uid(), name: f.name.trim(), username, passHash: hashPass(f.password), _plain: f.password, role: f.role, station: f.role === 'مشتری' ? '' : f.station.trim(), active: true, ...(f.role === 'مشتری' ? { customerId: f.customerId } : {}) }])) setF(blank);
  }
  function patch(id, change) { return saveList(users.map(u => u.id === id ? { ...u, ...change } : u)); }
  function changeRole(u, role) {
    if (u.role === 'مدیر چاپخانه' && role !== 'مدیر چاپخانه' && managers.length <= 1) { setMsg({ ok: false, t: 'حداقل یک مدیر چاپخانه‌ی فعال باید وجود داشته باشد.' }); return; }
    patch(u.id, { role });
  }
  function toggle(u) {
    if (u.role === 'مشتری' && u.active === false && !eligibleCustomers.some(c => c.id === u.customerId)) { setMsg({ ok: false, t: 'فعال‌سازی حساب مشتری نیازمند شمارهٔ یکتا و تأیید صلاحیت است.' }); return; }
    if (u.active !== false && u.role === 'مدیر چاپخانه' && managers.length <= 1) { setMsg({ ok: false, t: 'آخرین مدیر فعال را نمی‌شود غیرفعال کرد.' }); return; }
    if (u.id === currentUser.id && u.active !== false) { setMsg({ ok: false, t: 'کاربری که با آن وارد شده‌اید را نمی‌شود غیرفعال کرد.' }); return; }
    patch(u.id, { active: u.active === false });
  }
  function remove(u) {
    if (u.id === currentUser.id) { setMsg({ ok: false, t: 'کاربر فعلی را نمی‌شود حذف کرد.' }); return; }
    if (u.role === 'مدیر چاپخانه' && u.active !== false && managers.length <= 1) { setMsg({ ok: false, t: 'آخرین مدیر فعال را نمی‌شود حذف کرد.' }); return; }
    if (!confirm(`کاربر «${u.name}» حذف شود؟`)) return;
    saveList(users.filter(x => x.id !== u.id));
  }
  async function savePass(u) {
    if (newPass.length < 4) { setMsg({ ok: false, t: 'رمز جدید باید حداقل ۴ کاراکتر باشد.' }); return; }
    if (await patch(u.id, { passHash: hashPass(newPass), _plain: newPass })) { setResetFor(null); setNewPass(''); }
  }
  return (
    <div style={{ ...card, maxWidth: 820 }}>
      <SectionTitle>کاربران و سطح دسترسی</SectionTitle>
      <div style={{ fontSize: 12, color: COLORS.sub, lineHeight: 2 }}>هر کاربر فقط به‌اندازه‌ی وظیفه‌اش بخش‌ها را می‌بیند. فقط «مدیر چاپخانه» به همه‌ی بخش‌ها دسترسی دارد. اگر چند ایستگاه روی شبکه کار می‌کنند، نام هر ایستگاه را در همان ردیف حسابش بنویسید تا کنار نام کاربر در ستون کناری دیده شود.</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: COLORS.primary, color: '#fff' }}>{['نام', 'نام کاربری', 'نقش', 'ایستگاه', 'وضعیت', ''].map(h => <th key={h} style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700 }}>{h}</th>)}</tr></thead>
          <tbody>
            {users.map((u, idx) => (
              <Fragment key={u.id}>
                <tr style={{ background: idx % 2 ? COLORS.altRow : '#fff', opacity: u.active === false ? 0.55 : 1 }}>
                  <td style={{ padding: '7px 10px', fontWeight: 700 }}>{u.name}{u.id === currentUser.id && <span style={{ color: COLORS.sub, fontWeight: 400 }}> (شما)</span>}</td>
                  <td style={{ padding: '7px 10px', direction: 'ltr', textAlign: 'right' }}>{u.username}</td>
                  <td style={{ padding: '7px 10px' }}>
                    {u.role === 'مشتری' ? <span style={{ fontWeight: 700 }}>مشتری{(customers.find(c => c.id === u.customerId) || {}).name ? ` — ${(customers.find(c => c.id === u.customerId) || {}).name}` : ''}</span> : <select value={u.role} onChange={e => changeRole(u, e.target.value)} style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, width: 170 }}>{STAFF_ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select>}
                    <div style={{ fontSize: 11, color: COLORS.sub, marginTop: 3 }}>{ROLE_NOTES[u.role]}</div>
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    {u.role === 'مشتری' ? <span style={{ color: COLORS.sub }}>—</span> : <input key={`${u.id}:${u.station || ''}`} defaultValue={u.station || ''} maxLength={40} placeholder="مثلاً مالی" aria-label={`نام ایستگاه ${u.name}`} title="نام این ایستگاه؛ با خروج از فیلد ذخیره می‌شود" style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, width: 130 }} onBlur={e => { const v = e.target.value.trim(); if (v !== (u.station || '')) patch(u.id, { station: v }); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />}
                  </td>
                  <td style={{ padding: '7px 10px' }}><Badge text={u.active === false ? 'غیرفعال' : 'فعال'} bg={u.active === false ? '#eee' : COLORS.accentLight} fg={u.active === false ? '#666' : COLORS.primaryDark} /></td>
                  <td style={{ padding: '7px 10px' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <GhostButton onClick={() => { setResetFor(resetFor === u.id ? null : u.id); setNewPass(''); }} style={{ padding: '4px 8px', fontSize: 11 }}>تغییر رمز</GhostButton>
                      <GhostButton onClick={() => toggle(u)} style={{ padding: '4px 8px', fontSize: 11 }}>{u.active === false ? 'فعال‌سازی' : 'غیرفعال'}</GhostButton>
                      <IconButton icon={Trash2} danger title="حذف" onClick={() => remove(u)} />
                    </div>
                  </td>
                </tr>
                {resetFor === u.id && (
                  <tr style={{ background: COLORS.warnBg }}><td colSpan={6} style={{ padding: 8 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <TextInput type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="رمز جدید" style={{ maxWidth: 220, direction: 'ltr', textAlign: 'left' }} />
                      <PrimaryButton icon={Save} onClick={() => savePass(u)}>ذخیره رمز</PrimaryButton>
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <SectionTitle small>افزودن کاربر</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <Field label="نام و نام‌خانوادگی"><TextInput value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="نام کاربری"><TextInput value={f.username} onChange={e => setF({ ...f, username: e.target.value })} style={{ direction: 'ltr', textAlign: 'left' }} /></Field>
        <Field label="رمز عبور"><TextInput type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} style={{ direction: 'ltr', textAlign: 'left' }} /></Field>
        <Field label="نقش"><Select options={[...STAFF_ROLES, 'مشتری']} value={f.role} onChange={e => setF({ ...f, role: e.target.value })} /></Field>
        {f.role !== 'مشتری' && <Field label="نام ایستگاه"><TextInput value={f.station} maxLength={40} placeholder="مثل مالی، لیتوگرافی، سفارشات" onChange={e => setF({ ...f, station: e.target.value })} /></Field>}
        {f.role === 'مشتری' && <Field label="مشتری تأییدشده *"><select value={f.customerId} onChange={e => setF({ ...f, customerId: e.target.value })} style={inputStyle}><option value="">— انتخاب کنید —</option>{eligibleCustomers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.customerCode}</option>)}</select></Field>}
      </div>
      {msg && <div style={{ color: msg.ok ? COLORS.success : COLORS.danger, fontSize: 12, fontWeight: 700 }}>{msg.t}</div>}
      {f.role === 'مشتری' && <div style={{ fontSize: 12, color: COLORS.sub }}>فقط پرونده‌هایی که مدیر در بخش مشتریان شماره‌گذاری و تأیید کرده است قابل انتخاب هستند.</div>}
      <div><PrimaryButton icon={Plus} disabled={busy} onClick={add}>{busy ? 'در حال ذخیره…' : 'افزودن کاربر'}</PrimaryButton></div>
    </div>
  );
}

/* فهرست فرم‌های سفارش برای سرپرست‌ها: فقط شماره، مشتری، عنوان و چاپ فرم (بدون هیچ مبلغی) */
function FormsList({ orders, onOpen }) {
  const list = orders.filter(o => !!o.workflow?.productionAuthorization && !['در انتظار تایید', 'بایگانی', 'لغو شده', REQUEST_STATUS].includes(o.status));
  const [q, setQ] = useState('');
  const shown = q.trim() ? list.filter(o => (o.orderNumber || '').includes(q.trim()) || (o.customerName || '').includes(q.trim()) || (o.title || '').includes(q.trim())) : list;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={18} /> فرم‌های سفارش چاپ</div>
      <div style={{ fontSize: 12, color: COLORS.sub }}>فقط سفارش‌های تاییدشده نمایش داده می‌شوند. فرم، بدون مبلغ ریالی است.</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: '6px 10px', maxWidth: 360 }}>
        <Search size={14} color={COLORS.sub} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="شماره سفارش یا نام مشتری..." style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, background: 'transparent' }} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: COLORS.primary, color: '#fff' }}>{['شماره', 'مشتری', 'عنوان سفارش', 'تحویل', ''].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>{h}</th>)}</tr></thead>
          <tbody>
            {shown.map((o, idx) => (
              <tr key={o.id} style={{ background: idx % 2 ? COLORS.altRow : '#fff' }}>
                <td style={{ padding: '8px 10px', fontWeight: 800 }}>{o.orderNumber}</td>
                <td style={{ padding: '8px 10px' }}>{o.customerName}</td>
                <td style={{ padding: '8px 10px' }}>{o.title || orderTitleSummary(o)}</td>
                <td style={{ padding: '8px 10px' }}>{faDate(o.deliveryDate)}</td>
                <td style={{ padding: '8px 10px' }}><GhostButton icon={Printer} onClick={() => onOpen(o)} style={{ padding: '4px 10px', fontSize: 12 }}>مشاهده و چاپ فرم</GhostButton></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: COLORS.sub }}>فرمی برای نمایش وجود ندارد.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===================== واحدهای تولید ===================== */
const UNIT_COLS = {
  design: { size: false, colors: false, perfecting: false },
  litho: { size: true, colors: false, perfecting: false },
  digital: { size: true, colors: true, perfecting: false },
  offset: { size: true, colors: true, perfecting: true },
  binding: { size: false, colors: false, perfecting: false },
};
const VAR_EN = Object.fromEntries(FORMULA_VARS.map(v => [v.key, v.en]));

function FormulaBox({ unitKey, entry, onChange, kindLabel, partner }) {
  const meta = UNIT_META[unitKey];
  const def = (partner && PARTNER_FORMULAS[unitKey]) || DEFAULT_FORMULAS[unitKey];
  const [sample, setSample] = useState(() => ({ ...(meta.sample || {}) }));
  const taRef = useRef(null);
  const text = entry.formula || '';
  const effective = text.trim() || def;
  const ctx = {};
  Object.keys(sample).forEach(k => { if (VAR_EN[k]) ctx[VAR_EN[k]] = Number(sample[k]) || 0; });
  const res = priceEntry({ ...entry, formula: effective }, ctx, unitKey, { partner: !!partner });
  const insert = (token) => {
    const el = taRef.current; const cur = text;
    if (el && typeof el.selectionStart === 'number') { const a = el.selectionStart, b = el.selectionEnd; onChange(cur.slice(0, a) + token + cur.slice(b)); setTimeout(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); }, 0); }
    else onChange(cur + token);
  };
  const keys = meta.vars;
  return (
    <div style={{ background: COLORS.altRow, border: `1px dashed ${COLORS.border}`, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: COLORS.primaryDark }}>فرمول محاسبه‌ی قیمت {kindLabel}</div>
      <div style={{ fontSize: 11, color: COLORS.sub, lineHeight: 1.9 }}>خالی بگذارید تا فرمول پیش‌فرض اعمال شود: <span dir="rtl" style={{ fontWeight: 700, color: COLORS.text }}>{def}</span></div>
      <textarea ref={taRef} value={text} onChange={e => onChange(e.target.value)} rows={2} placeholder={def} style={{ ...inputStyle, fontFamily: 'inherit', direction: 'rtl', resize: 'vertical' }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: COLORS.sub }}>متغیرها (کلیک کنید):</span>
        {keys.map(k => <button key={k} title={(FORMULA_VARS.find(v => v.key === k) || {}).label} onClick={() => insert(k)} style={{ border: `1px solid ${COLORS.border}`, background: '#fff', borderRadius: 999, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{k}</button>)}
        {['+', '-', '*', '/', '(', ')'].map(o => <button key={o} onClick={() => insert(` ${o} `)} style={{ border: `1px solid ${COLORS.border}`, background: COLORS.accentLight, borderRadius: 6, padding: '2px 8px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{o}</button>)}
        {FORMULA_FUNCS.slice(0, 5).map(f => <button key={f.fa} title={f.desc} onClick={() => insert(`${f.fa}(`)} style={{ border: `1px solid ${COLORS.border}`, background: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{f.fa}( )</button>)}
        <button title="اگر(شرط، مقدار۱، مقدار۲)" onClick={() => insert('اگر(')} style={{ border: `1px solid ${COLORS.border}`, background: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>اگر( )</button>
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.sub }}>آزمایش با مقدارهای نمونه:</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {keys.filter(k => !['نرخ', 'راه_اندازی', 'حداقل'].includes(k)).map(k => (
          <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: COLORS.sub, width: 92 }}>{k}<NumInput value={sample[k] ?? ''} onChange={e => setSample({ ...sample, [k]: e.target.value })} style={{ padding: '4px 8px', fontSize: 12 }} /></label>
        ))}
      </div>
      <div style={{ fontSize: 13, fontWeight: 800, color: res.ok ? COLORS.success : COLORS.danger }}>
        {res.ok ? `نتیجه: ${res.amount.toLocaleString('en-US')} ریال` : `خطا در فرمول: ${res.error}`}
      </div>
    </div>
  );
}

function UnitEntryRow({ unitKey, entry, idx, onChange, onRemove }) {
  const cols = UNIT_COLS[unitKey];
  const [open, setOpen] = useState(false);
  const set = (patch) => onChange({ ...entry, ...patch });
  const cell = { padding: '5px 6px', verticalAlign: 'top' };
  const mini = { padding: '5px 7px', fontSize: 12 };
  const setComp = (id, patch) => set({ components: (entry.components || []).map(c => c.id === id ? { ...c, ...patch } : c) });
  const parts = entryParts(entry);
  return (
    <Fragment>
      <tr style={{ background: idx % 2 ? COLORS.altRow : '#fff', opacity: entry.active === false ? 0.5 : 1 }}>
        <td style={cell}><input type="checkbox" checked={entry.active !== false} onChange={e => set({ active: e.target.checked })} title="فعال" /></td>
        <td style={{ ...cell, minWidth: 210 }}><TextInput value={entry.name} onChange={e => set({ name: e.target.value })} style={mini} placeholder="نام" /></td>
        <td style={{ ...cell, width: 100 }}><TextInput value={entry.kind || ''} onChange={e => set({ kind: e.target.value })} style={mini} /></td>
        {cols.size && <td style={{ ...cell, width: 118 }}><div style={{ display: 'flex', gap: 3, alignItems: 'center' }}><NumInput value={entry.w} onChange={e => set({ w: e.target.value })} style={{ ...mini, width: 46 }} /><span>×</span><NumInput value={entry.h} onChange={e => set({ h: e.target.value })} style={{ ...mini, width: 46 }} /></div></td>}
        {cols.colors && <td style={{ ...cell, width: 54 }}><NumInput value={entry.colors} onChange={e => set({ colors: e.target.value })} style={mini} /></td>}
        {cols.perfecting && <td style={{ ...cell, width: 50, textAlign: 'center' }}><input type="checkbox" checked={!!entry.perfecting} onChange={e => set({ perfecting: e.target.checked })} /></td>}
        <td style={{ ...cell, width: 92 }}><TextInput value={entry.unit || ''} onChange={e => set({ unit: e.target.value })} style={mini} /></td>
        <td style={{ ...cell, width: 104 }}><NumInput value={entry.rate} onChange={e => set({ rate: e.target.value })} style={mini} /></td>
        <td style={{ ...cell, width: 96 }}><NumInput value={entry.setup} onChange={e => set({ setup: e.target.value })} style={mini} /></td>
        <td style={{ ...cell, width: 96 }}><NumInput value={entry.minCharge} onChange={e => set({ minCharge: e.target.value })} style={mini} /></td>
        <td style={{ ...cell, whiteSpace: 'nowrap' }}>
          <button onClick={() => setOpen(!open)} title="اجزا، فرمول و توضیحات" style={{ border: `1px solid ${COLORS.border}`, background: open ? COLORS.accentLight : '#fff', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>{open ? 'بستن' : (entry.formula || (entry.components || []).length || (entry.tiers || []).length ? 'فرمول ●' : 'فرمول')}</button>{' '}
          <IconButton icon={Trash2} danger title="حذف" onClick={onRemove} />
        </td>
      </tr>
      {open && (
        <tr style={{ background: COLORS.warnBg }}><td colSpan={12} style={{ padding: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Field label="توضیحات (ظرفیت، شرایط، نکات)"><textarea value={entry.notes || ''} onChange={e => set({ notes: e.target.value })} rows={2} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} /></Field>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: COLORS.primaryDark, marginBottom: 6 }}>اجزای هزینه (اختیاری) — جمع اجزای فعال در فرمول با نام «اجزا» می‌آید{parts ? ` (الان: ${parts.toLocaleString('en-US')})` : ''}</div>
              {(entry.components || []).map(c => (
                <div key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }}>
                  <input type="checkbox" checked={c.on !== false} onChange={e => setComp(c.id, { on: e.target.checked })} title="فعال" />
                  <TextInput value={c.name} onChange={e => setComp(c.id, { name: e.target.value })} style={{ ...mini, maxWidth: 260 }} placeholder="نام جزء" />
                  <NumInput value={c.price} onChange={e => setComp(c.id, { price: e.target.value })} style={{ ...mini, maxWidth: 140 }} placeholder="قیمت" />
                  <IconButton icon={X} danger title="حذف جزء" onClick={() => set({ components: entry.components.filter(x => x.id !== c.id) })} />
                </div>
              ))}
              <GhostButton icon={Plus} onClick={() => set({ components: [...(entry.components || []), { id: uid(), name: '', price: '', on: true }] })} style={{ padding: '4px 10px', fontSize: 12 }}>افزودن جزء</GhostButton>
            </div>
            {unitKey === 'offset' && (
              <div style={{ background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <TierEditor title="پلکان قیمت هر دور چاپ متن (برای هر زینک)" hint="برای هر زینک یک دور چاپ حساب می‌شود. مثلاً: تا ۱۰۰۰ نسخه قیمت الف، تا ۲۰۰۰ قیمت ب، تا ۳۰۰۰ قیمت ج، تا ۵۰۰۰ قیمت د؛ بالاتر از ۵۰۰۰ به نسبت ۵۰۰۰ زیاد می‌شود. وقتی پلکان دارید فرمول پیش‌فرض می‌شود «زینک × پله + فرم × راه‌اندازی»." tiers={entry.tiers || []} onChange={(t) => set({ tiers: t })} />
                <TierEditor title="پلکان قیمت چاپ جلد (اختیاری؛ اگر خالی باشد از پلکان بالا استفاده می‌شود)" hint="مثلاً چاپ جلد چهاررنگ از ۱ تا ۵۰۰۰ یک قیمت ثابت برای هر زینک دارد: فقط یک پله با سقف ۵۰۰۰ بگذارید." tiers={entry.coverTiers || []} onChange={(t) => set({ coverTiers: t })} />
              </div>
            )}
            <FormulaBox unitKey={unitKey} entry={entry} kindLabel={`«${entry.name || 'این ردیف'}»`} onChange={(v) => set({ formula: v })} />
          </div>
        </td></tr>
      )}
    </Fragment>
  );
}

function TierEditor({ title, hint, tiers, onChange }) {
  const setT = (i, patch) => onChange(tiers.map((t, j) => j === i ? { ...t, ...patch } : t));
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 800, color: COLORS.primaryDark }}>{title}</div>
      <div style={{ fontSize: 11, color: COLORS.sub, lineHeight: 1.9, marginBottom: 4 }}>{hint}</div>
      {tiers.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12 }}>تا تیراژ</span>
          <NumInput value={t.upTo} onChange={e => setT(i, { upTo: e.target.value })} style={{ width: 110, padding: '4px 8px', fontSize: 12 }} />
          <span style={{ fontSize: 12 }}>قیمت هر دور (ریال)</span>
          <NumInput value={t.price} onChange={e => setT(i, { price: e.target.value })} style={{ width: 150, padding: '4px 8px', fontSize: 12 }} />
          <IconButton icon={X} danger title="حذف پله" onClick={() => onChange(tiers.filter((_, j) => j !== i))} />
        </div>
      ))}
      <GhostButton icon={Plus} onClick={() => onChange([...tiers, { upTo: '', price: '' }])} style={{ padding: '3px 10px', fontSize: 12 }}>افزودن پله</GhostButton>
    </div>
  );
}

function PartnerRow({ unitKey, p, idx, onChange, onRemove }) {
  const [open, setOpen] = useState(false);
  const set = (patch) => onChange({ ...p, ...patch });
  const mini = { padding: '5px 7px', fontSize: 12 };
  return (
    <Fragment>
      <tr style={{ background: idx % 2 ? COLORS.altRow : '#fff' }}>
        <td style={{ padding: 5, minWidth: 150 }}><TextInput value={p.name} onChange={e => set({ name: e.target.value })} style={mini} placeholder="نام مجموعه" /></td>
        <td style={{ padding: 5, width: 120 }}><TextInput value={p.phone} onChange={e => set({ phone: e.target.value })} style={{ ...mini, direction: 'ltr', textAlign: 'right' }} /></td>
        <td style={{ padding: 5, minWidth: 170 }}><TextInput value={p.address} onChange={e => set({ address: e.target.value })} style={mini} /></td>
        <td style={{ padding: 5, minWidth: 150 }}><TextInput value={p.service} onChange={e => set({ service: e.target.value })} style={mini} placeholder="چه کاری انجام می‌دهد" /></td>
        <td style={{ padding: 5, width: 84 }}><TextInput value={p.unit} onChange={e => set({ unit: e.target.value })} style={mini} /></td>
        <td style={{ padding: 5, width: 100 }}><NumInput value={p.rate} onChange={e => set({ rate: e.target.value })} style={mini} /></td>
        <td style={{ padding: 5, width: 90 }}><NumInput value={p.setup} onChange={e => set({ setup: e.target.value })} style={mini} /></td>
        <td style={{ padding: 5, whiteSpace: 'nowrap' }}>
          <button onClick={() => setOpen(!open)} style={{ border: `1px solid ${COLORS.border}`, background: open ? COLORS.accentLight : '#fff', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>{open ? 'بستن' : (p.formula ? 'فرمول ●' : 'فرمول')}</button>{' '}
          <IconButton icon={Trash2} danger title="حذف" onClick={onRemove} />
        </td>
      </tr>
      {open && <tr style={{ background: COLORS.warnBg }}><td colSpan={8} style={{ padding: 10 }}>
        <Field label="توضیحات"><textarea value={p.notes || ''} onChange={e => set({ notes: e.target.value })} rows={2} style={{ ...inputStyle, fontFamily: 'inherit' }} /></Field>
        <div style={{ height: 8 }} />
        <FormulaBox partner unitKey={unitKey} entry={{ rate: p.rate, setup: p.setup, minCharge: '', components: [], formula: p.formula }} kindLabel={`برون‌سپاری «${p.name || ''}»`} onChange={(v) => set({ formula: v })} />
      </td></tr>}
    </Fragment>
  );
}

function UnitSection({ unitKey, data, onChange }) {
  const meta = UNIT_META[unitKey];
  const cols = UNIT_COLS[unitKey];
  const [filter, setFilter] = useState('');
  const [presetName, setPresetName] = useState('');
  const have = new Set(data.items.map(i => i.name));
  const available = PRESETS[unitKey].filter(p => !have.has(p.name));
  const shown = data.items.map((e, i) => ({ e, i })).filter(({ e }) => !filter.trim() || `${e.name} ${e.kind}`.includes(filter.trim()));
  const setItem = (i, v) => onChange({ ...data, items: data.items.map((x, j) => j === i ? v : x) });
  const th = { padding: '7px 6px', textAlign: 'right', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' };
  const card = { background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={card}>
        <SectionTitle>{meta.title} — این واحد چه می‌کند و هزینه‌اش چیست؟</SectionTitle>
        <textarea value={data.description} onChange={e => onChange({ ...data, description: e.target.value })} rows={5} style={{ ...inputStyle, fontFamily: 'inherit', lineHeight: 2, resize: 'vertical' }} />
      </div>
      <div style={card}>
        <SectionTitle>ماشین‌آلات و خدمات ({data.items.length})</SectionTitle>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: '6px 10px', width: 240 }}>
            <Search size={14} color={COLORS.sub} />
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="جستجو در فهرست..." style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, background: 'transparent', fontFamily: 'inherit' }} />
          </div>
          {available.length > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select value={presetName} onChange={e => setPresetName(e.target.value)} style={{ ...inputStyle, width: 300 }}>
                <option value="">افزودن از فهرست آماده‌ی ماشین‌ها/خدمات...</option>
                {available.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <GhostButton icon={Plus} onClick={() => { const p = PRESETS[unitKey].find(x => x.name === presetName); if (!p) return; onChange({ ...data, items: [...data.items, makeEntry(p)] }); setPresetName(''); }}>افزودن</GhostButton>
            </div>
          )}
          <GhostButton icon={Plus} onClick={() => onChange({ ...data, items: [...data.items, makeEntry({ name: '', unit: '' })] })}>ردیف خالی</GhostButton>
        </div>
        <div style={{ fontSize: 11, color: COLORS.sub, lineHeight: 1.9 }}>قیمت‌ها به ریال. تا نرخ یک ردیف را وارد نکنید، محاسبه‌ی قیمت از نرخ‌های قدیمی «تنظیمات» استفاده می‌کند. مشخصات ماشین‌ها از اطلاعات منتشرشده‌ی سازنده‌ها است؛ مدل‌های «تقریبی» را با دستگاه خودتان تطبیق دهید.</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: COLORS.primary, color: '#fff' }}>
              <th style={th}>فعال</th><th style={th}>نام</th><th style={th}>نوع</th>
              {cols.size && <th style={th}>ابعاد (cm)</th>}{cols.colors && <th style={th}>رنگ</th>}{cols.perfecting && <th style={th}>پشت‌ورو</th>}
              <th style={th}>واحد قیمت</th><th style={th}>نرخ</th><th style={th}>راه‌اندازی</th><th style={th}>حداقل مبلغ</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {shown.map(({ e, i }, k) => <UnitEntryRow key={e.id} unitKey={unitKey} entry={e} idx={k} onChange={(v) => setItem(i, v)} onRemove={() => { if (confirm(`«${e.name || 'این ردیف'}» حذف شود؟`)) onChange({ ...data, items: data.items.filter((_, j) => j !== i) }); }} />)}
              {shown.length === 0 && <tr><td colSpan={12} style={{ padding: 18, textAlign: 'center', color: COLORS.sub }}>موردی نیست.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div style={card}>
        <SectionTitle color={COLORS.primaryDark}>برون‌سپاری {meta.title.replace('واحد ', '')}</SectionTitle>
        <div style={{ fontSize: 12, color: COLORS.text, lineHeight: 2 }}><strong>برون‌سپاری یعنی چه؟</strong> وقتی این کار را خودتان نمی‌کنید و به مجموعه‌ی دیگری می‌سپارید. {meta.outsourceWhy} نام، تلفن، نشانی و نرخ هر پیمانکار را اینجا ثبت کنید تا هنگام ثبت سفارش انتخاب شود و هزینه‌اش در فرم سفارش بیاید.</div>
        {data.outsource.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: COLORS.primaryDark, color: '#fff' }}>{['نام مجموعه', 'تلفن', 'نشانی', 'خدمت', 'واحد', 'نرخ', 'راه‌اندازی', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{data.outsource.map((p, i) => <PartnerRow key={p.id} unitKey={unitKey} p={p} idx={i} onChange={(v) => onChange({ ...data, outsource: data.outsource.map((x, j) => j === i ? v : x) })} onRemove={() => { if (confirm(`«${p.name || 'این پیمانکار'}» حذف شود؟`)) onChange({ ...data, outsource: data.outsource.filter((_, j) => j !== i) }); }} />)}</tbody>
            </table>
          </div>
        )}
        <div><GhostButton icon={Plus} onClick={() => onChange({ ...data, outsource: [...data.outsource, makePartner()] })}>افزودن پیمانکار برون‌سپاری</GhostButton></div>
      </div>
    </div>
  );
}

function UnitsPanel({ units, onSave }) {
  const [d, setD] = useState(units);
  const [sec, setSec] = useState('offset');
  const [dirty, setDirty] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  useEffect(() => {
    if (!dirty) return undefined;
    const t = setTimeout(() => { onSave(d); setDirty(false); setSavedMsg('ذخیره شد ✓'); }, 700);
    return () => clearTimeout(t);
  }, [d, dirty]);
  const change = (key, v) => { setD({ ...d, [key]: v }); setDirty(true); setSavedMsg(''); };
  function exportExcel() {
    const sheets = UNIT_ORDER.map(k => ({
      name: UNIT_META[k].title.replace('واحد ', '').slice(0, 28),
      rows: [['نام', 'نوع', 'عرض (cm)', 'طول (cm)', 'رنگ', 'پشت‌ورو', 'واحد قیمت', 'نرخ', 'راه‌اندازی', 'حداقل', 'اجزا', 'فرمول', 'فعال', 'توضیحات'],
        ...d[k].items.map(e => [e.name, e.kind, e.w, e.h, e.colors, e.perfecting ? 'بله' : '', e.unit, e.rate, e.setup, e.minCharge, (e.components || []).map(c => `${c.name}: ${c.price || 0}`).join(' | '), e.formula || '(پیش‌فرض)', e.active === false ? 'خیر' : 'بله', e.notes])],
    }));
    const out = UNIT_ORDER.flatMap(k => d[k].outsource.map(p => [UNIT_META[k].title, p.name, p.phone, p.address, p.service, p.unit, p.rate, p.setup, p.formula || '(پیش‌فرض)', p.notes]));
    sheets.push({ name: 'برون‌سپاری', rows: [['واحد', 'نام', 'تلفن', 'نشانی', 'خدمت', 'واحد', 'نرخ', 'راه‌اندازی', 'فرمول', 'توضیحات'], ...out] });
    saveWorkbook('واحدهای-تولید.xlsx', sheets);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6 }}><BookOpen size={19} /> واحدهای تولید و ماشین‌آلات</div>
        <div style={{ flex: 1 }} />
        {(dirty || savedMsg) && <span style={{ fontSize: 12, color: dirty ? COLORS.warn : COLORS.success, fontWeight: 700 }}>{dirty ? 'در حال ذخیره...' : savedMsg}</span>}
        <GhostButton icon={FileText} onClick={exportExcel}>خروجی Excel</GhostButton>
      </div>
      <div style={{ fontSize: 12, color: COLORS.sub, lineHeight: 2 }}>اینجا داده‌ی پایه‌ی قیمت هر واحد را می‌سازید. برای هر ماشین یا خدمت می‌توانید نرخ بدهید یا با «فرمول» نحوه‌ی محاسبه را خودتان تعیین کنید؛ مثلاً <strong dir="rtl">دور / 1000 * نرخ + فرم * راه_اندازی</strong>. هیچ قیمتی از پیش پر نشده است. تغییرات خودکار ذخیره می‌شود.</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {UNIT_ORDER.map(k => (
          <button key={k} onClick={() => setSec(k)} style={{ padding: '8px 16px', borderRadius: 9, border: `1px solid ${sec === k ? COLORS.primary : COLORS.border}`, background: sec === k ? COLORS.primary : '#fff', color: sec === k ? '#fff' : COLORS.text, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{UNIT_META[k].title.replace('واحد ', '')} <span style={{ opacity: 0.7, fontWeight: 500 }}>({d[k].items.length})</span></button>
        ))}
      </div>
      <UnitSection key={sec} unitKey={sec} data={d[sec]} onChange={(v) => change(sec, v)} />
    </div>
  );
}

/* ===================== نامه‌ی اداری A5 ===================== */
function LetterSheet({ letter, settings }) {
  const co = settings.company; const st = LETTER_STATUS[letter.status] || LETTER_STATUS.sent;
  return (
    <div className="a5-sheet" style={{ width: '132mm', minHeight: '194mm', margin: '0 auto', display: 'flex', flexDirection: 'column', background: '#fff', color: '#000', direction: 'rtl', fontSize: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottom: `2.5px solid ${COLORS.primary}`, paddingBottom: 6, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={co.logo || logoUrl} alt="" style={{ maxHeight: 46, maxWidth: 80, objectFit: 'contain' }} />
          <div style={{ fontWeight: 800, fontSize: 11.5, color: COLORS.primaryDark, lineHeight: 1.6 }}>{co.name}</div>
        </div>
        <div style={{ fontSize: 10.5, lineHeight: 1.9, textAlign: 'left' }}>
          <div>شماره: <strong>{faDigits(letter.number)}</strong></div>
          <div>تاریخ: <strong>{faDate(letter.date)}</strong></div>
          <div>پیوست: ندارد</div>
        </div>
      </div>
      <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 14, marginBottom: 6 }}>نامه‌ی اداری — درخواست</div>
      <div style={{ border: '1px solid #000', borderRadius: 6, padding: '4px 8px', fontSize: 11, lineHeight: 2, marginBottom: 8 }}>
        <div><strong>از:</strong> واحد {letter.fromUnit}{letter.fromName ? ` — ${letter.fromName}` : ''}</div>
        <div><strong>به:</strong> مدیریت محترم چاپخانه</div>
        <div><strong>موضوع:</strong> {letter.subject}</div>
      </div>
      <div style={{ flex: 1, whiteSpace: 'pre-wrap', lineHeight: 2.1, fontSize: 11.5 }}>{letter.body}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <div style={{ border: '1px solid #000', borderRadius: 6, minHeight: 70, padding: '3px 6px', fontSize: 10.5, fontWeight: 700, textAlign: 'center' }}>درخواست‌کننده<div style={{ fontWeight: 400, marginTop: 4 }}>{letter.fromName}</div><div style={{ fontWeight: 400, fontSize: 9, color: '#666' }}>امضاء</div></div>
        <div style={{ border: '1px solid #000', borderRadius: 6, minHeight: 70, padding: '3px 6px', fontSize: 10.5, fontWeight: 700, textAlign: 'center' }}>
          نظر مدیر چاپخانه
          {letter.status && letter.status !== 'sent' && <div style={{ fontWeight: 800, marginTop: 3, color: st.fg }}>{st.label}</div>}
          {letter.managerNote && <div style={{ fontWeight: 400, fontSize: 10, marginTop: 2, textAlign: 'right' }}>{letter.managerNote}</div>}
          <div style={{ fontWeight: 400, fontSize: 9, color: '#666', marginTop: 4 }}>امضاء</div>
        </div>
      </div>
      <div style={{ borderTop: `1.5px solid ${COLORS.primary}`, marginTop: 8, paddingTop: 3, fontSize: 9, lineHeight: 1.8, textAlign: 'center', color: '#222' }}>
        {co.address ? `نشانی: ${co.address}` : ''}{co.postalCode ? ` — کدپستی: ${co.postalCode}` : ''}
        {(co.phone || co.mobile) && <div>{co.phone ? <>تلفن: <bdi>{co.phone}</bdi></> : null}{co.mobile ? <>{co.phone ? ' — ' : ''}همراه: <bdi>{co.mobile}</bdi></> : null}</div>}
      </div>
    </div>
  );
}
function LetterPrint({ letter, settings, onClose }) {
  return <PrintOverlay onClose={onClose} initialPaper="A5" pdfName={`نامه-${letter.number || ''}`.trim()}><LetterSheet letter={letter} settings={settings} /></PrintOverlay>;
}

function LetterForm({ initial, onSave, onCancel, settings }) {
  const [v, setV] = useState(initial);
  const [touched, setTouched] = useState(false);
  const [errs, setErrs] = useState([]);
  const type = LETTER_TYPES[v.type];
  const recompose = (next) => ({ ...next, body: composeLetter(next, faDate) });
  const upd = (patch, forceCompose) => setV(prev => { const next = { ...prev, ...patch }; return (forceCompose || (!touched && prev.type !== 'other')) ? recompose(next) : next; });
  const setField = (k, val) => upd({ fields: { ...v.fields, [k]: val } });
  function changeType(t) { setTouched(false); setV(prev => recompose({ ...prev, type: t, subject: LETTER_TYPES[t].title, fields: {} })); }
  const control = (k, label) => {
    const val = v.fields[k] || '';
    if (k === 'from' || k === 'to') return <JalaliDateInput value={val} onChange={x => setField(k, x)} />;
    if (k === 'urgency') return <Select options={URGENCY} value={val || 'عادی'} onChange={e => setField(k, e.target.value)} />;
    if (k === 'leaveType') return <Select options={LEAVE_TYPES} value={val || LEAVE_TYPES[0]} onChange={e => setField(k, e.target.value)} />;
    if (k === 'amount' || k === 'price') return <NumInput value={val} onChange={e => setField(k, e.target.value)} />;
    return <TextInput value={val} onChange={e => setField(k, e.target.value)} />;
  };
  function save() { const e = validLetter(v); setErrs(e); if (e.length) return; onSave(v); }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Field label="نوع نامه"><select value={v.type} onChange={e => changeType(e.target.value)} style={inputStyle}>{Object.entries(LETTER_TYPES).map(([k, t]) => <option key={k} value={k}>{t.title}</option>)}</select></Field>
        <Field label="واحد درخواست‌کننده"><Select options={UNITS} value={v.fromUnit} onChange={e => upd({ fromUnit: e.target.value })} /></Field>
        <Field label="تاریخ نامه"><JalaliDateInput value={v.date} onChange={x => upd({ date: x })} /></Field>
      </div>
      <Field label="موضوع"><TextInput value={v.subject} onChange={e => setV({ ...v, subject: e.target.value })} /></Field>
      {type.fields.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>{type.fields.map(([k, label]) => <Field key={k} label={label}>{control(k, label)}</Field>)}</div>}
      <Field label="متن نامه (قابل ویرایش)">
        <textarea value={v.body} onChange={e => { setTouched(true); setV({ ...v, body: e.target.value }); }} rows={6} style={{ ...inputStyle, fontFamily: 'inherit', lineHeight: 2, resize: 'vertical' }} />
      </Field>
      <div><GhostButton icon={Sparkles} onClick={() => { setTouched(false); setV(prev => recompose(prev)); }} style={{ padding: '4px 10px', fontSize: 12 }}>ساخت دوباره‌ی متن رسمی از روی فیلدها</GhostButton></div>
      {errs.length > 0 && <div style={{ background: COLORS.dangerBg, color: COLORS.danger, borderRadius: 8, padding: 8, fontSize: 12 }}>{errs.map((x, i) => <div key={i}>• {x}</div>)}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: `1px solid ${COLORS.border}`, paddingTop: 12 }}><GhostButton onClick={onCancel}>انصراف</GhostButton><PrimaryButton icon={Save} onClick={save}>ارسال نامه به مدیر</PrimaryButton></div>
    </div>
  );
}

function LettersPanel({ letters, user, isManager, settings, onNew, onUpdate, onDelete }) {
  const [open, setOpen] = useState(null);
  const [printing, setPrinting] = useState(null);
  const [resp, setResp] = useState({ status: 'approved', note: '' });
  const mine = isManager ? letters : letters.filter(l => l.createdBy === user.id);
  const sorted = [...mine].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const pending = letters.filter(l => l.status === 'sent').length;
  const th = { padding: '8px 10px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' };
  const cur = open ? letters.find(l => l.id === open) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6 }}><Receipt size={18} /> نامه‌ها و درخواست‌ها</div>
        <PrimaryButton icon={Plus} onClick={onNew}>نامه‌ی جدید به مدیر چاپخانه</PrimaryButton>
      </div>
      {isManager && pending > 0 && <div style={{ background: LETTER_STATUS.sent.bg, color: LETTER_STATUS.sent.fg, borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 800 }}>{fmt(pending)} نامه منتظر نظر شماست.</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: COLORS.primary, color: '#fff' }}>{['شماره', 'تاریخ', 'واحد', 'موضوع', 'وضعیت', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {sorted.map((l, idx) => { const st = LETTER_STATUS[l.status] || LETTER_STATUS.sent; return (
              <tr key={l.id} style={{ background: idx % 2 ? COLORS.altRow : '#fff' }}>
                <td style={{ padding: '8px 10px', fontWeight: 800 }}>{faDigits(l.number)}</td><td style={{ padding: '8px 10px' }}>{faDate(l.date)}</td>
                <td style={{ padding: '8px 10px' }}>{l.fromUnit}{l.fromName ? <span style={{ color: COLORS.sub }}> — {l.fromName}</span> : null}</td>
                <td style={{ padding: '8px 10px' }}>{l.subject}</td>
                <td style={{ padding: '8px 10px' }}><Badge text={st.label} bg={st.bg} fg={st.fg} /></td>
                <td style={{ padding: '8px 10px' }}><div style={{ display: 'flex', gap: 6 }}>
                  <GhostButton onClick={() => { setOpen(l.id); setResp({ status: l.status === 'sent' ? 'approved' : l.status, note: l.managerNote || '' }); }} style={{ padding: '4px 10px', fontSize: 12 }}>{isManager ? 'مشاهده و پاسخ' : 'مشاهده'}</GhostButton>
                  <GhostButton icon={Printer} onClick={() => setPrinting(l)} style={{ padding: '4px 10px', fontSize: 12 }}>چاپ A5</GhostButton>
                  {(isManager || (l.createdBy === user.id && l.status === 'sent')) && <IconButton icon={Trash2} danger title="حذف" onClick={() => { if (confirm('این نامه حذف شود؟')) onDelete(l.id); }} />}
                </div></td>
              </tr>); })}
            {sorted.length === 0 && <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: COLORS.sub }}>نامه‌ای ثبت نشده است.</td></tr>}
          </tbody>
        </table>
      </div>
      {cur && (
        <Modal title={`نامه ${faDigits(cur.number)}`} onClose={() => setOpen(null)} wide>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 8, overflow: 'auto', background: '#f4f4f4' }}><div style={{ background: '#fff', padding: 10, width: 'fit-content', margin: '0 auto' }}><LetterSheet letter={cur} settings={settings} /></div></div>
            {isManager && (
              <div style={{ background: COLORS.altRow, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: COLORS.primaryDark }}>نظر مدیر چاپخانه</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                  <Field label="وضعیت"><select value={resp.status} onChange={e => setResp({ ...resp, status: e.target.value })} style={inputStyle}>{['approved', 'followup', 'rejected', 'sent'].map(k => <option key={k} value={k}>{LETTER_STATUS[k].label}</option>)}</select></Field>
                  <Field label="توضیح مدیر"><TextInput value={resp.note} onChange={e => setResp({ ...resp, note: e.target.value })} /></Field>
                </div>
                <div><PrimaryButton icon={Check} onClick={() => { onUpdate({ ...cur, status: resp.status, managerNote: resp.note.trim(), decidedAt: todayIso(), decidedBy: user.name }); setOpen(null); }}>ثبت نظر</PrimaryButton></div>
              </div>
            )}
          </div>
        </Modal>
      )}
      {printing && <LetterPrint letter={printing} settings={settings} onClose={() => setPrinting(null)} />}
    </div>
  );
}

const navPermission = (id, perms) => !!id && (id === 'about' || perms.tabs.includes(id.split('-')[0]));
const loadNumberingSettings = () => window.printshopApi?.numberingSettings() || Promise.resolve({ ok: false, error: 'شماره‌گذاری در نسخه دسکتاپ فعال است.' });
const saveNumberingSettings = settings => window.printshopApi?.saveNumberingSettings(settings) || Promise.resolve({ ok: false, error: 'ذخیره انجام نشد.' });

/* بند ب: نامِ فارسیِ همان فهرست‌هایی که از راه شبکه نوشتنشان با نسخه سنجیده می‌شود. */
const STALE_LABELS = {
  printshop_orders_v5: 'سفارش‌ها', printshop_customers_v2: 'مشتری‌ها', printshop_suppliers_v2: 'تامین‌کننده‌ها',
  printshop_inventory_v3: 'موجودی', printshop_settings_v1: 'تنظیمات', printshop_units_v1: 'واحدها و نرخ‌ها',
  printshop_receipts_v1: 'رسیدها', printshop_consignments_v1: 'رسیدهای امانت', printshop_letters_v1: 'نامه‌ها', printshop_users_v1: 'حساب‌های کاربری',
};
/* بند پ: نامِ هر فهرستی که نشانهٔ زندهٔ تغییرش را به اپراتور خبر می‌دهیم. */
const LIVE_LABELS = {
  ...STALE_LABELS,
  printshop_inv_categories: 'دسته‌های انبار', printshop_ai_v1: 'تنظیمات هوش مصنوعی',
  printshop_marketer_pay_v1: 'پرداخت‌های بازاریاب', printshop_documents_v1: 'اسناد مالی',
  printshop_manager_pin: 'پین مدیر', printshop_product_types: 'انواع محصول', printshop_qty_units: 'واحدها',
  printshop_service_types: 'انواع خدمات', printshop_binding_types: 'انواع صحافی', printshop_paper_kinds: 'انواع کاغذ',
  printshop_book_like_types: 'محصولات کتابی', printshop_trim_sizes: 'قطع‌ها', printshop_print_colors: 'رنگ‌های چاپ',
};
export default function PrintShopApp() {
  const [user, setUser] = useState(null);
  const [users, setUsers] = useState(null);
  const [units, setUnits] = useState(null);
  const [invDrafts, setInvDrafts] = useState([]);
  const [mkPays, setMkPays] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [consignmentReceipts, setConsignmentReceipts] = useState([]);
  const [receiptDraft, setReceiptDraft] = useState(null);
  const [letters, setLetters] = useState([]);
  const [loginSeen, setLoginSeen] = useState(false);
  const [secureInfo, setSecureInfo] = useState({ defaultAdmin: false });
  const [letterModal, setLetterModal] = useState(null);
  const [letterAlert, setLetterAlert] = useState(false);
  const [aiCfg, setAiCfg] = useState({ enabled: false, apiKey: '', model: AI_DEFAULT_MODEL });
  const [workbench, setWorkbench] = useState({ openIds: [], activeId: '' });
  const [excelDataset, setExcelDataset] = useState('customers');
  const [visitedDesks, setVisitedDesks] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [printDocument, setPrintDocument] = useState(null);
  const [orders, setOrders] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [myFinance, setMyFinance] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [qtyUnits, setQtyUnits] = useState(DEFAULT_QTY_UNITS);
  const [serviceTypes, setServiceTypes] = useState(DEFAULT_SERVICE_TYPES);
  const [invCategories, setInvCategories] = useState(DEFAULT_INV_CATEGORIES);
  const [productTypes, setProductTypes] = useState(DEFAULT_PRODUCT_TYPES);
  const [bindingTypes, setBindingTypes] = useState(DEFAULT_BINDING_TYPES);
  const [paperKinds, setPaperKinds] = useState(DEFAULT_PAPER_KINDS);
  const [trimSizes, setTrimSizes] = useState(DEFAULT_TRIM_SIZES);
  const [engineCuts, setEngineCuts] = useState(ENGINE_CUTS);
  const [enginePresses, setEnginePresses] = useState(ENGINE_PRESSES);
  const [printColors, setPrintColors] = useState(DEFAULT_PRINT_COLORS);
  const [bookLikeTypes, setBookLikeTypes] = useState(DEFAULT_BOOK_LIKE_TYPES);
  const [loaded, setLoaded] = useState(false);
  const [reloadTick, setReloadTick] = useState(0); // بند ب: پس از تضاد نسخه، فهرست‌ها از بانک تازه می‌شوند
  const [staleNotice, setStaleNotice] = useState(null); // بند ب: نوار قرمزی که نوشتنِ ردشده را توضیح می‌دهد
  const [liveNotice, setLiveNotice] = useState(null); // بند پ: فهرست‌هایی که ایستگاهِ دیگری عوض کرده و این ایستگاه هنوز تازه نکرده
  /* بند ت/ث: نشانگر اتصال. اگر همین ماشین سرور باشد، وضعیت «سرور روشن» از آغاز روشن است؛
     در غیر این صورت حالت محلی بی‌سرور است و ایستگاه با نخستین پاسخِ ضربان وضعیت می‌گیرد. */
  const [serverLink, setServerLink] = useState(() => (window.printshopApi?.serving ? 'serving' : window.printshopApi?.transport === 'network' ? 'checking' : 'local'));
  const lastSessionKey = useRef(''); // بند ب: تازه‌شدنِ فهرست نباید میزِ باز را از نو بسازد
  const [orderModal, setOrderModal] = useState(null);
  const [orderDirty, setOrderDirty] = useState(false);
  const [invModal, setInvModal] = useState(null);
  const [custModal, setCustModal] = useState(null);
  const [suppModal, setSuppModal] = useState(null);
  const [detailOrder, setDetailOrder] = useState(null);
  const [detailViewOnly, setDetailViewOnly] = useState(false); // نمای «جزئیات» از تابلوی تولید: بدون هیچ عملیات
  const [printOrder, setPrintOrder] = useState(null);
  const [ledgerCustomer, setLedgerCustomer] = useState(null);
  const [ledgerSupplier, setLedgerSupplier] = useState(null);
  const [partyReview, setPartyReview] = useState(null); // { kind: 'customer'|'supplier', id } — بررسی یک طرف از همان ردیف فهرست
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [phoneLookup, setPhoneLookup] = useState('');
  const [financeOrderNumber, setFinanceOrderNumber] = useState('');
  const [managerPin, setManagerPin] = useState('1234');
  const [gateModal, setGateModal] = useState(false);
  const [settings, setSettings] = useState(mergeSettings(null));
  const [archiveOrder, setArchiveOrder] = useState(null);
  const [printCopy, setPrintCopy] = useState(1);
  const [emergencyStop, setEmergencyStop] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [userAvatar, setUserAvatar] = useState('');
  useEffect(() => { setUserAvatar(user?.id ? loadAvatar(user.id) : ''); }, [user?.id]);
  async function changeAvatar(file) {
    try { setUserAvatar(await saveAvatar(user.id, file)); }
    catch (failure) { alert(failure.message || 'تصویر ذخیره نشد.'); }
  }
  async function importCatalog(dataset, rows, options) {
    const result = await window.printshopApi?.catalogImport(dataset, rows, options);
    if (result?.ok && options?.commit) ({ customers: setCustomers, inventory: setInventory, suppliers: setSuppliers })[dataset]?.(result.value);
    return result;
  }

  useEffect(() => {
    if (isSecure() && (!user || user.mustChange)) return undefined;
    /* تنها ورودِ تازه صفحه را از نو می‌سازد؛ تازه‌شدنِ پس از تضاد نسخه (reloadTick) باید
       میزِ بازِ اپراتور را با فیلتر و تبش نگه دارد و فقط داده را عوض کند. */
    const sessionKey = `${isSecure() ? (user && user.id) : 'local'}|${user && user.mustChange ? 'must' : 'ok'}`;
    const newSession = lastSessionKey.current !== sessionKey;
    lastSessionKey.current = sessionKey;
    (async () => {
      if (isSecure() && newSession) { setLoaded(false); setLiveNotice(null); } // نشستِ تازه، خبرهای نشستِ قبلی را با خود نمی‌آورد
      const load = async (key, setter, fallback) => {
        try { const r = await window.storage.get(key, true); setter(r ? JSON.parse(r.value) : fallback); }
        catch (e) { setter(fallback); }
      };
      await Promise.all([
        load('printshop_orders_v5', (v) => setOrders(migrateOrders(v)), []),
        load('printshop_inventory_v3', setInventory, []),
        isSecure() && user?.role === 'مشتری' ? refreshCustomerProfile() : load('printshop_customers_v2', setCustomers, []),
        load('printshop_suppliers_v2', setSuppliers, []),
        load('printshop_qty_units', setQtyUnits, DEFAULT_QTY_UNITS),
        load('printshop_service_types', setServiceTypes, DEFAULT_SERVICE_TYPES),
        load('printshop_inv_categories', setInvCategories, DEFAULT_INV_CATEGORIES),
        load('printshop_product_types', (v) => setProductTypes([...new Set([...(Array.isArray(v) ? v : []), ...DEFAULT_PRODUCT_TYPES])]), DEFAULT_PRODUCT_TYPES),
        load('printshop_binding_types', setBindingTypes, DEFAULT_BINDING_TYPES),
        load('printshop_paper_kinds', setPaperKinds, DEFAULT_PAPER_KINDS),
        load('printshop_trim_sizes', (v) => setTrimSizes(trimSizesFromMap(v)), DEFAULT_TRIM_SIZES),
        load('printshop_engine_cuts', (v) => setEngineCuts(v && Object.keys(v).length ? v : ENGINE_CUTS), null),
        load('printshop_engine_presses', (v) => setEnginePresses(v && Object.keys(v).length ? v : ENGINE_PRESSES), null),
        load('printshop_print_colors', (v) => setPrintColors(printColorsFromMap(v).length ? printColorsFromMap(v) : DEFAULT_PRINT_COLORS), null),
        load('printshop_book_like_types', setBookLikeTypes, DEFAULT_BOOK_LIKE_TYPES),
        load('printshop_manager_pin', setManagerPin, '1234'),
        load('printshop_settings_v1', (v) => setSettings(mergeSettings(v)), null),
        isSecure() ? (async () => { if (user && user.role === 'مدیر چاپخانه') { const r = await window.printshopApi.auth.listUsers(); if (r.ok) setUsers(r.users); } })() : load('printshop_users_v1', setUsers, null),
        load('printshop_units_v1', setUnits, null),
        load('printshop_marketer_pay_v1', setMkPays, []),
        load('printshop_receipts_v1', setReceipts, []),
        load('printshop_consignments_v1', setConsignmentReceipts, []),
        load('printshop_letters_v1', setLetters, []),
        load('printshop_login_seen_v1', setLoginSeen, false),
        load('printshop_ai_v1', (v) => setAiCfg(prev => ({ ...prev, ...(v || {}) })), null),
      ]);
      setLoaded(true);
    })();
    return undefined;
  }, [isSecure() ? (user && user.id) : 'local', user && user.mustChange, reloadTick]);

  async function persist(key, setter, next) {
    try { const saved = await window.storage.set(key, JSON.stringify(next), true); setter(JSON.parse(saved.value)); return true; }
    /* بند ب: تضاد نسخه پیام مسدودکننده ندارد؛ نوار قرمز می‌گوید چه شد و فهرست تازه شد. */
    catch (e) { if (e && e.code === 'STALE_RECORD') return false; alert((e && e.message) || 'ذخیره انجام نشد؛ اطلاعات قبلی حفظ شده است.'); return false; }
  }
  const persistOrders = (next) => persist('printshop_orders_v5', setOrders, next);
  const persistInventory = (next) => persist('printshop_inventory_v3', setInventory, next);
  const persistCustomers = (next) => persist('printshop_customers_v2', setCustomers, next.map(c => customers.some(old => old.id === c.id) ? c : { ...c, customerCode: '', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' } }));
  const persistSuppliers = (next) => persist('printshop_suppliers_v2', setSuppliers, next.map(s => suppliers.some(old => old.id === s.id) ? s : { ...s, supplierCode: '', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' } }));
  const persistQtyUnits = (next) => persist('printshop_qty_units', setQtyUnits, next);
  const persistServiceTypes = (next) => persist('printshop_service_types', setServiceTypes, next);
  const persistInvCategories = (next) => persist('printshop_inv_categories', setInvCategories, next);
  const persistProductTypes = (next) => persist('printshop_product_types', setProductTypes, next);
  const persistBindingTypes = (next) => persist('printshop_binding_types', setBindingTypes, next);
  const persistPaperKinds = (next) => persist('printshop_paper_kinds', setPaperKinds, next);
  const persistBookLikeTypes = (next) => persist('printshop_book_like_types', setBookLikeTypes, next);
  const persistEngineCuts = (next) => persist('printshop_engine_cuts', setEngineCuts, next);
  const persistEnginePresses = (next) => persist('printshop_engine_presses', setEnginePresses, next);
  const persistTrimSizes = (next) => persist('printshop_trim_sizes', setTrimSizes, next);
  async function persistPrintColors(nextPairs) {
    try { const saved = await window.storage.set('printshop_print_colors', JSON.stringify(printColorsToMap(nextPairs)), true); setPrintColors(printColorsFromMap(JSON.parse(saved.value))); return true; }
    catch (e) { if (e && e.code === 'STALE_RECORD') return false; alert((e && e.message) || 'ذخیره انجام نشد؛ فهرست قبلی حفظ شده است.'); return false; }
  }
  const persistManagerPin = (next) => persist('printshop_manager_pin', setManagerPin, next);
  const persistSettings = (next) => persist('printshop_settings_v1', setSettings, next);
  async function refreshCustomerProfile() {
    if (!isSecure()) return;
    try {
      const result = await window.printshopApi.customerProfile();
      setCustomers(result.ok && result.customer ? [result.customer] : []);
      const finance = await window.printshopApi.customerFinance();
      setMyFinance(finance.ok ? { orders: finance.orders, documents: finance.documents } : null);
      return result;
    } catch (_) { setCustomers([]); setMyFinance(null); return { ok: false, error: 'دریافت پروندهٔ مشتری ممکن نشد.' }; }
  }
  async function refreshPartyBank(kind) {
    const key = kind === 'supplier' ? 'printshop_suppliers_v2' : 'printshop_customers_v2';
    const setter = kind === 'supplier' ? setSuppliers : setCustomers;
    try { const r = await window.storage.get(key, true); setter(r ? JSON.parse(r.value) : []); return { ok: true }; }
    catch (e) { return { ok: false, error: (e && e.message) || 'دریافت فهرست ممکن نشد.' }; }
  }
  async function partyAction(kind, id, action, payload) {
    if (!isSecure()) return { ok: false, error: 'تأیید و صدور کد در نسخهٔ امن دسکتاپ فعال است.' };
    try {
      const result = await window.printshopApi.partyAction(kind, id, action, payload);
      if (result?.ok && result.removed) return await refreshPartyBank(kind), result;
      if (result?.ok && result.party) {
        const setter = kind === 'supplier' ? setSuppliers : setCustomers;
        setter(previous => previous.map(p => p.id === id ? result.party : p));
      }
      return result;
    } catch (_) { return { ok: false, error: 'ثبت بررسی ممکن نشد؛ دوباره تلاش کنید.' }; }
  }
  async function togglePartyActive(kind, party) {
    const active = partyActive(party);
    const label = kind === 'supplier' ? 'تامین‌کننده' : 'مشتری';
    if (!confirm(active ? `${label} «${party.name}» غیرفعال شود؟ از فهرست‌های کاری بیرون می‌رود اما سابقهٔ اسنادش می‌ماند.` : `${label} «${party.name}» دوباره فعال شود؟`)) return;
    const result = await partyAction(kind, party.id, active ? 'deactivate' : 'activate', {});
    if (!result?.ok) alert(result?.error || 'ثبت تغییر ممکن نشد.');
  }
  async function persistUsers(next) {
    if (isSecure()) {
      const r = await window.printshopApi.auth.saveUsers(next);
      if (r.ok) {
        setUsers(r.users);
        /* نام ایستگاهِ خودِ کاربرِ واردشده باید همان لحظه در ستون کناری دیده شود،
           نه پس از ورود بعدی. */
        const me = r.users.find(x => x.id === user?.id);
        if (me && me.station !== ((user && user.station) || '')) setUser(prev => prev ? { ...prev, station: me.station } : prev);
      }
      return r;
    }
    const ok = await persist('printshop_users_v1', setUsers, next.map(({ _plain, ...u }) => u));
    return { ok, error: ok ? '' : 'ذخیرهٔ کاربران انجام نشد.' };
  }
  const persistUnits = (next) => persist('printshop_units_v1', setUnits, next);
  const persistAi = (next) => persist('printshop_ai_v1', setAiCfg, next);
  const persistMkPays = (next) => persist('printshop_marketer_pay_v1', setMkPays, next);
  const persistReceipts = (next) => persist('printshop_receipts_v1', setReceipts, next);
  const persistLetters = (next) => persist('printshop_letters_v1', setLetters, next);
  function newLetterDraft() {
    const t = 'material';
    const base = { id: uid(), number: '', date: todayIso(), type: t, fromUnit: unitForRole(user ? user.role : ''), fromName: user ? user.name : '', createdBy: user ? user.id : '', subject: LETTER_TYPES[t].title, fields: {}, body: '', status: 'sent', managerNote: '', createdAt: Date.now() };
    return { ...base, body: composeLetter(base, faDate) };
  }
  function addReceipt(r, updateUnitValue) {
    const sp = suppliers.find(x => x.id === r.supplierId);
    persistInventory(applyReceipt(inventory, r, sp ? sp.name : '', { updateUnitValue, uid }));
    persistReceipts([r, ...receipts]);
  }
  function updateReceipt(r) { persistReceipts(receipts.map(x => x.id === r.id ? { ...x, ...r, lines: x.lines } : x)); }
  function deleteReceipt(r) {
    if (r.receiptNumber) { alert('رسید شماره‌دار قابل حذف نیست؛ سابقه سند باید حفظ شود.'); return; }
    if (!confirm('این ورود کالا حذف شود؟ مقدار آن از موجودی انبار کم می‌شود.')) return;
    const res = reverseReceipt(inventory, r, { uid, today: todayIso() });
    if (!res.ok) { alert(res.error); return; }
    persistInventory(res.inventory); persistReceipts(receipts.filter(x => x.id !== r.id));
  }
  const unitsData = useMemo(() => mergeUnits(units), [units]);
  costContext.units = unitsData; costContext.priceEntry = priceEntry; costContext.entryHasPrice = entryHasPrice; costContext.entryHasTiers = entryHasTiers;
  lexicon.trimSizes = trimSizes; lexicon.paperKinds = paperKinds; lexicon.bindingTypes = bindingTypes;
  applyBank({ engineCuts, enginePresses, cutTrim: trimSizes, bindingTypes, printColors, productTypes, bookLikeTypes });
  lexicon.printColors = printColors; lexicon.bookLikeTypes = bookLikeTypes;
  const allUsers = users && users.length ? users : [DEFAULT_ADMIN];
  const role = user ? user.role : '';
  const perms = permsFor(role);
  const curTab = navPermission(workbench.activeId, perms) ? workbench.activeId : (perms.tabs[0] || 'orders');
  const managerView = !!perms.users;
  const pendingLetters = useMemo(() => letters.filter(l => l.status === 'sent').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)), [letters]);
  useEffect(() => { setLetterAlert(managerView && loaded && pendingLetters.length > 0); }, [managerView, loaded]);

  /* اصلاحات ۱۷/بند ۰: کدینگ حساب‌ها و نگاشت رویداد→سند را سرور می‌سازد و میز دایرةالمعارف فقط می‌خواند؛
     دروازهٔ نقش در خودِ سرور است (مدیر چاپخانه و مدیر مالی) و عددِ سطرهای دفترکل از بانک می‌آید. */
  const [ledger, setLedger] = useState(null);
  const [ledgerNote, setLedgerNote] = useState('');
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.printshopApi : null;
    if (!api || typeof api.ledgerCoding !== 'function') { setLedger(null); setLedgerNote('کدینگ دفترکل فقط در نسخهٔ پایگاه دادهٔ امن خوانده می‌شود.'); return undefined; }
    if (role !== 'مدیر چاپخانه' && role !== 'مدیر مالی') { setLedger(null); setLedgerNote('کدینگ و نگاشت سند فقط برای مدیر چاپخانه و مدیر مالی نمایش داده می‌شود.'); return undefined; }
    let alive = true;
    api.ledgerCoding().then(r => {
      if (!alive) return;
      if (r && r.ok) { setLedger(r); setLedgerNote(''); }
      else { setLedger(null); setLedgerNote((r && r.error) || 'کدینگ دفترکل از سرور خوانده نشد.'); }
    }).catch(() => { if (alive) { setLedger(null); setLedgerNote('کدینگ دفترکل از سرور خوانده نشد.'); } });
    return () => { alive = false; };
  }, [role]);

  function logEvent(order, text) { return { ...order, history: [...(order.history || []), { id: uid(), date: todayIso(), text, by: user ? user.name : '' }] }; }
  async function submitRequest(text, phone) {
    if (isSecure()) return window.printshopApi.auth.submitRequest(text, phone);
    const cust = customers.find(c => c.id === (user && user.customerId));
    const base = emptyOrder();
    const o = { ...base, status: REQUEST_STATUS, customerId: cust ? cust.id : '', customerName: cust ? cust.name : (user ? user.name : ''), phone, mobile: cust ? (cust.mobile || '') : '', smartText: text, requestText: text, title: text.slice(0, 60), source: 'مشتری', requestedBy: user ? user.id : '',
      history: [{ id: uid(), date: todayIso(), text: 'درخواست سفارش توسط مشتری ثبت شد', by: user ? user.name : '' }] };
    persistOrders([o, ...orders]);
    return { ok: true, orderNumber: o.orderNumber };
  }
  function convertRequest(order) {
    const base = emptyOrder();
    setDetailOrder(null);
    setOrderModal({ ...base, id: order.id, orderNumber: order.orderNumber, date: order.date, createdAt: order.createdAt, customerId: order.customerId, customerCode: order.customerCode, customerName: order.customerName, phone: order.phone, mobile: order.mobile || '', smartText: order.requestText || order.smartText || '', requestText: order.requestText || order.smartText || '', status: REQUEST_STATUS, history: order.history || [], vatPercent: settings.quote.vatPercent ? String(settings.quote.vatPercent) : '' });
  }
  function openRequests() { setStatusFilter(REQUEST_STATUS); setTab('orders'); }
  const openDetail = order => { setDetailViewOnly(false); setDetailOrder(order); };
  const openBoardDetail = order => { setDetailViewOnly(role !== 'مدیر چاپخانه'); setDetailOrder(order); };
  async function upsertOrder(order) {
    const prev = orders.find(o => o.id === order.id);
    const fromRequest = !!prev && prev.status === REQUEST_STATUS;
    const exists = !!prev && !fromRequest;
    const base = exists ? { ...order, quoteRev: prev.workflow?.customerConfirmation ? (Number(prev.quoteRev) || 1) + 1 : order.quoteRev } : { ...order, status: 'در انتظار تایید', vatPercent: perms.manageOrder ? order.vatPercent : '' };
    const safe = withoutWorkflowWrites(base, prev);
    const withLog = exists ? logEvent(safe, 'ویرایش مشخصات سفارش') : logEvent(safe, fromRequest ? 'تبدیل درخواست مشتری به سفارش — منتظر بررسی و اجازهٔ مدیر' : 'ثبت سفارش — منتظر بررسی و اجازهٔ مدیر');
    if (!await persistOrders(prev ? orders.map(o => o.id === order.id ? withLog : o) : [withLog, ...orders])) return;
    setOrderModal(null); setDetailOrder(null);
  }
  async function saveOrderUpdate(o) {
    if (!await persistOrders(orders.map(x => x.id === o.id ? o : x))) return false;
    if (detailOrder && detailOrder.id === o.id) setDetailOrder(o);
    return true;
  }
  function approveOrder(order) {
    if (!perms.approveProduction) { alert('اجازهٔ شروع تولید فقط با مدیر چاپخانه است.'); return; }
    setDetailOrder(order);
  }
  async function refreshNotifications() {
    if (!isSecure()) return;
    const result = await window.printshopApi.notifications();
    if (result.ok) setNotifications(result.notifications || []);
  }
  async function workflowAction(id, action, payload) {
    if (!isSecure()) return { ok: false, error: 'ثبت گردش سفارش در نسخهٔ دسکتاپ و پایگاه دادهٔ امن فعال است.' };
    const result = await window.printshopApi.orderAction(id, action, payload);
    if (result.code === 'UNAUTHENTICATED') window.dispatchEvent(new Event('printshop:session-expired'));
    if (!result.ok) return result;
    try {
      const response = await window.storage.get('printshop_orders_v5', true);
      const fresh = migrateOrders(JSON.parse(response.value));
      setOrders(fresh);
      setDetailOrder(previous => previous ? fresh.find(o => o.id === previous.id) || null : null);
    } catch (_) { /* A role without order access may still stop an order. */ }
    if (action === 'change_stage' || action === 'complete_stage') {
      try { const response = await window.storage.get('printshop_inventory_v3', true); setInventory(JSON.parse(response.value)); } catch (_) { /* role-scoped access */ }
    }
    await refreshNotifications().catch(() => {});
    return result;
  }
  async function completeItemStage(order, item, stage, note) {
    const result = await workflowAction(order.id, 'complete_stage', { itemId: item.id, stage, note });
    if (result.code === 'STAGE_CONFLICT' || result.code === 'REVISION_CONFLICT') {
      try {
        const response = await window.storage.get('printshop_orders_v5', true);
        setOrders(migrateOrders(JSON.parse(response.value)));
      } catch (_) { /* role without order access */ }
    }
    return result;
  }
  async function readNotification(id) {
    const result = await window.printshopApi.markNotificationRead(id);
    if (result.ok) await refreshNotifications();
  }
  async function archiveOrderSave(order, info) {
    const o = logEvent({ ...order, status: 'بایگانی', archive: { ...info, date: todayIso() } }, `بایگانی — ${info.reason}${info.note ? ': ' + info.note : ''}`);
    if (await saveOrderUpdate(o)) setArchiveOrder(null);
  }
  function reopenOrder(order) {
    if (!confirm(`سفارش ${order.orderNumber} از بایگانی خارج شود و پیش‌فاکتور جدید برایش آماده شود؟`)) return;
    const o = logEvent({ ...order, status: 'در انتظار تایید', quoteRev: (order.quoteRev || 1) + 1, archive: null }, 'بازگشایی از بایگانی — پیش‌فاکتور جدید');
    saveOrderUpdate(o); setTab('orders'); openDetail(o);
  }
  function newQuoteRevision(order) {
    const rev = (order.quoteRev || 1) + 1;
    saveOrderUpdate(logEvent({ ...order, quoteRev: rev }, `نسخه ${rev} پیش‌فاکتور — مبلغ ${fmt(orderPayable(order))} ریال`));
  }
  function changeOrderStatus(order, status) { saveOrderUpdate(logEvent({ ...order, status }, `تغییر وضعیت به «${status}»`)); }
  async function deleteOrder(id) { if (!confirm('این سفارش حذف شود؟')) return; if (await persistOrders(orders.filter(o => o.id !== id))) setDetailOrder(null); }

  // مراحل مصرف‌کنندهٔ material در هر دو مسیر و مسیر قدیمی — فقط برای حالت بدون پایگاه داده.
  const MATERIAL_STAGES = ['لیتوگرافی', 'لیتوگرافی و زینک', 'چاپ', 'چاپ افست', 'چاپ دیجیتال', 'صحافی', 'صحافی و تکمیلی', 'خدمات تکمیلی', 'برش و تکمیلی'];
  const crossesIntoMaterials = (item, newStage) => {
    const list = stagesFor(item);
    const from = list.indexOf(item.stage || START_STAGE), to = list.indexOf(newStage);
    return to > from && list.slice(from + 1, to + 1).some(st => MATERIAL_STAGES.includes(st));
  };
  function deductItemMaterials(item, order) {
    let inv = [...inventory];
    itemAllMaterials(item).forEach(m => {
      if (!m.inventoryItemId || !(Number(m.qty) > 0)) return;
      inv = inv.map(i => {
        if (i.id !== m.inventoryItemId) return i;
        const used = usageInStockUnit(m, i);
        const before = stockLevel(i);
        const after = Math.round(Math.max(0, before - used) * 1000) / 1000;
        const move = { id: uid(), date: todayIso(), type: 'out', qty: Math.round(Math.min(used, before) * 1000) / 1000, note: `سفارش ${order.orderNumber} — ${item.productName || 'قلم'}`, orderNumber: order.orderNumber };
        const movements = [...(i.movements || []), move];
        if (i.unitMode === 'band_sheet') return { ...i, bandCount: after, movements };
        if (i.unitMode === 'roll_kg') return { ...i, weightKg: after, movements };
        return { ...i, quantity: after, movements };
      });
    });
    persistInventory(inv);
  }
  async function changeItemStage(order, item, newStage) {
    if (isSecure()) {
      const list = stagesFor(item);
      const jump = list.indexOf(newStage) - list.indexOf(item.stage || START_STAGE) > 1;
      const reason = jump ? prompt('دلیل عبور از چند مرحله را ثبت کنید:') : '';
      if (jump && !reason) return;
      const result = await workflowAction(order.id, 'change_stage', { itemId: item.id, newStage, reason });
      if (!result.ok) alert(result.error || 'تغییر مرحله ثبت نشد.');
      return;
    }
    if (['در انتظار تایید', 'بایگانی', REQUEST_STATUS].includes(order.status)) { alert('این سفارش هنوز تایید نشده است؛ ابتدا تایید مشتری را ثبت کنید.'); return; }
    const crossingIntoProduction = crossesIntoMaterials(item, newStage) && !item.materialsDeducted;
    if (crossingIntoProduction) deductItemMaterials(item, order);
    const items = order.items.map(it => it.id === item.id ? { ...it, stage: newStage, materialsDeducted: it.materialsDeducted || crossingIntoProduction } : it);
    const updated = { ...order, items };
    persistOrders(orders.map(o => o.id === order.id ? updated : o));
    if (detailOrder && detailOrder.id === order.id) setDetailOrder(updated);
  }

  function upsertInv(item) {
    const old = inventory.find(i => i.id === item.id);
    const lvl = stockLevel(item);
    let movements = item.movements || [];
    if (!old) movements = [...movements, { id: uid(), date: todayIso(), type: 'in', qty: lvl, note: 'موجودی اولیه' }];
    else if (stockLevel(old) !== lvl) movements = [...movements, { id: uid(), date: todayIso(), type: lvl > stockLevel(old) ? 'in' : 'out', qty: Math.round(Math.abs(lvl - stockLevel(old)) * 1000) / 1000, note: 'اصلاح دستی موجودی' }];
    const next = { ...item, movements };
    persistInventory(old ? inventory.map(i => i.id === item.id ? next : i) : [next, ...inventory]);
    setInvDrafts(ds => ds.filter(d => d.item.id !== item.id));
    setInvModal(null);
  }
  function upsertManyInv(items) {
    const adds = items.map(it => ({ ...it, movements: [{ id: uid(), date: todayIso(), type: 'in', qty: stockLevel(it), note: 'موجودی اولیه (ثبت هوشمند)' }] }));
    persistInventory([...adds, ...inventory]);
  }
  function addSupplierInline(sp) { persistSuppliers([sp, ...suppliers]); }
  function deleteInv(id) { if (!confirm('این قلم انبار حذف شود؟')) return; persistInventory(inventory.filter(i => i.id !== id)); }
  async function upsertCustomer(c) { const exists = customers.some(x => x.id === c.id); if (await persistCustomers(exists ? customers.map(x => x.id === c.id ? c : x) : [c, ...customers])) setCustModal(null); }
  function deleteCustomer(id) { const c = customers.find(x => x.id === id); if (c && protectedParty(c)) { alert('این رکورد تأیید یا کد گرفته و در بانک محافظت می‌شود؛ با دکمهٔ «غیرفعال کردن» در همان ردیف غیرفعالش کنید. حذف کامل فقط برای رکورد بی‌کد و تأییدنشده ممکن است.'); return; } if (!confirm('این مشتری حذف شود؟')) return; persistCustomers(customers.filter(x => x.id !== id)); }
  function upsertSupplier(s) { const exists = suppliers.some(x => x.id === s.id); persistSuppliers(exists ? suppliers.map(x => x.id === s.id ? s : x) : [s, ...suppliers]); setSuppModal(null); }
  function deleteSupplier(id) { const s = suppliers.find(x => x.id === id); if (s && protectedParty(s, 'supplier')) { alert('این تامین‌کننده تأیید یا کد گرفته و در بانک محافظت می‌شود؛ با دکمهٔ «غیرفعال کردن» در همان ردیف غیرفعالش کنید.'); return; } if (!confirm('این تامین‌کننده حذف شود؟')) return; persistSuppliers(suppliers.filter(x => x.id !== id)); }
  function addQtyUnit(u) { if (!qtyUnits.includes(u)) persistQtyUnits([...qtyUnits, u]); }
  function addServiceType(s) { if (!serviceTypes.includes(s)) persistServiceTypes([...serviceTypes, s]); }
  function addInvCategory(c) { if (!invCategories.includes(c)) persistInvCategories([...invCategories, c]); }
  function addProductType(p) { if (!productTypes.includes(p)) persistProductTypes([...productTypes, p]); }
  function removeQtyUnit(u) { persistQtyUnits(qtyUnits.filter(x => x !== u)); }
  function removeServiceType(t) { persistServiceTypes(serviceTypes.filter(x => x !== t)); }
  function removeProductType(p) { persistProductTypes(productTypes.filter(x => x !== p)); }
  function removeInvCategory(c) { if (REQUIRED_INV_CATEGORIES.includes(c)) return; persistInvCategories(invCategories.filter(x => x !== c)); }
  function addCustomerInline(c) { persistCustomers([...(Array.isArray(c) ? c : [c]), ...customers]); }

  const lowStock = inventory.filter(isLow);
  const missingInv = REQUIRED_INV_CATEGORIES.filter(c => !inventory.some(i => i.category === c));
  function openNewOrder() { setOrderModal({ ...emptyOrder(), vatPercent: settings.quote.vatPercent ? String(settings.quote.vatPercent) : '' }); }
  function exportInventory(list) {
    const src = Array.isArray(list) ? list : inventory;
    const head = ['ردیف', 'شرح', 'دسته', 'گراماژ', 'سایز', 'رنگ / نوع', 'برند', 'مالک', 'کاربرد (مشتری)', 'منبع تامین', 'تعداد بند', 'ورق در هر بند', 'جمع ورق', 'وزن (کیلوگرم)', 'موجودی', 'واحد', 'حداقل موجودی', 'ارزش هر واحد (ریال)', 'ارزش کل (ریال)', 'محل نگهداری'];
    const rows = [head];
    src.forEach((i, idx) => rows.push([idx + 1, i.name, i.category, i.gramaj, i.size, i.color || i.finish || '', i.brand, ownerLabel(i, customers), i.ownerType === 'مشتری' ? purposeText(i) : '', supplierSourceLabel(i, customers, suppliers),
      i.unitMode === 'band_sheet' ? Number(i.bandCount) || 0 : '', i.unitMode === 'band_sheet' ? Number(i.sheetsPerBand) || 0 : '', i.unitMode === 'band_sheet' ? sheetCount(i) : '',
      i.unitMode === 'roll_kg' ? Number(i.weightKg) || 0 : '', stockLevel(i), stockUnitLabel(i), Number(i.minThreshold) || 0, Number(i.unitValue) || 0, Math.round(itemValue(i)), i.location]));
    const moves = [['کالا', 'مالک', 'تاریخ', 'نوع', 'مقدار', 'واحد', 'شرح']];
    src.forEach(i => (i.movements || []).forEach(m => moves.push([i.name, ownerLabel(i, customers), faDate(m.date), m.type === 'in' ? 'ورود' : 'خروج', Number(m.qty), stockUnitLabel(i), m.note || ''])));
    saveWorkbook(`موجودی-انبار-${faDate(todayIso()).replace(/\//g, '-')}.xlsx`, [{ name: 'موجودی انبار', rows }, { name: 'گردش کالا', rows: moves }]);
  }
  const activeOrders = orders.filter(o => !['تحویل شده', 'لغو شده', 'بایگانی'].includes(o.status));
  const todayOrders = orders.filter(o => o.date === todayIso());
  const inProduction = activeOrders.reduce((sum, o) => sum + (o.items || []).filter(it => it.stage && it.stage !== START_STAGE && !isDeliveryStage(it.stage)).length, 0);
  /* اصلاحات ۱۷/بند ۱: «جمع مطالبات» و «چند سفارش بدهکار» دیگر در رابط ساخته نمی‌شوند.
     هر دو از جدول پروندهٔ اعتباری سرور (be:creditFiles) خوانده می‌شوند تا عددِ بدهیِ
     چاپخانه فقط یک منبع داشته باشد. */
  /* curTab هم داده می‌شود: میز اعتبار باید با هر بار رفتن به یک بخش از سرور تازه خوانده
     شود، وگرنه مدیر همان عددِ پیشین را می‌بیند و «قابل استفاده» را اشتباه می‌خواند. */
  const creditDesk = useCreditFiles(loaded && isSecure() && (role === 'مدیر چاپخانه' || role === 'مدیر مالی'), curTab);
  const totalReceivable = creditDesk.kpis ? creditDesk.kpis.totalDefinite : 0;
  const urgentOrders = activeOrders.filter(o => { const u = urgency(o); return u.color === COLORS.danger || u.color === COLORS.warn; });
  const financeOrder = financeOrderNumber.trim() ? orders.find(o => o.orderNumber && o.orderNumber === financeOrderNumber.trim()) : undefined;
  const pendingOrders = orders.filter(o => o.status === 'در انتظار تایید');
  const expiredQuotes = pendingOrders.filter(o => addDaysIso(o.date, Number(settings.quote.validityDays) || 0) < todayIso());
  const followUps = orders.filter(o => o.status === 'بایگانی' && o.archive && o.archive.followUp && o.archive.followUp <= todayIso());

  const visibleOrders = useMemo(() => {
    let list = orders.filter(o => statusFilter === 'بایگانی' || o.status !== 'بایگانی');
    if (role === 'مشتری') list = phoneLookup.length > 3 ? list.filter(o => (o.phone || '').includes(phoneLookup)) : [];
    if (statusFilter !== 'all') list = list.filter(o => o.status === statusFilter);
    if (search.trim()) {
      const q = search.trim();
      list = list.filter(o => (o.customerName || '').includes(q) || (o.orderNumber || '').includes(q) || (o.phone || '').includes(q) || (o.items || []).some(it => (it.productName || '').includes(q)));
    }
    return list;
  }, [orders, role, phoneLookup, statusFilter, search]);

  const NAV_ALL = [
    { id: 'dashboard', label: 'داشبورد', icon: LayoutDashboard },
    { id: 'orders', label: role === 'مشتری' ? 'سفارش‌های من' : 'سفارش‌ها', icon: ClipboardList },
    { id: 'forms', label: 'فرم‌های سفارش', icon: NotebookPen },
    { id: 'production', label: 'تابلوی تولید', icon: SquareKanban },
    { id: 'archive', label: 'بایگانی', icon: Archive },
    { id: 'inventory', label: 'موجودی و کالاها', icon: Package },
    { id: 'customers', label: 'مشتریان', icon: Users },
    { id: 'suppliers', label: 'تامین‌کنندگان', icon: Truck },
    { id: 'units', label: 'واحدهای تولید', icon: Factory },
    { id: 'finance', label: 'خلاصه مالی', icon: Wallet },
    { id: 'request', label: 'ثبت درخواست سفارش', icon: Inbox },
    { id: 'myfinance', label: 'مالی من', icon: Wallet },
    { id: 'letters', label: 'نامه‌ها', icon: Mails },
    { id: 'settings', label: 'تنظیمات', icon: Settings },
  ];
  const EXTRA_DESKS = [
    ['finance-pricing', 'قیمت‌گذاری و دریافت', 'finance', Calculator],
    ['finance-quote', 'پیش‌فاکتورها', 'finance', FileCheck],
    ['finance-invoice', 'فاکتورها', 'finance', Receipt],
    ['finance-statement', 'صورت وضعیت', 'finance', ScrollText],
    ['finance-credit', 'پروندهٔ اعتباری و مطالبات', 'finance', BookUser],
    ['finance-marketers', 'حساب بازاریاب‌ها', 'finance', Megaphone],
    ['inventory-stock', 'موجودی کالا', 'inventory', Boxes],
    ['inventory-entry', 'ثبت اقلام انبار', 'inventory', PackagePlus],
    ['inventory-movements', 'کاردکس و گردش انبار', 'inventory', ArrowLeftRight],
    ['inventory-receipts', 'رسیدهای انبار', 'inventory', FileInput],
    ['report-unfinished', 'گزارش کارهای ناتمام', 'report', BarChart3],
    ['report-delivery', 'گزارش تحویل', 'report', Truck],
    ['report-finance', 'گزارش مالی و تسویه', 'report', Wallet],
    ['settings-company', 'مشخصات و تنظیمات', 'settings', Building],
    ['settings-users', 'کاربران و دسترسی‌ها', 'settings', ShieldCheck],
    ['settings-numbering', 'مدیریت شماره‌گذاری', 'settings', ListOrdered],
    ['settings-lexicon', 'دایرةالمعارف', 'settings', Library],
    ['settings-maintenance', 'پاکسازی سفارش‌های آزمایشی', 'settings', Archive],
    ['excel', 'ورود از اکسل', 'excel', Sheet],
    ['settings-ai', 'تنظیمات تحلیل محلی', 'settings', Cpu],
  ].map(([id, label, permission, icon]) => ({ id, label, permission, icon })).filter(desk => (desk.id !== 'settings-maintenance' || role === 'مدیر چاپخانه') && (desk.id !== 'report-finance' || role === 'مدیر چاپخانه' || role === 'مدیر مالی'));
  const navItems = [...NAV_ALL, ...EXTRA_DESKS].filter(n => navPermission(n.permission || n.id, perms)).map(n => ({ ...n, parent: n.permission && n.permission !== n.id ? n.permission : undefined, group: (n.permission || n.id) === 'finance' ? 'finance' : (n.permission || n.id) === 'inventory' ? 'inventory' : (n.permission || n.id) === 'report' ? 'report' : ['settings', 'customers', 'suppliers', 'units', 'about', 'excel'].includes(n.permission || n.id) ? 'management' : 'work' }));
  const allowedDesks = navItems.map(n => n.id);
  const deskParents = Object.fromEntries(navItems.filter(n => n.parent).map(n => [n.id, n.parent]));
  function setTab(id) {
    if (!allowedDesks.includes(id)) return;
    setWorkbench(previous => workbenchReducer(previous, { type: 'open', id, allowedIds: allowedDesks, parentOf: deskParents }));
    setVisitedDesks(previous => previous.includes(id) ? previous : [...previous, id]);
  }
  function openExcel(dataset) {
    setExcelDataset(dataset);
    setTab('excel');
  }
  const canImport = dataset => (catalogSchemas[dataset]?.writeRoles || []).includes(role);
  function closeDesk(id) {
    if (latestCloseBlocker()) { requestGuardedAction(null); return; }
    setWorkbench(previous => workbenchReducer(previous, { type: 'close', id, allowedIds: allowedDesks }));
  }
  function deskLinks(permission) { return <div className="workbench-shortcuts">{EXTRA_DESKS.filter(n => n.permission === permission).map(n => <button type="button" key={n.id} onClick={() => setTab(n.id)}><n.icon size={19} /><strong>{n.label}</strong><span>باز کردن در تب مستقل</span></button>)}</div>; }
  async function refreshDocuments() {
    const result = await window.printshopApi?.documents();
    if (result?.ok) setDocuments(result.documents);
    return result || { ok: false, error: 'اسناد مالی در نسخه دسکتاپ فعال است.' };
  }
  async function issueDocument(orderId, type) {
    const result = await window.printshopApi?.documentAction(orderId, 'issue_' + type, {});
    if (result?.ok) setDocuments(previous => [result.document, ...previous.filter(d => d.id !== result.document.id)]);
    return result;
  }
  async function voidDocument(id, reason) {
    const document = documents.find(d => d.id === id);
    if (!document) return { ok: false, error: 'سند پیدا نشد؛ فهرست را تازه کنید.' };
    const result = await window.printshopApi?.documentAction(document.orderId, 'void', { documentId: id, reason });
    if (result?.ok) setDocuments(previous => previous.map(d => d.id === id ? result.document : d));
    return result;
  }
  useEffect(() => { if (user && ['finance-quote', 'finance-invoice', 'finance-statement'].includes(curTab)) refreshDocuments().catch(() => {}); }, [user?.id, curTab]);

  useEffect(() => {
    const first = user ? (permsFor(user.role).tabs[0] || 'orders') : '';
    setWorkbench({ openIds: first ? [first] : [], activeId: first });
    setVisitedDesks(first ? [first] : []); setDocuments([]); setPrintDocument(null);
  }, [user?.id, user?.role]);
  useEffect(() => { if (isSecure()) window.printshopApi.auth.info().then(i => setSecureInfo(i || { defaultAdmin: false })).catch(() => {}); }, []);
  useEffect(() => {
    const expired = () => { setUser(null); setLoaded(false); setDetailOrder(null); setOrderModal(null); setPrintOrder(null); };
    window.addEventListener('printshop:session-expired', expired);
    return () => window.removeEventListener('printshop:session-expired', expired);
  }, []);
  /* بند ب: نوشتنِ ردشده هیچ داده‌ای را عوض نکرده است؛ همان لحظه فهرست از بانک
     خوانده می‌شود و نوار قرمز می‌گوید چرا نوشتهٔ این ایستگاه ذخیره نشد. */
  useEffect(() => {
    const stale = (event) => {
      setReloadTick(n => n + 1);
      setLiveNotice(null); // فهرست همین حالا از بانک تازه شد؛ خبرِ منتظر بی‌موضوع است
      setStaleNotice({ key: (event.detail && event.detail.key) || '' });
    };
    window.addEventListener('printshop:stale', stale);
    return () => window.removeEventListener('printshop:stale', stale);
  }, []);
  /* بند پ: در حالت شبکه هر چند ثانیه از سرور پرسیده می‌شود «بعد از آخرین کارِ این ایستگاه
     جایی تغییر کرده؟». سرور فقط نامِ فهرست‌ها را می‌فرستد، نه داده؛ تا «تازه‌سازی» زده
     نشود هیچ نوشتهٔ بازِ این ایستگاه دور ریخته نمی‌شود. ایستگاهِ تک‌نفره (بدون سرور)
     پرس‌وجو نمی‌کند. */
  useEffect(() => {
    if (!isSecure() || !user || user.mustChange) return undefined;
    if (!window.printshopApi?.serverName || typeof window.printshopApi.changes !== 'function') return undefined;
    let active = true;
    /* همین ضربان، نشانگر اتصال را هم زنده نگه می‌دارد: خطای حمل‌ونقل یعنی «قطع»،
       پاسخِ سرور — حتی پاسخِ خطای کاری — یعنی «وصل». */
    const DOWN = new Set(['SERVER_UNREACHABLE', 'REQUEST_TIMEOUT', 'RESPONSE_TOO_LARGE', 'BAD_RESPONSE', 'SERVER_ERROR', 'BAD_ENVELOPE']);
    const t = setInterval(async () => {
      try {
        const r = await window.printshopApi.changes();
        if (!active) return;
        setServerLink(!r || DOWN.has(r.code) ? 'down' : 'up');
        if (!r?.ok || !Array.isArray(r.changed) || r.changed.length === 0) return;
        setLiveNotice(prev => Array.from(new Set([...(prev || []), ...r.changed])));
      } catch (e) { if (active) setServerLink('down'); /* سرورِ در دسترس نبودن، نشانهٔ تغییر نیست */ }
    }, 2500);
    return () => { active = false; clearInterval(t); };
  }, [user && user.id, user && user.mustChange]);
  // سفارش‌ها هر چند ثانیه تازه می‌شوند تا «درخواست جدید مشتری» بدون بستن برنامه برسد
  /* بازتابِ پرداخت را سرور با هر رسید تازه می‌نویسد؛ پس همان سفارش‌ها از بانک خوانده می‌شوند
     تا هیچ ایستگاهی عددِ پولِ قدیمی نشان ندهد — چه از چرخهٔ چندثانیه‌ای، چه بی‌درنگ پس از ثبتِ رسید. */
  async function refreshOrders() {
    try {
      const r = await window.storage.get('printshop_orders_v5', true);
      const fresh = migrateOrders(JSON.parse(r.value));
      setOrders(prev => (JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh));
      setDetailOrder(prev => prev ? fresh.find(o => o.id === prev.id) || null : null);
    } catch (e) { /* بانک در دسترس نبود؛ چرخهٔ تازه‌سازی دوباره می‌خواند */ }
  }
  useEffect(() => {
    if (!user || user.mustChange || user.role === 'مشتری') return undefined;
    let active = true;
    refreshNotifications().catch(() => {});
    const t = setInterval(async () => {
      try {
        await refreshNotifications();
        if (!permsFor(user.role).tabs.some(tab => ['orders', 'production', 'forms', 'finance'].includes(tab))) return;
        if (!active) return;
        await refreshOrders();
      } catch (e) { /* ignore */ }
    }, 5000);
    return () => { active = false; clearInterval(t); };
  }, [user && user.id, user && user.mustChange]);
  async function logout() {
    if (isSecure()) { try { await window.printshopApi.auth.logout(); } catch (e) { /* ignore */ } window.location.reload(); return; }
    setUser(null); setDetailOrder(null); setOrderModal(null); setPrintOrder(null);
  }
  async function previewOrderReset() {
    if (role !== 'مدیر چاپخانه') return { ok: false, error: 'پاکسازی فقط در اختیار مدیر چاپخانه است.' };
    return window.printshopApi?.previewOrderReset() || { ok: false, error: 'پاکسازی فقط در نسخه امن دسکتاپ در دسترس است.' };
  }
  async function resetTestOrders(payload) {
    if (role !== 'مدیر چاپخانه') return { ok: false, error: 'پاکسازی فقط در اختیار مدیر چاپخانه است.' };
    const result = await window.printshopApi?.resetOrders(payload);
    if (result?.ok) {
      alert(`سفارش‌های آزمایشی پاک شدند. اطلاعات مشتریان و انبار حفظ شد.\nپشتیبان پیش از پاکسازی:\n${result.backupFile}\n\nبرای دریافت داده‌های تازه، دوباره وارد برنامه شوید.`);
      await logout();
    }
    return result || { ok: false, error: 'پاکسازی انجام نشد.' };
  }
  async function doLogin(username, password) {
    if (isSecure()) {
      const r = await window.printshopApi.auth.login(username, password);
      if (r && r.ok) { setUser(r.user); return { ok: true }; }
      return { ok: false, error: (r && r.error) || 'ورود ممکن نشد.' };
    }
    const u = allUsers.find(x => normUser(x.username) === normUser(username) && x.passHash === hashPass(password));
    if (!u) return { ok: false, error: 'نام کاربری یا رمز عبور اشتباه است.' };
    if (u.active === false) return { ok: false, error: 'این کاربر غیرفعال شده است؛ با مدیر چاپخانه تماس بگیرید.' };
    setUser(u); if (!loginSeen) persist('printshop_login_seen_v1', setLoginSeen, true);
    return { ok: true };
  }
  const localAdminDefault = allUsers.some(u => u.id === 'u_admin' && u.passHash === hashPass('1234'));
  const mustChangePw = !!user && (isSecure() ? !!user.mustChange : (user.id === 'u_admin' && user.passHash === hashPass('1234')));
  async function changeOwnPassword(pw) {
    if (isSecure()) { const r = await window.printshopApi.auth.setOwnPassword(pw); if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'ذخیره‌ی رمز ممکن نشد.' }; setUser(u => ({ ...u, mustChange: false })); setSecureInfo(i => ({ ...i, defaultAdmin: false })); return { ok: true }; }
    const nu = { ...user, passHash: hashPass(pw) }; persistUsers(allUsers.map(x => x.id === user.id ? nu : x)); setUser(nu); return { ok: true };
  }

  if (window.printshopApi && !window.printshopApi.secure) {
    /* ایستگاه شبکه با کامپیوتر سرور فاصله دارد؛ پیامش باید همان سرور را نام ببرد،
       نه SQLite این ماشین — وگرنه اپراتور دنبال خرابی می‌گردد جایی که بانک سالم است. */
    const station = window.printshopApi.serverName || '';
    return <div dir="rtl" style={{ minHeight: '100vh', background: COLORS.cream, display: 'grid', placeItems: 'center', padding: 24 }}><div role="alert" style={{ maxWidth: 560, background: '#fff', border: `1px solid ${COLORS.danger}`, padding: 24, borderRadius: 12, lineHeight: 2 }}><strong style={{ color: COLORS.danger }}>{station ? 'سرور چاپخانه در دسترس نیست' : 'پایگاه داده در دسترس نیست'}</strong><p>{station ? `برای حفاظت از اطلاعات، ورود و تغییر داده در این ایستگاه متوقف شده است. فایل‌های قبلی حفظ می‌شوند؛ کامپیوتر سرور را روشن و برنامهٔ سرور را اجرا کنید، سپس این برنامه را دوباره باز کنید.` : 'برای حفاظت از اطلاعات، ورود و تغییر داده متوقف شده است. فایل‌های قبلی حفظ می‌شوند؛ پس از رفع مشکل SQLite برنامه را دوباره اجرا کنید.'}</p>{station ? <div dir="ltr" style={{ fontSize: 13, opacity: .75 }}>{station}</div> : null}<details><summary>جزئیات خطا</summary><div dir="ltr" style={{ overflowWrap: 'anywhere', fontSize: 12 }}>{window.printshopApi.startupError}</div></details></div></div>;
  }
  if (!user && (isSecure() || loaded)) return <LoginScreen company={settings.company} firstHint={isSecure() ? !!secureInfo.defaultAdmin : (!loginSeen && localAdminDefault)} onSubmit={doLogin} />;
  if (user && mustChangePw) return <ForcePassword user={user} onSave={changeOwnPassword} />;
  if (!loaded) return <div dir="rtl" style={{ fontFamily: "'Vazirmatn', Tahoma, Arial, sans-serif", background: COLORS.cream, minHeight: '100vh', padding: 30, color: COLORS.sub, fontSize: 13 }}>در حال بارگذاری...</div>;

  function renderWorkbenchPage(curTab) { return <>
          {!loaded && <div style={{ color: COLORS.sub, fontSize: 13 }}>در حال بارگذاری...</div>}

          {perms.newOrder && orders.filter(o => o.status === REQUEST_STATUS).length > 0 && curTab !== 'request' && (
            <button onClick={openRequests} style={{ width: '100%', textAlign: 'right', background: COLORS.dangerBg, color: COLORS.danger, border: `2px solid ${COLORS.danger}`, borderRadius: 12, padding: '10px 14px', marginBottom: 12, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', animation: 'psPulse 1.6s infinite' }}>
              🔔 {fmt(orders.filter(o => o.status === REQUEST_STATUS).length)} درخواست سفارش جدید از مشتریان منتظر ثبت است — برای دیدن و ادامه‌ی کار اینجا را بزنید
            </button>
          )}
          {loaded && curTab === 'request' && user && <CustomerRequestForm key={user.id} customer={customers.find(c => c.id === user.customerId)} onSubmit={submitRequest} onRefresh={refreshCustomerProfile} />}
          {loaded && curTab === 'myfinance' && user && <CustomerFinancePanel key={user.id} customer={customers.find(c => c.id === user.customerId)} finance={myFinance} onRefresh={refreshCustomerProfile} />}

          {loaded && curTab === 'dashboard' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <KpiCard label="سفارش‌های باز" value={fmt(activeOrders.length)} accent={COLORS.primary} />
                <KpiCard label="سفارش‌های امروز" value={fmt(todayOrders.length)} accent={COLORS.primary} />
                <KpiCard label="اقلام کم‌موجود" value={fmt(lowStock.length)} accent={lowStock.length ? COLORS.danger : COLORS.success} />
                <KpiCard label="قلم‌های در حال تولید" value={fmt(inProduction)} accent={COLORS.primary} />
                <KpiCard label="پیش‌فاکتور منتظر تایید" value={fmt(pendingOrders.length)} accent={pendingOrders.length ? COLORS.warn : COLORS.success} />
              </div>
              {(followUps.length > 0 || expiredQuotes.length > 0) && (
                <div style={{ background: COLORS.warnBg, border: `1px solid ${COLORS.warn}`, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: COLORS.warn, fontWeight: 700, fontSize: 13 }}><AlertTriangle size={16} /> نیاز به پیگیری با مشتری</div>
                  {followUps.length > 0 && <div><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>سفارش‌های بایگانی‌شده که موعد پیگیری‌شان رسیده</div><ArchiveTable orders={followUps} onOpen={openDetail} onReopen={reopenOrder} /></div>}
                  {expiredQuotes.length > 0 && <div><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>پیش‌فاکتورهای منقضی‌شده‌ی بدون پاسخ (تایید یا بایگانی کنید)</div><OrdersTable orders={expiredQuotes} onOpen={openDetail} /></div>}
                </div>
              )}
              {urgentOrders.length > 0 && (
                <div style={{ background: COLORS.warnBg, border: `1px solid ${COLORS.warn}`, borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: COLORS.warn, fontWeight: 700, fontSize: 13, marginBottom: 8 }}><AlertTriangle size={16} /> سفارش‌های فوری یا عقب‌افتاده</div>
                  <OrdersTable orders={urgentOrders} onOpen={openDetail} />
                </div>
              )}
              {lowStock.length > 0 && (
                <div style={{ background: COLORS.dangerBg, border: `1px solid ${COLORS.danger}`, borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: COLORS.danger, fontWeight: 700, fontSize: 13, marginBottom: 6 }}><AlertTriangle size={16} /> اقلام رو به اتمام</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{lowStock.map(i => <Badge key={i.id} text={`${i.name} — ${fmt(stockLevel(i))} ${stockUnitLabel(i)}`} bg="#fff" fg={COLORS.danger} />)}</div>
                </div>
              )}
              <div><SectionTitle>آخرین سفارش‌ها</SectionTitle><OrdersTable orders={orders.slice(0, 6)} onOpen={openDetail} /></div>
            </div>
          )}

          {loaded && curTab === 'orders' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.primaryDark }}>{role === 'مشتری' ? 'سفارش‌های من' : 'سفارش‌ها'}</div>
                {perms.newOrder && <PrimaryButton icon={Plus} onClick={openNewOrder}>{role === 'مشتری' ? 'ثبت سفارش جدید' : 'سفارش جدید'}</PrimaryButton>}
              </div>
              {role === 'مشتری' && <Field label="برای مشاهده سفارش‌های خود، شماره تماس را وارد کنید"><TextInput value={phoneLookup} onChange={e => setPhoneLookup(e.target.value)} placeholder="0912..." /></Field>}
              {role !== 'مشتری' && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: '6px 10px', flex: 1, minWidth: 200 }}>
                    <Search size={14} color={COLORS.sub} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جست‌وجوی نام، شماره سفارش، محصول..." style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, background: 'transparent' }} />
                  </div>
                  <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: 170 }}>
                    <option value="all">همه وضعیت‌ها</option>
                    {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              <OrdersTable orders={visibleOrders} onOpen={openDetail} />
              {role === 'مشتری' && phoneLookup.length <= 3 && <div style={{ color: COLORS.sub, fontSize: 13, textAlign: 'center', padding: 20 }}>شماره تماس خود را وارد کنید تا سفارش‌هایتان نمایش داده شود.</div>}
            </div>
          )}

          {loaded && curTab === 'archive' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6 }}><Archive size={18} /> بایگانی (سفارش‌های تایید‌نشده)</div>
              <div style={{ fontSize: 12, color: COLORS.sub }}>سفارش‌هایی که مشتری تایید نکرده اینجا می‌مانند. با «بازگشایی» می‌توانید هر زمان پیش‌فاکتور جدید (با تغییرات دلخواه) صادر کنید.</div>
              <ArchiveTable orders={orders.filter(o => o.status === 'بایگانی').sort((a, b) => ((b.archive && b.archive.date) || '').localeCompare((a.archive && a.archive.date) || ''))} onOpen={openDetail} onReopen={reopenOrder} />
            </div>
          )}

          {loaded && curTab === 'forms' && <FormsList orders={orders} onOpen={openDetail} />}

          {loaded && curTab === 'production' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6 }}><Layers size={18} /> تابلوی تولید</div>
              <ProductionBoard orders={orders} settings={settings} role={role} onOpenOrder={openBoardDetail} onMoveStage={changeItemStage} onCompleteStage={completeItemStage} onRecordCounts={isSecure() ? workflowAction : undefined} />
            </div>
          )}

          {loaded && curTab === 'inventory' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6 }}><Boxes size={18} /> انبار</div>
                <div style={{ display: 'flex', gap: 8 }}>{canImport('inventory') && <GhostButton icon={Sheet} onClick={() => openExcel('inventory')}>ورود از اکسل</GhostButton>}<GhostButton icon={FileText} onClick={() => exportInventory()}>خروجی اکسل (همه)</GhostButton><PrimaryButton icon={Plus} onClick={() => setInvModal(emptyInventoryItem())}>کالای جدید</PrimaryButton></div>
              </div>
              <div style={{ background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.primaryDark, marginBottom: 6 }}>وضعیت دسته‌های انبار — کسری مواد مانع ثبت درخواست و پیش‌فاکتور نیست</div>
                <InventoryChecklist inventory={inventory} />
              </div>
              {deskLinks('inventory')}

            </div>
          )}

          {loaded && curTab === 'letters' && user && <LettersPanel letters={letters} user={user} isManager={!!perms.users} settings={settings} onNew={() => setLetterModal(newLetterDraft())} onUpdate={(l) => persistLetters(letters.map(x => x.id === l.id ? l : x))} onDelete={(id) => persistLetters(letters.filter(x => x.id !== id))} />}

          {loaded && curTab === 'about' && <AboutDesk />}
          {loaded && curTab === 'settings' && deskLinks('settings')}
          {loaded && curTab === 'settings-company' && <SettingsPanel settings={settings} onSave={persistSettings} managerPin={managerPin} onChangePin={persistManagerPin} />}
          {loaded && curTab === 'settings-users' && <UsersManager users={allUsers} currentUser={user} customers={customers} onSave={persistUsers} />}
          {loaded && curTab === 'settings-ai' && <AiSettingsCard ai={aiCfg} onSave={persistAi} />}
          {loaded && curTab === 'settings-numbering' && <NumberingSettings onLoad={loadNumberingSettings} onSave={saveNumberingSettings} />}
          {loaded && curTab === 'settings-lexicon' && (
            <LexiconDesk canEdit={role === 'مدیر چاپخانه'}
              productTypes={productTypes} onProductTypes={persistProductTypes} bookLikeTypes={bookLikeTypes} onBookLikeTypes={persistBookLikeTypes}
              bindingTypes={bindingTypes} onBindingTypes={persistBindingTypes} serviceTypes={serviceTypes} onServiceTypes={persistServiceTypes}
              paperKinds={paperKinds} onPaperKinds={persistPaperKinds} trimSizes={trimSizes} onTrimSizes={persistTrimSizes} engineCuts={engineCuts} onEngineCuts={persistEngineCuts} enginePresses={enginePresses} onEnginePresses={persistEnginePresses}
              printColors={printColors} onPrintColors={persistPrintColors} qtyUnits={qtyUnits} onQtyUnits={persistQtyUnits}
              invCategories={invCategories} onInvCategories={persistInvCategories} requiredInvCategories={REQUIRED_INV_CATEGORIES}
              ledger={ledger} ledgerNote={ledgerNote} />
          )}
          {loaded && curTab === 'excel' && <CatalogTransfer key={excelDataset} role={role} initialDataset={excelDataset} data={{ customers, inventory, suppliers }} onImport={importCatalog} />}

          {loaded && role === 'مدیر چاپخانه' && curTab === 'settings-maintenance' && <OrderResetPanel onPreview={previewOrderReset} onReset={resetTestOrders} />}


          {loaded && curTab === 'customers' && <CustomersPanel customers={customers} settings={settings} onNew={() => setCustModal(emptyCustomer())} onEdit={setCustModal} onDelete={deleteCustomer} onLedger={setLedgerCustomer} onImport={canImport('customers') ? () => openExcel('customers') : undefined} canReview={role === 'مدیر چاپخانه'} onReview={c => setPartyReview({ kind: 'customer', id: c.id })} onToggleActive={c => togglePartyActive('customer', c)} />}

          {loaded && curTab === 'units' && <UnitsPanel units={unitsData} onSave={persistUnits} />}

          {loaded && curTab === 'suppliers' && <SuppliersPanel suppliers={suppliers} inventory={inventory} receipts={receipts} settings={settings} canPay={!!perms.manageOrder} onNew={() => setSuppModal(emptySupplier())} onEdit={setSuppModal} onDelete={deleteSupplier} onLedger={setLedgerSupplier} onUpdateReceipt={updateReceipt} onDeleteReceipt={deleteReceipt} onImport={canImport('suppliers') ? () => openExcel('suppliers') : undefined} canReview={role === 'مدیر چاپخانه'} onReview={s => setPartyReview({ kind: 'supplier', id: s.id })} onToggleActive={s => togglePartyActive('supplier', s)} />}

          {loaded && curTab === 'finance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: 6 }}><Wallet size={18} /> مالی</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <KpiCard label="جمع بدهی قطعی (ریال)" value={fmt(totalReceivable)} accent={COLORS.danger} />
                <KpiCard label="تعهد خالص همهٔ پرونده‌ها (ریال)" value={fmt(creditDesk.kpis ? creditDesk.kpis.totalNet : 0)} accent={COLORS.warn} />
                <KpiCard label="مشتری‌های دارای ماندهٔ باز" value={fmt(creditDesk.kpis ? creditDesk.kpis.openDebt : 0)} accent={COLORS.danger} />
                <KpiCard label="جمع فروش کل (ریال)" value={fmt(orders.reduce((s, o) => s + orderGrandTotal(o), 0))} accent={COLORS.primary} />
              </div>
              {deskLinks('finance')}
            </div>
          )}
          {loaded && curTab === 'finance-pricing' && <div className="workbench-stack">              <SectionTitle>جست‌وجوی سفارش برای قیمت‌گذاری / فاکتور</SectionTitle>
              <div style={{ display: 'flex', gap: 8 }}><TextInput list="finance-order-numbers" value={financeOrderNumber} onChange={e => setFinanceOrderNumber(e.target.value)} placeholder="شماره سفارش را وارد کنید..." style={{ maxWidth: 240 }} /><datalist id="finance-order-numbers">{orders.filter(o => o.orderNumber).map(o => <option key={o.id} value={o.orderNumber}>{o.customerName}</option>)}</datalist></div>
              {financeOrderNumber.trim() && !financeOrder && <div style={{ color: COLORS.sub, fontSize: 13 }}>سفارشی با این شماره یافت نشد.</div>}
              {financeOrder && <FinancialOrderView key={financeOrder.id} recentOrders={orders} onOpenDocuments={() => setTab('finance-quote')} onPreviewQuote={input => window.printshopApi?.previewQuote(financeOrder.id, input) || Promise.resolve({ ok: false, error: 'محاسبهٔ امن در نسخهٔ دسکتاپ فعال است.' })} onSaveQuote={(input, expectedRevision) => workflowAction(financeOrder.id, 'save_quote', { input, expectedRevision })} order={financeOrder} customer={customers.find(c => c.id === financeOrder.customerId)} settings={settings} inventory={inventory} canApprove={!!perms.approveProduction} onMoneyChanged={refreshOrders} onApprove={() => approveOrder(financeOrder)} onArchive={() => setArchiveOrder(financeOrder)} onNewRevision={() => newQuoteRevision(financeOrder)} onPrintForm={() => { setPrintCopy(2); setPrintOrder(financeOrder); }} />}
</div>}
          {loaded && curTab === 'finance-credit' && <CreditFilesPanel data={creditDesk} role={role} fmt={fmt} faDate={faDate} onOpenOrder={(id) => { const o = orders.find(x => x.id === id); if (o) openDetail(o); }} />}
          {loaded && curTab === 'finance-marketers' && (<div><SectionTitle>گزارش بازاریاب‌ها (پورسانت)</SectionTitle><MarketerReport customers={customers} orders={orders} payments={mkPays} settings={settings} onAddPayment={(p) => persistMkPays([...mkPays, p])} onDeletePayment={(id) => persistMkPays(mkPays.filter(x => x.id !== id))} /></div>)}
          {loaded && ['finance-quote', 'finance-invoice', 'finance-statement'].includes(curTab) && <FinancialDocuments documentType={curTab.slice(8)} documents={documents} orders={orders} onIssue={issueDocument} onVoid={voidDocument} onRefresh={refreshDocuments} onPrint={setPrintDocument} onProposal={isSecure() ? (orderId) => window.printshopApi?.invoiceProposal(orderId) : undefined} onIssuePartial={isSecure() ? (orderId) => issueDocument(orderId, 'partial_invoice') : undefined} />}
          {loaded && curTab === 'inventory-entry' && (<InventorySmartEntry drafts={invDrafts} setDrafts={setInvDrafts} customers={customers} suppliers={suppliers} categories={invCategories} ai={aiCfg} onRegister={upsertManyInv} onEdit={(d) => setInvModal(d.item)} />)}
          {loaded && curTab === 'inventory-stock' && (<InventoryTable inventory={inventory} customers={customers} suppliers={suppliers} settings={settings} onEdit={setInvModal} onDelete={deleteInv} onExport={exportInventory} onImport={canImport('inventory') ? () => openExcel('inventory') : undefined} canReceive={isSecure() && ['مدیر چاپخانه', 'انباردار'].includes(role)} onReceive={setReceiptDraft} />)}
          {loaded && curTab === 'inventory-movements' && <InventoryMovements inventory={inventory} settings={settings} DateInput={JalaliDateInput} faDate={faDate} fmt={fmt} />}
          {loaded && curTab === 'report-unfinished' && <UnfinishedWorkReport customers={customers} DateInput={JalaliDateInput} faDate={faDate} fmt={fmt} onOpenOrder={(id) => { const o = orders.find(x => x.id === id); if (o) openDetail(o); }} />}
          {loaded && curTab === 'report-delivery' && <DeliveryReport customers={customers} DateInput={JalaliDateInput} faDate={faDate} fmt={fmt} onOpenOrder={(id) => { const o = orders.find(x => x.id === id); if (o) openDetail(o); }} />}
          {loaded && curTab === 'report-finance' && <FinanceReport customers={customers} DateInput={JalaliDateInput} faDate={faDate} fmt={fmt} onOpenOrder={(id) => { const o = orders.find(x => x.id === id); if (o) openDetail(o); }} />}
          {loaded && curTab === 'inventory-receipts' && <ReceiptTable receipts={receipts} suppliers={suppliers} inventory={inventory} showSupplier canPay={!!perms.manageOrder} onStatus={(r, st) => updateReceipt({ ...r, payStatus: st, payDate: st === 'paid' ? (r.payDate || todayIso()) : r.payDate })} />}

  </>; }

  return (
    <div className="printshop-desktop" dir="rtl" style={{ fontFamily: "'Vazirmatn', Tahoma, Arial, sans-serif", background: COLORS.cream, height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      <div style={{ background: COLORS.primary, color: '#fff', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {<img src={settings.company.logo || logoUrl} alt="" style={{ height: 38, maxWidth: 80, objectFit: 'contain', background: '#fff', borderRadius: 8, padding: 2 }} />}
          <div><div style={{ fontWeight: 800, fontSize: 16 }}>{settings.company.name}</div><div style={{ fontSize: 11, color: COLORS.accentLight }}>سامانه مدیریت سفارش، انبار و مالی</div></div>
        </div>
        {isSecure() && user.role !== 'مشتری' && <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.12)', borderRadius: 9, padding: '5px 10px' }}>
          <WorkflowNotifications notifications={notifications} onRead={readNotification} letterAlerts={managerView ? pendingLetters : []} onOpenLetters={() => { setLetterAlert(false); setTab('letters'); }} /><button type="button" className="workflow-button workflow-danger" onClick={() => setEmergencyStop(true)}>توقف / لغو به درخواست مشتری</button>
        </div>}
      </div>

      {isSecure() && managerView && pendingLetters.length > 0 && <button type="button" className="notice-flash-banner" onClick={() => { setLetterAlert(false); setTab('letters'); }}><Mails size={16} aria-hidden="true" /><span>{pendingLetters.length.toLocaleString('fa-IR')} نامه از واحدها منتظر نظر شماست — برای موافقت یا مخالفت</span></button>}

      {staleNotice && <div className="stale-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" /><span>{`«${STALE_LABELS[staleNotice.key] || 'این فهرست'}» پس از خواندنِ شما در ایستگاه دیگری تغییر کرد. فهرست تازه شد و نوشتهٔ این ایستگاه ذخیره نشد؛ مقادیر تازه را ببینید و دوباره ثبت کنید.`}</span><button type="button" onClick={() => setStaleNotice(null)}>متوجه شدم</button></div>}

      {liveNotice && liveNotice.length > 0 && <div className="live-banner" role="status"><RefreshCw size={16} aria-hidden="true" /><span>{`${liveNotice.map(key => `«${LIVE_LABELS[key] || 'این فهرست'}»`).join('، ')} در ایستگاه دیگری تغییر ${liveNotice.length > 1 ? 'کرده‌اند' : 'کرده است'}. تا تازه‌سازی نکنید، نوشته‌های بازِ این ایستگاه دست‌نخورده می‌ماند.`}</span><button type="button" className="live-banner-action" onClick={() => { setLiveNotice(null); setReloadTick(n => n + 1); }}>تازه‌سازی</button><button type="button" onClick={() => setLiveNotice(null)}>بعداً</button></div>}

      <WorkbenchShell items={navItems} activeId={curTab} openIds={workbench.openIds} onOpen={setTab} onClose={closeDesk} onLogout={() => requestGuardedAction(logout)} userLabel={user.name} userRole={user.role} station={user.station || ''} link={serverLink} server={window.printshopApi?.serverName || ''} serving={window.printshopApi?.servingUrl || ''} avatarUrl={userAvatar} onAvatarChange={changeAvatar}>
        {visitedDesks.filter(id => allowedDesks.includes(id)).map(id => <section key={id} hidden={curTab !== id} className="workbench-page">{renderWorkbenchPage(id)}</section>)}
      </WorkbenchShell>
      <AppStatusBar />

      {printOrder && (<PrintSlip lockCopy={!perms.anyCopy} units={unitsData} order={printOrder} settings={settings} customer={customers.find(c => c.id === printOrder.customerId)} inventory={inventory} initialCopy={printCopy} onClose={() => setPrintOrder(null)} />)}
      {printDocument && <InvoicePrint document={printDocument} settings={settings} onClose={() => setPrintDocument(null)} />}

      {orderModal && (
        <Modal title={orders.some(o => o.id === orderModal.id) ? 'ویرایش سفارش' : 'سفارش جدید'} onClose={() => setOrderModal(null)} wide dirty={orderDirty}>
          <OrderForm initial={orderModal} onDirtyChange={setOrderDirty} units={unitsData} perms={perms} settings={{ ...settings, ai: aiCfg }} customers={customers} inventory={inventory} qtyUnits={qtyUnits} serviceTypes={serviceTypes} productTypes={productTypes}
            onAddQtyUnit={addQtyUnit} onAddServiceType={addServiceType} onAddProductType={addProductType}
            onRemoveQtyUnit={removeQtyUnit} onRemoveServiceType={removeServiceType} onRemoveProductType={removeProductType} role={role}
            orders={orders} onSave={upsertOrder} onCancel={() => setOrderModal(null)} onAddCustomer={addCustomerInline} onAddStock={perms.addStock ? (cat) => setInvModal({ ...emptyInventoryItem(), category: cat || 'کاغذ' }) : undefined} />
        </Modal>
      )}
      {invModal && (
        <Modal title={inventory.some(i => i.id === invModal.id) ? 'ویرایش کالا' : 'کالای جدید'} onClose={() => setInvModal(null)} wide>
          <InventoryForm initial={invModal} isNew={!inventory.some(i => i.id === invModal.id)} customers={customers} suppliers={suppliers} categories={invCategories} onAddCategory={addInvCategory} onRemoveCategory={removeInvCategory} onAddCustomer={addCustomerInline} onAddSupplier={addSupplierInline} onSave={upsertInv} onCancel={() => setInvModal(null)} />
        </Modal>
      )}
      {receiptDraft && inventory.some(i => i.id === receiptDraft.id) && (
        <Modal title="رسید تحویل کالا از مشتری" onClose={() => setReceiptDraft(null)} wide>
          <ConsignmentReceiptModal item={inventory.find(i => i.id === receiptDraft.id)} receipts={consignmentReceipts} customers={customers} settings={settings}
            actor={user && user.name} onClose={() => setReceiptDraft(null)} onSaved={async () => {
              try {
                const [inv, rec] = await Promise.all([window.storage.get('printshop_inventory_v3', true), window.storage.get('printshop_consignments_v1', true)]);
                setInventory(JSON.parse(inv.value)); setConsignmentReceipts(JSON.parse(rec.value));
              } catch (_) { /* نقشی که دسترسی ندارد فهرست را تازه نمی‌کند؛ سرور خودش رد کرده است */ }
            }} />
        </Modal>
      )}
      {custModal && (
        <Modal title={customers.some(c => c.id === custModal.id) ? 'ویرایش مشتری' : 'مشتری جدید'} onClose={() => setCustModal(null)} wide>
          <CustomerForm initial={custModal} marketers={workList(customers.filter(c => c.isMarketer))} onSave={upsertCustomer} onCancel={() => setCustModal(null)} />
        </Modal>
      )}
      {suppModal && (
        <Modal title={suppliers.some(s => s.id === suppModal.id) ? 'ویرایش تامین‌کننده' : 'تامین‌کننده جدید'} onClose={() => setSuppModal(null)} wide>
          <SupplierForm initial={suppModal} onSave={upsertSupplier} onCancel={() => setSuppModal(null)} />
        </Modal>
      )}
      {partyReview && (
        <Modal title={`بررسی ${partyReview.kind === 'supplier' ? 'تامین‌کننده' : 'مشتری'} — ${(partyReview.kind === 'supplier' ? suppliers : customers).find(p => p.id === partyReview.id)?.name || ''}`} onClose={() => setPartyReview(null)} trackChanges={false}>
          <CustomerEligibility key={`${partyReview.kind}:${partyReview.id}`} compact focusId={partyReview.id} kind={partyReview.kind} defaultKind={partyReview.kind} customers={customers} suppliers={suppliers} onAction={partyAction} onRefresh={refreshPartyBank} />
        </Modal>
      )}
      {detailOrder && (
        <Modal title={`سفارش ${detailOrder.orderNumber || 'معلق'} — ${detailOrder.customerName}`} onClose={() => setDetailOrder(null)} wide>
          {isSecure() && !detailViewOnly && detailOrder.status !== 'تحویل شده' && <OrderWorkflowPanel key={detailOrder.id} order={detailOrder} role={role} onAction={workflowAction} DateInput={JalaliDateInput} faDate={faDate} fmtMoney={fmt} />}
          <OrderDetail order={detailOrder} role={role} perms={perms} units={unitsData} readOnly={detailViewOnly} onCompleteStage={completeItemStage} onRecordCounts={isSecure() ? workflowAction : undefined} onConvertRequest={() => convertRequest(detailOrder)} onReleaseHold={() => saveOrderUpdate(logEvent({ ...detailOrder, onHold: false, holdReason: '' }, 'رفع تعلیق — مواد تامین شد'))} onEdit={() => { setOrderModal(detailOrder); setDetailOrder(null); }} onDelete={() => deleteOrder(detailOrder.id)}
            onChangeStage={(itemId, stage) => { const it = detailOrder.items.find(i => i.id === itemId); changeItemStage(detailOrder, it, stage); }}
            onPrint={() => { setPrintCopy(1); setPrintOrder(detailOrder); }} onApprove={() => approveOrder(detailOrder)} onArchive={() => setArchiveOrder(detailOrder)} onReopen={() => reopenOrder(detailOrder)} onChangeStatus={(st) => changeOrderStatus(detailOrder, st)} />
        </Modal>
      )}
      {archiveOrder && (
        <Modal title="بایگانی سفارش" onClose={() => setArchiveOrder(null)}>
          <ArchiveDialog order={archiveOrder} onSave={(info) => archiveOrderSave(archiveOrder, info)} onCancel={() => setArchiveOrder(null)} />
        </Modal>
      )}
      {emergencyStop && <Modal title="توقف فوری به درخواست مشتری" onClose={() => setEmergencyStop(false)}><EmergencyStopForm onAction={workflowAction} onClose={() => setEmergencyStop(false)} /></Modal>}
      {gateModal && (
        <Modal title="ابتدا انبار را تکمیل کنید" onClose={() => setGateModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, lineHeight: 2 }}>برای ثبت سفارش، موجودی مواد اولیه باید در انبار ثبت شده باشد (کاغذ، مقوا، مرکب، زینک، سلفون، فویل طلا). وضعیت فعلی:</div>
            <InventoryChecklist inventory={inventory} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <GhostButton onClick={() => setGateModal(false)}>بستن</GhostButton>
              {perms.tabs.includes('inventory') ? <PrimaryButton icon={Boxes} onClick={() => { setGateModal(false); setTab('inventory'); }}>رفتن به انبار</PrimaryButton> : <span style={{ fontSize: 12, color: COLORS.sub }}>از انباردار یا مدیر بخواهید موجودی را ثبت کند.</span>}
            </div>
          </div>
        </Modal>
      )}
      {ledgerCustomer && <CustomerLedgerModal customer={ledgerCustomer} settings={settings} inventory={inventory} consignments={consignmentReceipts} onClose={() => setLedgerCustomer(null)} />}
      {letterModal && <Modal title="نامه‌ی جدید به مدیر چاپخانه" onClose={() => setLetterModal(null)} wide><LetterForm initial={letterModal} settings={settings} onCancel={() => setLetterModal(null)} onSave={async (l) => { if (await persistLetters([{ ...l, number: '' }, ...letters])) setLetterModal(null); }} /></Modal>}
      {letterAlert && managerView && pendingLetters.length > 0 && <Modal title="نامه‌های منتظر نظر شما" onClose={() => setLetterAlert(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: LETTER_STATUS.sent.bg, color: LETTER_STATUS.sent.fg, borderRadius: 8, padding: '9px 12px', fontSize: 13, fontWeight: 700 }}>{fmt(pendingLetters.length)} نامه از واحدهای چاپخانه منتظر موافقت یا مخالفت شماست.</div>
          <ul style={{ margin: 0, paddingRight: 18, fontSize: 13, lineHeight: 2 }}>{pendingLetters.slice(0, 5).map(l => <li key={l.id}>{l.fromUnit || '—'} — {l.subject} — <span dir="ltr">{faDate(l.date)}</span></li>)}</ul>
          {pendingLetters.length > 5 && <div style={{ fontSize: 11, color: COLORS.sub }}>و {fmt(pendingLetters.length - 5)} نامهٔ دیگر در فهرست نامه‌ها.</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <GhostButton onClick={() => setLetterAlert(false)}>بعداً</GhostButton>
            <PrimaryButton icon={Mails} onClick={() => { setLetterAlert(false); setTab('letters'); }}>رفتن به نامه‌ها</PrimaryButton>
          </div>
        </div>
      </Modal>}
      {ledgerSupplier && <SupplierLedgerModal supplier={ledgerSupplier} suppliers={suppliers} inventory={inventory} receipts={receipts} settings={settings} canPay={!!perms.manageOrder} onAddReceipt={addReceipt} onUpdateReceipt={updateReceipt} onDeleteReceipt={deleteReceipt} onClose={() => setLedgerSupplier(null)} />}
    </div>
  );
}
