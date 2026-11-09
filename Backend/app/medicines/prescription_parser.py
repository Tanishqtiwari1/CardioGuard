"""Reads medicine lines out of prescription text.

Only what is written is extracted. A missing frequency stays missing, and every line comes back
unconfirmed: the patient checks each one before anything is compared or scheduled.
"""
import re

from app.medicines import repository
from app.medicines.identification import match_name, near_names
from app.medicines.text import STRENGTH_PAIR_RE, STRENGTH_RE, format_strength, same_strength, tokens

PREFIX_RE = re.compile(r"^\s*(?:\d{1,2}\s*[.)]\s*)?(?:rx\s*[:.]?\s*)?(tab(?:let)?s?|cap(?:sule)?s?|syp|syrup|inj(?:ection)?|t|c)\b\.?", re.I)
SLOTS_RE = re.compile(r"(?<![\d./-])([01½]|1/2)\s*[-–—xX]\s*([01½]|1/2)\s*[-–—xX]\s*([01½]|1/2)(?:\s*[-–—xX]\s*([01½]|1/2))?(?![\d/])")
DURATION_RE = re.compile(r"(?:[x×*]|for)\s*(\d{1,3})\s*(days?|d|weeks?|wks?|w|months?|mths?|m)\b", re.I)
DURATION_ALT_RE = re.compile(r"\b(\d{1,3})\s*(days?|weeks?|wks?|months?|mths?)\b", re.I)
DOSE_RE = re.compile(r"\b(½|1/2|\d{1,2}(?:\.\d)?)\s*(tablets?|tabs?|capsules?|caps?|puffs?|units?|ml)\b", re.I)
DURATION_DAYS = {"d": 1, "w": 7, "m": 30}

FREQUENCY_RULES = [
    (re.compile(r"\b(sos|prn|as\s+needed|when\s+required|if\s+needed)\b", re.I), None, "as_needed"),
    (re.compile(r"\b(qid|q\.i\.d|four\s+times)\b", re.I), 4, "four_daily"),
    (re.compile(r"\b(tds|tid|t\.d\.s|t\.i\.d|thrice|three\s+times)\b", re.I), 3, "three_daily"),
    (re.compile(r"\b(bd|bid|b\.d|b\.i\.d|twice|two\s+times|12\s*hourly)\b", re.I), 2, "twice_daily"),
    (re.compile(r"\b(od|o\.d|qd|once(?:\s+(?:a\s+)?da(?:y|ily))?|one\s+time|daily)\b", re.I), 1, "once_daily"),
    (re.compile(r"\b(hs|h\.s|at\s+bed\s*time|bedtime)\b", re.I), 1, "once_daily"),
]
TIMING_RULES = [
    ("after_breakfast", r"\bafter\s+(?:b/?f|breakfast)\b"),
    ("before_breakfast", r"\bbefore\s+(?:b/?f|breakfast)\b"),
    ("after_lunch", r"\bafter\s+lunch\b"),
    ("before_lunch", r"\bbefore\s+lunch\b"),
    ("after_dinner", r"\bafter\s+(?:dinner|supper)\b"),
    ("before_dinner", r"\bbefore\s+(?:dinner|supper)\b"),
    ("bedtime", r"\b(?:hs|h\.s|at\s+bed\s*time|bedtime)\b"),
    ("night", r"\b(?:at\s+night|night|nocte|रात)\b"),
    ("evening", r"\b(?:in\s+the\s+evening|evening|शाम)\b"),
    ("afternoon", r"\b(?:afternoon|दोपहर)\b"),
    ("morning", r"\b(?:in\s+the\s+morning|morning|mane|सुबह)\b"),
    ("empty_stomach", r"\bempty\s+stomach\b"),
]
FOOD_RULES = [
    ("after_food", r"\b(?:after\s+(?:food|meals?)|p\.?c\.?|खाने\s+के\s+बाद)\b"),
    ("before_food", r"\b(?:before\s+(?:food|meals?)|a\.?c\.?|खाने\s+से\s+पहले)\b"),
    ("with_food", r"\bwith\s+(?:food|meals?)\b"),
]
SLOT_NAMES = ["morning", "afternoon", "evening_or_night", "night"]
# A meal states the time of day more exactly than the general word beside it ("1-0-0 after breakfast").
MORE_SPECIFIC = {
    "morning": ("before_breakfast", "after_breakfast", "empty_stomach"),
    "afternoon": ("before_lunch", "after_lunch"),
    "evening_or_night": ("before_dinner", "after_dinner"),
    "night": ("before_dinner", "after_dinner", "bedtime"),
}
HEADER_WORDS = {"name", "age", "sex", "date", "dr", "doctor", "patient", "mobile", "phone", "address", "regd", "reg", "clinic", "hospital", "diagnosis", "bp", "pulse", "weight", "advice"}


