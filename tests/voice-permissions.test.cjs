const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { microphonePermission } = require('../electron/voice-permissions.js');
const file = path.resolve(__dirname, '../dist/index.html');
const url = pathToFileURL(file).href;
const contents = { mainFrame: { url } };
const details = { requestingUrl: url, isMainFrame: true, mediaTypes: ['audio'] };
test('only authenticated app audio capture passes both Electron permission shapes', () => {
  assert.equal(microphonePermission(contents, 'media', details, file, true), true);
  assert.equal(microphonePermission(contents, 'media', { ...details, mediaTypes: undefined, mediaType: 'audio' }, file, true), true);
  for (const change of [{ isMainFrame: false }, { requestingUrl: 'https://example.com' }, { mediaTypes: ['audio', 'video'] }, { mediaTypes: [] }, { mediaTypes: undefined, mediaType: 'unknown' }]) {
    assert.equal(microphonePermission(contents, 'media', { ...details, ...change }, file, true), false);
  }
  assert.equal(microphonePermission(contents, 'media', details, file, false), false);
  assert.equal(microphonePermission(contents, 'camera', details, file, true), false);
  assert.equal(microphonePermission({ mainFrame: { url: 'file:///different.html' } }, 'media', details, file, true), false);
});
