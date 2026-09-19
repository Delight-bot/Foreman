"""Demo library: generates sample manuals as real PDFs and ingests them.

The CV-12 drive manual is 48 pages with the E-42 relay procedure on page 47, a torque
table and a wiring figure. A 2023 service bulletin moves that check from relay K3 to K4
(it drives the correction loop). A scanned addendum has no text layer, so it lands in
the review queue. Run `python -m app.sample --reset` to rebuild the demo data.
"""
import argparse
import os
import shutil
import uuid

import pymupdf

from . import config, db, graph, index, ingest

W, H = 612, 792
LEFT, RIGHT = 64, 548
INK = (0.106, 0.125, 0.157)
GREY = (0.29, 0.33, 0.39)
ORANGE = (0.9, 0.41, 0.17)


class Writer:
    def __init__(self, header: str):
        self.doc = pymupdf.open()
        self.header = header
        self.page = None
        self.y = 0

    def new_page(self):
        self.page = self.doc.new_page(width=W, height=H)
        n = len(self.doc)
        self.page.insert_text((LEFT, 26), self.header, fontsize=7.5, fontname="helv", color=GREY)
        self.page.insert_text((RIGHT - 30, H - 22), f"{n}", fontsize=8, fontname="helv", color=GREY)
        self.y = 64

    def _box(self, text, size, font="helv", color=INK, indent=0, gap=8):
        r = pymupdf.Rect(LEFT + indent, self.y, RIGHT, H - 60)
        left = self.page.insert_textbox(r, text, fontsize=size, fontname=font, color=color, lineheight=1.3)
        if left < 0:
            raise ValueError(f"text overflows page {len(self.doc)}: {text[:40]}")
        self.y = r.y1 - left + gap

    def h1(self, text):
        self._box(text, 17, "hebo", gap=14)

    def h2(self, text):
        self.y += 4
        self._box(text, 12.5, "hebo", gap=6)

    def p(self, text):
        self._box(text, 10.2)

    def steps(self, items):
        self._box("\n".join(f"{i}. {s}" for i, s in enumerate(items, 1)), 10.2, indent=10)

    def warn(self, text):
        y0 = self.y
        self._box(text, 10.2, "hebo", indent=12, gap=10)
        self.page.draw_rect(pymupdf.Rect(LEFT, y0 - 2, LEFT + 4, self.y - 10), color=ORANGE, fill=ORANGE)

    def table(self, caption, header, rows, widths):
        self._box(caption, 9.5, "hebo", gap=3)
        x0, y = LEFT, self.y
        row_h = 17
        all_rows = [header] + rows
        total = sum(widths)
        for ri, r in enumerate(all_rows):
            x = x0
            for ci, cell in enumerate(r):
                self.page.insert_text((x + 5, y + 12), cell, fontsize=9.5, fontname="hebo" if ri == 0 else "helv", color=INK)
                x += widths[ci]
            y += row_h
        # Ruled grid so table detection can find it.
        for i in range(len(all_rows) + 1):
            self.page.draw_line((x0, self.y + i * row_h), (x0 + total, self.y + i * row_h), color=INK, width=0.8)
        x = x0
        for wv in [0] + widths:
            x += wv
            self.page.draw_line((x, self.y), (x, self.y + len(all_rows) * row_h), color=INK, width=0.8)
        self.y = y + 12

    def figure_relay_board(self, caption, highlight="K3", spare=None):
        top = self.y
        fw, fh = 340, 190
        fx = LEFT + (RIGHT - LEFT - fw) / 2
        pg = self.page
        pg.draw_rect(pymupdf.Rect(fx, top, fx + fw, top + fh), color=INK, width=1.2)
        pg.insert_text((fx + 10, top + 16), "RELAY BOARD  CABINET B", fontsize=8, fontname="helv", color=INK)
        pg.draw_line((fx + 20, top + 40), (fx + fw - 20, top + 40), color=INK, width=1)
        pg.insert_text((fx + 22, top + 34), "+24 V DC", fontsize=7.5, fontname="helv", color=INK)
        pg.draw_line((fx + 20, top + 160), (fx + fw - 20, top + 160), color=INK, width=1)
        pg.insert_text((fx + 22, top + 174), "0 V", fontsize=7.5, fontname="helv", color=INK)
        for i, name in enumerate(["K1", "K2", "K3", "K4"]):
            cx = fx + 50 + i * 78
            hot = name == highlight
            label = "SPARE" if name == spare else name
            col = ORANGE if hot else INK
            pg.draw_line((cx + 20, top + 40), (cx + 20, top + 70), color=INK, width=1)
            pg.draw_rect(pymupdf.Rect(cx, top + 70, cx + 40, top + 125), color=col, width=2.2 if hot else 1.2)
            pg.insert_text((cx + (4 if label == "SPARE" else 12), top + 101), label, fontsize=9 if label == "SPARE" else 11,
                           fontname="hebo", color=col)
            pg.draw_line((cx + 20, top + 125), (cx + 20, top + 160), color=INK, width=1)
            if hot:
                pg.insert_text((cx - 10, top + 68), "13", fontsize=8, fontname="helv", color=ORANGE)
                pg.insert_text((cx + 44, top + 134), "14", fontsize=8, fontname="helv", color=ORANGE)
        self.y = top + fh + 6
        self._box(caption, 9, color=GREY, gap=10)

    def save(self, path):
        self.doc.save(path, garbage=3, deflate=True)
        self.doc.close()