def merge_timing(slots: list[str]) -> list[str]:
    unique = list(dict.fromkeys(slots))
    return [slot for slot in unique if not any(detail in unique for detail in MORE_SPECIFIC.get(slot, ()))]


def _strength(line: str, item: dict | None) -> str | None:
    pair = STRENGTH_PAIR_RE.search(line)
    if pair:
        unit_b = pair.group(4)
        return f"{format_strength(float(pair.group(1)), pair.group(2) or unit_b)} + {format_strength(float(pair.group(3)), unit_b)}"
    found = STRENGTH_RE.search(line)
    if found:
        return format_strength(float(found.group(1)), found.group(2))
    if item and item["strengths"]:
        words = tokens(line)
        unit = STRENGTH_RE.search(item["strengths"][0]).group(2)
        for word in words:
            if re.fullmatch(r"\d+(\.\d+)?", word) and any(same_strength(format_strength(float(word), unit), option) for option in item["strengths"]):
                return format_strength(float(word), unit)
    return None


def _frequency(line: str) -> tuple[int | None, str | None, bool, list[str]]:
    """Returns (times per day, frequency code, as needed, timing slots from a 1-0-1 pattern)."""
    if FREQUENCY_RULES[0][0].search(line):
        return None, "as_needed", True, []
    slots = SLOTS_RE.search(line)
    if slots:
        values = [value for value in slots.groups() if value is not None]
        names = SLOT_NAMES if len(values) == 4 else ["morning", "afternoon", "night"]
        taken = [names[index] for index, value in enumerate(values) if value != "0"]
        count = len(taken)
        code = {1: "once_daily", 2: "twice_daily", 3: "three_daily", 4: "four_daily"}.get(count)
        return (count or None), code, False, taken
    for pattern, count, code in FREQUENCY_RULES[1:]:
        if pattern.search(line):
            return count, code, False, []
    return None, None, False, []


def _duration(line: str) -> tuple[int | None, str | None]:
    match = DURATION_RE.search(line) or DURATION_ALT_RE.search(line)
    if not match:
        return None, None
    count = int(match.group(1))
    days = count * DURATION_DAYS[match.group(2)[0].lower()]
    return (days if 0 < days <= 730 else None), match.group(0).strip()


def parse_line(raw: str) -> dict | None:
    line = " ".join(raw.split())
    if len(line) < 3:
        return None
    words = tokens(line)
    if words and words[0] in HEADER_WORDS:
        return None

    has_prefix = bool(PREFIX_RE.search(line))
    named = match_name(line)
    near = [] if named else near_names(PREFIX_RE.sub("", line))
    # A line that names nothing and has no Tab/Cap prefix is not a medicine line.
    if not named and not has_prefix:
        return None
    item = repository.entry(named["key"]) if named else None

    times, frequency, as_needed, slots = _frequency(line)
    timing = [key for key, pattern in TIMING_RULES if re.search(pattern, line, re.I)]
    food = next((key for key, pattern in FOOD_RULES if re.search(pattern, line, re.I)), None)
    days, duration_text = _duration(line)
    dose = DOSE_RE.search(line)

    if not item:
        written = PREFIX_RE.sub("", line).strip()
        written = re.split(r"\s+\d|\s+(?:od|bd|tds|bid|tid|hs|sos)\b", written, maxsplit=1, flags=re.I)[0].strip(" .:-")
    return {
        "raw_line": line[:300],
        "medicine_key": item["key"] if item else None,
        "medicine_name": item["name"] if item else (written[:120] or None),
        "brand_written": named["hit"]["alias"] if named and named["hit"]["kind"] == "brand" else None,
        "strength": _strength(line, item),
        "dose": f"{dose.group(1)} {dose.group(2).lower()}" if dose else None,
        "frequency": frequency,
        "times_per_day": times,
        "as_needed": as_needed,
        "timing": merge_timing([*slots, *timing]),
        "food_relation": food,
        "duration_days": days,
        "duration_text": duration_text,
        "instructions": None,
        "confidence": "high" if item else "needs_confirmation",
        "candidates": near[:3],
        "confirmed": False,
    }


def parse_prescription(text: str) -> dict:
    items = [parsed for parsed in map(parse_line, (text or "").splitlines()) if parsed]
    return {"items": items[:30], "readable": bool(items)}
