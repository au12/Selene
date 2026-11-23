"""Selene desk clock enclosure — parametric CadQuery model.

    python selene_enclosure.py            # exports STEP + STL + 3MF for every part into ./out

Design: a round "drum" head (front bezel + shell in one piece, printed face-down), a retainer ring
that clamps the display by its glass rim through a foam gasket, a back cover with four 12 mm
panel buttons + 12/24 pinhole + speaker grille + cable notch, a 16 mm LIGHT/SNOOZE button on
top, and a pedestal stand. All fasteners are M3 into brass heat-set inserts.

Board: Waveshare ESP32-P4-WIFI6-Touch-LCD-4C (round cover glass Ø126, active area Ø101.5).
!! Measure YOUR module and adjust the "measure me" values before printing the shell — print
   `fit_test_ring` first (≈20 min) to confirm the glass seat.

Coordinates: clock axis = Z (front face at z=0, back at z=+L_BODY), +Y = top of the clock.
Looking at the FRONT (from -Z), +X is the viewer's LEFT. Back-cover features are laid out in
"rear view" coordinates (looking from +Z, +X to the right), which is what you see when wiring.
"""
from pathlib import Path

import cadquery as cq

# ───────────────────────────── measure me ─────────────────────────────
GLASS_D = 126.0        # cover-glass outline diameter
ACTIVE_D = 101.5       # visible LCD area diameter
RIM_T = 2.2            # thickness of the module at its outer rim (glass only, if the LCD frame is smaller)
PANEL_FRAME_D = 114.0  # diameter of the LCD frame / anything behind the glass rim (retainer clears this)
FOAM_T = 1.5           # compressed thickness of the foam gasket between retainer and glass

# ───────────────────────────── design parameters ──────────────────────
R_OUT = 73.0           # drum outer radius (Ø146)
L_BODY = 56.0          # drum depth (front face → back face)
LIP_T = 2.6            # bezel lip in front of the glass
AP_D = 105.0           # front aperture (shows active area + a thin black ring)
SEAT_CLR = 0.5         # radial clearance around the glass
SEAT_DEPTH = 7.0       # seat bore depth behind the lip
WALL = 3.2
COVER_T = 3.2
REBATE = 2.0           # back rebate widening for the cover
INSERT_D = 4.0         # M3 heat-set insert hole (typical 4.0–4.2)
INSERT_L = 5.0
M3_CLEAR = 3.4
TOP_BTN_D = 16.2       # 16 mm momentary push button (LIGHT/SNOOZE)
REAR_BTN_D = 12.2      # 12 mm momentary push buttons
REAR_BTN_PITCH = 24.0
REAR_BTN_Y = -22.0
SPEAKER_D = 40.0       # speaker pocket (the kit speaker or any Ø28–40 mm 8Ω speaker)

R_SEAT = GLASS_D / 2 + SEAT_CLR
R_IN = R_OUT - WALL
Z_LEDGE = LIP_T + SEAT_DEPTH
OUT = Path(__file__).parent / "out"


