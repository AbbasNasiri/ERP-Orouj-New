'use strict';
const path = require('node:path');
const { fileURLToPath } = require('node:url');
function microphonePermission(webContents, permission, details, rendererFile, isAuthenticated) {
  if (permission !== 'media' || !isAuthenticated || !webContents || !details || details.isMainFrame !== true) return false;
  const kinds = details.mediaTypes || [details.mediaType];
  if (!kinds.length || kinds.some(kind => kind !== 'audio')) return false;
  try {
    const url = details.requestingUrl;
    return !!url && path.resolve(fileURLToPath(url)) === path.resolve(rendererFile)
      && webContents.mainFrame.url === url;
  } catch (_) { return false; }
}
module.exports = { microphonePermission };
