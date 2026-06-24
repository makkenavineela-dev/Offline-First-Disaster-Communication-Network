# RESQ — SE-AAT Model Diagrams
**System:** Offline-First Disaster Communication Network (RESQ)

---

## (i) Context Diagram

Shows the RESQ system boundary and all external entities it interacts with.

```mermaid
graph TB
    subgraph RESQ_SYSTEM["◈  RESQ SYSTEM  ◈"]
        direction TB
        APP["📱 RESQ Mobile App\n(Offline-First PWA)"]
        BACKEND["🖥️ RESQ Backend\n(WiFi/LAN Relay Node)"]
    end

    subgraph EXTERNAL["External Entities"]
        U1["👤 Civilian User"]
        U2["🚒 First Responder"]
        U3["🏥 Medical Officer"]
        U4["📋 Coordinator"]
        BLE["📡 Bluetooth Low Energy\nMesh Network"]
        CELL["📶 Cellular Network\n(SMS Gateway)"]
        GPS["🛰️ GPS / Location\nServices"]
        OFFMESH["📵 Off-Mesh Contact\n(Regular Phone)"]
        GOSSIP["🌐 Peer Backend Node\n(Multi-zone Relay)"]
    end

    U1 -->|"register, send SOS\nmessage, share resources"| APP
    U2 -->|"coordinate rescue\nbroadcast alerts"| APP
    U3 -->|"medical resources\ntriage info"| APP
    U4 -->|"manage network\nview all nodes"| APP

    APP <-->|"BLE GATT: discover\nexchange keys, relay"| BLE
    APP -->|"send SMS to\noff-grid contacts"| CELL
    APP <-->|"GPS fix\n(lat/lng/accuracy)"| GPS
    APP <-->|"WebSocket:\nreal-time sync"| BACKEND

    CELL -->|"SMS delivery"| OFFMESH
    BACKEND <-->|"HTTP gossip:\ncross-zone relay"| GOSSIP

    style RESQ_SYSTEM fill:#1a3a5c,stroke:#4a9eff,color:#fff
    style EXTERNAL fill:#1a1a2e,stroke:#444,color:#ccc
    style APP fill:#0d6efd,stroke:#4a9eff,color:#fff
    style BACKEND fill:#0d6efd,stroke:#4a9eff,color:#fff
```

---

## (ii-a) Use-Case Diagram

Shows all actors and the system use cases they can perform.

```mermaid
graph LR
    subgraph Actors
        CIV["👤 Civilian"]
        FR["🚒 First\nResponder"]
        MED["🏥 Medical\nOfficer"]
        COORD["📋 Coordinator"]
    end

    subgraph RESQ_UC["RESQ System — Use Cases"]
        UC1(["UC-01\nRegister / Login"])
        UC2(["UC-02\nSetup E2EE Keypair"])
        UC3(["UC-03\nSend SOS Alert"])
        UC4(["UC-04\nBroadcast SOS to Mesh\n+ SMS Contacts"])
        UC5(["UC-05\nSend Encrypted\nDirect Message"])
        UC6(["UC-06\nRelay Mesh Messages\n(Store-and-Forward)"])
        UC7(["UC-07\nShare / Update\nResources"])
        UC8(["UC-08\nView Network\nMap & Peers"])
        UC9(["UC-09\nSend SMS to\nOff-Mesh Contact"])
        UC10(["UC-10\nView & Acknowledge\nAlerts"])
        UC11(["UC-11\nManage Emergency\nContacts"])
        UC12(["UC-12\nConfigure Preferences\n(relay, E2EE, vibrate)"])
        UC13(["UC-13\nView / Merge\nResource Inventory"])
    end

    CIV --> UC1
    CIV --> UC3
    CIV --> UC5
    CIV --> UC7
    CIV --> UC9
    CIV --> UC10
    CIV --> UC11

    FR --> UC1
    FR --> UC3
    FR --> UC4
    FR --> UC5
    FR --> UC6
    FR --> UC8
    FR --> UC10

    MED --> UC1
    MED --> UC3
    MED --> UC5
    MED --> UC7
    MED --> UC13

    COORD --> UC1
    COORD --> UC4
    COORD --> UC8
    COORD --> UC12
    COORD --> UC13

    UC1 -.->|"«include»"| UC2
    UC3 -.->|"«extend»"| UC4

    style RESQ_UC fill:#0f2e0f,stroke:#2e7d32,color:#e0e0e0
```

---

## (ii-b) State Diagram — App & Connection Lifecycle

Shows all possible states of the RESQ app and the events that trigger transitions.

