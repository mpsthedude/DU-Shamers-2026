const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '_site');
const assets = ['ticket-rules.js', 'app.js', 'standings.js', 'editions.js', 'weekly-tracker.js', 'live.js', 'props.js', 'analyzer.js', 'account-password.js', 'auth.js', 'styles.css', 'props.css', 'member.css', 'league-theme.css'];
assets.push('push.js','push-sw.js','manifest.webmanifest','hub-icon.svg','hub-icon.png');
fs.mkdirSync(output, { recursive: true });
const versions = new Map();
for (const asset of assets) {
  const bytes = fs.readFileSync(path.join(root, asset));
  versions.set(asset, crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12));
  fs.writeFileSync(path.join(output, asset), bytes);
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\b(src|href)="([^"]+)"/g,
  (match, attribute, asset) => versions.has(asset) ? `${attribute}="${asset}?v=${versions.get(asset)}"` : match);
fs.writeFileSync(path.join(output, 'index.html'), html);
console.log('Prepared the public site with content-versioned asset URLs.');