def bezel_body() -> cq.Workplane:
    body = cq.Workplane("XY").circle(R_OUT).extrude(L_BODY)
    # front: soft outer edge and a stepped decorative ring
    body = body.faces("<Z").edges().chamfer(1.6)
    body = body.cut(cq.Workplane("XY").circle(AP_D / 2).extrude(LIP_T))
    body = body.cut(cq.Workplane("XY").circle(AP_D / 2 + 3.0).circle(AP_D / 2).extrude(0.8))  # step
    body = body.faces("<Z").edges(cq.selectors.RadiusNthSelector(0)).chamfer(0.6)
    # glass seat and main cavity
    body = body.cut(cq.Workplane("XY").workplane(offset=LIP_T).circle(R_SEAT).extrude(SEAT_DEPTH))
    body = body.cut(cq.Workplane("XY").workplane(offset=Z_LEDGE).circle(R_IN).extrude(L_BODY))
    # back rebate for the cover
    body = body.cut(cq.Workplane("XY").workplane(offset=L_BODY - COVER_T).circle(R_IN + REBATE).extrude(COVER_T + 1))
    # retainer-ring inserts in the ledge (4x)
    r_ins = (R_SEAT + R_IN) / 2
    body = body.cut(
        cq.Workplane("XY").workplane(offset=Z_LEDGE - INSERT_L)
        .polarArray(r_ins, 45, 360, 4).circle(INSERT_D / 2).extrude(INSERT_L + 0.1)
    )
    # back-cover bosses with inserts (4x at 45° so the bottom cable notch stays clear)
    boss_r = R_IN - 3.0
    boss = (cq.Workplane("XY").workplane(offset=L_BODY - COVER_T - 12)
            .polarArray(boss_r, 45, 360, 4).circle(4.2).extrude(12))
    body = body.union(boss)
    body = body.cut(
        cq.Workplane("XY").workplane(offset=L_BODY - COVER_T - INSERT_L - 1)
        .polarArray(boss_r, 45, 360, 4).circle(INSERT_D / 2).extrude(INSERT_L + 2)
    )
    # top LIGHT/SNOOZE button hole (radial, at mid depth)
    body = body.cut(
        cq.Workplane("XZ", origin=(0, R_OUT + 1, L_BODY * 0.48)).circle(TOP_BTN_D / 2).extrude(WALL + 3)
    )
    # flat landing for the button nut inside / bezel outside
    body = body.cut(
        cq.Workplane("XZ", origin=(0, R_OUT + 0.6, L_BODY * 0.48)).rect(26, 26).extrude(0.9)
    )
    # stand screws through the bottom wall (2x)
    for x in (-22.0, 22.0):
        body = body.cut(cq.Workplane("XZ", origin=(x, -R_OUT + 6, L_BODY * 0.5)).circle(M3_CLEAR / 2).extrude(-10))
    # cable notch at the bottom of the back rim (USB-C)
    body = body.cut(cq.Workplane("XY").workplane(offset=L_BODY - 9).center(0, -R_OUT + 2).rect(18, 10).extrude(10))
    return body


def retainer_ring() -> cq.Workplane:
    """Clamps the display by its glass rim (foam gasket between). Flange bolts to the ledge."""
    nose_l = SEAT_DEPTH - RIM_T - FOAM_T
    flange = cq.Workplane("XY").circle(R_IN - 0.4).circle(PANEL_FRAME_D / 2 + 1.0).extrude(2.6)
    nose = cq.Workplane("XY").workplane(offset=-nose_l).circle(R_SEAT - 0.5).circle(PANEL_FRAME_D / 2 + 1.0).extrude(nose_l)
    ring = flange.union(nose)
    r_ins = (R_SEAT + R_IN) / 2
    ring = ring.cut(cq.Workplane("XY").workplane(offset=-1).polarArray(r_ins, 45, 360, 4).circle(M3_CLEAR / 2).extrude(5))
    # FPC / cable relief at the bottom
    ring = ring.cut(cq.Workplane("XY").workplane(offset=-nose_l - 1).center(0, -(R_SEAT - 4)).rect(36, 14).extrude(nose_l + 4))
    return ring


