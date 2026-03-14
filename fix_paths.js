const fs = require('fs');
const path = require('path');

const frontendDir = path.join(__dirname, 'frontend');

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // 1. Fix .html links: change href="../dir/index.html" to href="../dir/"
  // Use a regex that matches href or src pointing to something/index.html
  content = content.replace(/(href|src)="(\.\.?\/[^"]*)\/index\.html"/g, '$1="$2/"');
  
  // 2. Fix script paths for store.js and i18n.js
  // Many files use ../../store.js when it should be ../store.js if served from frontend/
  // We want them to point to the store.js in the frontend folder.
  // If a file is in frontend/splash/index.html, it should use ../store.js
  const relativePath = path.relative(path.dirname(filePath), frontendDir);
  const correctStorePath = path.join(relativePath, 'store.js').replace(/\\/g, '/');
  const correctI18nPath = path.join(relativePath, 'i18n.js').replace(/\\/g, '/');
  
  content = content.replace(/src="[^"]*store\.js"/g, `src="${correctStorePath}"`);
  content = content.replace(/src="[^"]*i18n\.js"/g, `src="${correctI18nPath}"`);

  // 3. Fix Leaflet paths
  const correctLeafletJS = path.join(relativePath, 'leaflet/leaflet.js').replace(/\\/g, '/');
  const correctLeafletCSS = path.join(relativePath, 'leaflet/leaflet.css').replace(/\\/g, '/');
  content = content.replace(/href="[^"]*leaflet\.css"/g, `href="${correctLeafletCSS}"`);
  content = content.replace(/src="[^"]*leaflet\.js"/g, `src="${correctStorePath === 'store.js' ? 'leaflet/leaflet.js' : correctLeafletJS}"`);
  // Special case for map/index.html which I might have already messed with.
  
  fs.writeFileSync(filePath, content);
  console.log(`Fixed: ${filePath}`);
}

const folders = ['dashboard', 'map', 'messaging', 'resources', 'settings', 'sos', 'splash'];

folders.forEach(folder => {
  const indexPath = path.join(frontendDir, folder, 'index.html');
  if (fs.existsSync(indexPath)) {
    fixFile(indexPath);
  }
});

// Also fix the root frontend/index.html if it exists
const rootIndexPath = path.join(frontendDir, 'index.html');
if (fs.existsSync(rootIndexPath)) {
  fixFile(rootIndexPath);
}

// Fix sw.js mapping
const swPath = path.join(frontendDir, 'sw.js');
if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf8');
  // Remove / from the start of paths to make them relative to sw scope
  swContent = swContent.replace(/'\//g, "'");
  // Ensure we fall back to a valid path
  swContent = swContent.replace(/match\('dashboard\/index\.html'\)/g, "match('dashboard/')");
  fs.writeFileSync(swPath, swContent);
  console.log(`Fixed: ${swPath}`);
}
