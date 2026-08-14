from fractions import Fraction
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.units import inch
from reportlab.lib import colors
from points import POINTS

OUT = "/home/user/mailoutreach-ai/out/Dock_B_Grade_Transitions_1-8.pdf"
IMG = "content300.png"
IW, IH = 3187, 4567

INK   = colors.HexColor("#1a1a1a")
MUTED = colors.HexColor("#6f6f6f")
RULE  = colors.HexColor("#c4c4c4")
DOWN  = colors.HexColor("#9b2c2c")
UP    = colors.HexColor("#1f5c3a")
ZEBRA = colors.HexColor("#f2f2f2")
HDRBG = colors.HexColor("#e6e6e6")

DEN = 8

def frac8(inches):
    """Nearest 1/8 inch, unsigned, as a mixed number."""
    n = round(abs(inches) * DEN)
    if n == 0:
        return '0'
    f = Fraction(n, DEN)
    whole, rem = divmod(f.numerator, f.denominator)
    if rem == 0:
        return f'{whole}'
    if whole == 0:
        return f'{rem}/{f.denominator}'
    return f'{whole} {rem}/{f.denominator}'

rows = []
for pid, elev, desc, note in POINTS:
    inches = elev * 12.0
    if abs(inches) < 0.0625:
        arrow, frac, col = "", "0", MUTED
    elif inches < 0:
        arrow, frac, col = "–", frac8(inches), DOWN     # en dash = drop
        frac = "–" + frac
    else:
        arrow, frac, col = "", frac8(inches), UP
    rows.append(dict(pid=str(pid) if pid else "?", desc=desc, elev=elev,
                     inches=inches, frac=frac, col=col, note=bool(note)))

c = canvas.Canvas(OUT, pagesize=letter)
c.setTitle("Dock B Survey - Grade Point Transitions")

# ---------------------------------------------------------------- page 1
c.setPageSize(letter)
PW, PH = letter
M = 0.35 * inch
FOOT = 0.30 * inch
avail_w = PW - 2*M
avail_h = PH - 2*M - FOOT
s = min(avail_w / IW, avail_h / IH)
dw, dh = IW*s, IH*s
c.drawImage(IMG, (PW-dw)/2, M + FOOT + (avail_h-dh)/2, dw, dh,
            preserveAspectRatio=True, anchor='c')
c.setFont("Helvetica", 8)
c.setFillColor(MUTED)
c.drawString(M, M + 6, "Dock B Survey Surface — Model  |  elevations in decimal feet from site datum 0.000")
c.drawRightString(PW - M, M + 6, "Conversions on page 2")
c.showPage()

# ---------------------------------------------------------------- page 2
c.setPageSize(landscape(letter))
PW, PH = landscape(letter)
LM = RM = 0.4*inch
TM = 0.4*inch
BM = 0.45*inch

c.setFillColor(INK)
c.setFont("Helvetica-Bold", 15)
c.drawString(LM, PH - TM - 12, "Grade transition legend — elevation to inches, nearest 1/8\"")
c.setFont("Helvetica", 8.5)
c.setFillColor(MUTED)
c.drawString(LM, PH - TM - 26,
             "Elevation (ft) × 12 = transition in inches from datum.  "
             "A leading – means the point is BELOW datum (step down); no sign means ABOVE datum (step up).")
c.drawString(LM, PH - TM - 37,
             "Example: pt. 167, –0.650 ft → –0.650 × 12 = –7.8 in. → step DOWN 7 3/4 in.")

TOP = PH - TM - 52
BOT = BM + 26
NCOL = 4
GUT = 0.16*inch
CW = (PW - LM - RM - GUT*(NCOL-1)) / NCOL
# column widths inside a block
W_PT, W_TY, W_EL, W_IN, W_FR = 0.34*inch, 0.46*inch, 0.52*inch, 0.42*inch, 0.61*inch
PAD = 3

HDR_H = 13.5
ROW_H = 10.6
n_rows = int((TOP - BOT - HDR_H) // ROW_H)
per_col = -(-len(rows) // NCOL)
per_col = max(per_col, 1)
if per_col > n_rows:
    per_col = n_rows

def draw_block(x, items):
    y = TOP
    # header
    c.setFillColor(HDRBG)
    c.rect(x, y - HDR_H, CW, HDR_H, stroke=0, fill=1)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 7.4)
    cx = x + PAD
    c.drawString(cx, y - HDR_H + 4, "Pt.");            cx += W_PT
    c.drawString(cx, y - HDR_H + 4, "Type");           cx += W_TY
    c.drawRightString(cx + W_EL - 2*PAD, y - HDR_H + 4, "Elev. ft"); cx += W_EL
    c.drawRightString(cx + W_IN - 2*PAD, y - HDR_H + 4, "in.");      cx += W_IN
    c.drawRightString(cx + W_FR - PAD,   y - HDR_H + 4, "1/8 in.")
    c.setStrokeColor(INK); c.setLineWidth(0.7)
    c.line(x, y - HDR_H, x + CW, y - HDR_H)
    y -= HDR_H
    for i, r in enumerate(items):
        if i % 2 == 1:
            c.setFillColor(ZEBRA)
            c.rect(x, y - ROW_H, CW, ROW_H, stroke=0, fill=1)
        ty = y - ROW_H + 3
        cx = x + PAD
        c.setFillColor(DOWN if r["note"] else INK)
        c.setFont("Helvetica-Bold" if r["note"] else "Helvetica", 7.6)
        c.drawString(cx, ty, r["pid"]); cx += W_PT
        c.setFillColor(INK); c.setFont("Helvetica", 7.6)
        c.drawString(cx, ty, r["desc"][:8]); cx += W_TY
        c.drawRightString(cx + W_EL - 2*PAD, ty, f'{r["elev"]:.3f}'.replace("-", "–")); cx += W_EL
        c.drawRightString(cx + W_IN - 2*PAD, ty, f'{abs(r["inches"]):.1f}'); cx += W_IN
        c.setFillColor(r["col"]); c.setFont("Helvetica-Bold", 7.6)
        c.drawRightString(cx + W_FR - PAD, ty, r["frac"])
        y -= ROW_H
    c.setStrokeColor(RULE); c.setLineWidth(0.3)
    yy = TOP - HDR_H
    for i in range(len(items) + 1):
        c.line(x, yy, x + CW, yy); yy -= ROW_H
    c.rect(x, TOP - HDR_H - ROW_H*len(items), CW, HDR_H + ROW_H*len(items),
           stroke=1, fill=0)

for k in range(NCOL):
    chunk = rows[k*per_col:(k+1)*per_col]
    if not chunk: break
    draw_block(LM + k*(CW + GUT), chunk)

c.setFont("Helvetica", 7)
c.setFillColor(MUTED)
c.drawString(LM, BM + 10,
    "163 points.  Red point numbers need confirming on site: pts. 101/102 print on top of each other "
    "(read as +0.066 / +0.019); the “?” point at +0.250 has an illegible number (most likely pt. 32).  "
    "Pts. 1, 2, 12, 17, 27 and 146 do not appear on the sheet.")
c.drawString(LM, BM,
    "Source: Dock_B_Survey_Surface_ll_a (Model).  Fractions rounded to the nearest 1/8 in.; "
    "use the decimal inch column where tighter tolerance matters.")
c.showPage()
c.save()
print("built", OUT, "rows", len(rows), "per_col", per_col, "capacity", n_rows)
