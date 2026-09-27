"""Read a wiring diagram as a netlist, not as a picture.

A schematic is the one page where the answer is not in the prose. "What does terminal X4:7
land on" is printed as a line between two symbols, and a caption cannot carry it. The vision
model reads the drawing into devices, terminals and the connections between them; the result
is stored three ways, so it behaves like every other piece of evidence in Foreman:

  * a `schematic` chunk whose text is the netlist, indexed and searchable ("X4:7" matches),
  * the structured reading in `chunks.data`, so Neo4j can be rebuilt from PostgreSQL,
  * Terminal nodes and CONNECTS_TO edges in the graph, so a question naming one terminal
    retrieves the drawing that shows it.

The drawing is never paraphrased into an answer on its own: the netlist is quoted, cited and
outlined on the page like any other source, and what the model could not make out is listed
rather than guessed.
"""
import logging
import re

from pydantic import BaseModel

from . import llm
from .entities import normalise_ref, refs_in

log = logging.getLogger("foreman.schematic")

# Words that make a figure worth a second, more expensive look.
SCHEMATIC_WORDS = re.compile(
    r"\b(wiring|schematic|circuit|terminal|terminals|diagram|connection|connections|"
    r"ladder|loop|interlock|strip|board|pin|pins|coil|contact)\b", re.I)

MAX_CONNECTIONS = 120  # a drawing that reads longer than this is almost certainly hallucinating
MAX_TERMINALS = 200


class Device(BaseModel):
    designation: str  # as printed: K3, X4, KS1, F7
    kind: str  # relay, terminal strip, breaker, motor, sensor - "" when the drawing does not say


class Terminal(BaseModel):
    ref: str  # device and terminal as printed: X4:7, K3:13, K3:A1
    label: str  # the function printed beside it, if any: "drive enable", "0 V return"


class Connection(BaseModel):
    from_ref: str
    to_ref: str
    wire: str  # printed wire number or signal name on the line, "" when unlabelled


class SchematicReading(BaseModel):
    """What the vision model sees in one drawing. Empty lists are a valid answer."""

    is_schematic: bool  # false for photographs, exploded views and decorative figures
    title: str
    devices: list[Device]
    terminals: list[Terminal]
    connections: list[Connection]
    unreadable: list[str]  # parts of the drawing too small or too faint to read


SYSTEM = (
    "You read electrical and control drawings from equipment manuals: wiring diagrams, terminal "
    "strip layouts, ladder logic and circuit schematics. Transcribe the drawing as a netlist.\n"
    "- Report device designations exactly as printed (K3, X4, KS1, F7, -X4).\n"
    "- Write a terminal as DEVICE:TERMINAL, e.g. X4:7, K3:13, K3:A1.\n"
    "- Report a connection only where a line, wire or rail visibly joins two points. Give the "
    "wire number or signal name printed on it, or an empty string.\n"
    "- A terminal drawn with no wire on it is still a terminal: list it, and label it with what "
    "is printed beside it, such as 'spare'.\n"
    "- Never infer a connection from what would be usual for this kind of circuit, and never "
    "complete a line that runs off the edge of the crop. Put anything you cannot make out in "
    "unreadable instead of guessing it.\n"
    "- Set is_schematic to false if the figure is a photograph, an exploded parts view or any "
    "other drawing that has no electrical connections to read."
)


def looks_like_schematic(caption: str, labels: str) -> bool:
    """Cheap pre-filter: is this figure worth a vision call?

    Reading a drawing costs a model call per figure, so only figures that talk like a circuit
    get one. A printed terminal reference is decisive on its own; otherwise we want circuit
    vocabulary and at least one device designation among the labels."""
    blob = f"{caption}\n{labels}"
    if refs_in(blob):
        return True
    designations = {w for w in re.findall(r"\b[A-Z]{1,3}\d{1,3}\b", blob.upper())
                    if not w.startswith(("FIG", "TAB", "PAGE"))}
    return bool(SCHEMATIC_WORDS.search(blob)) and len(designations) >= 2


def _pair(a: str, b: str) -> tuple[str, str]:
    """A wire has two ends and no direction, so it is stored in one fixed order."""
    return (a, b) if a <= b else (b, a)


