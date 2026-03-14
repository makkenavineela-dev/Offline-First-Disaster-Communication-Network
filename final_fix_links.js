const fs = require('fs');
const path = require('path');

const folders = ['dashboard', 'map', 'messaging', 'resources', 'settings', 'sos', 'splash'];

folders.forEach(folder => {
  const p = path.join(__dirname, 'frontend', folder, 'index.html');
  if (fs.existsSync(p)) {
    let c = fs.readFileSync(p, 'utf8');
    // Change ../dir/index.html to ../dir/
    c = c.replace(/href="\.\.\/([^"\/]+)\/index\.html"/g, 'href="../$1/"');
    // Change ./dir/index.html to ./dir/
    c = c.replace(/href="\.\/([^"\/]+)\/index\.html"/g, 'href="./$1/"');
    // For common nav items
    c = c.replace(/href="\.\.\/(dashboard|map|messaging|resources|settings|sos|splash)\/index\.html"/g, 'href="../$1/"');
    fs.writeFileSync(p, c);
    console.log(`Updated links in ${folder}`);
  }
});
