# RESQ — Entity-Relationship Diagram

RESQ is **offline-first**: there is no central database. Every device keeps its
**own** copy of the data in the phone's `localStorage`, and copies are
**exchanged + merged** with nearby devices over the **Bluetooth mesh**. The
diagram below models the *logical* entities and how they relate.

---

## ER Diagram

```mermaid
erDiagram
    USER ||--|| CRYPTO_KEYPAIR : "owns (E2EE)"
    USER ||--o{ MESSAGE : "sends"
    USER ||--o{ SOS_ALERT : "broadcasts"
    USER ||--o{ RESOURCE : "owns / shares"
    USER ||--o{ PREFERENCE : "configures"
    USER ||--o{ LOCATION : "records (GPS)"
    USER ||--o{ CONTACT : "saves"
    USER ||--o{ OUTBOUND_QUEUE : "buffers (offline)"

    USER }o--o{ PEER : "discovers over BLE"
    PEER ||--o| PEER_PUBKEY : "shares public key"
    PEER ||--o{ MESSAGE : "is sender/recipient of"
    PEER ||--o{ SOS_ALERT : "originates"

    MESSAGE ||--o| READ_RECEIPT : "marked read by"
    MESSAGE }o--|| OUTBOUND_QUEUE : "relayed via"

    CONTACT ||--o{ SMS_MESSAGE : "texted over cellular SMS"

    USER {
        string userId PK "RESQ-XXXX / local_<phone>"
        string name
        string role "Civilian / First Responder / Medical / Coordinator"
        string phone "mobile number"
        string zone
        string verifyChannel "bypass / self-sms"
        bool   verified
    }

    CRYPTO_KEYPAIR {
        string userId PK,FK
        string publicKey "ECDH P-256 (shared)"
        string privateKey "ECDH P-256 (never leaves device)"
        string algorithm "ECDH + AES-GCM-256"
    }

    PEER {
        string userId PK "full id from GATT devinfo"
        string name
        int    rssi "signal strength dBm"
        bool   hasKey "E2EE key exchanged?"
        string bleAddress "BLE MAC"
        long   lastSeen
    }

    PEER_PUBKEY {
        string userId PK,FK
        string publicKey "base64 ECDH key of peer"
    }

    MESSAGE {
        string id PK "m_<uid>_<ts>"
        string fromUserId FK
        string fromName
        string toUserId "userId or 'all'"
        string content "plaintext (own) / ciphertext (relayed)"
        bool   enc "E2EE encrypted?"
        long   timestamp
        string channel "bluetooth / sms / ble"
        int    ttl "hops remaining (relay)"
    }

    SOS_ALERT {
        string id PK "sos_<ts>"
        string fromUserId FK
        string fromName
        string alertType "Flood/Fire/Medical/Collapse/..."
        string message
        float  lat
        float  lng
        long   timestamp
    }

    RESOURCE {
        string _id PK "res_<uid>_<ts>"
        string name
        string type "medical/water/food/power/shelter/..."
        int    quantity
        string unit
        string status "OK / LOW / CRITICAL"
        string ownerId FK
        string ownerName
        string ownerPhone
        long   updatedAt "last-write-wins merge key"
    }

    CONTACT {
        string phone PK
        string name
        string source "phonebook / emergency / mesh-known"
    }

    SMS_MESSAGE {
        string contactPhone PK,FK
        string text
        bool   outbound
        long   timestamp
    }

    LOCATION {
        string userId FK
        float  lat
        float  lng
        float  accuracy
        long   timestamp
    }

    PREFERENCE {
        string key PK "vibrate / sos_alerts / share_loc / relay / e2ee"
        bool   value
    }

    READ_RECEIPT {
        string contactKey PK "fromName (lowercased)"
        long   lastReadTimestamp
    }

    OUTBOUND_QUEUE {
        string id PK
        string type "message / sos / resource"
        string payload "JSON"
        long   queuedAt
    }
```

---

## How each entity is stored (localStorage)

| Entity | localStorage key | Notes |
|---|---|---|
| **USER** | `resq_uid`, `resq_name`, `resq_role`, `resq_mobile`, `resq_zone`, `resq_verify_channel` | The device owner / mesh node identity |
| **CRYPTO_KEYPAIR** | `resq_e2ee_priv`, `resq_e2ee_pub` | ECDH P-256 keypair (Web Crypto API) |
| **PEER_PUBKEY** | `resq_e2ee_peers` | Map of `userId → public key` of known peers |
| **PEER** | in-memory + `resq_nodes` | Discovered nearby devices (live BLE) |
| **MESSAGE** | `resq_bt_history` | Last 300 mesh messages (deduped by id) |
| **SOS_ALERT** | `resq_sos_history` | Last 50 SOS alerts |
| **RESOURCE** | `resq_resources` | Supply items (yours + network), merged by `updatedAt` |
| **CONTACT** | `resq_emergency_contacts`, `resq_known_phones`, `resq_contacts_cache` | SMS + phonebook contacts |
| **SMS_MESSAGE** | `resq_sms_<phone>` | Per-contact SMS thread history |
| **LOCATION** | `resq_location`, `resq_location_history` | GPS fixes |
| **PREFERENCE** | `resq_pref_*` | Settings toggles (vibrate, sos_alerts, share_loc) |
| **READ_RECEIPT** | `resq_read_map` | Last-read timestamp per contact |
| **OUTBOUND_QUEUE** | `resq_bt_queue`, `resq_msg_queue`, `resq_sos_queue` | Store-and-forward buffers (offline) |

---

## Key relationships explained

- **USER → CRYPTO_KEYPAIR (1:1)** — each user generates one ECDH keypair on first
  launch; the public key is shared over BLE, the private key never leaves the phone.
- **USER ↔ PEER (M:N)** — every device discovers many nearby devices over BLE, and
  is itself a peer to them. Identity (`userId`) is resolved from the GATT
  device-info characteristic (not the truncated advertisement).
- **PEER → PEER_PUBKEY (1:1)** — on connect, peers exchange public keys; this is
  what lets two users hold an **E2EE** conversation that relays can't read.
- **USER → MESSAGE (1:N)** — a user authors many messages. `to = 'all'` is a
  broadcast; otherwise it is a direct (encrypted) message routed by `userId`.
- **MESSAGE → READ_RECEIPT (1:0..1)** — opening a chat stamps a read time per
  contact, so threads move out of "unread".
- **USER → RESOURCE (1:N)** — a user owns supply items; edits broadcast over the
  mesh and merge on other devices using **last-write-wins** (`updatedAt`).
- **CONTACT → SMS_MESSAGE (1:N)** — the SMS tab keeps a separate per-contact
  thread, sent over **cellular SMS** (reaches people off the mesh).
- **MESSAGE/SOS/RESOURCE → OUTBOUND_QUEUE** — when no peer is in range, items are
  queued and **flushed** when a device comes back into Bluetooth range
  (store-and-forward / delay-tolerant networking).

---

## Sync model (not a server — a mesh)

```mermaid
flowchart LR
    A["Phone A — own localStorage"] <-->|"BLE GATT: exchange + merge"| B["Phone B — own localStorage"]
    B <-->|"relay: TTL + dedup"| C["Phone C — own localStorage"]
    A -.->|"cellular SMS"| S["Off-mesh contact (phone SMS)"]
```

Each phone is an independent replica. There is **no central database** — data
propagates device-to-device over Bluetooth (with TTL + de-duplication for
multi-hop relay), and to off-mesh people via **cellular SMS**.
