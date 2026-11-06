'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require('esbuild');
const { pdfPrintOptions } = require('../electron/pdf-export.js');

test('PrintPreview locks A4 landscape and forwards native PDF direction; legacy defaults stay selectable portrait', async () => {
  const React = require('react');
  const code = esbuild.buildSync({ entryPoints: [path.resolve(__dirname, '../src/PrintPreview.jsx')], bundle: true, write: false,
    platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom', 'react/jsx-runtime'], loader: { '.css': 'empty' } }).outputFiles[0].text;
  const calls = [], state = []; let cursor = 0;
  const hooks = { ...React, useEffect() {}, useRef: value => ({ current: value }), useState(initial) {
    const index = cursor++; if (!(index in state)) state[index] = initial;
    return [state[index], value => { state[index] = value; }];
  } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', 'document', code)(
    id => id === 'react' ? hooks : id === 'react-dom' ? { createPortal: node => node } : require(id), module, module.exports,
    { printshopApi: { savePdf: async (...args) => { calls.push(args); return { ok: true, paper: args[0] }; } } }, { body: {} });
  const Component = module.exports.default;
  const nodes = node => node == null || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const render = props => { cursor = 0; return nodes(Component(props)); };
  const locked = render({ initialPaper: 'A5', lockedPaper: 'A4', orientation: 'landscape', pdfName: 'invoice' });
  assert.equal(locked.find(node => node.type === 'select').props.disabled, true);
  assert.equal(locked.find(node => node.type === 'select').props.value, 'A4', 'lock overrides initialPaper');
  assert.match(locked.find(node => node.type === 'style').props.children, /size: A4 landscape/);
  assert.equal(locked.find(node => node.props.className === 'print-source').props['data-orientation'], 'landscape');
  await locked.find(node => node.type === 'button' && node.props.children === 'ذخیره PDF').props.onClick();
  assert.deepEqual(calls, [['A4', 'invoice', 'landscape']]);
  const legacy = render({});
  assert.equal(legacy.find(node => node.type === 'select').props.disabled, false);
  assert.match(legacy.find(node => node.type === 'style').props.children, /size: A5 portrait/);
  legacy.find(node => node.type === 'select').props.onChange({ target: { value: 'A4' } });
  assert.equal(render({}).find(node => node.type === 'select').props.value, 'A4');
  state.length = 0;
  assert.match(render({}).find(node => node.type === 'style').props.children, /size: A4 portrait/, 'fresh legacy default unchanged');
});

test('real Chromium pagination and PDF preserve text and tables on A4/A5 in both directions', { timeout: 120000 }, () => {
  const root = path.resolve(__dirname, '..');
  const fixture = path.join(root, '.work', 'print-pagination-tests');
  fs.mkdirSync(fixture, { recursive: true });
  const bundle = esbuild.buildSync({ entryPoints: [path.join(root, 'src/print-pagination.js')], bundle: true, write: false, format: 'iife', globalName: 'Pagination' }).outputFiles[0].text;
  const css = fs.readFileSync(path.join(root, 'src/print-pages.css'), 'utf8');
  const browserCases = async () => {
    const results = [];
    window.__paginationSnapshots = [];
    function el(tag, text, parent) { const node = document.createElement(tag); if (text) node.textContent = text; parent?.append(node); return node; }
    document.body.replaceChildren();
    const shortSource=el('div','',document.body);shortSource.className='print-source';
    const shortHost=el('div','',document.body);shortHost.className='print-pages';
    const intro=el('div','Intro',shortSource);intro.style.height='250px';
    const card=el('section','',shortSource);const shortTable=el('table','',card);
    const shortBody=el('tbody','',shortTable);
    for(let i=0;i<36;i++){const row=el('tr','',shortBody);row.style.height='23px';el('td',`Row ${i}`,row);}
    const hidden=el('div','HIDDEN-CONFIDENTIAL-TEST',shortSource);hidden.hidden=true;
    const shortCount=await Pagination.paginatePrint(shortSource,shortHost,{paper:'A4'});
    const beforeAbort=shortHost.outerHTML, controller=new AbortController();controller.abort();
    const abortedCount=await Pagination.paginatePrint(shortSource,shortHost,{paper:'A5',signal:controller.signal});
    results.push({remainingPageFilled:!!shortHost.firstElementChild.querySelector('table'),hiddenOmitted:!shortHost.textContent.includes('HIDDEN-CONFIDENTIAL-TEST'),shortCount,abortedUnchanged:abortedCount===0&&shortHost.outerHTML===beforeAbort});
    shortSource.remove(); shortHost.remove();
    let invalidDirectionRejected = false;
    try { await Pagination.paginatePrint(shortSource, shortHost, { orientation: 'sideways' }); } catch (error) { invalidDirectionRejected = /portrait/.test(error.message); }
    results[0].invalidDirectionRejected = invalidDirectionRejected;
    document.body.replaceChildren();
    const breakSource=el('div','',document.body); breakSource.className='print-source';
    const breakHost=el('div','',document.body); breakHost.className='print-pages';
    const firstBlock=el('div','BREAK-FIRST',breakSource); firstBlock.style.height='200px';
    const breakMarker=el('div','',breakSource); breakMarker.setAttribute('data-print-break','');
    const secondBlock=el('div','BREAK-SECOND',breakSource); secondBlock.style.height='200px';
    const breakCount=await Pagination.paginatePrint(breakSource,breakHost,{paper:'A4'});
    const breakPages=[...breakHost.children].map(page=>page.querySelector('.print-page-content').textContent);
    results[0].breakCount=breakCount;
    results[0].breakPage1=breakPages[0]||'';
    results[0].breakPage2=breakPages[1]||'';
    for (const paper of ['A4', 'A5']) for (const orientation of ['portrait', 'landscape']) {
      document.body.replaceChildren();
      const root = el('div'); root.className = 'print-root'; document.body.append(root);
      root.dataset.paper = paper; root.dataset.orientation = orientation;
      const source = el('div', '', root); source.className = 'print-source'; source.dataset.paper = paper; source.dataset.orientation = orientation;
      const host = el('div', '', root); host.className = 'print-pages'; host.dataset.paper = paper; host.dataset.orientation = orientation;
      const heading = el('h1', 'عنوان قرارداد فارسی', source);
      const content = el('div', '', source); content.style.display = 'grid'; content.style.gridTemplateColumns = '1fr 1fr';
      const paragraph = el('p', '', content); const rich = el('strong', '', paragraph);
      const words = Array.from({length:1700}, (_,i) => `کلمه${i}😀`); rich.textContent = words.join(' ');
      const table = el('table', '', content); table.style.borderCollapse = 'collapse';
      const thead = el('thead', '', table); const hr = el('tr', '', thead); el('th', 'شماره', hr); el('th', 'شرح خدمات', hr);
      const tbody = el('tbody', '', table);
      for (let i=0; i<65; i++) { const tr = el('tr', '', tbody); el('td', `ردیف-${i}`, tr); el('td', `شرح-${i}`, tr); }
      const longRow = el('tr', '', tbody); el('td', 'بلند-آخر', longRow);
      const longWords = Array.from({length:1300}, (_,i) => `جزئیات${i}`);
      el('td', longWords.join(' '), longRow);
      el('p', 'پایان قطعی سند', source);
      const noPrint = el('button', 'نباید چاپ شود', source); noPrint.className = 'no-print';
      const before = source.outerHTML;
      const count = await Pagination.paginatePrint(source, host, {paper, orientation});
      const pages = [...host.children];
      const printed = pages.map(page => page.querySelector('.print-page-content').textContent).join('');
      const allWords = [...words, ...longWords, 'پایان قطعی سند', 'بلند-آخر'];
      const missing = allWords.filter(word => !printed.includes(word));
      const visible = [...host.querySelectorAll('.print-page-content *')].every(node => getComputedStyle(node).visibility !== 'hidden');
      const clipped = pages.filter(page => { const c=page.querySelector('.print-page-content'); return c.scrollHeight > c.clientHeight+1 || c.scrollWidth > c.clientWidth+1; }).length;
      const tablePages = pages.filter(page=>page.querySelector('table'));
      results.push({paper,orientation,count,missing,clipped,visible,sourceWidth:source.getBoundingClientRect().width,unchanged:before===source.outerHTML,firstHeader:pages[0].querySelector('.print-page-header').textContent,lastHeader:pages.at(-1).querySelector('.print-page-header').textContent,tableHeaders:tablePages.every(page=>page.querySelector('thead')?.textContent.includes('شرح خدمات')),omitted:!printed.includes('نباید چاپ شود'),width:pages[0].getBoundingClientRect().width,height:pages[0].getBoundingClientRect().height});
      window.__paginationSnapshots.push(root.outerHTML);
    }
    return results;
  };
  const script = `const {app,BrowserWindow}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(fixture,'user-data'))});
    app.commandLine.appendSwitch('disable-gpu');
    app.whenReady().then(async()=>{try{const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta charset="utf-8"><style>'+${JSON.stringify(css)}+'</style>'));await win.webContents.executeJavaScript(${JSON.stringify(bundle)});const result=await win.webContents.executeJavaScript('('+${JSON.stringify(browserCases.toString())}+')()');
    const pdfPrintOptions=${pdfPrintOptions.toString()}, paperMm=${require('../electron/pdf-export.js').paperMm.toString()}, PAPERS={A4:[210,297],A5:[148,210]},MM_PER_INCH=25.4;
    for(let i=1;i<result.length;i++){const item=result[i];await win.webContents.executeJavaScript('document.body.innerHTML=window.__paginationSnapshots['+(i-1)+'];document.getElementById("page-style")?.remove();var s=document.createElement("style");s.id="page-style";s.textContent='+JSON.stringify('@page {size:'+item.paper+' '+item.orientation+';margin:0}')+';document.head.append(s)');
      for(const cssSize of [true,false]){const pdf=await win.webContents.printToPDF({...pdfPrintOptions(item.paper,item.orientation),preferCSSPageSize:cssSize});const raw=pdf.toString('latin1');const prefix=cssSize?'pdf':'native';item[prefix+'Pages']=(raw.match(/\\/Type\\s*\\/Page\\b/g)||[]).length;item[prefix+'Box']=(raw.match(/\\/MediaBox\\s*\\[[^\\]]*\\]/)||[''])[0];}}
    console.log('PAGINATION_RESULT:'+JSON.stringify(result));app.exit(0);}catch(e){console.error(e.stack);app.exit(1);}});`;
  const scriptPath = path.join(fixture, 'runner.cjs'); fs.writeFileSync(scriptPath, script);
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(require('electron'), [scriptPath], { env, encoding:'utf8', timeout:110000, windowsHide:true, maxBuffer:4*1024*1024 });
  assert.equal(run.status, 0, `${run.error || ''}\n${run.stderr}\n${run.stdout}`);
  const result = JSON.parse(run.stdout.split('PAGINATION_RESULT:')[1].split('\n')[0]);
  const remaining=result.shift();
  assert.equal(remaining.remainingPageFilled,true,'a table and its containing card fill the available first page');
  assert.equal(remaining.hiddenOmitted,true,'hidden sections remain omitted');
  assert.equal(remaining.abortedUnchanged,true,'a stale pagination request cannot overwrite the current paper preview');
  assert.equal(remaining.invalidDirectionRejected,true,'unknown directions cannot reach layout');
  assert.equal(remaining.breakCount,2,'a deliberate break starts a new page');
  assert.match(remaining.breakPage1,/BREAK-FIRST/);
  assert.ok(!remaining.breakPage1.includes('BREAK-SECOND'),'the following block never lands on the first page');
  assert.match(remaining.breakPage2,/BREAK-SECOND/);
  assert.ok(!remaining.breakPage2.includes('BREAK-FIRST'),'the preceding block stays on the first page');
  for (const item of result) {
    assert.ok(item.count > 2, `${item.paper}: long fixture must span actual pages`);
    assert.deepEqual(item.missing, [], `${item.paper}: every unique word survives`);
    assert.equal(item.visible, true, 'offscreen source styles do not leak into visible pages');
    const dimensions = item.paper === 'A4' ? [210, 297] : [148, 210];
    if (item.orientation === 'landscape') dimensions.reverse();
    for (const prefix of ['pdf', 'native']) {
      assert.equal(item[prefix+'Pages'],item.count,`${item.paper} ${item.orientation}: physical PDF count equals measured preview (${prefix})`);
      const box = (item[prefix+'Box'] || '').match(/[-\d.]+/g) || [];
      const w = Math.abs(+box[2] - +box[0]), h = Math.abs(+box[3] - +box[1]);
      assert.ok(box.length === 4 && Math.abs(w - dimensions[0]*72/25.4) <= 1.5 && Math.abs(h - dimensions[1]*72/25.4) <= 1.5,
        `${item.paper} ${item.orientation} PDF media box disagrees with physical dimensions (${prefix}): "${item[prefix+'Box']}"`);
    }
    assert.equal(item.clipped, 0, `${item.paper}: pages never overflow`);
    assert.equal(item.unchanged, true, 'React-owned source remains byte-for-byte unchanged');
    assert.equal(item.firstHeader, `صفحه ۱ از ${item.count.toLocaleString('fa-IR')}`);
    assert.equal(item.lastHeader, `صفحه ${item.count.toLocaleString('fa-IR')} از ${item.count.toLocaleString('fa-IR')}`);
    assert.equal(item.tableHeaders, true, 'table headers repeat on every table continuation');
    assert.equal(item.omitted, true);
    assert.ok(Math.abs(item.width - dimensions[0]*96/25.4)<1);
    assert.ok(Math.abs(item.height - dimensions[1]*96/25.4)<1);
    assert.ok(Math.abs(item.sourceWidth - (dimensions[0]-20)*96/25.4)<1,'source layout width follows physical printable width');
  }
});
