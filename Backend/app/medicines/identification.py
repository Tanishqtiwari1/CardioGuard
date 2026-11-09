"""Turns text read from a medicine pack into a medicine, with an honest confidence level.

Rules that keep this safe:
  - A poor image or unreadable text returns "unable". Nothing is guessed.
  - "high" needs an exact name, a strength printed on the pack that is known for that medicine,
    and a clear read. Anything less is "needs_confirmation".
  - A near-miss spelling is never treated as a match, only offered for the patient to confirm.
    Many medicine names differ by a letter or two.
"""
import calendar
import re
from datetime import date

from app.medicines import repository
from app.medicines.text import (
    STRENGTH_PAIR_RE, STRENGTH_RE, alias_index, edit_distance, format_number, format_strength,
    max_alias_words, normalise_alias, same_strength, strength_values, tokens,
)

HIGH = "high"
CONFIRM = "needs_confirmation"
UNABLE = "unable"

# Below this the OCR engine itself is unsure of the characters.
MIN_READABLE_OCR = 30
MIN_HIGH_CONFIDENCE_OCR = 60

# Words printed on most packs. These must never fuzzy-match a medicine name.
PACK_WORDS = {
    "tablet", "tablets", "capsule", "capsules", "contains", "contain", "manufactured", "marketed", "pharma",
    "pharmaceuticals", "limited", "laboratories", "healthcare", "schedule", "warning", "dosage", "keep", "store",
    "storage", "children", "reach", "medicine", "prescription", "directed", "physician", "coated", "release",
    "extended", "sustained", "film", "colour", "color", "titanium", "dioxide", "lactose", "batch", "expiry",
    "license", "licence", "price", "taxes", "inclusive", "doctor", "patient", "morning", "evening", "night",
    "daily", "after", "before", "breakfast", "lunch", "dinner", "water", "syrup", "injection", "strip", "each",
    "date", "india", "private", "drops", "cream", "protect", "moisture", "light", "temperature", "below",
}
ADVICE_WORDS = {"once", "twice", "thrice", "days", "weeks", "months", "with", "food", "meal", "meals"}

FORMS = [
    ("tablet", r"\b(tablets?|tabs?\.?|film[- ]coated)\b"),
    ("capsule", r"\b(capsules?|caps?\.?)\b"),
    ("syrup", r"\b(syrups?|syp\.?|suspension|oral solution)\b"),
    ("injection", r"\b(injections?|inj\.?|vials?|pre-?filled|cartridge)\b"),
    ("inhaler", r"\b(inhalers?|rotacaps?|respules?)\b"),
    ("spray", r"\bspray\b"),
    ("sachet", r"\b(sachets?|granules)\b"),
    ("drops", r"\bdrops\b"),
    ("gel", r"\b(gel|cream|ointment)\b"),
]
MONTHS = {name.lower(): number for number, name in enumerate(calendar.month_abbr) if name}

EXPIRY_RE = re.compile(
    r"\b(?:exp(?:iry)?|use\s*before|best\s*before|ex)\b\.?\s*(?:date|dt\.?)?\s*[:.\-]?\s*"
    r"((?:\d{1,2}[/.\-])?\d{1,2}[/.\-]\d{2,4}|(?:\d{1,2}[\s\-])?[a-z]{3,9}[\s.\-/']*\d{2,4})",
    re.I,
)
BATCH_RE = re.compile(r"\b(?:b\.?\s*no|batch(?:\s*no)?|lot(?:\s*no)?)\b\.?\s*[:.\-]?\s*([a-z0-9][a-z0-9\-/]{2,14})", re.I)
MFG_RE = re.compile(r"\b(?:mfd|mfg|manufactured|mktd|marketed|mkt)\b\.?\s*(?:by)?\s*[:.\-]?\s*([a-z][a-z&.,' \-]{3,60})", re.I)
COMPANY_RE = re.compile(r"\b([A-Z][A-Za-z&.' ]{2,40}\s(?:Pharma(?:ceuticals)?|Laboratories|Labs|Healthcare|Life\s?Sciences|Remedies|Biotech)(?:\s(?:Ltd\.?|Limited|Pvt\.?\s?Ltd\.?))?)")