FILLER = [
    ("Belt tracking", [
        "Belt tracking is checked with the conveyor running empty at rated speed. A belt that runs toward one side "
        "wears the edge and can trip the belt misalignment switch S14.",
        "Adjust tracking at the tail pulley take-up only. Turn each adjustment screw no more than a half turn at a "
        "time and let the belt run five full revolutions before judging the result.",
    ]),
    ("Belt tension", [
        "Correct tension is the lowest tension at which the drive pulley does not slip under full load. Excess "
        "tension shortens bearing life on the drive and tail pulleys.",
        "Measure deflection at the midpoint of the return span. Deflection of 12 to 15 mm under a 5 kg load is "
        "within range for the standard 650 mm belt.",
    ]),
    ("Carry rollers", [
        "Carry rollers are sealed for life and are replaced, not serviced. A roller that does not turn freely by "
        "hand, or that is noisy, is replaced at the next planned stop.",
        "Rollers drop into slotted brackets. Lift the belt with the belt lifter tool, remove the roller and fit "
        "the new one with the flats seated fully in the slots.",
    ]),
    ("Gearbox oil", [
        "The drive gearbox is filled with ISO VG 220 synthetic gear oil. Check the level through the sight glass "
        "weekly with the conveyor stopped for at least ten minutes.",
        "Change the oil every 10,000 operating hours or every two years, whichever comes first. Dispose of used "
        "oil according to site procedure.",
    ]),
    ("Drive motor inspection", [
        "Inspect the drive motor quarterly. Clean the cooling fins and the fan cover; a blocked fan cover is the "
        "most common cause of over-temperature faults.",
        "Record the motor current at full load on the HMI diagnostics screen. A rise of more than 10 percent from "
        "the commissioning value warrants a bearing and alignment check.",
    ]),
    ("Guards and interlocks", [
        "All guards are interlocked through safety relay KS1. Test every guard switch monthly by opening it with "
        "the conveyor running at crawl speed; the conveyor must stop within one second.",
        "Never bridge a guard switch. A failed switch is replaced before the conveyor is returned to service.",
    ]),
    ("Emergency stop circuit", [
        "The emergency stop pull-cord runs the full length of the conveyor. Pulling the cord at any point latches "
        "the stop; it is reset at the cord switch, then at the HMI.",
        "Test the pull-cord monthly at the switch farthest from the drive. Check that the cord tension indicator "
        "sits in the green band.",
    ]),
    ("Cleaning", [
        "Clean the belt and rollers with water and a neutral detergent only. Solvents swell the belt cover and "
        "void the belt warranty.",
        "Do not direct high-pressure water at the drive motor, the gearbox seals or the control cabinet.",
    ]),
    ("Speed sensor", [
        "The tail pulley speed sensor B21 detects belt slip and a stalled belt. The sensor gap to the target "
        "wheel is 2 mm; a larger gap causes intermittent slip alarms.",
        "Check the sensor LED while the pulley turns by hand. It should flash once per target tooth.",
    ]),
    ("Spare parts", [
        "Keep one set of critical spares on site: a drive belt, two carry rollers, one return roller, relay "
        "3RT2016-1BB42, fuse set F1 to F8, and a speed sensor.",
        "Order parts by the number on the part label, not by the position on the drawing; positions change "
        "between board revisions.",
    ]),
]


