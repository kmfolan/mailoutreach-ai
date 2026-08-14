from fractions import Fraction
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, PageBreak, Image, KeepTogether)
from points import POINTS

DENOM = 4
INK   = colors.HexColor("#1a1a1a")
MUTED = colors.HexColor("#6b6b6b")
RULE  = colors.HexColor("#c9c9c9")
DOWN  = colors.HexColor("#9b2c2c")
UP    = colors.HexColor("#1f5c3a")
HDRBG = colors.HexColor("#ececec")
ZEBRA = colors.HexColor("#f6f6f6")

def frac_str(inches, denom=DENOM):
    """Nearest 1/denom inch, as a mixed number string."""
    n = round(abs(inches) * denom)
    if n == 0:
        return f'<1/{denom}"'
    f = Fraction(n, denom)
    whole, rem = divmod(f.numerator, f.denominator)
    if rem == 0:
        return f'{whole}"'
    if whole == 0:
        return f'{rem}/{f.denominator}"'
    return f'{whole} {rem}/{f.denominator}"'

def transition(elev):
    inches = elev * 12.0
    if abs(inches) < 0.05:
        return "At datum — no change (0.0 in.)"
    verb = "Drops down" if inches < 0 else "Rises up"
    return f"{verb} {abs(inches):.1f} inches (~{frac_str(inches)})"

rows = []
for pid, elev, desc, note in POINTS:
    inches = elev * 12.0
    rows.append(dict(pid=pid, label=(str(pid) if pid else "?"), elev=elev, desc=desc,
                     note=note, inches=inches, frac=frac_str(inches),
                     text=transition(elev)))

# ---------------------------------------------------------------- styles
ss = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=ss["Title"], fontName="Helvetica-Bold",
                    fontSize=21, leading=25, textColor=INK, alignment=0, spaceAfter=2)
SUB = ParagraphStyle("SUB", parent=ss["Normal"], fontName="Helvetica",
                     fontSize=10.5, leading=14, textColor=MUTED, spaceAfter=14)
H2 = ParagraphStyle("H2", parent=ss["Heading2"], fontName="Helvetica-Bold",
                    fontSize=12.5, leading=15, textColor=INK,
                    spaceBefore=16, spaceAfter=7)
BODY = ParagraphStyle("BODY", parent=ss["Normal"], fontName="Helvetica",
                      fontSize=9.5, leading=13.5, textColor=INK, spaceAfter=6)
SMALL = ParagraphStyle("SMALL", parent=BODY, fontSize=8.5, leading=11.5, textColor=MUTED)
CELL = ParagraphStyle("CELL", parent=ss["Normal"], fontName="Helvetica",
                      fontSize=8.2, leading=10, textColor=INK)

def table_style(nrows, dircol=None):
    cmds = [
        ("FONT", (0,0), (-1,0), "Helvetica-Bold", 8.2),
        ("TEXTCOLOR", (0,0), (-1,0), INK),
        ("BACKGROUND", (0,0), (-1,0), HDRBG),
        ("FONT", (0,1), (-1,-1), "Helvetica", 8.2),
        ("TEXTCOLOR", (0,1), (-1,-1), INK),
        ("ALIGN", (0,0), (2,-1), "CENTER"),
        ("ALIGN", (3,0), (4,-1), "RIGHT"),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("LINEBELOW", (0,0), (-1,0), 0.8, INK),
        ("GRID", (0,0), (-1,-1), 0.25, RULE),
        ("TOPPADDING", (0,0), (-1,-1), 3.2),
        ("BOTTOMPADDING", (0,0), (-1,-1), 3.2),
        ("LEFTPADDING", (0,0), (-1,-1), 4),
        ("RIGHTPADDING", (0,0), (-1,-1), 4),
    ]
    for r in range(1, nrows):
        if r % 2 == 0:
            cmds.append(("BACKGROUND", (0,r), (-1,r), ZEBRA))
    return cmds

HEAD = ["Pt.", "Type", "Elev. (ft)", "Inches", "Nearest 1/4\"", "Transition from datum"]
COLW = [0.5*inch, 0.72*inch, 0.85*inch, 0.68*inch, 0.9*inch, 3.75*inch]

def build_table(items):
    data = [HEAD]
    style = []
    for i, r in enumerate(items, start=1):
        data.append([r["label"], r["desc"], f'{r["elev"]:+.3f}',
                     f'{r["inches"]:+.1f}', r["frac"] if abs(r["inches"])>=0.05 else "—",
                     r["text"]])
        if r["inches"] < -0.05:
            style.append(("TEXTCOLOR", (5,i), (5,i), DOWN))
        elif r["inches"] > 0.05:
            style.append(("TEXTCOLOR", (5,i), (5,i), UP))
        else:
            style.append(("TEXTCOLOR", (5,i), (5,i), MUTED))
        if r["note"]:
            style.append(("TEXTCOLOR", (0,i), (0,i), DOWN))
            style.append(("FONT", (0,i), (0,i), "Helvetica-Bold", 8.2))
    t = Table(data, colWidths=COLW, repeatRows=1)
    t.setStyle(TableStyle(table_style(len(data)) + style))
    return t