```mermaid
stateDiagram-v2
    [*] --> Unregistered : App first launch

    Unregistered --> Registering : User fills name/role/phone
    Registering --> KeyGeneration : Registration form submitted
    KeyGeneration --> Active : ECDH keypair generated\n(Web Crypto API)

    state Active {
        [*] --> Idle

        Idle --> BLE_Scanning : Bluetooth enabled\nApp in foreground
        BLE_Scanning --> PeerDiscovered : BLE advertisement received
        PeerDiscovered --> KeyExchange : Connect GATT service
        KeyExchange --> Authenticated : Public keys swapped (E2EE ready)

        Authenticated --> Messaging : User opens chat
        Authenticated --> SOSReady : SOS button tapped
        Authenticated --> ResourceSync : Resource tab opened

        Messaging --> EncryptingMsg : User types + sends
        EncryptingMsg --> MsgQueued : Peer out of range
        EncryptingMsg --> MsgSent : Peer in range → BLE write

        MsgQueued --> MsgSent : Peer reconnects\n(store-and-forward flush)

        SOSReady --> AlertBroadcasting : SOS type selected + confirmed
        AlertBroadcasting --> AlertRelayed : TTL-hop through mesh peers
        AlertRelayed --> AlertAcknowledged : Peer sends ACK

        ResourceSync --> ResourceMerging : Receive peer resource list
        ResourceMerging --> ResourceUpdated : last-write-wins merge applied

        BLE_Scanning --> Offline : Bluetooth off /\nno peers in range
        Offline --> BLE_Scanning : Bluetooth re-enabled /\npeer comes in range

        Authenticated --> PeerLost : Peer RSSI drops /\ndisconnect
        PeerLost --> BLE_Scanning : Restart scan cycle
    }

    Active --> [*] : App closed / killed
```

---

## (ii-c) State Diagram — SOS Alert Lifecycle

```mermaid
stateDiagram-v2
    [*] --> SOS_Idle : Normal operation

    SOS_Idle --> SOS_Composing : User taps SOS button
    SOS_Composing --> SOS_Idle : User cancels

    SOS_Composing --> SOS_Broadcasting : Alert type selected\n(Flood/Fire/Medical/Collapse)

    SOS_Broadcasting --> SOS_MeshSent : Written to BLE GATT\n(TTL=5, deduplication ID set)
    SOS_Broadcasting --> SOS_Queued : No peers in range

    SOS_MeshSent --> SOS_Relaying : Peer relays to next hop\n(TTL decremented)
    SOS_Relaying --> SOS_MeshSent : Delivered to next peer
    SOS_Relaying --> SOS_Expired : TTL reaches 0

    SOS_Broadcasting --> SOS_SMS_Sent : SMS dispatched to\nemergency contacts

    SOS_Queued --> SOS_Broadcasting : Peer connects\n(queue flushed)

    SOS_MeshSent --> SOS_Acknowledged : Recipient sends ACK
    SOS_Acknowledged --> SOS_Idle : Alert cleared
    SOS_Expired --> SOS_Idle : Alert dropped
```

---

## (ii-d) Sequence Diagram — E2EE Message Flow (Peer-to-Peer over BLE)

Shows the complete flow of a user sending an encrypted message to a peer via the Bluetooth mesh.

```mermaid
sequenceDiagram
    actor Alice as 👤 Alice (Phone A)
    participant AppA as RESQ App A\n(localStorage)
    participant BLE_A as BLE GATT\nServer A
    participant BLE_B as BLE GATT\nServer B
    participant AppB as RESQ App B\n(localStorage)
    actor Bob as 👤 Bob (Phone B)

    Note over Alice,Bob: Phase 1 — Peer Discovery & Key Exchange

    AppA ->> BLE_A: startAdvertising(userId, name)
    AppB ->> BLE_B: startAdvertising(userId, name)

    AppA ->> BLE_B: BLE scan → connect GATT
    BLE_B -->> AppA: connected

    AppA ->> BLE_B: write(pubKey_Alice)
    BLE_B -->> AppA: read(pubKey_Bob)

    AppA ->> AppA: storePeerKey(Bob, pubKey_Bob)\nto resq_e2ee_peers
    AppB ->> AppB: storePeerKey(Alice, pubKey_Alice)\nto resq_e2ee_peers

    Note over Alice,Bob: Phase 2 — Encrypted Message Send

    Alice ->> AppA: types "Meet at shelter 3"
    AppA ->> AppA: ECDH derive sharedSecret\n(Alice.priv × Bob.pub)
    AppA ->> AppA: AES-GCM-256 encrypt(message, sharedSecret)
    AppA ->> AppA: build MESSAGE{id, from, to, enc:true,\ncontent:ciphertext, ttl:5}

    AppA ->> BLE_B: BLE write(MESSAGE_JSON)
    BLE_B -->> AppB: onCharacteristicWrite(MESSAGE_JSON)

    AppB ->> AppB: dedup check (resq_bt_history)\n→ new message, accept
    AppB ->> AppB: ECDH derive sharedSecret\n(Bob.priv × Alice.pub)
    AppB ->> AppB: AES-GCM-256 decrypt(ciphertext)
    AppB ->> AppB: store plaintext → resq_bt_history
    AppB ->> AppB: trigger notification

    AppB -->> Bob: 🔔 "Alice: Meet at shelter 3"

    Note over Alice,Bob: Phase 3 — Read Receipt

    Bob ->> AppB: opens chat with Alice
    AppB ->> AppB: stamp resq_read_map[alice] = now()
    AppB ->> BLE_A: write(READ_RECEIPT{contactKey:"alice",ts})
    BLE_A -->> AppA: receipt received → UI "✓ seen"
```