def build_drive_manual(path):
    w = Writer("CV-12 CONVEYOR DRIVE MANUAL  ·  REV. 2019")
    w.new_page()
    w.y = 250
    w._box("CV-12 Conveyor Drive", 28, "hebo", gap=10)
    w._box("Operation and maintenance manual", 15, gap=24)
    w._box("Revision 2019  ·  Document owner: Reliability engineering", 10.5, color=GREY)

    w.new_page()
    w.h1("Contents")
    w.p("1 Safety .......... 3\n2 Description and specifications .......... 6\n3 Operation and preventive "
        "maintenance .......... 10\n4 Control cabinet and relay board .......... 40")

    w.new_page()
    w.h1("1 Safety")
    w.h2("1.1 Lock-out and tag-out")
    w.p("Before any work inside the drive cabinet or on moving parts, isolate the conveyor using the site "
        "lock-out procedure. Main disconnect Q1 isolates the drive motor and the 400 V supply.")
    w.warn("WARNING: The control circuit is backed by a 24 V DC UPS. Opening Q1 does not de-energize the relay "
           "board. Also open breaker F7 before touching the relay board.")
    w.steps(["Stop the conveyor from the HMI and wait for the belt to come to rest.",
             "Open main disconnect Q1 and fit your personal lock and tag.",
             "Open breaker F7 to remove the 24 V DC control supply and fit a lock.",
             "Verify zero energy with a two-pole tester at terminals X1:1 and X1:2."])
    w.h2("1.2 Personal protective equipment")
    w.p("Wear safety glasses, gloves rated for the task and safety footwear. Arc-rated clothing is required "
        "when working in the drive cabinet with Q1 closed, which is only permitted for measurements.")

    w.new_page()
    w.h1("2 Description and specifications")
    w.h2("2.1 Overview")
    w.p("The CV-12 is a flat-belt conveyor driven by a 5.5 kW geared motor through a variable-frequency drive. "
        "Control is by the line PLC over a relay interface board in cabinet B.")
    w.table("Table 2-1  Main data", ["Item", "Value"],
            [["Belt width", "650 mm"], ["Belt speed", "0.2 to 1.2 m/s"], ["Drive motor", "5.5 kW, 400 V"],
             ["Control voltage", "24 V DC"], ["Gear oil", "ISO VG 220"]], [180, 200])

    # Filler so 4.2.3 lands on page 47; tests use a short manual (FOREMAN_SAMPLE_SHORT=1) to keep Docling quick.
    chapter_pages = 2 if os.environ.get("FOREMAN_SAMPLE_SHORT") == "1" else 45 - len(w.doc)
    for i in range(chapter_pages):
        w.new_page()
        if i == 0:
            w.h1("3 Operation and preventive maintenance")
        topic, paras = FILLER[i % len(FILLER)]
        w.h2(f"3.{i + 1} {topic}")
        for para in paras:
            w.p(para)
        if i % 3 == 0:
            w.p("Record the inspection in the CMMS work order with the date, the reading and your initials.")

    w.new_page()  # page 46
    w.h1("4 Control cabinet and relay board")
    w.h2("4.1 Fault codes")
    w.table("Table 4-1  Drive fault codes", ["Code", "Meaning", "See"],
            [["E-17", "Drive overcurrent", "4.2.2"], ["E-31", "Motor over-temperature", "3.5"],
             ["E-42", "Relay board continuity fault", "4.2.3"], ["E-55", "Speed sensor B21 lost", "3.9"]],
            [60, 220, 80])
    w.h2("4.2.2 Drive overcurrent E-17")
    w.p("E-17 is raised by the drive when motor current exceeds 150 percent of rated for more than two seconds. "
        "Check for a jammed roller or product build-up at the tail pulley before resetting.")

    w.new_page()  # page 47
    w.h2("4.2.3 Continuity fault E-42")
    w.p("Fault E-42 indicates an open circuit on the control side of the relay board. The most common cause is a "
        "corroded terminal on relay K3, which switches the drive enable signal.")
    w.warn("WARNING: Lock out Q1 and open breaker F7 before opening panel B. The relay board stays live from the UPS.")
    w.steps(["Lock out main disconnect Q1 and open breaker F7 (see 1.1).",
             "Open panel B and locate relay K3 on the relay board (Fig. 12).",
             "Inspect relay K3 for a corroded terminal on the contactor side.",
             "Measure continuity across pins 13 and 14 of K3 (Fig. 12).",
             "If the circuit is open, replace relay K3 with part 3RT2016-1BB42.",
             "Torque terminals 13 and 14 to the values in Table 4-3.",
             "Close panel B, remove your locks and clear E-42 on the HMI fault screen."])
    w.table("Table 4-3  Terminal torque", ["Terminal", "Wire", "Torque"],
            [["13, 14", "1.5 mm²", "0.6 N·m"], ["A1, A2", "1.5 mm²", "0.6 N·m"], ["L1, T1", "4.0 mm²", "1.2 N·m"]],
            [110, 110, 110])
    w.figure_relay_board("Fig. 12  Relay board, cabinet B. Continuity is measured across pins 13 and 14 of K3.")

    w.new_page()  # page 48
    w.h2("4.3 Replacing the relay board")
    w.p("Replace the complete relay board only when more than one relay position has failed. Photograph the "
        "wiring before removing any conductor and label each wire with its terminal number.")
    w.save(path)


