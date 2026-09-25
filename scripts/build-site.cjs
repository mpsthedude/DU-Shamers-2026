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
// Publish only the trip page's public assets; reference photos and booking data stay out.
const tripOutput = path.join(output, 'kentucky');
fs.mkdirSync(path.join(tripOutput, 'assets'), { recursive: true });
for (const file of ['trip.css', 'trip.js', 'favicon.svg']) {
  fs.copyFileSync(path.join(root, 'kentucky', file), path.join(tripOutput, file));
}
for (const name of ['hero', 'bourbon', 'racing', 'tailgate', 'dinner', 'touchdown']) {
  fs.copyFileSync(path.join(root, 'kentucky', 'assets', `${name}.png`), path.join(tripOutput, 'assets', `${name}.png`));
}
for (const file of ['house-1.jpg', 'house-2.jpg', 'house-3.jpg']) {
  fs.copyFileSync(path.join(root, 'kentucky', 'assets', file), path.join(tripOutput, 'assets', file));
}
const tripHtml = fs.readFileSync(path.join(root, 'kentucky', 'index.html'), 'utf8').replace(/\b(src|href)="((?:assets\/)?[\w.-]+\.(?:css|js|png|jpg|svg))"/g,
  (match, attribute, asset) => `${attribute}="${asset}?v=${crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'kentucky', asset))).digest('hex').slice(0, 12)}"`);
fs.writeFileSync(path.join(tripOutput, 'index.html'), tripHtml);
console.log('Prepared the public site with content-versioned asset URLs.');
