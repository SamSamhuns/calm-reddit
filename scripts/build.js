// Builds the extension for each browser into dist/<browser>/ from the same source files.
// Chrome-based browsers can also load the repository folder as it is. Safari loads dist/safari (see safari/).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCES = ['manifest.json', 'src', 'popup', 'welcome', 'icons'];

// Manifest changes per browser.
const MANIFESTS = {
  chrome: (manifest) => manifest,
  safari: (manifest) => {
    delete manifest.minimum_chrome_version;
    // page.js needs "world": "MAIN", which Safari supports from version 18.
    manifest.browser_specific_settings = { safari: { strict_min_version: '18.0' } };
    return manifest;
  },
};

for (const [browser, change] of Object.entries(MANIFESTS)) {
  const out = path.join(ROOT, 'dist', browser);
  fs.rmSync(out, { recursive: true, force: true });
  for (const entry of SOURCES) fs.cpSync(path.join(ROOT, entry), path.join(out, entry), { recursive: true });
  const manifest = change(JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')));
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built dist/${browser}`);
}
