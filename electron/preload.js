const { contextBridge, ipcRenderer } = require('electron');

const st = ipcRenderer.sendSync('be:status') || { secure: false, error: '' };
let token = null; // توکن نشست فقط اینجا نگه داشته می‌شود و هیچ‌وقت در اختیار کد صفحه قرار نمی‌گیرد
const call = (ch, ...a) => ipcRenderer.invoke(ch, token, ...a);

const common = {
  dataPath: () => ipcRenderer.invoke('db:path'),
  saveFile: (name, b64) => call('file:save', name, b64),
  savePdf: (paper, name, orientation = 'portrait') => call('pdf:save', paper, name, orientation),
  refocus: () => ipcRenderer.send('win:refocus'),
  onCloseRequest: (listener) => {
    const wrapped = (_event, id) => { ipcRenderer.send('win:close-ack', id); listener(id); };
    ipcRenderer.on('win:close-request', wrapped);
    return () => ipcRenderer.removeListener('win:close-request', wrapped);
  },
  respondClose: (id, confirmed) => ipcRenderer.invoke('win:close-response', id, confirmed),
};

contextBridge.exposeInMainWorld('printshopApi', {
    ...common,
    secure: !!st.secure, mode: st.secure ? 'secure' : 'blocked', startupError: st.error || '',
    /* بند ت: «این کامپیوتر خودش بانک دارد» از «ایستگاهِ وصل‌شده به سرور» جدا می‌شود.
       mode فقط امن/مسدود را می‌گوید و برای نشانگر سرور کافی نیست. */
    transport: st.mode === 'network' ? 'network' : 'local',
    serverName: st.mode === 'network' ? st.server || '' : '',
    /* بند ث: همین ماشین خودش سرور است؟ نشانی‌ای که ایستگاه‌ها باید در client.json بگذارند. */
    serving: !!st.serving,
    servingUrl: st.serving ? st.serving.url || '' : '',
    servingAddresses: st.serving ? st.serving.addresses || [] : [],
    servingLoopback: st.serving ? !!st.serving.loopback : false,
    get: (key) => call('be:get', key),
    set: (key, value, expected) => call('be:set', key, value, expected),
    del: (key) => call('be:del', key),
    /* بند پ: نشانهٔ زندهٔ تغییر. هیچ آرگومانی ندارد؛ پایۀ مقایسه روی سرور و در همان نشست نگه داشته می‌شود. */
    changes: () => call('be:changes'),
    orderAction: (id, action, payload) => call('be:orderAction', id, action, payload),
    consignReceipt: (payload) => call('be:consignReceipt', payload),
    previewQuote: (id, input) => call('be:previewQuote', id, input),
    customerAction: (id, action, payload) => call('be:customerAction', id, action, payload),
    partyAction: (kind, id, action, payload) => call('be:partyAction', kind, id, action, payload),
    catalogImport: (dataset, rows, options) => call('be:catalogImport', dataset, rows, options),
    numberingSettings: () => call('be:numberingSettings'),
    saveNumberingSettings: (settings) => call('be:saveNumberingSettings', settings),
    previewOrderReset: () => call('be:previewOrderReset'),
    resetOrders: async (payload) => {
      const result = await call('be:resetOrders', payload);
      if (result?.ok && result.requiresLogin) token = null;
      return result;
    },
    documents: () => call('be:documents'),
    documentAction: (id, action, payload) => call('be:documentAction', id, action, payload),
    invoiceProposal: (id) => call('be:invoiceProposal', id),
    customerProfile: () => call('be:customerProfile'),
    customerFinance: () => call('be:customerFinance'),
    stockCardex: (input) => call('be:stockCardex', input),
    unfinishedWork: (input) => call('be:unfinishedWork', input),
    productionBoard: () => call('be:productionBoard'),
    ledgerCoding: () => call('be:ledgerCoding'),
    creditFiles: () => call('be:creditFiles'),
    customerCreditFile: (input) => call('be:customerCreditFile', input),
    saveCreditPolicy: (input) => call('be:saveCreditPolicy', input),
    approveCreditException: (input) => call('be:approveCreditException', input),
    /* اصلاحات ۱۷/بند ۲: رسید وجه، وضعیت چک و ابطال — تنها راهِ نوشتنِ پولِ دریافتی. */
    receipts: (input) => call('be:receipts', input),
    recordReceipt: (payload) => call('be:recordReceipt', payload),
    receiptCheque: (id, action) => call('be:receiptCheque', id, action),
    voidReceipt: (input) => call('be:voidReceipt', input),
    deliveryReport: (input) => call('be:deliveryReport', input),
    financeReport: (input) => call('be:financeReport', input),
    notifications: () => call('be:notifications'),
    markNotificationRead: (id) => call('be:notificationRead', id),
    aiComplete: (req) => call('ai:complete', req),
    auth: {
      info: () => ipcRenderer.invoke('be:info'),
      login: async (u, p) => { const r = await ipcRenderer.invoke('be:login', u, p); if (r && r.ok) { token = r.token; return { ok: true, user: r.user }; } return r; },
      logout: async () => { try { return await call('be:logout'); } finally { token = null; } },
      listUsers: () => call('be:listUsers'),
      saveUsers: (users) => call('be:saveUsers', users),
      setOwnPassword: (pw) => call('be:setOwnPassword', pw),
      verifyPin: (pin) => call('be:verifyPin', pin),
      submitRequest: (text, phone) => call('be:submitRequest', text, phone),
      audit: (n) => call('be:audit', n),
      backupNow: () => call('be:backupNow'),
      backupStatus: () => call('be:backupStatus'),
    },
});

contextBridge.exposeInMainWorld('printshopVoice', {
  // تبدیل صوت آفلاین: فقط متن برمی‌گردد و هیچ داده‌ای نوشته نمی‌شود؛ توکن نشست همانا اینجا می‌ماند.
  status: () => call('voice:status'),
  transcribe: (payload) => call('voice:transcribe', payload),
  cancel: (requestId) => call('voice:cancel', { requestId }),
});
