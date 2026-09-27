"""Tokenizing for identifiers: "E-42" yields e-42, e, 42 and e42, so every spelling matches.

The colon is a separator too, so the terminal "X4:7" survives whole and is also findable as x4."""
import re

TOKEN = re.compile(r"[a-z0-9]+(?:[-./:][a-z0-9]+)*")
STOP = set("""a an and are as at be by for from has have how i if in is it its my of on or so that the
this to was were what when where which why will with do does not no me our your can
""".split())


def is_code(tok: str) -> bool:
    """Identifier-like: letters and digits together (e-42, k3, 3rt2016-1bb42) or digit-dash-digit (4-3)."""
    return bool(re.search(r"\d", tok) and re.search(r"[a-z]", tok)) or bool(re.fullmatch(r"\d+[-./:]\d+", tok))


def tokenize(text: str) -> list[str]:
    out = []
    for t in TOKEN.findall(text.lower()):
        if t in STOP:
            continue
        out.append(t)
        parts = re.split(r"[-./:]", t)
        if len(parts) > 1:
            out.extend(p for p in parts if p and p not in STOP)
            out.append("".join(parts))
    return out
