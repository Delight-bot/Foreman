"""Reading a wiring diagram: reference handling, netlist rendering and the cleaning rules.

These need no services and no model: the vision call is the only part that does, and it is
covered from the API side in test_api.py.
"""
from app.answer import _netlist_steps
from app.entities import Entities, device_of, extract, normalise_ref, refs_in
from app.schematic import (Connection, Device, SchematicReading, Terminal, clean, is_useful,
                           looks_like_schematic, netlist_text)
from app.search_text import is_code, tokenize


def reading(**kw) -> SchematicReading:
    base = {"is_schematic": True, "title": "", "devices": [], "terminals": [], "connections": [], "unreadable": []}
    return SchematicReading(**{**base, **kw})


def test_a_terminal_is_recognised_however_the_manual_spells_it():
    for spelling in ["X4:7", "-X4:7", "X4.7", "X4 : 7", "x4:7", "=A1-X4:7"]:
        assert normalise_ref(spelling) == "X4:7", spelling
    assert normalise_ref("K3") == "K3" and normalise_ref("KS1") == "KS1"
    assert device_of("X4:7") == "X4" and device_of("K3") == "K3"
    assert normalise_ref("relay board") == "" and normalise_ref("") == ""
    # Part numbers and section headings are not terminals.
    assert normalise_ref("3RT2016-1BB42") == "" and normalise_ref("4.2.3") == ""


def test_refs_are_found_in_prose_and_in_questions():
    assert refs_in("Terminal X4:7 now carries the interlock from KS1 to relay K2 coil A1") == {"X4:7"}
    assert refs_in("what does x4:7 land on?") == {"X4:7"}
    # refs_in is strict DEVICE:TERMINAL syntax; reading prose is the extractor's job.
    assert refs_in("relay K2 coil A1") == set()
    assert refs_in("Measure continuity across pins 13 and 14 of K3") == set()
    assert extract("X4:7 goes to K2:A1").terminals == {"X4:7", "K2:A1"}


def test_a_terminal_survives_tokenizing_whole_and_in_pieces():
    toks = tokenize("Terminal X4:7 is spare")
    assert {"x4:7", "x4", "7", "x47"} <= set(toks)
    assert is_code("x4:7"), "a terminal must reach the exact-identifier vector"


def test_only_drawings_that_talk_like_circuits_cost_a_vision_call():
    assert looks_like_schematic("Fig. 13 Terminal strip X4, cabinet B", "X4:7 SPARE K3 13")
    assert looks_like_schematic("Fig. 12 Relay board, cabinet B", "K1 K2 K3 K4 +24 V DC 0 V")
    assert not looks_like_schematic("Fig. 4 Exploded view of the gearbox", "1 2 3 4")
    assert not looks_like_schematic("Fig. 7 The drive as delivered", "")


def test_cleaning_canonicalises_and_drops_what_cannot_be_used():
    out = clean(reading(
        title="  Cabinet B  ",
        devices=[Device(designation="-X4", kind="Terminal Strip"), Device(designation="X4", kind=""),
                 Device(designation="the relay board", kind="")],
        terminals=[Terminal(ref="X4.7", label="  spare  ")],
        connections=[Connection(from_ref="X4:5", to_ref="K3:13", wire="214"),
                     Connection(from_ref="K3:13", to_ref="X4:5", wire=""),   # the same wire, reversed
                     Connection(from_ref="X4:6", to_ref="X4:6", wire=""),    # a terminal onto itself
                     Connection(from_ref="X4:9", to_ref="", wire="")]))      # an endpoint off the crop
    assert out.title == "Cabinet B"
    assert [(d.designation, d.kind) for d in out.devices] == [("X4", "terminal strip")]
    assert [(c.from_ref, c.to_ref, c.wire) for c in out.connections] == [("K3:13", "X4:5", "214")]
    # The spare terminal is kept with its label, and both wired endpoints become terminals too.
    assert {t.ref for t in out.terminals} == {"X4:7", "X4:5", "K3:13"}
    assert next(t for t in out.terminals if t.ref == "X4:7").label == "spare"


def test_a_figure_with_nothing_to_read_earns_no_chunk():
    assert not is_useful(clean(reading(is_schematic=False, terminals=[Terminal(ref="X4:7", label="")])))
    assert not is_useful(clean(reading()))
    assert is_useful(clean(reading(terminals=[Terminal(ref="X4:7", label="spare")])))


def test_the_netlist_reads_as_evidence_and_indexes_as_identifiers():
    text = netlist_text(clean(reading(
        title="Terminal strip X4, cabinet B",
        devices=[Device(designation="X4", kind="terminal strip")],
        terminals=[Terminal(ref="X4:5", label="drive enable"), Terminal(ref="X4:7", label="spare")],
        connections=[Connection(from_ref="X4:5", to_ref="K3:13", wire="214")],
        unreadable=["the label under X4:8"])))
    assert "K3:13 - X4:5 (wire 214)" in text  # a wire has no direction; one fixed order
    assert "Terminals shown with no connection: X4:7" in text
    assert "X4:5 drive enable" in text
    assert "Not readable in this drawing: the label under X4:8" in text
    # Every line of the netlist is retrievable by the terminal it names.
    assert {"x4:5", "k3:13", "x4:7"} <= set(tokenize(text))


def test_entities_carry_terminals_into_the_graph():
    e = extract("Terminal X4:7 now carries the interlock signal from safety relay KS1 to relay K2 coil A1.")
    assert e.terminals == {"X4:7", "K2:A1"}
    assert "KS1" in e.components and "K2" in e.components
    assert bool(Entities(terminals={"X4:7"})), "a terminal alone is enough to query the graph"


def test_extractive_answers_quote_the_netlist_lines_about_the_terminal_asked_about():
    chunk = {"id": 7, "text": netlist_text(clean(reading(
        title="Terminal strip X4",
        terminals=[Terminal(ref="X4:7", label="spare")],
        connections=[Connection(from_ref="X4:5", to_ref="K3:13", wire="214"),
                     Connection(from_ref="X4:6", to_ref="K3:14", wire="215")])))}

    asked = _netlist_steps(chunk, {"X4:5"})
    assert [c.text for c in asked] == ["K3:13 - X4:5 (wire 214)"]
    assert all(c.chunk_ids == [7] for c in asked), "every line cites the drawing it was read from"

    # A terminal the drawing shows with nothing on it is an answer too, not a blank.
    assert any("X4:7" in c.text for c in _netlist_steps(chunk, {"X4:7"}))
    # With no terminal in the question, every line of the netlist stands as the evidence.
    assert len(_netlist_steps(chunk, set())) == 4