def build_bulletin(path):
    w = Writer("SERVICE BULLETIN SB-2023-04  ·  CV-SERIES RELAY BOARD RETROFIT")
    w.new_page()
    w.h1("SB-2023-04 Relay board retrofit")
    w.p("Applies to CV-series conveyors retrofitted in 2023 with relay board revision C. Retrofitted units carry "
        "a yellow label RB-REV-C inside panel B.")
    w.h2("1 What changed")
    w.p("On revision C boards the drive enable signal is switched by relay K4. The K3 position is not fitted and "
        "is labeled SPARE. Instructions that refer to relay K3 for the E-42 continuity check apply to K4 on these units.")
    w.new_page()
    w.h2("2 E-42 continuity check on revision C boards")
    w.warn("WARNING: Lock out Q1 and open breaker F7 before opening panel B. The relay board stays live from the UPS.")
    w.steps(["Confirm the RB-REV-C label inside panel B.",
             "Locate relay K4 on the relay board; the K3 position is marked SPARE (Fig. 2).",
             "Measure continuity across pins 13 and 14 of K4.",
             "If the circuit is open, replace relay K4 with part 3RT2016-1BB42 and torque terminals 13 and 14 to 0.6 N·m."])
    w.figure_relay_board("Fig. 2  Revision C relay board. The E-42 check moves to K4; K3 is SPARE.",
                         highlight="K4", spare="K3")
    w.save(path)


def build_pump_manual(path):
    w = Writer("PMP-07 COOLANT PUMP  ·  SERVICE INSTRUCTIONS REV. 2021")
    w.new_page()
    w.h1("PMP-07 Coolant pump")
    w.h2("1 Low flow alarm P-11")
    w.p("P-11 is raised when coolant flow at flow switch FS2 stays below 40 L/min for 10 seconds while the pump "
        "is running. The usual causes are a blocked suction strainer or air in the pump casing.")
    w.warn("WARNING: Stop the pump and close suction valve V1 and discharge valve V2 before opening the strainer.")
    w.steps(["Stop the pump at local control station LCS-7.",
             "Close suction valve V1 and discharge valve V2.",
             "Open the suction strainer cover and remove the basket.",
             "Clean the basket and check the cover O-ring; replace it if flattened.",
             "Refit the basket and cover, open V1 and V2, and vent the casing at vent screw VS1 until coolant runs clear.",
             "Restart the pump and confirm flow above 60 L/min on the HMI."])
    w.table("Table 1-1  Pump data", ["Item", "Value"],
            [["Rated flow", "90 L/min"], ["Alarm P-11 threshold", "40 L/min"], ["Motor", "2.2 kW, 400 V"]], [180, 160])
    w.save(path)


