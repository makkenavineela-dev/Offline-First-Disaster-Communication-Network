const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  Header, Footer, AlignmentType, LevelFormat, TableOfContents, HeadingLevel,
  BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak
} = require("docx");

const NAVY = "1F3864", BLUE = "1F6FEB", RED = "C00000", GREEN = "238636", GREY = "595959";
const HEADFILL = "1F3864", ROWFILL = "EAF1FB", ROWALT = "F6F9FE";

const border = { style: BorderStyle.SINGLE, size: 4, color: "B7C3D0" };
const borders = { top: border, bottom: border, left: border, right: border,
  insideHorizontal: border, insideVertical: border };

const CW = 9360; // content width (US Letter, 1" margins)

function H1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
}
function H2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
}
function P(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 140, line: 276 },
    alignment: opts.align || AlignmentType.JUSTIFIED,
    children: [new TextRun({ text, size: opts.size || 22, bold: !!opts.bold, italics: !!opts.italics, color: opts.color })]
  });
}
function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "bul", level },
    spacing: { after: 70, line: 270 },
    children: [new TextRun({ text, size: 22 })]
  });
}
function bulletRich(runs, level = 0) {
  return new Paragraph({
    numbering: { reference: "bul", level },
    spacing: { after: 70, line: 270 },
    children: runs
  });
}

// Table helpers
function headerCell(text, w) {
  return new TableCell({
    borders, width: { size: w, type: WidthType.DXA },
    shading: { fill: HEADFILL, type: ShadingType.CLEAR },
    margins: { top: 70, bottom: 70, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 21 })] })]
  });
}
function cell(text, w, i, bold) {
  return new TableCell({
    borders, width: { size: w, type: WidthType.DXA },
    shading: { fill: i % 2 ? ROWALT : ROWFILL, type: ShadingType.CLEAR },
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text, size: 21, bold: !!bold })] })]
  });
}
function twoColTable(head, rows, w1) {
  const w2 = CW - w1;
  return new Table({
    width: { size: CW, type: WidthType.DXA }, columnWidths: [w1, w2],
    rows: [
      new TableRow({ tableHeader: true, children: [headerCell(head[0], w1), headerCell(head[1], w2)] }),
      ...rows.map((r, i) => new TableRow({ children: [cell(r[0], w1, i, true), cell(r[1], w2, i)] }))
    ]
  });
}

// ── Image sizing ─────────────────────────────────────────────────────────────
const imgData = fs.readFileSync("RESQ_ER_Diagram.png");
const imgW = 640, imgH = Math.round(640 * 1722 / 3127); // keep aspect ratio

