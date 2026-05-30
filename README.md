# RESQ — Offline-First Disaster Communication Network

A peer-to-peer mesh communication system for disaster response that works entirely **without internet or cloud infrastructure**. Built for first responders, civilians, and shelter coordinators when networks fail.

---

## What It Does

- **Mesh messaging** — Send messages peer-to-peer over a local WiFi hotspot (no internet needed)
- **SOS broadcasts** — One-tap emergency signal sent to all nearby nodes with GPS coordinates
- **Live map** — See all connected people, shelters, and hazards on an offline Leaflet map
- **Resource tracking** — Track medical supplies, water, food, and power across shelters
- **AI assistant** — Offline NLP assistant trained on 28 emergency scenarios (first aid, fire, flood, etc.)
- **6-language support** — English, Hindi, Telugu, Tamil, Malayalam, Kannada
- **SMS bridge** — Integrates with Android SMS to reach people not on the app

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla JS + HTML5 PWA |
| Mobile | Capacitor 8.2.0 (Android) |
| Real-time mesh | Socket.io |
| Backend API | Node.js + Express 5 |
| Database | MongoDB + Mongoose |
| Offline maps | Leaflet.js + OpenStreetMap tile cache |
| NLP | compromise.js (fully offline) |
| Auth | JWT + bcrypt |

---

## Project Structure

```
├── frontend/               # PWA — all 11 app pages
│   ├── splash/             # Launch screen
│   ├── login/              # Phone, name, role, GPS consent
│   ├── dashboard/          # Main hub — SOS, messages, map, resources
│   ├── messaging/          # 4-tab chat (all, broadcast, zone, direct)
│   ├── map/                # Live Leaflet map with offline tile cache
│   ├── sos/                # SOS emergency broadcast
│   ├── ai/                 # Offline AI assistant (28 emergency scenarios)
│   ├── resources/          # Supply tracker (medical, water, food, power)
│   ├── settings/           # Profile, language, SMS contacts
│   ├── mesh.js             # P2P Socket.io layer with offline queue (100 msgs)
│   ├── store.js            # Centralized localStorage state
│   ├── sms-bridge.js       # Android SMS send/receive bridge
│   ├── i18n.js             # 6-language translation engine
│   ├── sw.js               # Service Worker — tile + asset cache
│   └── android/            # Capacitor Android project
│
└── backend/                # REST API + Socket.io server
    ├── src/
    │   ├── models/         # Mongoose schemas (User, Message, Resource)
    │   ├── controllers/    # Auth, Message, Resource, Sync logic
    │   ├── routes/         # Express route definitions
    │   ├── socket/         # Socket.io mesh event handler
    │   ├── middleware/     # JWT auth guard, error handler
    │   └── jobs/           # Cron — user status cleanup
    ├── tests/              # Jest test suite (auth, messaging, health)
    └── server.js           # Entry point
```

---

## Setup

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- Android Studio (for mobile build)
- Java 21 (bundled with Android Studio JBR)

### Backend

```bash
cd backend
npm install
```

Create a `.env` file:
```
PORT=5000
MONGO_URI=mongodb://localhost:27017/resq-disaster-app
JWT_SECRET=your-secret-here-change-in-production
NODE_ENV=development
```

```bash
npm run dev    # Starts on port 5000 with auto-reload
npm start      # Production start
```

### Frontend (Web / PWA)

```bash
cd frontend
npm install
```

**Recommended — use the dev server** (required for Service Worker and `/js/resq-auth.js` to load correctly):

```bash
# From the project root:
node serve-frontend.js
# Opens at http://localhost:3000
```

The dev server serves a no-op Service Worker so caching never blocks navigation during development. You can also open pages directly as `file://` for quick UI checks, but API calls and the auth helper will only work when served over HTTP.

### Android APK Build

**Option 1 — Batch script (recommended):**
```bat
.\BUILD_ANDROID.bat
```
Then in Android Studio: **Build → Rebuild Project**, then **Run → Run 'app'**

**Option 2 — Manual (PowerShell):**
```powershell
cd frontend
node build_android_assets.js        # Copies assets into www/
npx cap sync android                # Syncs to Android project

cd android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug         # Builds APK
```

**Install on device via ADB:**
```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb install app\build\outputs\apk\debug\app-debug.apk
```

APK output: `frontend/android/app/build/outputs/apk/debug/app-debug.apk` (≈7.3 MB)

---

## Running Tests

```bash
cd backend
npm test
```