# ---------------------------------------------------------------- document
PAGE = letter
LM = RM = 0.55*inch; TM = 0.6*inch; BM = 0.62*inch
FW = PAGE[0] - LM - RM
FH = PAGE[1] - TM - BM
GUT = 0.32*inch
CW = (FW - GUT) / 2.0

doc = BaseDocTemplate("/home/user/mailoutreach-ai/out/Dock_B_Grade_Transitions.pdf",
                      pagesize=PAGE, leftMargin=LM, rightMargin=RM,
                      topMargin=TM, bottomMargin=BM,
                      title="Dock B Survey - Grade Point Transitions",
                      author="Grade transition conversion")

def deco(canv, doc_):
    canv.saveState()
    canv.setFont("Helvetica", 7.5)
    canv.setFillColor(MUTED)
    canv.drawString(LM, BM - 16, "Dock B Survey Surface — grade point transitions (elevations in feet, converted to inches)")
    canv.drawRightString(PAGE[0]-RM, BM - 16, f"Page {canv.getPageNumber()}")
    canv.setStrokeColor(RULE); canv.setLineWidth(0.5)
    canv.line(LM, BM - 8, PAGE[0]-RM, BM - 8)
    canv.restoreState()

one = Frame(LM, BM, FW, FH, id="one", leftPadding=0, rightPadding=0,
            topPadding=0, bottomPadding=0)
colL = Frame(LM, BM, CW, FH, id="L", leftPadding=0, rightPadding=0,
             topPadding=0, bottomPadding=0)
colR = Frame(LM+CW+GUT, BM, CW, FH, id="R", leftPadding=0, rightPadding=0,
             topPadding=0, bottomPadding=0)
doc.addPageTemplates([
    PageTemplate(id="single", frames=[one], onPage=deco),
    PageTemplate(id="two", frames=[colL, colR], onPage=deco),
])

S = []
S.append(Paragraph("Dock B Survey — Grade Point Transitions", H1))
S.append(Paragraph("Every surveyed elevation converted to a rise/drop in inches. "
                   "Source: <i>Dock_B_Survey_Surface_ll_a (Model)</i>. 163 grade points.", SUB))

S.append(Paragraph("How to read this", H2))
S.append(Paragraph(
    "Elevations on the survey are decimal <b>feet</b> relative to the site datum of <b>0.000</b> "
    "(the sheet's 0.000 &ldquo;test&rdquo; point, pt. 5). Each value is multiplied by 12 to give the "
    "vertical transition in inches, then rounded to the nearest quarter inch for field use. "
    "A negative elevation means the point sits <b>below</b> datum, so you step <b>down</b> to it; "
    "a positive elevation means you step <b>up</b>.", BODY))
S.append(Paragraph(
    "<b>Worked example:</b> pt. 167, Shoring, &minus;0.650 ft &rarr; &minus;0.650 &times; 12 = "
    "&minus;7.8 in. &rarr; <b>Drops down 7.8 inches (~7 3/4 in.)</b>", BODY))

S.append(Spacer(1, 6))
leg = [["Shoring", "Shoring / excavation grade"], ["apron", "Apron slab"],
       ["SW", "Sidewalk"], ["EP", "Edge of pavement"], ["MS", "Measured surface / spot shot"],
       ["TC", "Top of curb"], ["AC", "Asphalt concrete"], ["new", "New / design grade"],
       ["new TC", "New top of curb"], ["Tp found", "Found survey point"], ["test", "Datum check shot"]]
lt = Table([["Point type abbreviations",""]] + [[a, b] for a, b in leg],
           colWidths=[0.78*inch, 1.92*inch])
lt.setStyle(TableStyle([
    ("SPAN", (0,0), (1,0)),
    ("FONT", (0,0), (0,0), "Helvetica-Bold", 11),
    ("BOTTOMPADDING", (0,0), (1,0), 8),
    ("FONT", (0,1), (0,-1), "Helvetica-Bold", 8.2),
    ("FONT", (1,1), (1,-1), "Helvetica", 8.2),
    ("TEXTCOLOR", (0,0), (-1,-1), INK),
    ("TOPPADDING", (0,1), (-1,-1), 2.4), ("BOTTOMPADDING", (0,1), (-1,-1), 2.4),
    ("LEFTPADDING", (0,0), (-1,-1), 0),
    ("VALIGN", (0,0), (-1,-1), "TOP"),
]))