def parse_expiry(text: str) -> str | None:
    """The last day of the printed month, as YYYY-MM-DD. Packs print only a month and year."""
    match = EXPIRY_RE.search(text)
    if not match:
        return None
    raw = match.group(1).strip()
    parts = [part for part in re.split(r"[/.\-\s']+", raw) if part]
    if len(parts) < 2:
        return None
    year_text, month_text = parts[-1], parts[-2]
    if not year_text.isdigit():
        return None
    year = int(year_text)
    year = year + 2000 if year < 100 else year
    month = MONTHS.get(month_text[:3].lower()) if month_text.isalpha() else int(month_text)
    if not month or not 1 <= month <= 12 or not 2000 <= year <= 2099:
        return None
    return date(year, month, calendar.monthrange(year, month)[1]).isoformat()


def _find_exact_aliases(words: list[str]) -> list[dict]:
    index = alias_index()
    hits, position = [], 0
    limit = max_alias_words()
    while position < len(words):
        matched = 0
        for size in range(min(limit, len(words) - position), 0, -1):
            alias = " ".join(words[position:position + size])
            if alias not in index:
                continue
            following = words[position + size] if position + size < len(words) else ""
            # Very short brand names ("Pan", "Mox") are ordinary words unless a number follows them.
            if len(alias) < 4 and not re.fullmatch(r"\d+(\.\d+)?", following):
                continue
            for hit in index[alias]:
                hits.append({**hit, "matched": alias, "end": position + size})
            matched = size
            break
        position += matched or 1
    return hits


def _find_near_misses(words: list[str]) -> list[dict]:
    index = alias_index()
    best: dict[str, dict] = {}
    for word in dict.fromkeys(words):
        if len(word) < 5 or word.isdigit() or word in PACK_WORDS or word in ADVICE_WORDS:
            continue
        allowed = 1 if len(word) < 8 else 2
        repaired = word.translate(str.maketrans("015", "ols"))
        for alias, targets in index.items():
            if " " in alias or len(alias) < 5:
                continue
            distance = min(edit_distance(word, alias, allowed), edit_distance(repaired, alias, allowed))
            if distance <= allowed and distance > 0:
                for target in targets:
                    current = best.get(target["key"])
                    if not current or distance < current["distance"]:
                        best[target["key"]] = {**target, "distance": distance, "read_as": word}
    return sorted(best.values(), key=lambda item: item["distance"])[:4]


def _resolve(hits: list[dict]) -> tuple[list[str], dict | None]:
    """Reduce name hits to one medicine. Returns (candidate keys, the winning hit or None)."""
    entries = repository.knowledge()["entries"]
    brand_hits = [hit for hit in hits if hit["kind"] == "brand"]
    generic_keys = list(dict.fromkeys(hit["key"] for hit in hits if hit["kind"] == "generic"))

    # A combination brand ("Telma-AM") already explains the generics printed beside it.
    for hit in sorted(brand_hits, key=lambda item: -len(entries[item["key"]]["ingredients"])):
        ingredients = set(entries[hit["key"]]["ingredients"])
        others = {ingredient for key in generic_keys for ingredient in entries[key]["ingredients"]} - ingredients
        other_brands = {b["key"] for b in brand_hits if not set(entries[b["key"]]["ingredients"]) <= ingredients}
        if not others and not other_brands:
            return [hit["key"]], hit

    if brand_hits:
        return list(dict.fromkeys([*(hit["key"] for hit in brand_hits), *generic_keys])), None
    if len(generic_keys) == 1:
        hit = next(hit for hit in hits if hit["kind"] == "generic")
        return generic_keys, hit
    if len(generic_keys) > 1:
        wanted = {ingredient for key in generic_keys for ingredient in entries[key]["ingredients"]}
        for item in repository.all_entries():
            if set(item["ingredients"]) == wanted:
                return [item["key"]], {"key": item["key"], "kind": "generic", "matched": " + ".join(generic_keys), "end": hits[-1]["end"]}
        return generic_keys, None
    return [], None


