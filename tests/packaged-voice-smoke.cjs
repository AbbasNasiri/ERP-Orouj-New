'use strict';
/* Manual packaged-artifact QA. Never imports application main/backend or opens a database.
   Node: --sidecar-only, or --bundle <win-unpacked> [--run].
   The real packaged Electron executable is hardlinked into an isolated QA runner,
   because packaged Electron normally starts its own app.asar instead of a test script.
   The default-app bootstrap is taken from the exact same installed Electron version. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const project = path.resolve(__dirname, '..');
const workspace = path.resolve(project, '..');
const qaRoot = path.join(workspace, '.work', 'voice-qa');
const defaultSidecar = path.join(workspace, 'deliverables', 'PrintShop-Test-2026-10-23', 'voice-asr');
const defaultSample = path.join(qaRoot, 'fleurs-fa-pcm16.wav');
function flag(name, fallback) { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; }
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function allFiles(dir, base = dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) allFiles(file, base, result);
    else { assert.ok(entry.isFile(), 'Unexpected link/special file: ' + file); result.push(path.relative(base, file).replace(/\\/g, '/')); }
  }
  return result.sort();
}
function sidecarIntegrity(target) {
  const source = path.join(workspace, 'tools', 'voice-asr');
  const expected = allFiles(source), actual = allFiles(target);
  assert.deepEqual(actual, expected, 'Sidecar must contain every engine/dependency/model file');
  let bytes = 0;
  const files = actual.map(relative => {
    const src = fs.readFileSync(path.join(source, relative));
    const out = fs.readFileSync(path.join(target, relative));
    const digest = sha256(src);
    assert.equal(sha256(out), digest, 'Sidecar mismatch: ' + relative);
    bytes += out.length;
    return { file: relative, bytes: out.length, sha256: digest };
  });
  const report = { ok: true, source, target, fileCount: files.length, bytes, files };
  fs.mkdirSync(qaRoot, { recursive: true });
  fs.writeFileSync(path.join(qaRoot, 'packaged-voice-sidecar-integrity.json'), JSON.stringify(report, null, 2));
  return { ok: true, fileCount: files.length, bytes, manifest: path.join(qaRoot, 'packaged-voice-sidecar-integrity.json') };
}
function hardlinkTree(from, to, skipResources = false) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skipResources && entry.name === 'resources') continue;
    const source = path.join(from, entry.name), target = path.join(to, entry.name);
    if (entry.isDirectory()) hardlinkTree(source, target);
    else { try { fs.linkSync(source, target); } catch (_) { fs.copyFileSync(source, target); } }
  }
}
function pcmFixture(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let fmt, pcm;
  for (let pos = 12; pos + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', pos, pos + 4), size = bytes.readUInt32LE(pos + 4), start = pos + 8;
    assert.ok(start + size <= bytes.length, 'WAV chunk must be complete');
    if (id === 'fmt ') { assert.ok(size >= 16); fmt = { format: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), rate: bytes.readUInt32LE(start + 4), bits: bytes.readUInt16LE(start + 14) }; }
    if (id === 'data') pcm = bytes.subarray(start, start + size);
    pos = start + size + size % 2;
  }
  assert.deepEqual(fmt, { format: 1, channels: 1, rate: 16000, bits: 16 });
  assert.ok(pcm?.length && pcm.length <= 60 * 16000 * 2);
  return { pcm, seconds: pcm.length / 32000, sha256: sha256(bytes) };
}
async function packagedRuntime(configFile) {
  const { app, utilityProcess } = require('electron');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  fs.mkdirSync(path.join(config.fixture, 'unused-user-data'), { recursive: true });
  app.setPath('userData', path.join(config.fixture, 'unused-user-data'));
  process.env.HF_HUB_OFFLINE = '1'; process.env.TRANSFORMERS_OFFLINE = '1';
  const events = [], guardLog = path.join(config.fixture, 'worker-network.jsonl');
  const worker = path.join(config.bundle, 'resources', 'app.asar.unpacked', 'electron', 'voice-engine.js');
  const archive = path.join(config.bundle, 'resources', 'app.asar');
  const wrapper = path.join(config.fixture, 'guarded-packaged-worker.cjs');
  const guardSource = [
    "'use strict';const fs=require('node:fs');",
    'const log=' + JSON.stringify(guardLog) + ';',
    "fs.appendFileSync(log,JSON.stringify({type:'guard-installed',pid:process.pid})+'\\n');",
    "const deny=channel=>(...args)=>{fs.appendFileSync(log,JSON.stringify({type:'network-attempt',channel,target:String(args[0]||'')})+'\\n');throw new Error('Offline QA blocked '+channel);};",
    "globalThis.fetch=deny('fetch');for(const name of ['http','https']){const m=require('node:'+name);m.request=deny(name+'.request');m.get=deny(name+'.get');}",
    "const net=require('node:net');net.connect=deny('net.connect');net.createConnection=deny('net.createConnection');net.Socket.prototype.connect=deny('Socket.connect');require('node:tls').connect=deny('tls.connect');require('node:dgram').createSocket=deny('dgram.createSocket');require('node:module').syncBuiltinESMExports();",
    'require(' + JSON.stringify(worker) + ');',
  ].join('\n');
  fs.writeFileSync(wrapper, guardSource);
  const protocol = require(path.join(archive, 'electron', 'voice-protocol.js'));
  const { createVoiceService } = require(path.join(archive, 'electron', 'voice-service.js'));
  const info = protocol.engineStatus(config.sidecar);
  assert.equal(info.installed, true, info.reason);
  const audio = pcmFixture(config.sample);
  let child;
  const service = createVoiceService({
    engineDir: config.sidecar, workerFile: worker, loadTimeoutMs: 180000, requestTimeoutMs: 240000,
    fork(file, args, options) {
      assert.equal(file, worker);
      child = utilityProcess.fork(wrapper, args, options);
      child.on('message', msg => { events.push(msg); console.log('[packaged-voice] ' + msg.type); });
      child.stderr?.on('data', chunk => fs.appendFileSync(path.join(config.fixture, 'worker-stderr.txt'), chunk));
      child.stdout?.on('data', chunk => fs.appendFileSync(path.join(config.fixture, 'worker-stdout.txt'), chunk));
      return child;
    },
  });
  const timer = setTimeout(() => { service.dispose(); console.error('Packaged voice QA timed out'); app.exit(1); }, 450000);
  try {
    await app.whenReady();
    const result = await service.transcribe({ requestId: 'packaged-fa-smoke', sampleRate: 16000, pcm16Base64: audio.pcm.toString('base64') });
    assert.equal(result.ok, true, result.error);
    assert.match(result.text, /[\u0600-\u06ff]/, 'Genuine Persian recognition is required');
    assert.ok(result.text.trim().length >= 2);
    const guardEvents = fs.readFileSync(guardLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(guardEvents.some(event => event.type === 'guard-installed'));
    assert.deepEqual(guardEvents.filter(event => event.type === 'network-attempt'), [], 'Packaged worker attempted network access');
    const report = { ok: true, bundle: config.bundle, sidecar: config.sidecar, worker, archive,
      executable: process.execPath, electron: process.versions.electron, fixture: config.fixture,
      sample: config.sample, sampleSeconds: audio.seconds, sampleSha256: audio.sha256,
      text: result.text, ms: result.ms, events, guardEvents,
      serviceFromPackagedArchive: true, engineFromUnpackedArtifact: true, noApplicationBackendLoaded: true };
    fs.writeFileSync(path.join(config.fixture, 'result.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(qaRoot, 'packaged-voice-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report)); clearTimeout(timer); service.dispose(); app.exit(0);
  } catch (error) {
    const report = { ok: false, error: String(error.stack || error), events };
    fs.writeFileSync(path.join(config.fixture, 'failure.json'), JSON.stringify(report, null, 2));
    console.error(error.stack || error); clearTimeout(timer); service.dispose(); app.exit(1);
  }
}
async function prepare() {
  const sidecar = path.resolve(flag('--sidecar', defaultSidecar));
  const integrity = sidecarIntegrity(sidecar);
  console.log(JSON.stringify({ sidecar: integrity }));
  if (process.argv.includes('--sidecar-only')) return;
  const bundle = path.resolve(flag('--bundle', path.join(project, 'release-test-2026-10-23', 'win-unpacked')));
  const sample = path.resolve(flag('--sample', defaultSample));
  pcmFixture(sample);
  const executable = path.join(bundle, 'PrintShop.exe');
  const archive = path.join(bundle, 'resources', 'app.asar');
  const asar = require('@electron/asar');
  const packedEngine = asar.extractFile(archive, path.join('electron', 'voice-engine.js'));
  assert.equal(sha256(packedEngine), sha256(fs.readFileSync(path.join(bundle, 'resources', 'app.asar.unpacked', 'electron', 'voice-engine.js'))), 'Unpacked engine differs from archived metadata');
  for (const name of ['voice-engine.js', 'voice-service.js', 'voice-protocol.js']) {
    assert.equal(sha256(asar.extractFile(archive, path.join('electron', name))), sha256(fs.readFileSync(path.join(project, 'electron', name))), 'Packaged artifact is stale: ' + name);
  }
  // Inspect the delivered executable using its built-in Node runtime, without starting main/backend.
  const versions = cp.spawnSync(executable, ['-p', 'JSON.stringify(process.versions)'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8' });
  assert.equal(versions.status, 0, versions.stderr);
  const installedVersion = require(path.join(project, 'node_modules', 'electron', 'package.json')).version;
  assert.equal(JSON.parse(versions.stdout.trim()).electron, installedVersion, 'Default-app bootstrap must match packaged Electron');
  const fixture = fs.mkdtempSync(path.join(qaRoot, 'packaged-voice-'));
  const runner = path.join(fixture, 'runtime');
  hardlinkTree(bundle, runner, true);
  fs.mkdirSync(path.join(runner, 'resources'));
  fs.copyFileSync(path.join(project, 'node_modules', 'electron', 'dist', 'resources', 'default_app.asar'), path.join(runner, 'resources', 'default_app.asar'));
  const config = { bundle, sidecar, sample, fixture, integrity, version: installedVersion };
  const configFile = path.join(fixture, 'config.json'); fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  console.log(JSON.stringify({ prepared: true, fixture, configFile, version: installedVersion }));
  if (!process.argv.includes('--run')) return;
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = cp.spawn(path.join(runner, 'PrintShop.exe'), [__filename, '--runtime-config', configFile], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { fs.appendFileSync(path.join(fixture, 'stdout.txt'), chunk); process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { fs.appendFileSync(path.join(fixture, 'stderr.txt'), chunk); process.stderr.write(chunk); });
  process.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code === 0 ? 0 : 1)); });
}
if (process.versions.electron && process.type === 'browser' && process.argv.includes('--runtime-config')) {
  packagedRuntime(flag('--runtime-config')).catch(error => { console.error(error); require('electron').app.exit(1); });
} else {
  prepare().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