def clean(reading: SchematicReading) -> SchematicReading:
    """Canonicalise references and drop what cannot be trusted.

    The model returns what it sees; this keeps only what the rest of Foreman can use - real
    references, no self-connections, no duplicates - and caps the size, because a reading far
    longer than any real drawing means the model lost its place rather than found more wires."""
    devices, seen_dev = [], set()
    for d in reading.devices:
        ref = normalise_ref(d.designation)
        if ref and ":" not in ref and ref not in seen_dev:
            seen_dev.add(ref)
            devices.append(Device(designation=ref, kind=d.kind.strip().lower()))

    terminals, seen_term = [], set()
    for t in reading.terminals:
        ref = normalise_ref(t.ref)
        if ":" in ref and ref not in seen_term and len(terminals) < MAX_TERMINALS:
            seen_term.add(ref)
            terminals.append(Terminal(ref=ref, label=" ".join(t.label.split())))

    connections, seen_conn = [], set()
    for c in reading.connections:
        a, b = _pair(normalise_ref(c.from_ref), normalise_ref(c.to_ref))
        if not a or not b or a == b or (a, b) in seen_conn or len(connections) >= MAX_CONNECTIONS:
            continue
        seen_conn.add((a, b))
        connections.append(Connection(from_ref=a, to_ref=b, wire=" ".join(c.wire.split())))

    # Endpoints the model wired up but forgot to list are still terminals of this drawing.
    for a, b in sorted(seen_conn):
        for ref in (a, b):
            if ":" in ref and ref not in seen_term and len(terminals) < MAX_TERMINALS:
                seen_term.add(ref)
                terminals.append(Terminal(ref=ref, label=""))

    return SchematicReading(
        is_schematic=reading.is_schematic,
        title=" ".join(reading.title.split()),
        devices=devices,
        terminals=sorted(terminals, key=lambda t: t.ref),
        connections=sorted(connections, key=lambda c: (c.from_ref, c.to_ref)),
        unreadable=[" ".join(u.split()) for u in reading.unreadable if u.strip()],
    )


def is_useful(reading: SchematicReading) -> bool:
    """A reading earns its own chunk only when it says something the caption could not."""
    return reading.is_schematic and bool(reading.connections or reading.terminals)


def netlist_text(reading: SchematicReading, caption: str = "") -> str:
    """The netlist as the technician reads it and the index searches it.

    This is the chunk text, so it is also the passage a claim is checked against: every line
    here is something the model reported seeing in the drawing."""
    connected = {r for c in reading.connections for r in (c.from_ref, c.to_ref)}
    lines = [f"Wiring diagram: {reading.title or caption or 'schematic'}"]

    if reading.devices:
        lines.append("Devices: " + ", ".join(f"{d.designation} ({d.kind})" if d.kind else d.designation
                                             for d in reading.devices))
    if reading.connections:
        lines.append("Connections shown in the drawing:")
        lines += [f"{c.from_ref} - {c.to_ref}" + (f" (wire {c.wire})" if c.wire else "")
                  for c in reading.connections]

    labelled = [f"{t.ref} {t.label}" for t in reading.terminals if t.label]
    if labelled:
        lines.append("Terminal labels: " + "; ".join(labelled))
    spare = [t.ref for t in reading.terminals if t.ref not in connected]
    if spare:
        lines.append("Terminals shown with no connection: " + ", ".join(spare))
    if reading.unreadable:
        lines.append("Not readable in this drawing: " + "; ".join(reading.unreadable))
    return "\n".join(lines)


def read(png: bytes, caption: str) -> SchematicReading | None:
    """Read one drawing. Returns None when the model is unavailable or sees no circuit."""
    try:
        result, _ = llm.parse(
            SYSTEM,
            [llm.image_block(png), {"type": "text", "text": f"Printed caption: {caption or '(none)'}"}],
            SchematicReading, effort="high")
    except llm.LLMUnavailable as e:
        log.warning("schematic reading skipped: %s", e)
        return None
    reading = clean(result)
    return reading if is_useful(reading) else None
