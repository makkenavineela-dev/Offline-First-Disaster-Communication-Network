"""
RESQ — SE-AAT Model Diagrams Generator
Generates 8 diagrams + compiles them into a professional PDF
"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, Ellipse
import numpy as np
import os

from reportlab.lib.pagesizes import A4
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Image,
                                 PageBreak, Table, TableStyle, HRFlowable)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT

# ── Paths ────────────────────────────────────────────────────────────────────
BASE = r"C:\Users\dell\Desktop\Offline-First-Disaster-Communication-Network"
IMGS = os.path.join(BASE, "docs", "diagram_images")
os.makedirs(IMGS, exist_ok=True)

# ── Colour palette ───────────────────────────────────────────────────────────
C_BLUE   = '#1565C0'
C_DBLUE  = '#0D47A1'
C_GREEN  = '#2E7D32'
C_RED    = '#C62828'
C_ORANGE = '#E65100'
C_PURPLE = '#6A1B9A'
C_TEAL   = '#00838F'
C_AMBER  = '#F57F17'
C_LBLUE  = '#E3F2FD'
C_LGREY  = '#F5F5F5'
C_GREY   = '#546E7A'


# ── Shared drawing helpers ───────────────────────────────────────────────────
def save(fig, name):
    p = os.path.join(IMGS, f"{name}.png")
    fig.savefig(p, dpi=150, bbox_inches='tight', facecolor='white', edgecolor='none')
    plt.close(fig)
    return p


def fbox(ax, cx, cy, w, h, text, fc=C_BLUE, tc='white', fs=8.5,
         fw='bold', style='round,pad=0.1', zorder=3, lw=1.5, ec='#37474F'):
    ax.add_patch(FancyBboxPatch((cx - w/2, cy - h/2), w, h,
                                boxstyle=style, facecolor=fc,
                                edgecolor=ec, linewidth=lw, zorder=zorder))
    ax.text(cx, cy, text, fontsize=fs, ha='center', va='center',
            color=tc, fontweight=fw, zorder=zorder+1, multialignment='center')


def diamond(ax, cx, cy, w, h, text, fc=C_AMBER, tc='white', fs=8):
    pts = np.array([(cx, cy+h/2), (cx+w/2, cy),
                    (cx, cy-h/2), (cx-w/2, cy)])
    ax.add_patch(plt.Polygon(pts, facecolor=fc, edgecolor='#37474F', lw=1.5, zorder=3))
    ax.text(cx, cy, text, fontsize=fs, ha='center', va='center',
            color=tc, fontweight='bold', zorder=4, multialignment='center')


def arr(ax, x1, y1, x2, y2, col='#37474F', lw=1.8, style='->', ls='solid'):
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle=style, color=col, lw=lw,
                                linestyle=ls))


def actor(ax, cx, cy, label, col=C_BLUE, fs=8):
    ax.add_patch(plt.Circle((cx, cy+0.42), 0.16, facecolor=col, zorder=5))
    ax.plot([cx, cx],        [cy+0.26, cy-0.20], color=col, lw=2, zorder=5)
    ax.plot([cx-0.24, cx+0.24], [cy+0.06, cy+0.06], color=col, lw=2, zorder=5)
    ax.plot([cx, cx-0.18],   [cy-0.20, cy-0.55], color=col, lw=2, zorder=5)
    ax.plot([cx, cx+0.18],   [cy-0.20, cy-0.55], color=col, lw=2, zorder=5)
    ax.text(cx, cy-0.72, label, fontsize=fs, ha='center', va='top',
            color=col, fontweight='bold', multialignment='center')


# ════════════════════════════════════════════════════════════════════════════
# 1. CONTEXT DIAGRAM
# ════════════════════════════════════════════════════════════════════════════
def draw_context():
    fig, ax = plt.subplots(figsize=(14, 11))
    ax.set_xlim(0, 14); ax.set_ylim(0, 11); ax.axis('off')
    fig.patch.set_facecolor('white')
    ax.text(7, 10.6, '1.  Context Diagram — RESQ Disaster Communication System',
            fontsize=14, fontweight='bold', color=C_BLUE, ha='center')

    # ── central system circle ──
    ax.add_patch(plt.Circle((7, 5.2), 1.85, facecolor=C_BLUE,
                             edgecolor=C_DBLUE, lw=3, zorder=3))
    ax.text(7, 5.45, 'RESQ', fontsize=17, fontweight='bold',
            color='white', ha='center', va='center', zorder=4)
    ax.text(7, 4.90, 'SYSTEM', fontsize=10, color='#BBDEFB',
            ha='center', va='center', zorder=4)

    # ── external entities (x, y, name, colour, flow_label) ──
    EW, EH = 2.3, 0.90
    ents = [
        (2.2, 9.4,  'Civilian User',         C_GREEN,  'SOS / Messages\nResources'),
        (7.0, 9.7,  'First Responder',        C_BLUE,   'Broadcast Alerts\nCoordination'),
        (11.8,9.4,  'Coordinator',            C_PURPLE, 'Network Config\nManagement'),
        (0.9, 5.2,  'Medical Officer',        '#558B2F', 'Medical Resources\nTriage Info'),
        (13.1,5.2,  'Peer Backend\n(Gossip)', '#4527A0', 'Cross-zone Relay\nMessages'),
        (2.2, 1.2,  'Cellular SMS\nGateway',  C_ORANGE, 'SMS → Off-mesh\nContacts'),
        (7.0, 0.6,  'GPS / Location\nServices',C_TEAL,  'lat / lng / accuracy'),
        (11.8,1.2,  'Bluetooth BLE\nMesh',    C_RED,    'Peer discovery\nKey exchange\nMessage relay'),
    ]

    for (ex, ey, name, col, flow) in ents:
        ax.add_patch(FancyBboxPatch((ex-EW/2, ey-EH/2), EW, EH,
                                    boxstyle='round,pad=0.08',
                                    facecolor=col, edgecolor='white', lw=2, zorder=3))
        ax.text(ex, ey, name, fontsize=8.5, fontweight='bold', color='white',
                ha='center', va='center', zorder=4, multialignment='center')

        dx, dy = 7-ex, 5.2-ey
        ln = np.hypot(dx, dy); nx, ny = dx/ln, dy/ln
        sx = ex + nx*(EW/2+0.05);  sy = ey + ny*(EH/2+0.05)
        ex2 = 7 - nx*1.88;         ey2 = 5.2 - ny*1.88
        ax.annotate('', xy=(ex2, ey2), xytext=(sx, sy),
                    arrowprops=dict(arrowstyle='<->', color=C_GREY, lw=1.8), zorder=2)
        mx = (sx+ex2)/2 - ny*0.30;  my = (sy+ey2)/2 + nx*0.30
        ax.text(mx, my, flow, fontsize=6, color='#37474F', ha='center',
                style='italic',
                bbox=dict(facecolor='white', edgecolor='none', alpha=0.85, pad=1.5),
                zorder=5)

    return save(fig, '1_context')


# ════════════════════════════════════════════════════════════════════════════
# 2. USE-CASE DIAGRAM
# ════════════════════════════════════════════════════════════════════════════
def draw_usecase():
    fig, ax = plt.subplots(figsize=(16, 14))
    ax.set_xlim(0, 16); ax.set_ylim(0, 14); ax.axis('off')
    fig.patch.set_facecolor('white')
    ax.text(8, 13.6, '2.  Use Case Diagram — RESQ System',
            fontsize=14, fontweight='bold', color=C_BLUE, ha='center')

    # system boundary
    ax.add_patch(FancyBboxPatch((3.2, 0.4), 9.6, 12.6, boxstyle='square,pad=0',
                                facecolor='#F0F7FF', edgecolor=C_BLUE, lw=2.5, zorder=1))
    ax.text(8, 12.7, '« RESQ System »', fontsize=9, color=C_BLUE,
            ha='center', style='italic')

    # use-cases (cx, cy, label)
    UCS = [
        (8.0, 11.9, 'UC-01  Register / Login'),
        (8.0, 10.9, 'UC-02  Generate E2EE Keypair'),
        (5.5, 9.85, 'UC-03  Send SOS Alert'),
        (10.5,9.85, 'UC-04  Broadcast SOS\n(Mesh + SMS)'),
        (5.5, 8.70, 'UC-05  Send Encrypted\nDirect Message'),
        (10.5,8.70, 'UC-06  Relay Messages\n(Store-and-Forward)'),
        (5.5, 7.55, 'UC-07  Share / Update\nResources'),
        (10.5,7.55, 'UC-08  View Network Map\n& Peer List'),
        (5.5, 6.40, 'UC-09  Send SMS to\nOff-Mesh Contact'),
        (10.5,6.40, 'UC-10  View & Ack Alerts'),
        (5.5, 5.25, 'UC-11  Manage Emergency\nContacts'),
        (10.5,5.25, 'UC-12  Configure\nPreferences'),
        (8.0, 4.10, 'UC-13  View Merged\nResource Inventory'),
        (8.0, 2.95, 'UC-14  Offline Queue\nManagement'),
    ]
    uc_pos = {}
    for cx, cy, lbl in UCS:
        ax.add_patch(Ellipse((cx, cy), 3.5, 0.80,
                             facecolor=C_LBLUE, edgecolor=C_BLUE, lw=1.5, zorder=2))
        ax.text(cx, cy, lbl, fontsize=7.5, ha='center', va='center',
                color=C_DBLUE, fontweight='bold', zorder=3, multialignment='center')
        uc_pos[lbl] = (cx, cy)

    # actors (cx, cy, label, colour, connected UC labels)
    ACTORS = [
        (1.3, 7.8, 'Civilian\nUser', C_GREEN, [
            'UC-01  Register / Login',
            'UC-03  Send SOS Alert',
            'UC-05  Send Encrypted\nDirect Message',
            'UC-07  Share / Update\nResources',
            'UC-09  Send SMS to\nOff-Mesh Contact',
            'UC-11  Manage Emergency\nContacts']),
        (1.3, 3.5, 'Medical\nOfficer', '#558B2F', [
            'UC-07  Share / Update\nResources',
            'UC-13  View Merged\nResource Inventory']),
        (14.7,7.8, 'First\nResponder', C_BLUE, [
            'UC-03  Send SOS Alert',
            'UC-04  Broadcast SOS\n(Mesh + SMS)',
            'UC-08  View Network Map\n& Peer List',
            'UC-10  View & Ack Alerts']),
        (14.7,3.5, 'Coordinator', C_PURPLE, [
            'UC-08  View Network Map\n& Peer List',
            'UC-12  Configure\nPreferences',
            'UC-13  View Merged\nResource Inventory',
            'UC-14  Offline Queue\nManagement']),
    ]
    for ax_x, ax_y, lbl, col, ucs in ACTORS:
        actor(ax, ax_x, ax_y, lbl, col=col, fs=8)
        for uc in ucs:
            if uc not in uc_pos:
                continue
            ux, uy = uc_pos[uc]
            dx, dy = ux-ax_x, uy-ax_y
            ln = np.hypot(dx, dy)
            if ln == 0:
                continue
            ex_e = ux - (dx/ln)*1.75;  ey_e = uy - (dy/ln)*0.42
            ax.plot([ax_x, ex_e], [ax_y, ey_e], color=col, lw=1, alpha=0.55, zorder=2)

    # «include» UC-01 → UC-02
    arr(ax, 8, 11.55, 8, 11.30, col='#90A4AE', lw=1.2, ls='dashed')
    ax.text(8.15, 11.42, '«include»', fontsize=6.5, color='#78909C', style='italic')

    # «extend» UC-03 → UC-04
    arr(ax, 5.5+1.75, 9.85, 10.5-1.75, 9.85, col='#90A4AE', lw=1.2, ls='dashed')
    ax.text(8, 9.97, '«extend»', fontsize=6.5, color='#78909C', ha='center', style='italic')

    return save(fig, '2_usecase')


# ════════════════════════════════════════════════════════════════════════════
# 3. ACTIVITY DIAGRAM
# ════════════════════════════════════════════════════════════════════════════
def draw_activity():
    fig, ax = plt.subplots(figsize=(11, 16))
    ax.set_xlim(0, 11); ax.set_ylim(5.5, 20); ax.axis('off')
    fig.patch.set_facecolor('white')
    ax.text(5.5, 19.6, '3.  Activity Diagram — Send Message (RESQ)',
            fontsize=13, fontweight='bold', color=C_BLUE, ha='center')

    BW, BH = 3.6, 0.65   # normal box
    DW, DH = 3.2, 0.80   # diamond

    # ── start ──
    ax.add_patch(plt.Circle((5.5, 19.1), 0.28, facecolor='#212121', zorder=4))

    # helper: centre-spine vertical arrow
    def va(y1, y2): arr(ax, 5.5, y1, 5.5, y2)

    # 1. Launch App
    y = 18.35
    fbox(ax, 5.5, y, BW, BH, 'Launch RESQ App', fc=C_BLUE)
    va(19.1-0.28, y+BH/2)

    # 2. Registered?
    y -= 1.15
    diamond(ax, 5.5, y, DW, DH, 'Is User\nRegistered?')
    va(18.35-BH/2, y+DH/2)

    # No branch → Register
    fbox(ax, 2.0, y, 2.5, BH, 'Show\nRegistration\nForm', fc=C_ORANGE)
    arr(ax, 5.5-DW/2, y, 2.0+1.25, y, col=C_ORANGE)
    ax.text(3.9, y+0.14, 'No', fontsize=8, color=C_ORANGE, ha='center')

    fbox(ax, 2.0, y-0.95, 2.5, BH, 'Generate\nE2EE Keypair', fc=C_ORANGE)
    arr(ax, 2.0, y-BH/2, 2.0, y-0.95+BH/2, col=C_ORANGE)
    # rejoin to centre
    ax.annotate('', xy=(5.5-BW/2, y-1.15), xytext=(2.0+1.25, y-0.95),
                arrowprops=dict(arrowstyle='->', color=C_ORANGE, lw=1.5))

    # Yes
    ax.text(5.65, y-0.22, 'Yes', fontsize=8, color=C_GREEN)

    # 3. Open Chat
    y -= 1.15
    fbox(ax, 5.5, y, BW, BH, 'Open Chat / Contacts', fc=C_BLUE)
    va(y+1.15-BH/2-0.28, y+BH/2)   # gap already covered by No-branch merge

    # 4. Select Contact
    y -= 1.0
    fbox(ax, 5.5, y, BW, BH, 'Select Contact', fc=C_BLUE)
    va(y+1.0-BH/2, y+BH/2)

    # 5. Type Message
    y -= 1.0
    fbox(ax, 5.5, y, BW, BH, 'Type Message & Tap Send', fc=C_BLUE)
    va(y+1.0-BH/2, y+BH/2)

    # 6. E2EE enabled?
    y -= 1.1
    diamond(ax, 5.5, y, DW, DH, 'E2EE Enabled\n& Peer Key Known?')
    va(y+1.1-BH/2, y+DH/2)

    # Yes → Encrypt
    fbox(ax, 8.8, y, 2.8, BH, 'ECDH Key Derive\n+AES-GCM Encrypt', fc=C_GREEN)
    arr(ax, 5.5+DW/2, y, 8.8-1.4, y, col=C_GREEN)
    ax.text(7.0, y+0.14, 'Yes', fontsize=8, color=C_GREEN, ha='center')

    # No → Plaintext
    fbox(ax, 2.2, y, 2.5, BH, 'Keep as\nPlaintext', fc=C_AMBER, tc='white')
    arr(ax, 5.5-DW/2, y, 2.2+1.25, y, col=C_AMBER)
    ax.text(3.9, y+0.14, 'No', fontsize=8, color=C_AMBER, ha='center')

    # 7. BLE peer in range?
    y -= 1.1
    diamond(ax, 5.5, y, DW, DH, 'BLE Peer\nIn Range?')
    # merge from both encrypt paths
    ax.plot([8.8, 8.8, 5.5+DW/2+0.01], [y+1.1-BH/2, y+DH/2, y+DH/2],
            color=C_GREEN, lw=1.5)
    ax.plot([2.2, 2.2, 5.5-DW/2-0.01], [y+1.1-BH/2, y+DH/2, y+DH/2],
            color=C_AMBER, lw=1.5)
    va(y+1.1-DH/2-0.38, y+DH/2)   # main spine

    # Yes → BLE Write
    fbox(ax, 8.8, y, 2.8, BH, 'BLE GATT Write\n(deliver now)', fc=C_GREEN)
    arr(ax, 5.5+DW/2, y, 8.8-1.4, y, col=C_GREEN)
    ax.text(7.0, y+0.14, 'Yes', fontsize=8, color=C_GREEN, ha='center')

    # No → Queue
    fbox(ax, 2.2, y, 2.5, BH, 'Enqueue in\nresq_bt_queue', fc=C_RED)
    arr(ax, 5.5-DW/2, y, 2.2+1.25, y, col=C_RED)
    ax.text(3.9, y+0.14, 'No', fontsize=8, color=C_RED, ha='center')

    # 8. Recipient Decrypts
    y -= 1.1
    fbox(ax, 5.5, y, BW, BH, 'Recipient Decrypts\n& Shows Message', fc=C_BLUE)
    ax.plot([8.8, 8.8, 5.5+BW/2+0.01], [y+1.1-BH/2, y+BH/2, y+BH/2], color=C_GREEN, lw=1.5)
    ax.plot([2.2, 2.2, 5.5-BW/2-0.01], [y+1.1-BH/2, y+BH/2, y+BH/2], color=C_RED, lw=1.5)

    # 9. Trigger Notification
    y -= 1.0
    fbox(ax, 5.5, y, BW, BH, 'Trigger Push Notification', fc=C_BLUE)
    va(y+1.0-BH/2, y+BH/2)

    # 10. Stamp Read Receipt
    y -= 1.0
    fbox(ax, 5.5, y, BW, BH, 'Stamp Read Receipt\n(resq_read_map)', fc=C_BLUE)
    va(y+1.0-BH/2, y+BH/2)

    # ── end ──
    y -= 0.85
    ax.add_patch(plt.Circle((5.5, y), 0.30, facecolor='white',
                             edgecolor='#212121', lw=2.5, zorder=4))
    ax.add_patch(plt.Circle((5.5, y), 0.19, facecolor='#212121', zorder=5))
    va(y+1.0-BH/2-0.15, y+0.30)

    return save(fig, '3_activity')


# ════════════════════════════════════════════════════════════════════════════
# 4. ARCHITECTURE DIAGRAM
# ════════════════════════════════════════════════════════════════════════════
def draw_architecture():
    fig, ax = plt.subplots(figsize=(15, 12))
    ax.set_xlim(0, 15); ax.set_ylim(0, 12); ax.axis('off')
    fig.patch.set_facecolor('white')
    ax.text(7.5, 11.65, '4.  Architecture Diagram — RESQ System',
            fontsize=14, fontweight='bold', color=C_BLUE, ha='center')

    layers = [
        # (y_bottom, height, title, bg, border, [(label, cx)])
        (9.6,  1.9, 'LAYER 1 — PRESENTATION', '#E3F2FD', C_BLUE, [
            ('Auth /\nRegister', 2.0), ('Messaging\nUI', 5.2),
            ('SOS Alert\nScreen', 8.4), ('Resources\nScreen', 11.6),
            ('Network\nMap', 14.0-1.0)]),
        (7.1,  1.9, 'LAYER 2 — APPLICATION LOGIC', '#E8F5E9', C_GREEN, [
            ('JWT Auth\n(authMiddleware)', 2.2), ('E2EE Crypto\n(crypto-e2ee.js)', 5.5),
            ('Message Ctrl\n(messageController)', 8.5), ('Resource Ctrl\n(resourceController)', 11.8),
            ('SOS Handler\n(socketHandler)', 14.0-1.0)]),
        (4.6,  1.9, 'LAYER 3 — MESH COMMUNICATION', '#FFF3E0', C_ORANGE, [
            ('BLE GATT\n(bluetooth-mesh.js)', 2.5), ('WiFi Mesh\n(Socket.io)', 5.8),
            ('SMS Gateway\n(notifications.js)', 9.2), ('Peer Gossip\n(peerGossip.js)', 12.8)]),
        (2.1,  1.9, 'LAYER 4 — DATA PERSISTENCE', '#FCE4EC', C_RED, [
            ('localStorage\n(Messages / SOS\n/ Resources)', 3.2),
            ('Outbound Queue\n(resq_bt_queue)', 7.5),
            ('E2EE Key Store\n(resq_e2ee_peers)', 11.8)]),
        (0.1,  1.6, 'LAYER 5 — BACKEND INFRASTRUCTURE  (Node.js + MongoDB)', '#EDE7F6', '#4527A0', [
            ('Express REST API\n(auth / message\n/ resource routes)', 3.2),
            ('MongoDB\n(User, Message\nResource models)', 7.5),
            ('Cron Jobs +\nSwagger Docs', 12.0)]),
    ]

    for (yb, h, title, bg, bdr, comps) in layers:
        # layer background
        ax.add_patch(FancyBboxPatch((0.2, yb), 14.6, h, boxstyle='round,pad=0.1',
                                    facecolor=bg, edgecolor=bdr, lw=2, zorder=1))
        # title header strip (solid band across top of layer)
        TITLE_H = 0.42
        ax.add_patch(FancyBboxPatch((0.2, yb+h-TITLE_H), 14.6, TITLE_H,
                                    boxstyle='square,pad=0',
                                    facecolor=bdr, edgecolor=bdr, lw=0, zorder=2))
        ax.text(7.5, yb+h-TITLE_H/2, title, fontsize=9, fontweight='bold',
                color='white', ha='center', va='center', zorder=3)
        # component boxes below the title strip
        ch = h - TITLE_H - 0.30
        for (lbl, cx) in comps:
            ax.add_patch(FancyBboxPatch((cx-1.45, yb+0.15), 2.9, ch,
                                        boxstyle='round,pad=0.07',
                                        facecolor=bdr, edgecolor='white', lw=1.5, zorder=2,
                                        alpha=0.85))
            ax.text(cx, yb+0.15+ch/2, lbl, fontsize=7.5, fontweight='bold',
                    color='white', ha='center', va='center', zorder=3,
                    multialignment='center')

    # vertical arrows between layers
    for ya in [9.6, 7.1, 4.6, 2.1]:
        ax.annotate('', xy=(7.5, ya+1.9-0.05), xytext=(7.5, ya+0.08),
                    arrowprops=dict(arrowstyle='<->', color=C_GREY, lw=2.5))

    ax.text(0.4, 0.0,
            '  Users (Mobile Browser)  |  BLE Devices  |  Cellular Network  |  GPS  |  Peer Backends',
            fontsize=8.5, color=C_GREY, style='italic')

    return save(fig, '4_architecture')


# ════════════════════════════════════════════════════════════════════════════
# 5. CLASS DIAGRAM
# ════════════════════════════════════════════════════════════════════════════
def draw_class():
    fig, ax = plt.subplots(figsize=(20, 15))
    ax.set_xlim(0, 20); ax.set_ylim(0, 15); ax.axis('off')
    fig.patch.set_facecolor('white')
    ax.text(10, 14.65, '5.  Class Diagram — RESQ System',
            fontsize=14, fontweight='bold', color=C_BLUE, ha='center')

    def uml(cx, cy, name, attrs, meths, fc=C_BLUE, w=3.5):
        hn = 0.55
        ha_ = len(attrs)*0.30 + 0.18
        hm = len(meths)*0.30 + 0.18
        th = hn + ha_ + hm
        yt = cy + th/2

        # name band
        ax.add_patch(FancyBboxPatch((cx-w/2, yt-hn), w, hn, boxstyle='square,pad=0',
                                    facecolor=fc, edgecolor='#37474F', lw=1.5))
        ax.text(cx, yt-hn/2, name, fontsize=9, fontweight='bold',
                color='white', ha='center', va='center')

        # attributes
        ya = yt-hn
        ax.add_patch(FancyBboxPatch((cx-w/2, ya-ha_), w, ha_, boxstyle='square,pad=0',
                                    facecolor='#F5F5F5', edgecolor='#37474F', lw=1.5))
        for i, a in enumerate(attrs):
            ax.text(cx-w/2+0.12, ya-0.10-i*0.30, a, fontsize=6.5,
                    color='#212121', va='top', fontfamily='monospace')

        # methods
        ym = ya-ha_
        ax.add_patch(FancyBboxPatch((cx-w/2, ym-hm), w, hm, boxstyle='square,pad=0',
                                    facecolor='white', edgecolor='#37474F', lw=1.5))
        for i, m in enumerate(meths):
            ax.text(cx-w/2+0.12, ym-0.10-i*0.30, m, fontsize=6.5,
                    color=C_BLUE, va='top', fontfamily='monospace')

        return cy-th/2, cy+th/2   # bottom_y, top_y

    def assoc(x1,y1,x2,y2,lbl,m1='',m2=''):
        ax.plot([x1,x2],[y1,y2], color=C_GREY, lw=1.5, zorder=0)
        mx=(x1+x2)/2;  my=(y1+y2)/2
        ax.text(mx, my+0.14, lbl, fontsize=6.5, color='#37474F', ha='center',
                style='italic',
                bbox=dict(facecolor='white', edgecolor='none', alpha=0.9, pad=1))
        if m1: ax.text(x1+(x2-x1)*0.05, y1+(y2-y1)*0.05+0.13, m1, fontsize=7, color=C_RED, fontweight='bold')
        if m2: ax.text(x2-(x2-x1)*0.05, y2-(y2-y1)*0.05+0.13, m2, fontsize=7, color=C_RED, fontweight='bold')

    uml(2.2, 11.2, 'User',
        ['- userId : String', '- name : String', '- role : String',
         '- phone : String', '- zone : String', '- verified : Boolean'],
        ['+ register() : void', '+ login() : String',
         '+ generateKeypair() : void', '+ getProfile() : User'], fc=C_BLUE)

    uml(7.0, 11.2, 'CryptoKeyPair',
        ['- userId : String', '- publicKey : String',
         '- privateKey : String', '- algorithm : String'],
        ['+ generate() : void', '+ deriveSecret(pub) : CryptoKey',
         '+ encrypt(msg, key) : String', '+ decrypt(cipher, key) : String'], fc=C_GREEN)

    uml(12.0, 11.2, 'Peer',
        ['- userId : String', '- name : String', '- rssi : Number',
         '- hasKey : Boolean', '- bleAddr : String', '- lastSeen : Number'],
        ['+ connect() : Promise', '+ disconnect() : void',
         '+ exchangeKey() : void', '+ getSignal() : Number'], fc=C_PURPLE)

    uml(17.2, 11.2, 'Message',
        ['- id : String', '- fromUserId : String', '- toUserId : String',
         '- content : String', '- enc : Boolean', '- ttl : Number', '- timestamp : Number'],
        ['+ send() : void', '+ relay() : void',
         '+ encrypt(key) : void', '+ decrypt(key) : void',
         '+ isExpired() : Boolean'], fc=C_ORANGE)

    uml(2.2,  5.5, 'SOSAlert',
        ['- id : String', '- fromUserId : String', '- alertType : String',
         '- message : String', '- lat : Number', '- lng : Number', '- timestamp : Number'],
        ['+ broadcast() : void', '+ relay(ttl) : void',
         '+ sendSMS(contacts) : void', '+ acknowledge() : void'], fc=C_RED)

    uml(7.0,  5.5, 'Resource',
        ['- _id : String', '- name : String', '- type : String',
         '- quantity : Number', '- status : String',
         '- ownerId : String', '- updatedAt : Number'],
        ['+ update() : void', '+ sync() : void',
         '+ merge(remote) : Resource', '+ broadcast() : void'], fc=C_TEAL)

    uml(12.0, 5.5, 'Contact',
        ['- phone : String', '- name : String', '- source : String'],
        ['+ sendSMS(text) : void',
         '+ getThread() : SMS[]', '+ addToEmergency() : void'], fc='#558B2F')

    uml(17.2, 5.5, 'OutboundQueue',
        ['- id : String', '- type : String',
         '- payload : String', '- queuedAt : Number'],
        ['+ enqueue(item) : void', '+ flush(peerId) : void',
         '+ dequeue(id) : void', '+ size() : Number'], fc='#4527A0')

    # associations
    assoc(3.95, 11.2, 5.25, 11.2, 'owns (E2EE)', '1', '1')
    assoc(2.2,  8.95, 2.2,  7.85, 'broadcasts',   '1', '*')
    assoc(2.2,  8.95, 7.0,  7.85, 'owns',          '1', '*')
    assoc(3.95, 11.2, 15.45,11.2, 'sends',          '1', '*')
    assoc(10.25,11.2, 15.45,11.2, 'discovers',      '*', '*')
    assoc(17.2, 8.95, 17.2, 7.85, 'queued via',     '1', '0..*')

    return save(fig, '5_class')


# ════════════════════════════════════════════════════════════════════════════
# 6. SEQUENCE DIAGRAM
# ════════════════════════════════════════════════════════════════════════════
def draw_sequence():
    fig, ax = plt.subplots(figsize=(17, 15))
    ax.set_xlim(0, 17); ax.set_ylim(0, 15); ax.axis('off')
    fig.patch.set_facecolor('white')
    ax.text(8.5, 14.65, '6.  Sequence Diagram — E2EE Messaging over BLE Mesh',
            fontsize=13, fontweight='bold', color=C_BLUE, ha='center')

    parts = [
        (1.4,  'Alice\n(User)',        C_GREEN),
        (4.2,  'RESQ App A\n(Phone A)',C_BLUE),
        (7.2,  'BLE GATT\nServer A',  C_ORANGE),
        (10.2, 'BLE GATT\nServer B',  C_ORANGE),
        (13.2, 'RESQ App B\n(Phone B)',C_BLUE),
        (16.0, 'Bob\n(User)',          C_GREEN),
    ]
    TOP = 14.1; BOT = 0.3

    for (px, lbl, pc) in parts:
        bw = 2.0 if 'App' in lbl or 'GATT' in lbl else 1.5
        ax.add_patch(FancyBboxPatch((px-bw/2, TOP-0.38), bw, 0.75,
                                    boxstyle='round,pad=0.06',
                                    facecolor=pc, edgecolor='white', lw=1.5, zorder=3))
        ax.text(px, TOP, lbl, fontsize=7, fontweight='bold', color='white',
                ha='center', va='center', zorder=4, multialignment='center')
        ax.plot([px,px],[TOP-0.38, BOT], color='#B0BEC5', lw=1.5,
                linestyle='dashed', zorder=1)

    y = TOP-0.38

    def msg(y, x1, x2, lbl, col='#37474F', ret=False):
        sty = '<-' if ret else '->'
        ls  = 'dashed' if ret else 'solid'
        ax.annotate('', xy=(x2, y), xytext=(x1, y),
                    arrowprops=dict(arrowstyle=sty, color=col, lw=1.8, linestyle=ls))
        ax.text((x1+x2)/2, y+0.08, lbl, fontsize=7, ha='center', va='bottom',
                color=col, fontweight='bold' if not ret else 'normal',
                bbox=dict(facecolor='white', edgecolor='none', alpha=0.92, pad=1))

    def note(y, cx, txt, w=2.8, fc='#FFF9C4', bc='#F9A825'):
        ax.add_patch(FancyBboxPatch((cx-w/2, y-0.25), w, 0.50,
                                    boxstyle='round,pad=0.06',
                                    facecolor=fc, edgecolor=bc, lw=1, zorder=4))
        ax.text(cx, y, txt, fontsize=6.5, ha='center', va='center',
                color='#4E342E', zorder=5, multialignment='center')

    def phase(y, lbl):
        ax.add_patch(FancyBboxPatch((0.1, y-0.24), 16.8, 0.48, boxstyle='square,pad=0',
                                    facecolor='#E8EAF6', edgecolor='#3949AB', lw=1, alpha=0.8))
        ax.text(8.5, y, lbl, fontsize=8.5, fontweight='bold', ha='center',
                va='center', color='#1A237E')

    # ── Phase 1 ──
    y -= 0.55
    phase(y, 'Phase 1 — BLE Peer Discovery & Key Exchange')

    y -= 0.60; msg(y, 4.2, 7.2, 'startAdvertising(userId, name)')
    y -= 0.52; msg(y, 13.2, 10.2,'startAdvertising(userId, name)')
    y -= 0.52; msg(y, 4.2, 10.2, 'BLE scan → connect GATT')
    y -= 0.52; msg(y, 10.2, 4.2, 'connected ✓', col=C_GREEN, ret=True)
    y -= 0.52; msg(y, 4.2, 10.2, 'write(pubKey_Alice)')
    y -= 0.52; msg(y, 10.2, 13.2,'onWrite(pubKey_Alice)')
    y -= 0.52; msg(y, 13.2, 4.2, 'read(pubKey_Bob)', col=C_GREY, ret=True)
    y -= 0.52
    note(y, 4.2,  'Store: resq_e2ee_peers\n[Bob → pubKey_Bob]')
    note(y, 13.2, 'Store: resq_e2ee_peers\n[Alice → pubKey_Alice]')

    # ── Phase 2 ──
    y -= 0.65
    phase(y, 'Phase 2 — Encrypted Message Transmission')

    y -= 0.62; msg(y, 1.4, 4.2, 'type: "Meet at shelter 3"', col=C_GREEN)
    y -= 0.52; note(y, 4.6, 'ECDH(Alice.priv × Bob.pub)\n→ sharedSecret', w=3.0, fc='#E8F5E9', bc=C_GREEN)
    y -= 0.52; note(y, 4.6, 'AES-GCM-256 encrypt(msg)\n→ ciphertext', w=3.0, fc='#E8F5E9', bc=C_GREEN)
    y -= 0.52; msg(y, 4.2, 7.2, 'BLE write( MESSAGE{enc:true, ttl:5} )')
    y -= 0.52; msg(y, 7.2, 10.2, 'BLE relay → Server B')
    y -= 0.52; msg(y, 10.2, 13.2,'onCharacteristicWrite( MESSAGE )')
    y -= 0.52; note(y, 12.8,'dedup ✓ new | AES-GCM\ndecrypt → plaintext', w=3.0, fc='#E8F5E9', bc=C_GREEN)
    y -= 0.52; msg(y, 13.2, 16.0,'[NOTIFY]  "Alice: Meet at shelter 3"', col=C_GREEN)

    # ── Phase 3 ──
    y -= 0.65
    phase(y, 'Phase 3 — Read Receipt')

    y -= 0.60; msg(y, 16.0, 13.2,'opens chat with Alice', col=C_PURPLE)
    y -= 0.52; note(y, 13.0,'stamp resq_read_map\n[alice] = now()', fc='#F3E5F5', bc=C_PURPLE)
    y -= 0.52; msg(y, 13.2, 7.2, 'write(READ_RECEIPT{ts})')
    y -= 0.52; msg(y, 7.2, 4.2, '"✓ seen" delivered', col=C_PURPLE, ret=True)

    return save(fig, '6_sequence')


# ════════════════════════════════════════════════════════════════════════════
# 7. PROJECT COST ESTIMATION
# ════════════════════════════════════════════════════════════════════════════
def draw_cost():
    fig = plt.figure(figsize=(15, 12)); fig.patch.set_facecolor('white')
    fig.text(0.5, 0.97, '7.  Project Cost Estimation — COCOMO II & Function Point Analysis',
             fontsize=13, fontweight='bold', color=C_BLUE, ha='center', va='top')

    # ── COCOMO table ──────────────────────────────────────────────────
    ax1 = fig.add_axes([0.03, 0.56, 0.46, 0.37])
    ax1.axis('off')
    ax1.set_title('COCOMO II — Basic Model', fontsize=10, fontweight='bold', color=C_BLUE, pad=6)

    cdata = [
        ['Parameter',                  'Value / Calculation'],
        ['Project Type',               'Organic  (small team, familiar domain)'],
        ['Estimated Size',             '15 KLOC  (JS frontend + Node.js backend)'],
        ['Formula',                    'E = 2.4 × (KLOC)^1.05'],
        ['Effort  E',                  '2.4 × (15)^1.05  =  41.2  Person-Months'],
        ['Dev Time  D',                '2.5 × (E)^0.38   =  11.8  Months'],
        ['Avg Team Size',              'N = E / D  ≈  3–4  Persons'],
        ['Avg Salary (India)',          'INR  60,000 / person / month'],
        ['Total Cost  (COCOMO)',        'INR  41.2 × 60,000  =  INR 24,72,000'],
    ]
    CW = [0.35, 0.65]; RH = 1.0/len(cdata)
    for i, row in enumerate(cdata):
        for j, cell in enumerate(row):
            x = sum(CW[:j]); y = 1.0-(i+1)*RH
            fc = C_BLUE if i==0 else (C_LBLUE if i%2==0 else 'white')
            tc = 'white' if i==0 else '#212121'
            ax1.add_patch(mpatches.Rectangle((x,y),CW[j],RH, facecolor=fc, edgecolor='#90A4AE', lw=0.8))
            ax1.text(x+0.01, y+RH/2, cell, fontsize=7.5 if i==0 else 7,
                     color=tc, va='center', fontweight='bold' if i==0 else 'normal')

    # ── FP table ─────────────────────────────────────────────────────
    ax2 = fig.add_axes([0.52, 0.56, 0.46, 0.37])
    ax2.axis('off')
    ax2.set_title('Function Point (Albrecht) Estimation', fontsize=10, fontweight='bold', color=C_GREEN, pad=6)

    fpdata = [
        ['Function Type',              'Count','Wt','FP'],
        ['External Inputs (EI)',        '12',  '4', '48'],
        ['External Outputs (EO)',       '8',   '5', '40'],
        ['External Inquiries (EQ)',     '6',   '4', '24'],
        ['Internal Logical Files (ILF)','5',  '10', '50'],
        ['External Interface Files (EIF)','3','7',  '21'],
        ['Unadjusted FP  (UFP)',        '',   '',  '183'],
        ['Complexity Adj. Factor',      '',  '1.0',  ''],
        ['Adjusted FP  (AFP)',          '',   '',  '183'],
        ['Productivity',                '', '15 FP/PM',''],
        ['Effort  (AFP / Prod.)',        '',   '','12.2 PM'],
        ['Cost  @ INR 60 K/PM',         '',   '', 'INR 7,32,000'],
    ]
    CW2=[0.46,0.18,0.18,0.18]; RH2=1.0/len(fpdata)
    for i, row in enumerate(fpdata):
        for j, cell in enumerate(row):
            x=sum(CW2[:j]); y=1.0-(i+1)*RH2
            fc = C_GREEN if i==0 else ('#C8E6C9' if row[0] in ['Unadjusted FP  (UFP)', 'Adjusted FP  (AFP)', 'Cost  @ INR 60 K/PM'] else ('#E8F5E9' if i%2==0 else 'white'))
            tc = 'white' if i==0 else '#212121'
            ax2.add_patch(mpatches.Rectangle((x,y),CW2[j],RH2, facecolor=fc, edgecolor='#90A4AE', lw=0.8))
            ax2.text(x+0.01, y+RH2/2, cell, fontsize=7.5 if i==0 else 7,
                     color=tc, va='center', fontweight='bold' if i==0 else 'normal')

    # ── Cost bar chart ────────────────────────────────────────────────
    ax3 = fig.add_axes([0.05, 0.06, 0.42, 0.42])
    phases = ['Requirements\n& Design','Frontend\nDev','Backend\nDev',
              'BLE/Mesh\nIntegration','Testing &\nQA','Deploy\n& Docs']
    pm     = [3.5, 8.0, 7.0, 10.0, 7.2, 5.5]
    cost_l = [p*0.6 for p in pm]
    bars = ax3.bar(phases, cost_l,
                   color=[C_BLUE, C_GREEN, C_ORANGE, C_PURPLE, C_RED, C_TEAL],
                   edgecolor='white', linewidth=1.5, zorder=3)
    ax3.set_facecolor('#F8F9FA'); ax3.yaxis.grid(True, alpha=0.4, zorder=0)
    ax3.set_ylabel('Cost (INR Lakhs)', fontsize=9)
    ax3.set_title('Cost by Phase (COCOMO II)', fontsize=10, fontweight='bold', color=C_BLUE, pad=6)
    ax3.tick_params(axis='x', labelsize=8); ax3.tick_params(axis='y', labelsize=8)
    for b, v in zip(bars, cost_l):
        ax3.text(b.get_x()+b.get_width()/2, b.get_height()+0.04,
                 f'INR {v:.1f}L', ha='center', va='bottom', fontsize=7.5, fontweight='bold')

    # ── Effort pie ────────────────────────────────────────────────────
    ax4 = fig.add_axes([0.55, 0.06, 0.42, 0.42])
    pie_lbl = [f'{n}\n({v} PM)' for n,v in zip(['Frontend','Backend','BLE/Mesh','Testing','Design','Deploy'],pm)]
    wedges, _, auto = ax4.pie(pm, labels=pie_lbl, autopct='%1.1f%%',
                               colors=[C_BLUE,C_GREEN,C_ORANGE,C_RED,C_PURPLE,C_TEAL],
                               startangle=90, pctdistance=0.78,
                               explode=[0,0,0.07,0,0,0])
    for t in _:    t.set_fontsize(7.5)
    for a in auto: a.set_fontsize(7.5); a.set_color('white'); a.set_fontweight('bold')
    ax4.set_title('Effort Distribution  (41.2 PM Total)',
                  fontsize=10, fontweight='bold', color=C_BLUE, pad=6)

    return save(fig, '7_cost')


# ════════════════════════════════════════════════════════════════════════════
# 8. PROJECT EFFORT ESTIMATION — GANTT CHART
# ════════════════════════════════════════════════════════════════════════════
def draw_effort():
    fig, ax = plt.subplots(figsize=(20, 11))
    ax.set_facecolor('#F8F9FA'); fig.patch.set_facecolor('white')
    ax.set_title('8.  Project Effort Estimation — Gantt Chart  (12-Month Schedule)',
                 fontsize=13, fontweight='bold', color=C_BLUE, pad=10)

    tasks = [
        # (task name,           phase,     start_wk, dur_wk, colour)
        ('Requirement Analysis','Phase 1',  0,  3, C_BLUE),
        ('System Design (SRS + Models)', 'Phase 1', 2, 4, '#1976D2'),
        ('Architecture & DB Design','Phase 1', 4, 2, '#42A5F5'),
        ('Frontend UI Dev',    'Phase 2',  6,  8, C_GREEN),
        ('BLE Mesh Module',    'Phase 2',  7, 10, C_ORANGE),
        ('E2EE Crypto Module', 'Phase 2',  9,  5, C_PURPLE),
        ('Backend REST API',   'Phase 3',  6,  7, C_RED),
        ('MongoDB Integration','Phase 3', 10,  4, '#B71C1C'),
        ('Socket.io Real-time','Phase 3', 12,  4, '#EF5350'),
        ('SMS Gateway Integ.', 'Phase 4', 14,  3, C_TEAL),
        ('Store-and-Forward Q.','Phase 4',13,  4, '#00695C'),
        ('Unit & Integ. Tests','Phase 5', 16,  5, C_AMBER),
        ('System Testing',     'Phase 5', 19,  3, '#FFB300'),
        ('Bug Fixes & Optim.', 'Phase 5', 20,  3, '#FF8F00'),
        ('Documentation',      'Phase 6', 18,  4, C_PURPLE),
        ('Deployment & Demo',  'Phase 6', 22,  2, '#311B92'),
    ]
    TW = 25
    Ys = list(range(len(tasks), 0, -1))

    ax.set_xlim(-0.5, TW+0.5); ax.set_ylim(0, len(tasks)+2)

    for m in range(13):
        wk = m*2
        ax.axvline(wk, color='#CFD8DC', lw=0.8, zorder=0)
        if m < 12:
            ax.text(wk+1, len(tasks)+1.3, f'Month {m+1}',
                    fontsize=7.5, ha='center', color=C_GREY, fontweight='bold')

    for i, (tname, phase, sw, dw, col) in enumerate(tasks):
        y = Ys[i]
        ax.add_patch(FancyBboxPatch((sw, y-0.38), dw, 0.76,
                                    boxstyle='round,pad=0.05',
                                    facecolor=col, edgecolor='white', lw=1.5, zorder=3, alpha=0.92))
        ax.text(sw+dw/2, y, tname, fontsize=7.5, ha='center', va='center',
                color='white', fontweight='bold', zorder=4)
        ax.text(-0.4, y, phase, fontsize=6.5, ha='right', va='center',
                color=C_GREY, style='italic')

    # Y-axis: no tick labels — task names appear inside the bars
    ax.set_yticks([])
    for sp in ['top','right','left','bottom']: ax.spines[sp].set_visible(False)
    ax.set_xticks(range(0, TW+1, 2))
    ax.set_xticklabels([f'W{w}' for w in range(0, TW+1, 2)], fontsize=8)
    ax.set_xlabel('Project Timeline (Weeks)', fontsize=10)
    ax.xaxis.grid(True, alpha=0.35, zorder=0)
    leg = [mpatches.Patch(facecolor=c, label=l, edgecolor='white')
           for l,c in [('Phase 1: Planning & Design',C_BLUE),
                        ('Phase 2: Frontend + BLE Dev',C_GREEN),
                        ('Phase 3: Backend Dev',C_RED),
                        ('Phase 4: Integration',C_TEAL),
                        ('Phase 5: Testing & QA',C_AMBER),
                        ('Phase 6: Deployment & Docs',C_PURPLE)]]
    ax.legend(handles=leg, loc='lower right', fontsize=7.5,
              framealpha=0.95, edgecolor='#B0BEC5', ncol=2)

    ax.text(TW/2, -0.75,
            '  Total Duration: ~12 Months (24 Weeks)  |  Total Effort: 41.2 Person-Months  |  Team: 4 Developers  ',
            fontsize=8.5, ha='center', va='center', color='white', fontweight='bold',
            bbox=dict(facecolor=C_BLUE, edgecolor=C_DBLUE, boxstyle='round,pad=0.4'))

    fig.subplots_adjust(left=0.04, right=0.98, top=0.93, bottom=0.10)
    return save(fig, '8_effort')


# ════════════════════════════════════════════════════════════════════════════
# GENERATE ALL IMAGES
# ════════════════════════════════════════════════════════════════════════════
print("Generating diagrams ...")
imgs = {}
imgs['context']      = draw_context();      print("  [1/8] Context Diagram")
imgs['usecase']      = draw_usecase();      print("  [2/8] Use-Case Diagram")
imgs['activity']     = draw_activity();     print("  [3/8] Activity Diagram")
imgs['architecture'] = draw_architecture(); print("  [4/8] Architecture Diagram")
imgs['class_']       = draw_class();        print("  [5/8] Class Diagram")
imgs['sequence']     = draw_sequence();     print("  [6/8] Sequence Diagram")
imgs['cost']         = draw_cost();         print("  [7/8] Cost Estimation")
imgs['effort']       = draw_effort();       print("  [8/8] Effort Estimation")


# ════════════════════════════════════════════════════════════════════════════
# BUILD PDF
# ════════════════════════════════════════════════════════════════════════════
PDF = os.path.join(BASE, "docs", "RESQ_SE_AAT_Model_Diagrams.pdf")
W_A4, H_A4 = A4
IMG_W = W_A4 - 3.6*cm

doc  = SimpleDocTemplate(PDF, pagesize=A4,
                          rightMargin=1.8*cm, leftMargin=1.8*cm,
                          topMargin=1.5*cm,   bottomMargin=1.5*cm)
ST   = getSampleStyleSheet()

sT = ParagraphStyle('T', parent=ST['Title'], fontSize=22,
                     textColor=colors.HexColor(C_BLUE), alignment=TA_CENTER,
                     fontName='Helvetica-Bold', spaceAfter=6)
sS = ParagraphStyle('S', parent=ST['Normal'], fontSize=11,
                     textColor=colors.HexColor(C_GREY), alignment=TA_CENTER, spaceAfter=4)
sH = ParagraphStyle('H', parent=ST['Heading1'], fontSize=13,
                     textColor=colors.HexColor(C_BLUE), fontName='Helvetica-Bold',
                     spaceBefore=10, spaceAfter=6,
                     backColor=colors.HexColor(C_LBLUE), borderPad=4)
sB = ParagraphStyle('B', parent=ST['Normal'], fontSize=9,
                     textColor=colors.HexColor('#37474F'), leading=14, spaceAfter=4)

story = []

# ── cover ──────────────────────────────────────────────────────────────────
story += [Spacer(1, 2*cm),
          Paragraph('RESQ', sT),
          Paragraph('Offline-First Disaster Communication Network', ParagraphStyle(
              'x', parent=ST['Normal'], fontSize=15, alignment=TA_CENTER,
              textColor=colors.HexColor(C_BLUE), spaceAfter=4)),
          HRFlowable(width='75%', thickness=2.5, color=colors.HexColor(C_BLUE),
                      spaceBefore=8, spaceAfter=8),
          Paragraph('SE-AAT  —  Model Diagrams Report', ParagraphStyle(
              'x2', parent=ST['Normal'], fontSize=17, alignment=TA_CENTER,
              fontName='Helvetica-Bold', textColor=colors.HexColor(C_GREY), spaceAfter=6)),
          Spacer(1, 0.5*cm),
          Paragraph('Submitted as part of Software Engineering AAT', sS),
          Spacer(1, 1.2*cm)]

idx = [['#', 'Diagram', 'Page'],
       ['1','Context Diagram','2'],
       ['2','Use-Case Diagram','3'],
       ['3','Activity Diagram','4'],
       ['4','Architecture Diagram','5'],
       ['5','Class Diagram','6'],
       ['6','Sequence Diagram','7'],
       ['7','Project Cost Estimation (COCOMO II + Function Points)','8'],
       ['8','Project Effort Estimation (Gantt Chart)','9']]

idx_t = Table(idx, colWidths=[1.2*cm, 13*cm, 2*cm])
idx_t.setStyle(TableStyle([
    ('BACKGROUND',(0,0),(-1,0), colors.HexColor(C_BLUE)),
    ('TEXTCOLOR', (0,0),(-1,0), colors.white),
    ('FONTNAME',  (0,0),(-1,0), 'Helvetica-Bold'),
    ('FONTSIZE',  (0,0),(-1,0), 10),
    ('ALIGN',     (0,0),(-1,-1),'CENTER'),
    ('VALIGN',    (0,0),(-1,-1),'MIDDLE'),
    ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor(C_LBLUE), colors.white]),
    ('FONTSIZE',  (0,1),(-1,-1), 9),
    ('GRID',      (0,0),(-1,-1), 0.5, colors.HexColor('#90A4AE')),
    ('ROWHEIGHT', (0,0),(-1,-1), 22),
    ('ALIGN',     (1,1),(1,-1), 'LEFT'),
    ('LEFTPADDING',(1,1),(1,-1), 8),
]))
story.append(idx_t)
story.append(Spacer(1, 0.8*cm))
story.append(Paragraph(
    '<b>Project:</b> Bluetooth-mesh-based offline-first communication app for disaster scenarios. '
    'Supports End-to-End Encrypted (E2EE) messaging, SOS broadcasts, resource sharing, '
    'store-and-forward queuing, and SMS to off-grid contacts. '
    'User roles: Civilian, First Responder, Medical Officer, Coordinator.', sB))

# ── diagram pages ──────────────────────────────────────────────────────────
pages = [
    ('context',      '1.  Context Diagram',
     'Shows the RESQ system boundary with 8 external entities: four user roles, BLE mesh network, '
     'Cellular SMS gateway, GPS/Location services, and Peer Backend gossip node. '
     'Bidirectional arrows show the data flows into and out of the system.'),
    ('usecase',      '2.  Use-Case Diagram',
     '4 actors (Civilian, First Responder, Medical Officer, Coordinator) linked to 14 labelled use '
     'cases. Includes «include» relationship (Register → Generate E2EE Keypair) and '
     '«extend» (Send SOS → Broadcast via Mesh + SMS).'),
    ('activity',     '3.  Activity Diagram  —  Send Message Flow',
     'Complete activity flow: app launch → registration check → keypair generation → '
     'contact selection → E2EE decision → BLE delivery or queue fallback → '
     'recipient decryption → push notification → read receipt.'),
    ('architecture', '4.  Architecture Diagram',
     '5-layer architecture: Presentation (HTML/JS), Application Logic (Auth, Crypto, Controllers), '
     'Mesh Communication (BLE GATT, Socket.io, SMS, Gossip), Data Persistence (localStorage, Queues), '
     'and Backend Infrastructure (Node.js, Express, MongoDB).'),
    ('class_',       '5.  Class Diagram',
     '8 UML classes with typed attributes and methods: User, CryptoKeyPair, Peer, Message, SOSAlert, '
     'Resource, Contact, OutboundQueue. Association lines show 1:1, 1:N, and M:N multiplicity.'),
    ('sequence',     '6.  Sequence Diagram  —  E2EE Messaging over BLE',
     'Three phases: (1) BLE peer discovery + ECDH public-key exchange, '
     '(2) ECDH secret derivation + AES-GCM-256 encrypt → BLE write → decrypt → '
     'push notification, (3) read-receipt stamping and delivery confirmation.'),
    ('cost',         '7.  Project Cost Estimation',
     'Two techniques: (A) COCOMO II Basic — 15 KLOC organic, E = 41.2 PM, '
     '~12 months, INR 24.72 lakhs; '
     '(B) Function Point (Albrecht) — 183 AFP, 12.2 PM, INR 7.32 lakhs (dev core). '
     'Phase cost bar chart and effort pie chart included.'),
    ('effort',       '8.  Project Effort Estimation  —  Gantt Chart',
     '16 tasks across 6 phases over 24 weeks (12 months): Planning (Wk 0–6), '
     'Frontend + BLE Dev (Wk 6–16), Backend Dev (Wk 6–16), Integration (Wk 13–17), '
     'Testing & QA (Wk 16–23), Deployment & Docs (Wk 18–24). '
     'Total: 41.2 person-months, 4-person team.'),
]

for key, title, desc in pages:
    story.append(PageBreak())
    story.append(Paragraph(title, sH))
    story.append(Spacer(1, 0.15*cm))
    story.append(Paragraph(desc, sB))
    story.append(Spacer(1, 0.25*cm))
    story.append(HRFlowable(width='100%', thickness=1,
                              color=colors.HexColor(C_LBLUE), spaceAfter=6))
    ratio_map = {'activity': 1.10, 'sequence': 0.95, 'class_': 0.82}
    img_h = IMG_W * ratio_map.get(key, 0.78)
    im = Image(imgs[key], width=IMG_W, height=img_h)
    im.hAlign = 'CENTER'
    story.append(im)

print("\nBuilding PDF ...")
doc.build(story)
print(f"Done!  PDF saved to:\n  {PDF}")