def back_cover() -> cq.Workplane:
    r = R_IN + REBATE - 0.25
    cov = cq.Workplane("XY").circle(r).extrude(COVER_T)
    cov = cov.edges(">Z").fillet(1.0)
    # screws (countersunk) into the bosses — mirrored because we look at it from the back
    boss_r = R_IN - 3.0
    cov = cov.faces(">Z").workplane().polarArray(boss_r, 45, 360, 4).cskHole(M3_CLEAR, 6.4, 90)
    # rear buttons: SET · MODE · REV · FWD (left→right seen from the back)
    xs = [(-1.5 + i) * REAR_BTN_PITCH for i in range(4)]
    cov = cov.cut(cq.Workplane("XY").pushPoints([(x, REAR_BTN_Y) for x in xs]).circle(REAR_BTN_D / 2).extrude(COVER_T))
    # 12/24 pin hole (6x6 tactile switch glued behind)
    cov = cov.cut(cq.Workplane("XY").center(56, REAR_BTN_Y).circle(1.1).extrude(COVER_T))
    # speaker grille + locating ring
    pts = []
    pitch = 3.6
    for j in range(-6, 7):
        for i in range(-6, 7):
            x = i * pitch + (pitch / 2 if j % 2 else 0)
            y = j * pitch * 0.866
            if x * x + y * y < (SPEAKER_D / 2 - 3) ** 2:
                pts.append((x, y + 24))
    cov = cov.cut(cq.Workplane("XY").pushPoints(pts).circle(1.15).extrude(COVER_T))
    ring = cq.Workplane("XY").workplane(offset=-4).center(0, 24).circle(SPEAKER_D / 2 + 2.2).circle(SPEAKER_D / 2 + 0.4).extrude(4)
    cov = cov.union(ring)
    # vents
    for k in range(-3, 4):
        cov = cov.cut(cq.Workplane("XY").center(k * 9.0, 52).slot2D(16, 3.2, 90).extrude(COVER_T))
    # cable notch (matches the shell)
    cov = cov.cut(cq.Workplane("XY").center(0, -r + 3).rect(18, 8).extrude(COVER_T))
    # labels (debossed 0.6 mm)
    labels = [("SET", xs[0]), ("MODE", xs[1]), ("REV", xs[2]), ("FWD", xs[3])]
    for txt, x in labels:
        cov = cov.cut(cq.Workplane("XY").workplane(offset=COVER_T - 0.6).center(x, REAR_BTN_Y + 11.5)
                      .text(txt, 4.2, 0.7, kind="bold", halign="center", valign="center"))
    cov = cov.cut(cq.Workplane("XY").workplane(offset=COVER_T - 0.6).center(56, REAR_BTN_Y + 6.5)
                  .text("12/24", 3.0, 0.7, kind="bold", halign="center", valign="center"))
    cov = cov.cut(cq.Workplane("XY").workplane(offset=COVER_T - 0.6).center(0, -44)
                  .text("SELENE  ·  LUNAR ALARM", 4.0, 0.7, kind="bold", halign="center", valign="center"))
    return cov


def stand() -> cq.Workplane:
    """Pedestal: trapezoid foot with a saddle that matches the drum."""
    depth = 44.0
    prof = (cq.Workplane("XY").polyline([(-62, 0), (62, 0), (36, 34), (-36, 34)]).close().extrude(depth))
    prof = prof.edges("|Z").fillet(4.0)
    # saddle: cut by the drum cylinder (axis along Z of the part = clock axis)
    drum = cq.Workplane("XY").workplane(offset=-1).center(0, 34 + R_OUT - 12).circle(R_OUT + 0.3).extrude(depth + 2)
    st = prof.cut(drum)
    st = st.faces("<Y").edges().chamfer(1.2)
    # inserts for the two drum screws (vertical, from the saddle)
    for x in (-22.0, 22.0):
        y_top = 34 + R_OUT - 12 - (R_OUT ** 2 - x ** 2) ** 0.5
        st = st.cut(cq.Workplane("XZ", origin=(x, y_top + 0.5, depth / 2)).circle(INSERT_D / 2).extrude(INSERT_L + 0.5))
    # felt pad recesses
    st = st.cut(cq.Workplane("XZ", origin=(0, 0, 0)).pushPoints([(-45, depth / 2), (45, depth / 2)]).rect(16, 30).extrude(-0.8))
    return st


def fit_test_ring() -> cq.Workplane:
    """Front lip + glass seat + ledge only — print first to check the display fit."""
    h = Z_LEDGE + 2.0
    return bezel_body().intersect(cq.Workplane("XY").circle(R_OUT + 1).extrude(h))


PARTS = {
    "bezel_body": bezel_body,
    "retainer_ring": retainer_ring,
    "back_cover": back_cover,
    "stand": stand,
    "fit_test_ring": fit_test_ring,
}


def main():
    OUT.mkdir(exist_ok=True)
    for name, fn in PARTS.items():
        part = fn()
        cq.exporters.export(part, str(OUT / f"{name}.step"))
        cq.exporters.export(part, str(OUT / f"{name}.stl"), tolerance=0.02, angularTolerance=0.12)
        try:
            cq.exporters.export(part, str(OUT / f"{name}.3mf"), tolerance=0.02, angularTolerance=0.12)
        except Exception as e:  # 3MF needs a recent CadQuery
            print("3mf skipped:", e)
        bb = part.val().BoundingBox()
        print(f"{name:14s} {bb.xlen:6.1f} x {bb.ylen:6.1f} x {bb.zlen:6.1f} mm  volume {part.val().Volume()/1000:6.1f} cm³")


if __name__ == "__main__":
    main()