---

## (ii-e) Sequence Diagram — Offline Store-and-Forward (Queued Message Delivery)

Shows what happens when Bob is out of range — the message is queued and delivered when he reconnects.

```mermaid
sequenceDiagram
    actor Alice as 👤 Alice (Phone A)
    participant AppA as RESQ App A
    participant Queue as Outbound Queue\n(resq_bt_queue)
    participant BLE_A as BLE GATT A
    participant BLE_B as BLE GATT B
    participant AppB as RESQ App B
    actor Bob as 👤 Bob (Phone B)

    Alice ->> AppA: sends message to Bob
    AppA ->> AppA: encrypt message

    AppA ->> BLE_A: attempt BLE write to Bob
    BLE_A -->> AppA: ❌ peer not found / out of range

    AppA ->> Queue: enqueue(MESSAGE, type="message")
    Note right of Queue: resq_bt_queue\n[{id, payload, queuedAt}]

    Note over BLE_A,BLE_B: ... time passes — Bob comes in range ...

    BLE_B ->> BLE_A: Bob's device detected via BLE scan
    BLE_A -->> AppA: peerConnected(Bob)

    AppA ->> Queue: flushQueue(peerId=Bob)
    Queue -->> AppA: [pending MESSAGE for Bob]

    AppA ->> BLE_B: BLE write(queued MESSAGE)
    BLE_B -->> AppB: onWrite(MESSAGE)
    AppB ->> AppB: decrypt + store + notify
    AppB ->> Queue: (Bob's side) clear delivered

    AppB -->> Bob: 🔔 "Alice: [delayed message delivered]"
    AppA ->> Queue: remove delivered items
```

---

## (ii-f) Sequence Diagram — SOS Broadcast + Multi-Hop Relay

```mermaid
sequenceDiagram
    actor Victim as 👤 Victim (Phone A)
    participant AppA as RESQ App A
    participant AppB as RESQ App B\n(Relay)
    participant AppC as RESQ App C\n(Coordinator)
    participant SMS as Cellular SMS\nGateway

    Victim ->> AppA: taps SOS → selects "Medical Emergency"
    AppA ->> AppA: build SOS_ALERT{id:sos_ts,\ntype:"Medical", lat, lng, ttl:5}
    AppA ->> AppA: store → resq_sos_history

    par BLE Mesh Broadcast
        AppA ->> AppB: BLE write(SOS_ALERT) [ttl=5]
        AppB ->> AppB: dedup check → new alert\ndecrement ttl → 4
        AppB ->> AppB: store → resq_sos_history\ntrigger local notification
        AppB ->> AppC: BLE relay(SOS_ALERT) [ttl=4]
        AppC ->> AppC: dedup check → new alert\ntrigger notification + UI banner
    and SMS to Emergency Contacts
        AppA ->> SMS: sendSMS(contacts[], "SOS: Medical Emergency\nlat,lng")
        SMS -->> Victim: "SMS sent to 3 contacts"
    end

    AppC -->> Victim: 📍 Coordinator sees alert on map
    Note over AppB,AppC: Alert propagates until TTL=0\nor all reachable peers have seen it
```

---

## Summary Table of Diagrams

| Diagram | Type | Purpose |
|---|---|---|
| Context Diagram | System Context | System boundary + all external entities |
| Use-Case Diagram | Behavioral | Actors and their interactions with the system |
| App Lifecycle State | State Machine | App, BLE, and peer connection states |
| SOS Alert State | State Machine | SOS alert creation → relay → acknowledgement |
| E2EE Message Sequence | Sequence | End-to-end encrypted chat over BLE GATT |
| Store-and-Forward Sequence | Sequence | Offline message queuing and delayed delivery |
| SOS Broadcast Sequence | Sequence | Multi-hop SOS relay + parallel SMS dispatch |
