const fs = require('fs');
const path = require('path');

const sourceDir = __dirname;
const targetDir = path.join(__dirname, 'www');

// List of top-level folders/files to copy to www (excluding android, node_modules, dist, www, etc.)
const toCopy = [
  'ai', 'dashboard', 'login', 'map', 'messaging', 'resources', 'settings', 'sos', 'splash', 'leaflet', 'icons',
  'i18n.js', 'location.js', 'store.js', 'sw.js', 'manifest.json', 'index.html'
];

function copySync(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const files = fs.readdirSync(src);
    for (const file of files) {
      if (file !== 'node_modules') {
        copySync(path.join(src, file), path.join(dest, file));
      }
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Clean www first
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir);

for (const item of toCopy) {
  const srcItem = path.join(sourceDir, item);
  const destItem = path.join(targetDir, item);
  copySync(srcItem, destItem);
}

console.log('✅ Successfully copied assets to www/');