# ---- summary by type
groups = {}
for r in rows:
    groups.setdefault(r["desc"].lower().replace("apron","apron"), []).append(r)
order = ["shoring","apron","sw","ep","ms","tc","ac","new","new tc","tp found","test"]
srows = [["Summary by point type","","","",""],
         ["Type", "Pts", "Range (ft)", "Range (in.)", "Typical transition"]]
for k in order:
    g = [r for r in rows if r["desc"].lower() == k]
    if not g: continue
    lo = min(r["elev"] for r in g); hi = max(r["elev"] for r in g)
    avg = sum(r["inches"] for r in g)/len(g)
    if abs(avg) < 0.05:
        tip = "no change"
    else:
        tip = f'avg {abs(avg):.1f} in. {"down" if avg < 0 else "up"}'
    srows.append([g[0]["desc"], str(len(g)), f"{lo:+.3f} to {hi:+.3f}",
                  f"{lo*12:+.1f} to {hi*12:+.1f}", tip])
st = Table(srows, colWidths=[0.8*inch, 0.38*inch, 1.14*inch, 1.14*inch, 1.24*inch])
st.setStyle(TableStyle([
    ("SPAN", (0,0), (-1,0)),
    ("FONT", (0,0), (0,0), "Helvetica-Bold", 11),
    ("BOTTOMPADDING", (0,0), (-1,0), 8),
    ("LEFTPADDING", (0,0), (0,0), 0),
    ("FONT", (0,1), (-1,1), "Helvetica-Bold", 8.2),
    ("BACKGROUND", (0,1), (-1,1), HDRBG),
    ("FONT", (0,2), (-1,-1), "Helvetica", 8.2),
    ("ALIGN", (1,1), (-1,-1), "RIGHT"),
    ("GRID", (0,1), (-1,-1), 0.25, RULE),
    ("LINEBELOW", (0,1), (-1,1), 0.8, INK),
    ("TOPPADDING", (0,1), (-1,-1), 3), ("BOTTOMPADDING", (0,1), (-1,-1), 3),
]))

two_up = Table([[lt, st]], colWidths=[2.75*inch, 4.65*inch])
two_up.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),
                            ("LEFTPADDING",(0,0),(-1,-1),0),
                            ("RIGHTPADDING",(0,0),(-1,-1),0)]))
S.append(two_up)

S.append(Paragraph("Transcription notes", H2))
S.append(Paragraph(
    "The source PDF is a flat raster with no text layer, so every label was read off the drawing. "
    "Three items could not be read cleanly and are flagged in red in the tables:", BODY))
S.append(Paragraph(
    "• <b>Pts. 101 / 102 (EP)</b> — the two labels print on top of each other. Read as "
    "101 = +0.066 and 102 = +0.019; the pairing of number to value should be confirmed on site.<br/>"
    "• <b>Unnumbered point at +0.250 &ldquo;new&rdquo;</b> — the point number is overstruck by "
    "linework and is illegible. By elimination it is most likely pt. 32.<br/>"
    "• <b>Pts. 1, 2, 12, 17, 27 and 146</b> do not appear anywhere on the sheet.", BODY))
S.append(Spacer(1, 4))
S.append(Paragraph(
    "Everything else was read at full resolution and cross-checked. Fractions are rounded to the "
    "nearest 1/4 in.; use the decimal inch column where tighter tolerance matters.", SMALL))

# ---- master table, two columns per page
S.append(PageBreak())
S.append(Paragraph("All grade points, by point number", H2))
S.append(Spacer(1, 2))
S.append(build_table(rows))

# ---- shoring, deepest first
S.append(PageBreak())
S.append(Paragraph("Shoring points, deepest first", H2))
S.append(Paragraph("Same data, re-sorted so the deepest excavation grades read first.", SMALL))
S.append(Spacer(1, 2))
sh = sorted([r for r in rows if r["desc"].lower() == "shoring"], key=lambda r: r["elev"])
S.append(build_table(sh))

# ---- source drawing
S.append(PageBreak())
S.append(Paragraph("Source drawing", H2))
S.append(Paragraph("Dock_B_Survey_Surface_ll_a (Model) — reproduced for reference.", SMALL))
S.append(Spacer(1, 6))
img = Image("content300.png")
maxw = FW; maxh = FH - 1.1*inch
sc = min(maxw/3187.0, maxh/4567.0)
img.drawWidth = 3187*sc; img.drawHeight = 4567*sc
S.append(img)

doc.build(S)
print("built")