def _read_strength(text: str, words: list[str], item: dict, hit: dict | None) -> tuple[str | None, list[str]]:
    """Returns (strength, notes). The strength is only what the pack shows."""
    known = item["strengths"]
    notes: list[str] = []
    if len(item["ingredients"]) > 1:
        return _read_combination_strength(text, words, item, hit)

    printed = list(dict.fromkeys(format_strength(float(number), unit) for number, unit in STRENGTH_RE.findall(text)))
    valid = [strength for strength in printed if any(same_strength(strength, candidate) for candidate in known)]
    if len(valid) == 1:
        return valid[0], notes
    if len(valid) > 1:
        return None, ["several_strengths"]
    if printed:
        if len(printed) == 1 and known:
            return printed[0], ["unusual_strength"]
        if len(printed) == 1:
            return printed[0], notes
        return None, ["several_strengths"]

    # "Telma 40": a bare number straight after the brand, accepted only if that strength exists.
    if hit and hit["end"] < len(words) and re.fullmatch(r"\d+(\.\d+)?", words[hit["end"]]):
        unit = STRENGTH_RE.search(known[0]).group(2) if known else "mg"
        candidate = format_strength(float(words[hit["end"]]), unit)
        if any(same_strength(candidate, option) for option in known):
            return candidate, notes
    return None, ["strength_not_visible"]


def _read_combination_strength(text: str, words: list[str], item: dict, hit: dict | None) -> tuple[str | None, list[str]]:
    known = item["strengths"]
    entries = repository.knowledge()["entries"]

    pair = STRENGTH_PAIR_RE.search(text)
    if pair:
        unit_b = pair.group(4)
        unit_a = pair.group(2) or unit_b
        value = f"{format_strength(float(pair.group(1)), unit_a)} + {format_strength(float(pair.group(3)), unit_b)}"
        if any(same_strength(value, option) for option in known) or not known:
            return value, []

    # Composition lines: "Telmisartan IP 40 mg ... Amlodipine IP 5 mg".
    parts = []
    lowered = text.lower()
    for ingredient in item["ingredients"]:
        names = [entries[ingredient]["name"].lower(), *entries[ingredient]["generic_aliases"]]
        found = None
        for name in names:
            match = re.search(re.escape(name) + r"[^\d\n]{0,40}?(\d{1,5}(?:\.\d{1,3})?)\s*(mg|mcg|gm|g|iu)\b", lowered)
            if match:
                found = format_strength(float(match.group(1)), match.group(2))
                break
        parts.append(found)
    if all(parts):
        value = " + ".join(parts)
        return value, [] if any(same_strength(value, option) for option in known) or not known else ["unusual_strength"]

    # "Telma-AM 40": a single number can't settle a two-ingredient pack, but it can if only one option fits.
    if hit and hit["end"] < len(words) and re.fullmatch(r"\d+(\.\d+)?", words[hit["end"]]):
        number = float(words[hit["end"]])
        fits = [option for option in known if STRENGTH_RE.search(option) and float(STRENGTH_RE.search(option).group(1)) == number]
        if len(fits) == 1:
            return fits[0], ["strength_partly_visible"]
    return None, ["strength_not_visible"]


def _read_form(text: str, item: dict | None) -> str | None:
    for form, pattern in FORMS:
        if re.search(pattern, text, re.I):
            return form
    return item["forms"][0] if item and len(item["forms"]) == 1 else None


def _read_manufacturer(text: str) -> str | None:
    match = MFG_RE.search(text)
    if match:
        return " ".join(match.group(1).split()).strip(" ,.-")[:80] or None
    match = COMPANY_RE.search(text)
    return " ".join(match.group(1).split())[:80] if match else None


