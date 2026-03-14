# RESQ — Making It 100% Offline

## What was broken (online dependencies)
1. Google Fonts (fonts.googleapis.com) 
2. Backend server (MongoDB + Express)

## What we fixed
1. ✅ Service Worker caches fonts on first load, works offline forever after
2. ✅ PWA manifest — installs on phone homescreen like native app  
3. ✅ Offline font fallbacks (Arial Narrow / Impact) if never been online
4. ✅ store.js uses localStorage (no server needed)
5. ✅ Backend is completely bypassed for hackathon demo

## How to run (2 steps)

### Step 1 — Serve locally
```bash
cd frontend
npx serve .    # OR: python3 -m http.server 3000
```

### Step 2 — Open on phone
1. Connect phone to same WiFi as laptop
2. Open browser on phone → type your laptop's IP:3000
3. Chrome will show "Add to Home Screen" banner
4. Tap it → app installs, works 100% offline from now on

## What "offline" means now
- First visit: needs WiFi to your laptop (local network only, NO internet needed)
- After first visit: completely offline, no WiFi, no internet, nothing
- Service Worker caches all HTML, JS, CSS, and fonts automatically
- All data (language, resources, messages) stored in localStorage on device

## For the hackathon pitch
"RESQ uses a Progressive Web App architecture with Service Workers 
to cache everything on first install. After that, zero network 
dependency. In a real deployment, devices would communicate via 
Bluetooth mesh and WiFi Direct — the backend handles sync only 
when internet is briefly restored."