Test coverage:
- **health.test.js** — API health endpoint, route existence
- **auth.test.js** — Register, login, duplicate detection, bad credentials, profile, auth guard
- **messaging.test.js** — Send broadcast/direct/SOS, delivery confirmation, zone fetch, input validation, auth guard
- **resources.test.js** — CRUD for resources, owner-only enforcement, type validation
- **sync.test.js** — Push batch (messages, resources, location), deduplication, pull with timestamp/default window
- **network.test.js** — Active nodes, heartbeat, status update with role guard, gossip peer management

---

## How the Mesh Works

1. One phone (or Raspberry Pi) runs the backend and creates a WiFi hotspot
2. Other phones join the hotspot and connect to `http://<host-ip>:5000` via Socket.io
3. Messages route in-memory through Socket.io — no internet, no cloud
4. Offline queue (100 messages) in `mesh.js` stores outbound messages when disconnected and flushes on reconnect
5. GPS coordinates share via the `location` socket event, powering the live map
6. Messages older than 30 days are auto-deleted from MongoDB via TTL index

### Multi-Zone Mesh (Peer Gossip)

When the disaster area spans multiple WiFi zones (each with its own backend), backends can gossip messages between zones over LAN:

```
# backend/.env on each node
RESQ_NODE_ID=node-A
RESQ_PEERS=http://192.168.1.21:5000,http://192.168.1.22:5000
```

Each backend automatically connects to its configured peers on startup. Messages, SOS alerts, and location updates hop up to 5 times across the mesh. The seen-message cache (5-minute TTL) prevents loops.

At runtime, you can also add/remove peers via the API (requires `shelter_admin` role):

```bash
# Add peer
curl -X POST http://localhost:5000/api/network/peers \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"url":"http://192.168.1.21:5000"}'

# List peers and status
curl http://localhost:5000/api/network/peers
```

---

## API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/register` | No | Register new node/user |
| POST | `/api/auth/login` | No | Login, get JWT token |
| GET | `/api/users/profile` | Yes | Get current user profile |
| PUT | `/api/users/location` | Yes | Update GPS location |
| POST | `/api/messages` | Yes | Send message (direct/broadcast/sos) |
| GET | `/api/messages/direct/:userId` | Yes | Fetch direct chat history |
| GET | `/api/messages/broadcasts/:zone` | Yes | Fetch zone broadcasts |
| GET | `/api/resources` | Yes | Get shelter resources |
| POST | `/api/sync` | Yes | Batch sync offline queued data |
| GET | `/api/health` | No | Server health check |

---

## Socket.io Events

| Event (client→server) | Description |
|----------------------|-------------|
| `join` | Register node with name, role, zone, GPS |
| `message` | Send message (to: 'all', 'zone', or userId) |
| `sos` | Broadcast SOS alert |
| `location` | Push GPS update |
| `heartbeat` | Keep-alive ping |

| Event (server→client) | Description |
|----------------------|-------------|
| `joined` | Confirms join, sends current node list |
| `node_joined` | New peer connected |
| `node_left` | Peer disconnected |
| `message` | Incoming message |
| `sos_alert` | Incoming SOS broadcast |
| `location_update` | Peer GPS update |
| `ack` | Message delivery acknowledgment |
| `delivery_receipt` | Direct message reached recipient |

---

## Security

- JWT authentication on all protected routes (30-day expiry)
- Rate limiting: 100 req / 15 min per IP
- NoSQL injection sanitization (strips `$` and `.` from keys)
- XSS sanitization (strips `<script>` tags and `javascript:` URIs from request bodies)
- Helmet.js security headers
- bcrypt password hashing (cost factor 12)
- Constant-time login comparison to prevent timing attacks

---

## Map Offline Tiles

Leaflet loads tiles from OpenStreetMap CDN by default. After the first visit the Service Worker caches every tile that was viewed. For a fully pre-seeded offline map (no first-visit internet needed):

1. Export a tile pack for your region from [Organic Maps](https://organicmaps.app/) or use [TileMill](https://tilemill-project.github.io/tilemill/)
2. Place `.png` tiles in `frontend/leaflet/tiles/{z}/{x}/{y}.png`
3. Update the `L.tileLayer` URL in `frontend/map/index.html` to `../leaflet/tiles/{z}/{x}/{y}.png`
4. Run `node build_android_assets.js` to bundle them into the APK

For the MVP/demo the existing CDN tiles + SW caching strategy is sufficient.

---

## Debugging

### Clear Service Worker & Cache

Navigate to `http://localhost:3000/sw-clear.html?debug` to unregister all Service Workers and clear all caches. This is a dev-only page — the `?debug` query param is required or it redirects away immediately.

---

## Deployment (LAN / Hotspot — no internet needed)

```bash
# On the host device (server):
cd backend && node server.js

# Clients open in browser or Android app:
http://<server-local-ip>:5000
```

The entire system runs on a local hotspot — no router, no internet, no DNS required.

---

## License

ISC