def _unable(reason: str, text: str = "") -> dict:
    return {
        "status": UNABLE,
        "reason": reason,
        "medicine_key": None,
        "medicine_name": None,
        "generic_name": None,
        "brand_name": None,
        "strength": None,
        "dosage_form": None,
        "manufacturer": None,
        "expiry_date": None,
        "batch_number": None,
        "candidates": [],
        "notes": [],
        "source_text": text[:1500],
    }


def _candidate(key: str) -> dict:
    item = repository.entry(key)
    return {"key": key, "name": item["name"], "strengths": item["strengths"]}


def identify(text: str, ocr_confidence: float | None = None, quality_issues: list[str] | None = None) -> dict:
    """OCR text -> an identification result. Pure function: no I/O and no model calls."""
    quality_issues = quality_issues or []
    text = (text or "").strip()

    if quality_issues:
        return _unable(quality_issues[0], text)
    if ocr_confidence is not None and ocr_confidence < MIN_READABLE_OCR:
        return _unable("unreadable_text", text)
    if sum(char.isalpha() for char in text) < 5:
        return _unable("unreadable_text", text)

    words = tokens(text)
    hits = _find_exact_aliases(words)
    keys, winner = _resolve(hits)

    if not keys:
        near = _find_near_misses(words)
        if not near:
            return _unable("name_not_found", text)
        result = _unable("name_uncertain", text)
        result.update(status=CONFIRM, candidates=[_candidate(hit["key"]) for hit in near], notes=["similar_name_only"])
        return result

    if len(keys) > 1 or winner is None:
        result = _unable("several_medicines", text)
        result.update(status=CONFIRM, candidates=[_candidate(key) for key in keys[:4]], notes=["several_medicines"])
        return result

    item = repository.entry(keys[0])
    strength, notes = _read_strength(text, words, item, winner)
    status = HIGH
    if notes:
        status = CONFIRM
    if ocr_confidence is not None and ocr_confidence < MIN_HIGH_CONFIDENCE_OCR:
        status = CONFIRM
        notes = [*notes, "low_read_confidence"]

    return {
        "status": status,
        "reason": None,
        "medicine_key": item["key"],
        "medicine_name": item["name"],
        "generic_name": item["name"],
        "brand_name": winner["alias"] if winner["kind"] == "brand" else None,
        "strength": strength,
        "dosage_form": _read_form(text, item),
        "manufacturer": _read_manufacturer(text),
        "expiry_date": parse_expiry(text),
        "batch_number": (BATCH_RE.search(text).group(1).upper() if BATCH_RE.search(text) else None),
        "candidates": [],
        "notes": notes,
        "source_text": text[:1500],
    }


def match_name(text: str) -> dict | None:
    """Exact name lookup for one prescription line or manual entry."""
    hits = _find_exact_aliases(tokens(text))
    keys, winner = _resolve(hits)
    if len(keys) == 1 and winner:
        return {"key": keys[0], "hit": winner}
    return None


def near_names(text: str) -> list[dict]:
    return [_candidate(hit["key"]) for hit in _find_near_misses(tokens(text))]


def search(query: str, limit: int = 8) -> list[dict]:
    needle = normalise_alias(query)
    if len(needle) < 2:
        return []
    scored = []
    for item in repository.all_entries():
        names = [item["name"], *item["brands"], *item["generic_aliases"]]
        normalised = [normalise_alias(name) for name in names]
        if any(name.startswith(needle) for name in normalised):
            scored.append((0, item))
        elif any(needle in name for name in normalised):
            scored.append((1, item))
    return [
        {"key": item["key"], "name": item["name"], "brands": item["brands"][:4], "strengths": item["strengths"], "forms": item["forms"]}
        for _, item in sorted(scored, key=lambda pair: (pair[0], pair[1]["name"]))[:limit]
    ]


__all__ = ["identify", "match_name", "near_names", "search", "format_number", "strength_values", "HIGH", "CONFIRM", "UNABLE"]
