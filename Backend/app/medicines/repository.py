"""Read-only access to the medicine reference data. Nothing in this module is generated at runtime.

Reference data lives in knowledge/*.json so it can be reviewed and versioned on its own:
  classes.json       what a type of medicine is, its common uses and safety points
  medicines.json     ingredients, combinations, brand names, condition and lab vocabularies
  interactions.json  interaction rules
  label_sources.json real FDA label records, written by scripts/sync_medicine_sources.py
"""
import json
from functools import lru_cache
from pathlib import Path

KNOWLEDGE = Path(__file__).parent / "knowledge"
REFERENCE_VERSION = "2026.11"
# Clinical sign-off is a human step. Change this only after a pharmacist has reviewed the data.
REVIEW_STATUS = "pending_clinical_review"

COMMON_SEEK_HELP = {
    "en": "Swelling of the face, lips or throat, or trouble breathing: call 108 or 112",
    "hi": "चेहरे, होंठ या गले में सूजन, या सांस लेने में तकलीफ: 108 या 112 पर कॉल करें",
}


def _load(name: str):
    with open(KNOWLEDGE / name, encoding="utf-8") as handle:
        return json.load(handle)


def _dedupe(items: list[dict]) -> list[dict]:
    seen, unique = set(), []
    for item in items:
        if item["en"] not in seen:
            seen.add(item["en"])
            unique.append(item)
    return unique


def _source_for(ingredients: list[str], labels: dict) -> dict:
    found = [labels[key] for key in ingredients if labels.get(key)]
    if found and len(found) == len(ingredients):
        return {
            "name": "US FDA drug label (via openFDA)",
            "kind": "fda_label",
            "labels": found,
            "version": max(item["effective_date"] for item in found),
            "last_verified": min(item["retrieved"] for item in found),
            "review_status": REVIEW_STATUS,
        }
    return {
        "name": "CardioGuard medicine reference",
        "kind": "internal_reference",
        "labels": found,
        "version": REFERENCE_VERSION,
        "last_verified": None,
        "review_status": REVIEW_STATUS,
    }


@lru_cache(maxsize=1)
def knowledge() -> dict:
    classes = _load("classes.json")
    data = _load("medicines.json")
    interactions = _load("interactions.json")
    try:
        sources = _load("label_sources.json")
    except FileNotFoundError:
        sources = {"labels": {}, "interactions": {}}

    ingredients = {item["key"]: item for item in data["ingredients"]}
    entries: dict[str, dict] = {}

    for item in data["ingredients"]:
        klass = classes[item["class"]]
        name = {"en": item["name"], "hi": item.get("hi", item["name"])}
        entries[item["key"]] = {
            "key": item["key"],
            "name": item["name"],
            "name_hi": name["hi"],
            "ingredients": [item["key"]],
            "classes": [item["class"]],
            "strengths": item["strengths"],
            "forms": item["forms"],
            "brands": item["brands"],
            "generic_aliases": item.get("generic_aliases", []),
            "standalone": item.get("standalone", True),
            "type_label": klass["label"],
            "medical_type": klass["medical"],
            "what_is": {lang: klass["what_is"][lang].replace("{name}", name[lang]) for lang in ("en", "hi")},
            "uses": klass["uses"],
            "use_short": klass["use_short"],
            "links": klass["links"],
            "precautions": klass["precautions"],
            "side_effects": klass["side_effects"],
            "seek_help": [*klass["seek_help"], COMMON_SEEK_HELP],
            "cautions": klass["cautions"],
            "labs": klass["labs"],
            "allergy_terms": klass["allergy_terms"],
            "tags": {item["key"], item["class"], *klass["groups"], *item.get("extra_tags", [])},
            "source": _source_for([item["key"]], sources["labels"]),
        }

    rank = {"commonly_used": 2, "may_be_related": 1}
    for combo in data["combinations"]:
        parts = [entries[key] for key in combo["ingredients"]]
        name_en = " + ".join(part["name"] for part in parts)
        name_hi = " + ".join(part["name_hi"] for part in parts)
        links: dict[str, str] = {}
        cautions: dict[str, dict] = {}
        labs: list[str] = []
        for part in parts:
            for condition, relation in part["links"].items():
                if rank[relation] > rank.get(links.get(condition), 0):
                    links[condition] = relation
            cautions.update(part["cautions"])
            labs += [lab for lab in part["labs"] if lab not in labs]
        entries[combo["key"]] = {
            "key": combo["key"],
            "name": name_en,
            "name_hi": name_hi,
            "ingredients": combo["ingredients"],
            "classes": [cls for part in parts for cls in part["classes"]],
            "strengths": combo["strengths"],
            "forms": combo["forms"],
            "brands": combo["brands"],
            "generic_aliases": [],
            "standalone": True,
            "type_label": {
                "en": "Combination medicine: " + "; ".join(part["type_label"]["en"] for part in parts),
                "hi": "मिश्रित दवा: " + "; ".join(part["type_label"]["hi"] for part in parts),
            },
            "medical_type": " + ".join(part["medical_type"] for part in parts),
            "what_is": {
                "en": f"This product contains more than one medicine: {name_en}. " + " ".join(part["what_is"]["en"] for part in parts),
                "hi": f"इस दवा में एक से अधिक दवाएं हैं: {name_hi}। " + " ".join(part["what_is"]["hi"] for part in parts),
            },
            "uses": _dedupe([use for part in parts for use in part["uses"]]),
            "use_short": {
                "en": " and ".join(dict.fromkeys(part["use_short"]["en"] for part in parts)),
                "hi": " और ".join(dict.fromkeys(part["use_short"]["hi"] for part in parts)),
            },
            "links": links,
            "precautions": _dedupe([item for part in parts for item in part["precautions"]]),
            "side_effects": _dedupe([item for part in parts for item in part["side_effects"]]),
            "seek_help": _dedupe([item for part in parts for item in part["seek_help"]]),
            "cautions": cautions,
            "labs": labs,
            "allergy_terms": [term for part in parts for term in part["allergy_terms"]],
            "tags": set().union(*(part["tags"] for part in parts)),
            "source": _source_for(combo["ingredients"], sources["labels"]),
        }

    return {
        "entries": entries,
        "ingredients": ingredients,
        "conditions": data["conditions"],
        "labs": data["labs"],
        "interactions": interactions,
        "interaction_sources": sources.get("interactions", {}),
    }


def entry(key: str | None) -> dict | None:
    return knowledge()["entries"].get(key) if key else None


def all_entries() -> list[dict]:
    return [item for item in knowledge()["entries"].values() if item["standalone"]]


def condition_label(key: str) -> dict:
    return knowledge()["conditions"].get(key) or {"en": key, "hi": key}


def is_known_condition(key: str) -> bool:
    return key in knowledge()["conditions"]


def public_entry(item: dict) -> dict:
    """The reference fields safe to send to the browser (sets are not JSON serialisable)."""
    return {key: value for key, value in item.items() if key not in {"tags", "allergy_terms", "links", "cautions", "standalone"}}
