# Generates a PNG ER diagram for the RESQ project using matplotlib.
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
import numpy as np

BG="#0d1117"; HDR="#1f6feb"; HDR_USER="#FF1F1F"; HDR_SEC="#238636"; HDR_PURPLE="#8957e5"
BODY="#161b22"; BORDER="#30363d"; TXT="#f5f5f0"; SUB="#9aa4b2"; LINE="#8b949e"; PK="#FFAA00"
plt.rcParams["font.family"]="DejaVu Sans"

fig, ax = plt.subplots(figsize=(26, 14), dpi=150)
fig.patch.set_facecolor(BG); ax.set_facecolor(BG)
ax.set_xlim(0, 280); ax.set_ylim(0, 140); ax.axis("off")

ROW_H=4.2; HDR_H=6.0; PADB=3.0

# name: (cx, cy, w, header, [(attr, is_pk)])
E = {
 "CONTACT": (30, 112, 34, HDR, [("phone (PK)",1),("name",0),("source",0)]),
 "SMS_MESSAGE": (30, 74, 34, HDR, [("contactPhone (PK,FK)",1),("text",0),("outbound",0),("timestamp",0)]),
 "RESOURCE": (32, 28, 36, HDR_SEC, [("_id (PK)",1),("name",0),("type",0),("quantity , unit",0),("status",0),("ownerId (FK)",0),("updatedAt",0)]),
 "LOCATION": (86, 116, 32, HDR_SEC, [("userId (FK)",0),("lat , lng",0),("accuracy",0),("timestamp",0)]),
 "CRYPTO_KEYPAIR": (86, 74, 38, HDR_SEC, [("userId (PK,FK)",1),("publicKey",0),("privateKey",0),("algorithm",0)]),
 "PREFERENCE": (86, 30, 32, HDR, [("key (PK)",1),("value",0)]),
 "PEER_PUBKEY": (146, 120, 34, HDR_SEC, [("userId (PK,FK)",1),("publicKey",0)]),
 "USER": (146, 74, 36, HDR_USER, [("userId (PK)",1),("name",0),("role",0),("phone",0),("zone",0),("verified",0)]),
 "SOS_ALERT": (146, 24, 36, HDR_USER, [("id (PK)",1),("fromUserId (FK)",0),("alertType",0),("message",0),("lat , lng",0),("timestamp",0)]),
 "PEER": (210, 110, 34, HDR, [("userId (PK)",1),("name",0),("rssi",0),("hasKey",0),("bleAddress",0),("lastSeen",0)]),
 "MESSAGE": (210, 50, 36, HDR, [("id (PK)",1),("fromUserId (FK)",0),("toUserId | 'all'",0),("content",0),("enc",0),("timestamp",0),("channel",0),("ttl",0)]),
 "OUTBOUND_QUEUE": (264, 100, 30, HDR_PURPLE, [("id (PK)",1),("type",0),("payload",0),("queuedAt",0)]),
 "READ_RECEIPT": (264, 46, 30, HDR, [("contactKey (PK)",1),("lastReadTimestamp",0)]),
}
boxes={}
def draw(name):
    cx,cy,w,hc,attrs = E[name]
    h = HDR_H + ROW_H*len(attrs) + PADB
    x0,y0,x1,y1 = cx-w/2, cy-h/2, cx+w/2, cy+h/2
    boxes[name]=(x0,y0,x1,y1)
    ax.add_patch(FancyBboxPatch((x0,y0),w,h,boxstyle="round,pad=0,rounding_size=1.4",
        lw=1.4, ec=BORDER, fc=BODY, zorder=3))
    ax.add_patch(FancyBboxPatch((x0,y1-HDR_H),w,HDR_H,boxstyle="round,pad=0,rounding_size=1.4",
        lw=0, fc=hc, zorder=4))
    ax.add_patch(plt.Rectangle((x0,y1-HDR_H),w,2.0,fc=hc,lw=0,zorder=4))
    ax.text(cx, y1-HDR_H/2, name, ha="center", va="center", color="white",
        fontsize=11, fontweight="bold", zorder=5)
    for i,(a,pk) in enumerate(attrs):
        ay = y1-HDR_H-2.3 - i*ROW_H
        ax.text(x0+2.2, ay, ("• " if not pk else "★ ")+a, ha="left", va="center",
            color=(PK if pk else TXT), fontsize=8.6, fontweight=("bold" if pk else "normal"), zorder=5)

def edge(b, tx, ty):
    x0,y0,x1,y1=b; cx,cy=(x0+x1)/2,(y0+y1)/2; dx,dy=tx-cx,ty-cy
    if dx==0 and dy==0: return cx,cy
    sx = (x1-cx)/dx if dx>0 else (x0-cx)/dx if dx<0 else 1e9
    sy = (y1-cy)/dy if dy>0 else (y0-cy)/dy if dy<0 else 1e9
    s=min(abs(sx),abs(sy)); return cx+dx*s, cy+dy*s

