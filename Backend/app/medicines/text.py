"""Small text helpers shared by medicine identification and prescription parsing."""
import re
from functools import lru_cache

from app.medicines.repository import all_entries, knowledge

STRENGTH_RE = re.compile(r"(?<![\d.])(\d{1,6}(?:\.\d{1,3})?)\s*(mg|mcg|µg|ug|gm|g|iu)\b", re.I)
STRENGTH_PAIR_RE = re.compile(
    r"(?<![\d.])(\d{1,5}(?:\.\d{1,3})?)\s*(mg|mcg|gm|g)?\s*[/+&]\s*(\d{1,5}(?:\.\d{1,3})?)\s*(mg|mcg|gm|g)\b", re.I
)
TO_MG = {"mg": 1.0, "mcg": 0.001, "µg": 0.001, "ug": 0.001, "g": 1000.0, "gm": 1000.0}


def tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+(?:\.[0-9]+)?", text.lower())


def format_number(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


def format_strength(value: float, unit: str) -> str:
    unit = unit.lower().replace("µg", "mcg").replace("ug", "mcg").replace("gm", "g")
    return f"{format_number(value)} {'IU' if unit == 'iu' else unit}"


def strength_values(strength: str | None) -> tuple:
    """Comparable values for a strength, so '0.25 mg' equals '250 mcg' and order doesn't matter."""
    if not strength:
        return ()
    values = []
    for number, unit in STRENGTH_RE.findall(strength):
        unit = unit.lower()
        values.append(("iu", float(number)) if unit == "iu" else ("mg", round(float(number) * TO_MG[unit], 4)))
    return tuple(sorted(values))


def same_strength(left: str | None, right: str | None) -> bool:
    return bool(strength_values(left)) and strength_values(left) == strength_values(right)


def edit_distance(left: str, right: str, limit: int = 3) -> int:
    if abs(len(left) - len(right)) > limit:
        return limit + 1
    previous = list(range(len(right) + 1))
    for row, left_char in enumerate(left, 1):
        current = [row]
        for col, right_char in enumerate(right, 1):
            current.append(min(previous[col] + 1, current[col - 1] + 1, previous[col - 1] + (left_char != right_char)))
        previous = current
    return previous[-1]


def normalise_alias(text: str) -> str:
    return " ".join(tokens(text))


@lru_cache(maxsize=1)
def alias_index() -> dict[str, list[dict]]:
    """Every generic and brand name, normalised, mapped to what it refers to."""
    index: dict[str, list[dict]] = {}

    def add(alias: str, key: str, kind: str):
        normalised = normalise_alias(alias)
        if normalised and not any(hit["key"] == key for hit in index.get(normalised, [])):
            index.setdefault(normalised, []).append({"key": key, "kind": kind, "alias": alias})

    entries = knowledge()["entries"]
    for item in entries.values():
        if "+" not in item["key"]:
            add(item["name"], item["key"], "generic")
            for alias in item["generic_aliases"]:
                add(alias, item["key"], "generic")
    for item in all_entries():
        for brand in item["brands"]:
            add(brand, item["key"], "brand")
    return index


def max_alias_words() -> int:
    return max(len(alias.split()) for alias in alias_index())
