const fs = require('fs');
const path = require('path');

const applyPatch = (dir) => {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    // Skip node_modules or output folders
    if (stat.isDirectory() && file !== 'node_modules' && file !== 'android' && file !== 'dist') {
      applyPatch(fullPath);
    } else if (file.endsWith('.html')) {
      let content = fs.readFileSync(fullPath, 'utf8');

      // Add Manifest link exactly before closing </head>
      if (!content.includes('manifest.json')) {
        content = content.replace(
          '</head>',
          '  <link rel="manifest" href="/manifest.json">\n</head>'
        );
      }

      // Add store.js script right before closing </body> if missing (most have it, but just in case)
      if (!content.includes('src="/store.js"') && !content.includes("src='../store.js'") && !content.includes('src="../store.js"')) {
        // Find how many directories deep we are to adjust path
        const depth = fullPath.split(path.sep).length - path.resolve(__dirname, 'frontend').split(path.sep).length;
        const relativePrefix = depth > 0 ? '../'.repeat(depth) : '/';
        content = content.replace(
           '</body>',
           `  <script src="${relativePrefix}store.js"></script>\n</body>`
        );
      }

      fs.writeFileSync(fullPath, content);
      console.log(`[PWA Patch] Successfully injected manifest to ${fullPath}`);
    }
  }
};

const frontendDir = path.join(__dirname, 'frontend');
if (fs.existsSync(frontendDir)) {
  console.log(`Scanning ${frontendDir} for HTML files...`);
  applyPatch(frontendDir);
  console.log('✅ Offline PWA Patch applied successfully to all screens.');
} else {
  console.error('frontend/ folder not found!');
}