def marker(tip, ang_away, many, optional):
    ux,uy = np.cos(ang_away), np.sin(ang_away)   # along line, away from box
    px,py = -uy, ux
    FL=3.6; W=2.7
    tx,ty = tip
    if many:
        bx,by = tx+ux*FL, ty+uy*FL
        for tgt in ((tx,ty),(tx+px*W,ty+py*W),(tx-px*W,ty-py*W)):
            ax.plot([bx,tgt[0]],[by,tgt[1]], color=LINE, lw=1.5, zorder=6)
    else:
        mx,my = tx+ux*FL, ty+uy*FL
        ax.plot([mx+px*W,mx-px*W],[my+py*W,my-py*W], color=LINE, lw=1.7, zorder=6)
    if optional:
        ox,oy = tx+ux*(FL+2.4), ty+uy*(FL+2.4)
        ax.add_patch(plt.Circle((ox,oy),1.2, fc=BG, ec=LINE, lw=1.4, zorder=6))

def rel(a,b,label, am=False,bm=False,ao=False,bo=False):
    ba,bb=boxes[a],boxes[b]
    ca=((ba[0]+ba[2])/2,(ba[1]+ba[3])/2); cb=((bb[0]+bb[2])/2,(bb[1]+bb[3])/2)
    pa=edge(ba,*cb); pb=edge(bb,*ca)
    ax.plot([pa[0],pb[0]],[pa[1],pb[1]], color=LINE, lw=1.3, zorder=2)
    ang=np.arctan2(cb[1]-ca[1], cb[0]-ca[0])
    marker(pa, ang, am, ao)
    marker(pb, ang+np.pi, bm, bo)
    mx,my=(pa[0]+pb[0])/2,(pa[1]+pb[1])/2
    ax.text(mx,my,label, ha="center", va="center", color="#c9d1d9", fontsize=8.0,
        style="italic", zorder=7, bbox=dict(boxstyle="round,pad=0.25", fc=BG, ec=BORDER, lw=0.6, alpha=0.95))

for n in E: draw(n)

rel("USER","CRYPTO_KEYPAIR","owns 1:1")
rel("USER","CONTACT","saves", bm=True, bo=True)
rel("USER","LOCATION","records", bm=True, bo=True)
rel("USER","PREFERENCE","sets", bm=True, bo=True)
rel("USER","PEER","discovers", am=True, bm=True, ao=True, bo=True)
rel("USER","MESSAGE","sends", bm=True, bo=True)
rel("USER","SOS_ALERT","broadcasts", bm=True, bo=True)
rel("USER","RESOURCE","owns", bm=True, bo=True)
rel("PEER","PEER_PUBKEY","provides", bo=True)
rel("PEER","MESSAGE","sender / recipient", bm=True, bo=True)
rel("CONTACT","SMS_MESSAGE","SMS thread", bm=True, bo=True)
rel("MESSAGE","READ_RECEIPT","read-state", bo=True)
rel("MESSAGE","OUTBOUND_QUEUE","relayed via", am=True)
rel("SOS_ALERT","OUTBOUND_QUEUE","queued", am=True)

ax.text(140,137,"RESQ  ·  Offline Disaster Mesh  —  Entity-Relationship Diagram",
    ha="center", color=TXT, fontsize=18, fontweight="bold")
ax.text(140,132.5,"Offline-first: no central database. Each phone stores its own copy (localStorage) and syncs device-to-device over the Bluetooth mesh + cellular SMS.",
    ha="center", color=SUB, fontsize=10, style="italic")

# legend (bottom-right empty area)
lx,ly=212,22
ax.add_patch(plt.Rectangle((lx-4,ly-13),62,25, fc=BODY, ec=BORDER, lw=1.2, zorder=8))
ax.text(lx,ly+7,"LEGEND", color=TXT, fontsize=9.5, fontweight="bold", zorder=9)
ax.text(lx,ly+3,"—|     exactly one", color=SUB, fontsize=8.2, zorder=9)
ax.text(lx,ly-1,"—<     many (crow's foot)", color=SUB, fontsize=8.2, zorder=9)
ax.text(lx,ly-5,"  o     optional (zero)", color=SUB, fontsize=8.2, zorder=9)
ax.text(lx,ly-9,"★ gold = primary key", color=PK, fontsize=8.2, fontweight="bold", zorder=9)

plt.savefig(r"C:\Users\dell\Desktop\Offline-First-Disaster-Communication-Network\docs\RESQ_ER_Diagram.png",
    facecolor=BG, bbox_inches="tight", pad_inches=0.35)
print("saved")
