"""Wording the product must never show. Applied to reference data in tests and to all AI output at runtime."""
import re

FORBIDDEN = [
    r"\bcorrect (?:medicine )?for you\b",
    r"\b(?:is|are) (?:the )?right (?:medicine|medication|dose) for you\b",
    r"\byou should (?:take|start|stop|use)\b",
    r"\byou (?:must|need to) (?:take|start|stop)\b",
    r"(?<!not )(?<!n't )\bstop taking\b",
    r"\bdiscontinue\b",
    r"\b(?:increase|decrease|reduce|double|halve) (?:your|the) (?:dose|dosage)\b",
    r"\btake \d+(?:\.\d+)?\s*(?:mg|mcg|g)\b",
    r"\binstead of (?:your|the) (?:prescribed|prescription)\b",
    r"\byou (?:have|are suffering from) (?:diabetes|hypertension|heart disease|high cholesterol|cancer)\b",
    r"\b(?:is|are) (?:authentic|genuine|counterfeit|fake)\b",
    r"\bsafe (?:for you )?to (?:take|combine|stop)\b",
    r"दवा (?:लेना )?बंद कर(?:ें|ो|दें)",
    r"खुराक (?:बढ़ा|घटा)(?:एं|ओ|लें)",
]
_PATTERNS = [re.compile(pattern, re.I) for pattern in FORBIDDEN]
# Technical terms patients shouldn't meet in the default simple view.
JARGON = [r"\bhyperlipid", r"\bantihypertensive\b", r"\bpharmacokinetic\b", r"\bpharmacodynamic\b", r"\bdyslipid"]
_JARGON = [re.compile(pattern, re.I) for pattern in JARGON]


def violations(text: str) -> list[str]:
    return [pattern.pattern for pattern in _PATTERNS if pattern.search(text)]


def jargon(text: str) -> list[str]:
    return [pattern.pattern for pattern in _JARGON if pattern.search(text)]


def numbers_are_grounded(output: str, facts: str) -> bool:
    """Every number in generated text must already appear in the verified facts."""
    return set(re.findall(r"\d+(?:\.\d+)?", output)) <= set(re.findall(r"\d+(?:\.\d+)?", facts))


def is_safe_explanation(output: str, facts: str) -> bool:
    return bool(output.strip()) and not violations(output) and not jargon(output) and numbers_are_grounded(output, facts)
