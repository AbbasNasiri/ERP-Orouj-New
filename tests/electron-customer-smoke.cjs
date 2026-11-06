'use strict';
// Run with the project's Electron executable after building the renderer.
// Uses production main/preload/native SQLite and only an isolated project fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
assert.ok(process.versions.electron, 'Electron runtime required');
const workDir = path.resolve(__dirname, '../../.work');
fs.mkdirSync(workDir, { recursive: true });
const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-customer-smoke-'));
const userData = path.join(fixtureDir, 'electron-user-data');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
process.env.PORTABLE_EXECUTABLE_DIR = fixtureDir;
const timeout = setTimeout(() => { console.error('Customer IPC smoke timed out'); app.exit(1); }, 30000);

async function rendererScenario() {
  function check(condition, message) { if (!condition) throw new Error(message); }
  async function ok(promise, message) {
    const response = await promise;
    check(response?.ok, `${message}: ${response?.code || ''} ${response?.error || ''}`);
    return response;
  }
  for (let attempt = 0; !document.querySelector('input[type="password"]') && attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const loginRendered = document.body.innerText.includes('ورود') && !!document.querySelector('input[type="password"]');
  check(loginRendered, 'React login page did not render');
  const api = window.printshopApi;
  check(api?.secure === true && api.mode === 'secure', 'Real main/preload did not start in secure mode');
  for (const method of ['customerAction', 'customerProfile', 'partyAction']) check(typeof api[method] === 'function', `${method} bridge missing`);
  check(typeof api.auth?.submitRequest === 'function', 'submitRequest bridge missing');
  check((await api.customerProfile()).code === 'UNAUTHENTICATED', 'Unauthenticated profile read allowed');
  check((await api.partyAction('customer', 'customer-one', 'issue_number')).code === 'UNAUTHENTICATED', 'Unauthenticated customer action allowed');
  const customersKey = 'printshop_customers_v2';
  const ordersKey = 'printshop_orders_v5';
  const managerPassword = 'isolated-customer-smoke-password';
  const customerPassword = 'isolated-customer-account-password';
  const login = await ok(api.auth.login('admin', '1234'), 'manager login');
  check(!Object.hasOwn(login, 'token'), 'Manager login token exposed to renderer');
  check(!(await api.get(customersKey)).ok, 'Forced-password-change guard did not block read');
  await ok(api.auth.setOwnPassword(managerPassword), 'initial password change');
  const initial = await ok(api.get(customersKey), 'initial customer read');
  check(initial.value === null || initial.value.length === 0, 'Fixture contains existing customers');
  await ok(api.set(customersKey, [
    { id: 'customer-one', name: 'مشتری آزمایشی یک', phone: '02100000000', mobile: '09120000000', debt: 123456, privateNote: 'must not reach customer profile' },
    { id: 'customer-two', name: 'مشتری خصوصی دیگر', mobile: '09990000000', privateNote: 'other customer data' },
  ]), 'create pending customer profiles');
  let customers = (await ok(api.get(customersKey), 'read pending customers')).value;
  check(customers.every(c => c.eligibility.status === 'pending' && !c.customerCode), 'New customer bypassed pending state');
  const REASON = 'مدارک ثبتی کامل و قابل اتکا است';
  check((await api.partyAction('customer', 'customer-one', 'issue_number')).ok === false, 'A code was issued before approval');
  check((await api.partyAction('customer', 'customer-one', 'approve')).code === 'VALIDATION_FAILED', 'Approval accepted without a manager reason');
  const account = { id: 'customer-account', name: 'حساب مشتری آزمایشی', username: 'customer-smoke', role: 'مشتری', customerId: 'customer-one', active: true, _plain: customerPassword };
  let users = (await ok(api.auth.listUsers(), 'list users before eligibility')).users;
  check(!(await api.auth.saveUsers([...users, account])).ok, 'Account created before customer eligibility');
  const approved = await ok(api.partyAction('customer', 'customer-one', 'approve', { reason: REASON }), 'approve customer eligibility');
  check(approved.party.eligibility.status === 'approved' && approved.party.active === true && approved.party.customerCode === '', 'Approval did not open the work list before numbering');
  check(approved.party.eligibility.reviewedBy.id === login.user.id, 'Eligibility approval missing manager identity');
  const numbered = await ok(api.partyAction('customer', 'customer-one', 'issue_number'), 'issue customer number after approval');
  check(numbered.party.customerCode === 'C-000001', 'First customer number incorrect');
  check((await api.partyAction('customer', 'customer-one', 'issue_number')).ok === false, 'A coded record received a replacement number');
  customers = (await ok(api.get(customersKey), 'read approved customer')).value;
  const forged = structuredClone(customers); forged[0].customerCode = 'C-999999';
  check(!(await api.set(customersKey, forged)).ok, 'Generic customer-number tampering allowed');
  users = (await ok(api.auth.listUsers(), 'list users after eligibility')).users;
  await ok(api.auth.saveUsers([...users, account]), 'create approved customer account');
  await ok(api.auth.logout(), 'manager logout');
  const customerLogin = await ok(api.auth.login(account.username, customerPassword), 'customer login');
  check(customerLogin.user.role === 'مشتری' && customerLogin.user.customerId === 'customer-one', 'Customer account identity incorrect');
  check(!Object.hasOwn(customerLogin, 'token'), 'Customer login token exposed to renderer');
  const profile = (await ok(api.customerProfile(), 'own customer profile')).customer;
  check(profile.id === 'customer-one' && profile.customerCode === 'C-000001' && profile.eligibility.status === 'approved', 'Own profile identity/eligibility incorrect');
  check(Object.keys(profile).sort().join(',') === ['id', 'name', 'customerCode', 'eligibility', 'phone', 'mobile'].sort().join(','), 'Profile contains fields beyond minimal allowlist');
  check(!JSON.stringify(profile).includes('مشتری خصوصی دیگر') && !Object.hasOwn(profile, 'debt') && !Object.hasOwn(profile, 'privateNote'), 'Profile leaked private/other-customer data');
  check((await api.get(customersKey)).code === 'FORBIDDEN', 'Customer read complete customer collection');
  check((await api.partyAction('customer', 'customer-two', 'approve', { reason: REASON })).code === 'FORBIDDEN', 'Customer approved another customer');
  check((await api.partyAction('customer', 'customer-one', 'erase')).code === 'FORBIDDEN', 'Customer erased a bank record');
  check(!(await api.set(ordersKey, [])).ok, 'Customer wrote production collection');
  const submitted = await ok(api.auth.submitRequest('درخواست آزمایشی چاپ کتاب؛ نیازمند بررسی کارشناسی', '02111111111'), 'submit customer request');
  check(!!submitted.orderNumber, 'Request did not receive an order number');
  check((await api.get(ordersKey)).code === 'FORBIDDEN', 'Customer read all orders');
  await ok(api.auth.logout(), 'customer logout');
  check((await api.customerProfile()).code === 'UNAUTHENTICATED', 'Profile remained readable after logout');
  await ok(api.auth.login('admin', managerPassword), 'manager re-login');
  const orders = (await ok(api.get(ordersKey), 'manager reads submitted request')).value;
  check(orders.length === 1, 'Unexpected request/order count');
  const request = orders[0];
  check(request.orderNumber === submitted.orderNumber && request.customerId === 'customer-one' && request.customerCode === 'C-000001', 'Request customer identity/number not persisted');
  check(request.status === 'درخواست مشتری' && request.requestedBy === account.id && request.source === 'مشتری', 'Submission did not remain a customer request');
  check(!request.approvedAt && !request.managerOverrideDebt && !request.workflow?.customerConfirmation && !request.workflow?.productionAuthorization, 'Submitting a request authorized production');
  check(Array.isArray(request.items) && request.items.length === 0 && Array.isArray(request.payments) && request.payments.length === 0, 'Request contains production or financial items');
  await ok(api.partyAction('customer', 'customer-one', 'deactivate'), 'deactivate an approved numbered customer');
  await ok(api.auth.logout(), 'manager logout for the deactivation check');
  await ok(api.auth.login(account.username, customerPassword), 'customer re-login while deactivated');
  check((await api.auth.submitRequest('درخواست پس از غیرفعال شدن؛ فقط برای آزمون', '')).code === 'CUSTOMER_NOT_APPROVED', 'A deactivated customer submitted a request');
  await ok(api.auth.logout(), 'customer logout after the deactivation check');
  await ok(api.auth.login('admin', managerPassword), 'manager re-login for the reactivation');
  const reactivated = await ok(api.partyAction('customer', 'customer-one', 'activate'), 'reactivate the customer');
  check(reactivated.party.active === true && reactivated.party.customerCode === 'C-000001', 'Reactivation lost the issued number');
  await ok(api.auth.logout(), 'final manager logout');
  return { loginRendered, secure: true, customerCode: profile.customerCode, eligibility: profile.eligibility.status,
    requestNumber: request.orderNumber, requestStatus: request.status, ownProfileOnly: true,
    tamperingDenied: true, accountBeforeApprovalDenied: true, productionAuthorized: false,
    deactivationBlocksRequests: true, reactivationKeepsNumber: true };
}

app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.once('did-fail-load', (_e, code, reason) => {
    console.error(JSON.stringify({ smoke: 'customer-real-ipc', pass: false, code, reason })); app.exit(1);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(${rendererScenario.toString()})()`);
      const dbFile = path.join(fixtureDir, 'PrintShopData', 'printshop.db');
      assert.ok(fs.existsSync(dbFile), 'Native production SQLite database was not created');
      assert.equal(fs.readFileSync(dbFile).subarray(0, 16).toString(), 'SQLite format 3\0');
      clearTimeout(timeout);
      console.log(JSON.stringify({ smoke: 'customer-real-ipc', pass: true, electron: process.versions.electron,
        abi: process.versions.modules, fixtureDir, ...result }));
      // Main owns the connection; retain only this isolated fixture for inspection.
      app.exit(0);
    } catch (error) { console.error(error.stack); app.exit(1); }
  });
});
require('../electron/main.js');