// ── Document ─────────────────────────────────────────────────────────────────
const doc = new Document({
  creator: "RESQ Project",
  title: "RESQ — Offline-First Disaster Communication Network",
  styles: {
    default: { document: { run: { font: "Calibri", size: 22, color: "222222" } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, color: NAVY, font: "Calibri" },
        paragraph: { spacing: { before: 300, after: 160 }, outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 25, bold: true, color: BLUE, font: "Calibri" },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
    ]
  },
  numbering: {
    config: [
      { reference: "bul", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 280 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1040, hanging: 280 } } } },
      ]},
    ]
  },
  sections: [{
    properties: {
      page: { size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 6 } },
        children: [
          new TextRun({ text: "RESQ — Offline-First Disaster Communication Network", size: 16, color: GREY }),
          new TextRun({ text: "          Page ", size: 16, color: GREY }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY }),
        ]
      })] })
    },
    children: [
      // ── TITLE PAGE ─────────────────────────────────────────────────────────
      new Paragraph({ spacing: { before: 1600 }, children: [] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
        children: [new TextRun({ text: "RESQ", bold: true, size: 80, color: RED })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 },
        children: [new TextRun({ text: "Offline-First Disaster Communication Network", bold: true, size: 36, color: NAVY })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
        children: [new TextRun({ text: "A Bluetooth-Mesh Mobile Application for Emergency Communication", italics: true, size: 26, color: GREY })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 },
        children: [new TextRun({ text: "When the internet, Wi-Fi and cellular towers fail — RESQ keeps people connected.", size: 22, color: "444444" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 },
        children: [new TextRun({ text: "PROJECT REPORT", bold: true, size: 28, color: BLUE })] }),
      new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "Department of Computer Science & Engineering", size: 22, color: "444444" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 },
        children: [new TextRun({ text: "Academic Year 2025 – 2026", size: 22, color: "444444" })] }),

      new Paragraph({ children: [new PageBreak()] }),

      // ── TABLE OF CONTENTS ──────────────────────────────────────────────────
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Table of Contents")] }),
      new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
      new Paragraph({ children: [new PageBreak()] }),

      // ── 1. OBJECTIVE ───────────────────────────────────────────────────────
      H1("1.  Objective"),
      P("The objective of the RESQ project is to design and build a mobile application that enables reliable communication during natural disasters and emergencies, precisely when conventional communication infrastructure — the internet, Wi-Fi routers, and cellular towers — has failed or become unavailable."),
      P("In disaster situations such as floods, earthquakes, fires, and building collapses, the network infrastructure people normally depend on is often the first thing to break down. Survivors and first responders are left unable to call for help, share their location, or coordinate relief. RESQ addresses this critical gap by removing the dependency on any central server or network operator."),
      P("The specific objectives of the project are:"),
      bullet("To establish a fully offline, device-to-device communication network using Bluetooth Low Energy (BLE) mesh, requiring no internet, Wi-Fi, or SIM card."),
      bullet("To allow messages to travel multiple hops — relaying automatically from phone to phone — so that two users out of direct range can still communicate through intermediate devices."),
      bullet("To protect private conversations with end-to-end encryption (E2EE), so that relay devices forwarding a message cannot read its contents."),
      bullet("To provide a one-touch SOS emergency broadcast that alerts every nearby device over the mesh and simultaneously notifies saved contacts through cellular SMS."),
      bullet("To enable sharing and live syncing of critical resources (medical supplies, water, food, shelter) across all devices in the mesh."),
      bullet("To deliver real-time phone notifications, an offline AI first-aid assistant, and GPS location sharing — all functioning without any network connection."),
      P("In short, the goal is a self-organising, resilient, privacy-preserving communication tool that works anywhere a phone has battery power, turning every smartphone into a node of an independent emergency network."),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 2. SOFTWARE & HARDWARE REQUIREMENTS ────────────────────────────────
      H1("2.  Software and Hardware Requirements"),

      H2("2.1  Software Requirements"),
      P("RESQ is built as a cross-platform mobile application using web technologies wrapped in a native Android shell. The software components used in its development and operation are listed below."),
      twoColTable(
        ["Component", "Specification / Purpose"],
        [
          ["Front-End", "HTML5, CSS3, and Vanilla JavaScript (ES6) — the complete user interface and app logic."],
          ["Native Bridge", "Capacitor 8 — packages the web app into a native Android application and exposes native device APIs."],
          ["Native Plugins", "Custom Java plugins for Bluetooth Mesh (BLE GATT), SMS, Contacts, BLE SOS beacon, and system notifications."],
          ["Encryption", "Web Crypto API — ECDH P-256 key exchange with AES-GCM-256 for end-to-end encryption (no external library)."],
          ["Local Database", "Browser localStorage — on-device key-value store for the user profile, messages, resources, keys and history."],
          ["Connectivity", "Bluetooth Low Energy (BLE) advertising, scanning and GATT server/client for the device-to-device mesh."],
          ["Build Tools", "Node.js, Gradle, and the Android SDK Build-Tools (compiles the signed APK)."],
          ["Operating System", "Android 6.0 (API 23) or higher on the device; Windows / macOS / Linux for development."],
          ["Version Control", "Git and GitHub for source-code management and collaboration."],
        ], 2400),

      H2("2.2  Hardware Requirements"),
      P("Because RESQ is designed for offline use in the field, its on-device hardware requirements are intentionally minimal — any modern Android smartphone is sufficient."),
      twoColTable(
        ["Hardware", "Minimum Requirement"],
        [
          ["Device", "Android smartphone (Android 6.0 / API 23 or above)."],
          ["Bluetooth", "Bluetooth 4.0 or higher with Bluetooth Low Energy (BLE) support — the core of the mesh network."],
          ["Processor", "Quad-core 1.2 GHz or above (standard on entry-level phones)."],
          ["Memory (RAM)", "2 GB or more."],
          ["Storage", "Approximately 10 MB of free space for the application and local data."],
          ["GPS Module", "Required for location sharing in SOS alerts and the live map."],
          ["Cellular Radio", "Optional — used only for the SMS fallback channel to reach contacts who are not on the mesh."],
          ["Development Machine", "PC/laptop with 8 GB RAM, Android Studio / SDK, and a USB cable or shared Wi-Fi for wireless debugging."],
        ], 2400),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 3. E-R DIAGRAM ─────────────────────────────────────────────────────
      H1("3.  Entity-Relationship (E-R) Diagram"),
      P("RESQ follows an offline-first architecture: there is no central database. Every device maintains its own independent copy of the data in local storage, and these copies are exchanged and merged with nearby devices over the Bluetooth mesh. The Entity-Relationship diagram below models the logical data entities, their attributes, and the relationships between them."),
      new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { before: 120, after: 100 },
        children: [new ImageRun({
          type: "png", data: imgData,
          transformation: { width: imgW, height: imgH },
          altText: { title: "RESQ E-R Diagram", name: "ER", description: "Entity-Relationship diagram of the RESQ data model" }
        })]
      }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
        children: [new TextRun({ text: "Figure 1: Entity-Relationship Diagram of the RESQ data model.", italics: true, size: 18, color: GREY })] }),

      H2("3.1  Key Entities"),
      bulletRich([new TextRun({ text: "USER ", bold: true, color: RED }), new TextRun({ text: "— the device owner / mesh node (userId, name, role, phone, zone).", size: 22 })]),
      bulletRich([new TextRun({ text: "CRYPTO_KEYPAIR ", bold: true, color: GREEN }), new TextRun({ text: "— the user’s ECDH key pair; the public key is shared, the private key never leaves the phone.", size: 22 })]),
      bulletRich([new TextRun({ text: "PEER & PEER_PUBKEY ", bold: true, color: BLUE }), new TextRun({ text: "— nearby devices discovered over BLE and the public keys they share for E2EE.", size: 22 })]),
      bulletRich([new TextRun({ text: "MESSAGE ", bold: true, color: BLUE }), new TextRun({ text: "— mesh messages (id, from, to, content, encrypted flag, TTL for multi-hop relay).", size: 22 })]),
      bulletRich([new TextRun({ text: "SOS_ALERT ", bold: true, color: RED }), new TextRun({ text: "— emergency broadcasts (alert type, message, GPS coordinates, timestamp).", size: 22 })]),
      bulletRich([new TextRun({ text: "RESOURCE ", bold: true, color: GREEN }), new TextRun({ text: "— shared supplies (name, type, quantity, status) merged across devices by last-write-wins.", size: 22 })]),
      bulletRich([new TextRun({ text: "CONTACT & SMS_MESSAGE ", bold: true, color: BLUE }), new TextRun({ text: "— phone contacts and the per-contact cellular-SMS conversation history.", size: 22 })]),
      bulletRich([new TextRun({ text: "OUTBOUND_QUEUE ", bold: true, color: "8957E5" }), new TextRun({ text: "— store-and-forward buffer holding messages until a peer comes into range.", size: 22 })]),

      H2("3.2  Key Relationships"),
      bullet("A USER owns exactly one CRYPTO_KEYPAIR (1 : 1) and discovers many PEERs over Bluetooth (many : many)."),
      bullet("A USER sends many MESSAGEs, broadcasts many SOS_ALERTs, owns many RESOURCEs, and saves many CONTACTs (1 : many)."),
      bullet("Each PEER provides one PEER_PUBKEY, which enables an encrypted conversation that relay devices cannot read."),
      bullet("Each CONTACT has a separate SMS_MESSAGE thread sent over cellular SMS (1 : many)."),
      bullet("MESSAGE and SOS_ALERT records are buffered in the OUTBOUND_QUEUE and relayed device-to-device with a hop limit (TTL) and de-duplication."),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 4. CONCLUSION & FUTURE SCOPE ───────────────────────────────────────
      H1("4.  Conclusion and Future Scope"),

      H2("4.1  Conclusion"),
      P("The RESQ project successfully demonstrates that reliable communication is possible even after the complete failure of conventional networks. By turning ordinary smartphones into nodes of a self-organising Bluetooth mesh, the application allows people to exchange messages, broadcast SOS alerts, and share critical resources without any internet, Wi-Fi, or cellular tower."),
      P("The system was implemented and tested successfully on two physical Android devices. The phones automatically discovered each other over Bluetooth Low Energy, exchanged public keys, and held a two-way, end-to-end encrypted conversation — confirming that relay devices forward ciphertext they cannot read. SOS alerts reached every nearby device over the mesh while simultaneously notifying saved contacts via SMS, resource updates synchronised across devices, and real-time notifications were delivered to the phone’s notification tray."),
      P("Key achievements of the project include:"),
      bullet("A working multi-hop Bluetooth mesh with automatic peer discovery and store-and-forward relaying."),
      bullet("End-to-end encryption (ECDH + AES-GCM) implemented entirely on-device with no external dependency."),
      bullet("A complete offline feature set: private chat, broadcast, SOS, resource sharing, SMS-to-contacts, an offline AI first-aid assistant, GPS, and system notifications."),
      bullet("A genuinely offline-first architecture with on-device storage and device-to-device synchronisation — no servers, no cloud, no running costs."),

      H2("4.2  Future Scope"),
      P("RESQ provides a strong foundation that can be extended in several directions to increase its range, capability, and reach:"),
      bullet("Long-range hardware: integrating LoRa radio modules to extend each hop from ~100 metres to several kilometres for sparse or rural disaster zones."),
      bullet("Wider mesh: optimising the routing protocol to support a larger number of simultaneous devices and more relay hops with intelligent path selection."),
      bullet("Group communication: encrypted group channels and zone-based broadcast rooms for coordinated relief teams."),
      bullet("Rich media: support for sending photos, voice messages, and small files over the mesh using chunked, resumable transfers."),
      bullet("Background operation: a foreground service so the mesh keeps relaying and receiving even when the app is closed or the screen is off."),
      bullet("Cross-platform support: an iOS version and a desktop relay node to bridge separate clusters of devices."),
      bullet("Map intelligence: an offline map that plots nearby peers, SOS locations, and available resources in real time."),
      bullet("Resilience features: battery-aware power-saving modes and message prioritisation so that emergency traffic is always delivered first."),
      P("With these enhancements, RESQ can evolve from a functional prototype into a deployable, life-saving communication platform for disaster-affected communities worldwide.", { bold: false, italics: true }),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("RESQ_Project_Report.docx", buffer);
  console.log("saved RESQ_Project_Report.docx");
});