def build_scanned_addendum(path):
    """A page with no text layer, like a photocopy that was scanned into the library."""
    src = Writer("LINE 3 WIRING ADDENDUM  ·  HANDWRITTEN MARKUP SCANNED 2022")
    src.new_page()
    src.h1("Line 3 wiring addendum")
    src.p("Cabinet B terminal strip X4 was re-wired in 2022 to add the line 3 interlock. Terminal X4:7 now carries "
          "the interlock signal from safety relay KS1 to relay K2 coil A1.")
    src.table("Table A-1  X4 changes", ["Terminal", "Before", "After"],
              [["X4:7", "spare", "KS1 to K2 A1"], ["X4:8", "spare", "0 V return"]], [100, 120, 160])
    # Page 2: a faded, low-resolution copy of the fuse schedule. OCR cannot read it reliably,
    # so it is quarantined for the owner to review.
    src.new_page()
    src.h1("Cabinet B fuse schedule")
    src.table("Table A-2  Fuses", ["Fuse", "Rating", "Circuit"],
              [["F5", "2 A", "PLC inputs"], ["F6", "4 A", "HMI"], ["F7", "6 A", "Relay board 24 V"]], [80, 80, 200])
    scans = [src.doc[0].get_pixmap(dpi=90, colorspace=pymupdf.csGRAY),
             src.doc[1].get_pixmap(dpi=19, colorspace=pymupdf.csGRAY)]
    src.doc.close()
    out = pymupdf.open()
    for pix in scans:
        page = out.new_page(width=W, height=H)
        page.insert_image(page.rect, pixmap=pix)
    out.save(path)
    out.close()


ASSETS = [
    ("CV-12", "Conveyor CV-12", "Line 3, drive cabinet B"),
    ("CV-14", "Conveyor CV-14", "Line 4, drive cabinet B"),
    ("PMP-07", "Coolant pump PMP-07", "Line 3, coolant skid"),
]

DOCS = [
    # (builder, title, version, owner, contact, asset tags)
    (build_drive_manual, "CV-12 Conveyor Drive Manual", "rev. 2019", "Reliability engineering", "ext. 4417", ["CV-12", "CV-14"]),
    (build_bulletin, "Service Bulletin SB-2023-04", "2023", "Reliability engineering", "ext. 4417", ["CV-14"]),
    (build_pump_manual, "PMP-07 Coolant Pump Service Instructions", "rev. 2021", "Utilities maintenance", "ext. 4520", ["PMP-07"]),
    (build_scanned_addendum, "Line 3 Wiring Addendum (scan)", "2022", "Controls engineering", "ext. 4388", ["CV-12"]),
]


def seed(reset: bool = False) -> None:
    if reset:
        db.reset()
        index.init(recreate=True)
        graph.wipe()
        # Synced folders (OneDrive, Dropbox) can hold directory handles; the files are what matter.
        shutil.rmtree(config.DATA_DIR, ignore_errors=True)
    config.ensure_dirs()
    db.init()
    index.init()
    graph.init()
    with db.session() as conn:
        for tag, name, loc in ASSETS:
            conn.execute("INSERT INTO assets(tag, name, location) VALUES(%s,%s,%s) ON CONFLICT (tag) DO NOTHING",
                         (tag, name, loc))
            graph.upsert_asset(tag, name)
    for builder, title, version, owner, contact, tags in DOCS:
        filename = f"{uuid.uuid4().hex}.pdf"
        builder(str(config.FILES_DIR / filename))
        with db.session() as conn:
            doc_id = conn.execute(
                "INSERT INTO documents(title, version, filename, owner, owner_contact) VALUES(%s,%s,%s,%s,%s) RETURNING id",
                (title, version, filename, owner, contact)).fetchone()["id"]
            for t in tags:
                aid = conn.execute("SELECT id FROM assets WHERE tag=%s", (t,)).fetchone()["id"]
                conn.execute("INSERT INTO document_assets VALUES(%s,%s)", (doc_id, aid))
        ingest.ingest_document(doc_id)
        print(f"ingested {title}", flush=True)


def seed_if_empty() -> None:
    with db.session() as conn:
        empty = conn.execute("SELECT count(*) AS n FROM documents").fetchone()["n"] == 0
    if empty:
        seed()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Build and ingest the Foreman demo library")
    ap.add_argument("--reset", action="store_true", help="delete all data in PostgreSQL, Qdrant and Neo4j first")
    seed(ap.parse_args().reset)
    graph.close()
    db.close()
