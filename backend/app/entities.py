"""The things a plant talks about: fault codes, components, part numbers and terminals.

They become nodes in the asset graph and anchor multi-hop retrieval: fault E-42 leads to
procedure 4.2.3, which involves relay K3, which the retrofit bulletin says is now K4; and
terminal X4:7 leads to the drawing that shows what it lands on.
"""
import re
from dataclasses import dataclass, field

# "fault E-42", "alarm P-11", "code E42", or a fault-code table row "E-42 | Relay board ..."
FAULT_CTX = re.compile(r"\b(?:fault|alarm|error|code|shows)\s+([A-Z]{1,2})-?(\d{2,3})\b", re.I)
# Drive-style codes: ABB uses four characters, decimal or hex ("fault 2310", "Code (hex): A2B1").
FAULT_DRIVE = re.compile(r"\b(?:fault|alarm|error|warning|code|shows)\b[^\n]{0,12}?\b([0-9][0-9A-F]{3}|[A-F][0-9A-F]{3})\b", re.I)
FAULT_ROW = re.compile(r"^\s*([A-Z]{1,2})-(\d{2,3})\s*\|", re.M)
FAULT_HEAD = re.compile(r"\b([A-Z]{1,2})-(\d{2,3})\s*$")  # "4.2.3 Continuity fault E-42"
# Designations on drawings: relay K3, breaker F7, disconnect Q1, switch S14, sensor B21, valve V1, safety relay KS1.
COMPONENT = re.compile(r"\b(KS|FS|VS|K|Q|F|S|B|V)(\d{1,2})\b")
# Orderable parts: "part 3RT2016-1BB42", "element HF-220".
PART = re.compile(r"\b(?:part|element|kit|p/n)\s+(?:no\.?\s+|number\s+)?([A-Z0-9]+(?:-[A-Z0-9]+)+)\b", re.I)
# A terminal: a device designation and one of its terminals, as drawings and prose write it.
# The terminal side is numbered (X4:7, K3:13) or a coil designation (K2:A1, KS1:A2).
TERMINAL = re.compile(r"\b([A-Z]{1,3}\d{1,3})\s*[:.]\s*([A-Z]{0,2}\d{1,3}[A-Z]?)\b")
# The same terminal written out in prose: "relay K2 coil A1", "K3 pin 13", "X4 terminal 7".
TERMINAL_PROSE = re.compile(r"\b([A-Z]{1,3}\d{1,3})\s+(?:coil|terminal|terminals|pin|pins)\s+"
                            r"([A-Z]{0,2}\d{1,3}[A-Z]?)\b", re.I)
DESIGNATION = re.compile(r"^([A-Z]{1,3}\d{1,3})$")


def normalise_ref(raw: str) -> str:
    """Canonical form of a terminal or device reference, or "" if it is neither.

    Manuals write the same terminal as "X4:7", "-X4:7", "X4.7" and "X4 : 7"; the graph needs
    one spelling so the drawing, the prose and the technician's question all meet."""
    s = (raw or "").strip().upper().replace(" ", "").lstrip("-=+")  # -X4:7
    if "-" in s and TERMINAL.fullmatch(s.rsplit("-", 1)[-1]):
        s = s.rsplit("-", 1)[-1]  # IEC location prefix: =A1-X4:7
    if m := TERMINAL.fullmatch(s):
        return f"{m.group(1)}:{m.group(2)}"
    return m.group(1) if (m := DESIGNATION.fullmatch(s)) else ""


def device_of(ref: str) -> str:
    """"X4:7" -> "X4". A device reference is its own device."""
    return ref.split(":", 1)[0]


def refs_in(text: str) -> set[str]:
    """Every terminal reference written in a piece of text, canonicalised."""
    return {f"{d}:{t}" for d, t in TERMINAL.findall((text or "").upper())}


@dataclass
class Entities:
    faults: set[str] = field(default_factory=set)
    components: set[str] = field(default_factory=set)
    parts: set[str] = field(default_factory=set)
    terminals: set[str] = field(default_factory=set)

    def __bool__(self):
        return bool(self.faults or self.components or self.parts or self.terminals)

    def as_dict(self):
        return {"faults": sorted(self.faults), "components": sorted(self.components),
                "parts": sorted(self.parts), "terminals": sorted(self.terminals)}


def _fault(letters: str, digits: str) -> str:
    return f"{letters.upper()}-{digits}"


def extract(text: str, section: str = "", loose: bool = False) -> Entities:
    """Entities in a chunk. `loose` also accepts bare codes like E-42, for technicians' questions."""
    e = Entities()
    for m in FAULT_CTX.finditer(text):
        e.faults.add(_fault(*m.groups()))
    for m in FAULT_ROW.finditer(text):
        e.faults.add(_fault(*m.groups()))
    if section and (m := FAULT_HEAD.search(section)):
        e.faults.add(_fault(*m.groups()))
    for m in FAULT_DRIVE.finditer(text):
        e.faults.add(m.group(1).upper())
    if loose:
        for m in re.finditer(r"\b([A-Z]{1,2})-?(\d{2,3})\b", text.upper()):
            e.faults.add(_fault(*m.groups()))
        # A technician often types the bare code: "3210", "A2B1".
        for m in re.finditer(r"\b(?=[0-9A-F]{4}\b)(?=[^\n]*\d)([0-9A-F]{4})\b", text.upper()):
            e.faults.add(m.group(1))
    e.components.update(a + b for a, b in COMPONENT.findall(text if not loose else text.upper()))
    e.parts.update(p.upper() for p in PART.findall(text))
    # Terminals reach the graph from a schematic's netlist ("X4:7"), from tables and from
    # prose that spells the same thing out ("relay K2 coil A1").
    e.terminals.update(refs_in(text))
    e.terminals.update(f"{d.upper()}:{t.upper()}" for d, t in TERMINAL_PROSE.findall(text))
    return e
