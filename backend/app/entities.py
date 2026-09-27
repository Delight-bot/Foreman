"""The things a plant talks about: fault codes, components and part numbers.

They become nodes in the asset graph and anchor multi-hop retrieval: fault E-42 leads to
procedure 4.2.3, which involves relay K3, which the retrofit bulletin says is now K4.
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


@dataclass
class Entities:
    faults: set[str] = field(default_factory=set)
    components: set[str] = field(default_factory=set)
    parts: set[str] = field(default_factory=set)

    def __bool__(self):
        return bool(self.faults or self.components or self.parts)

    def as_dict(self):
        return {"faults": sorted(self.faults), "components": sorted(self.components), "parts": sorted(self.parts)}


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
    return e
