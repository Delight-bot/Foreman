"""Carrying a conversation forward: the thread walk, what it reads back, what it keeps.

These need no services and no model. The end-to-end follow-up is covered in test_api.py.
"""
import inspect

import pytest

from app.answer import (MAX_CARRIED_CHUNKS, _table_steps, ask, audience_of, carried_ids, conversation,
                        thread_of)


class Cursor:
    def __init__(self, rows):
        self._rows = rows

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def __iter__(self):
        return iter(self._rows)


class FakeConn:
    """Just enough of a connection: look a query up by id, look chunks up by a list of ids."""

    def __init__(self, queries=(), chunks=()):
        self.queries = {q["id"]: q for q in queries}
        self.chunks = {c["id"]: c for c in chunks}

    def execute(self, sql, params=()):
        if "FROM queries" in sql:
            q = self.queries.get(params[0])
            return Cursor([q] if q else [])
        if "FROM chunks" in sql:
            return Cursor([self.chunks[i] for i in params[0] if i in self.chunks])
        raise AssertionError(f"unexpected query: {sql}")


def turn(qid, question, steps=(), parent=None, gap="", asset_id=1):
    return {"id": qid, "parent_id": parent, "question": question, "asset_id": asset_id,
            "answer": {"steps": [{"text": t, "chunk_ids": list(c)} for t, c in steps],
                       "warnings": [], "gap": gap}}


def chunk(cid):
    return {"id": cid, "kind": "text", "label": "", "section": "", "text": f"chunk {cid}",
            "page_no": 1, "page_status": "verified", "score": 0}


def test_a_thread_is_walked_newest_first_and_bounded():
    conn = FakeConn([turn(1, "conveyor stopped with E-42", [("Lock out Q1.", [10])]),
                     turn(2, "and what is the torque spec?", [("0.6 N m.", [11])], parent=1),
                     turn(3, "which wire size?", [("1.5 mm2.", [12])], parent=2)])
    assert [q["id"] for q in thread_of(conn, 3)] == [3, 2, 1]
    assert [q["id"] for q in thread_of(conn, 3, limit=2)] == [3, 2]
    assert thread_of(conn, None) == []
    assert thread_of(conn, 999) == [], "an id that is gone is not a conversation"


def test_a_parent_cycle_cannot_hang_the_request():
    conn = FakeConn([turn(1, "first", parent=2), turn(2, "second", parent=1)])
    assert [q["id"] for q in thread_of(conn, 1)] == [1, 2]


def test_the_conversation_reads_back_oldest_first():
    conn = FakeConn([turn(1, "conveyor stopped with E-42", [("Lock out Q1.", [10]), ("Open panel B.", [10])]),
                     turn(2, "and what is the torque spec?", [("0.6 N m.", [11])], parent=1)])
    text = conversation(thread_of(conn, 2))
    assert text.index("conveyor stopped") < text.index("torque spec"), "oldest first"
    assert "  1. Lock out Q1.\n  2. Open panel B." in text
    assert "Q: and what is the torque spec?" in text


def test_a_turn_that_found_nothing_still_reads_as_a_turn():
    conn = FakeConn([turn(1, "recalibrate the laser scanner", gap="Not in the documents.")])
    assert conversation(thread_of(conn, 1)) == "Q: recalibrate the laser scanner\nA: Not in the documents."


def test_the_previous_answers_pages_are_carried_into_the_next_search():
    conn = FakeConn([turn(1, "E-42", [("Lock out Q1.", [10]), ("Measure 13-14.", [11, 12, 10])])])
    assert carried_ids(thread_of(conn, 1)) == [10, 11, 12], "in order, without repeats"
    assert carried_ids([]) == [], "a first question carries nothing"


def test_carrying_evidence_is_capped():
    ids = list(range(100, 100 + MAX_CARRIED_CHUNKS + 3))
    conn = FakeConn([turn(1, "E-42", [(f"step {i}", [i]) for i in ids])])
    assert len(carried_ids(thread_of(conn, 1))) == MAX_CARRIED_CHUNKS


@pytest.mark.parametrize("steps", [(), (("Lock out Q1.", [10]),)])
def test_a_turn_always_names_the_question_that_was_asked(steps):
    conn = FakeConn([turn(1, "conveyor stopped", steps)])
    assert conversation(thread_of(conn, 1)).startswith("Q: conveyor stopped")


def table(text):
    return {"id": 5, "kind": "table", "text": text}


def test_a_table_answers_the_question_about_it_instead_of_being_left_to_open():
    """The torque values live in a table too short to be split row by row at ingest."""
    steps = _table_steps(table("Table 4-3  Terminal torque\n"
                               "Terminal | Wire | Torque\n"
                               "13, 14 | 1.5 mm2 | 0.6 N m\n"
                               "A1, A2 | 1.5 mm2 | 0.6 N m\n"
                               "L1, T1 | 4.0 mm2 | 1.2 N m"))
    assert [c.text for c in steps] == [
        "Terminal: 13, 14 | Wire: 1.5 mm2 | Torque: 0.6 N m",
        "Terminal: A1, A2 | Wire: 1.5 mm2 | Torque: 0.6 N m",
        "Terminal: L1, T1 | Wire: 4.0 mm2 | Torque: 1.2 N m",
    ]
    assert all(c.chunk_ids == [5] for c in steps), "every row cites the table it was read from"


def test_a_table_with_no_column_names_is_still_quoted_verbatim():
    steps = _table_steps(table("Table 9  Settings\n2310 | overcurrent\n3210 | DC overvoltage"))
    assert [c.text for c in steps] == ["2310 | overcurrent", "3210 | DC overvoltage"]


def test_a_table_with_nothing_under_its_caption_yields_no_steps():
    assert _table_steps(table("Table 1  Empty")) == []


def test_the_audience_defaults_to_the_technician_at_the_machine():
    assert audience_of("engineer") == "engineer"
    assert audience_of("Engineer") == "engineer" and audience_of(" engineer ") == "engineer"
    assert audience_of("technician") == "technician"
    # An older client sends nothing at all; anything unrecognised is not a reason to fail.
    assert audience_of(None) == "technician"
    assert audience_of("") == "technician"
    assert audience_of("wizard") == "technician"
    # It is never confused with `mode`, which records how the answer was produced.
    assert audience_of("model") == "technician" and audience_of("extractive") == "technician"


def test_ask_keeps_its_old_call_shape_and_defaults_the_audience():
    """Every caller that predates a parameter must keep working, positionally and by name."""
    sig = inspect.signature(ask)
    assert list(sig.parameters)[:4] == ["conn", "asset", "question", "photo"]
    assert sig.parameters["follow_up_to"].default is None
    assert sig.parameters["audience"].default == "technician"
