"""Deterministic screening across the medicine cabinet. Every finding asks for a professional review."""
from datetime import date
from itertools import combinations

from app.medicines import repository

DISCUSS = {
    "en": "Discuss this with your doctor or pharmacist. Keep following your prescription until you have spoken to them.",
    "hi": "इस बारे में डॉक्टर या फार्मासिस्ट से बात करें। उनसे बात होने तक अपने पर्चे का पालन करते रहें।",
}


def _label(cab: dict) -> str:
    return " ".join(part for part in [cab.get("brand_name") or cab.get("medicine_name"), cab.get("strength")] if part)


def _rule_source(rule_id: str) -> dict:
    evidence = repository.knowledge()["interaction_sources"].get(rule_id)
    if evidence and evidence.get("found"):
        label = evidence["label"]
        return {"name": f"US FDA label: {label['title']}", "kind": "fda_label", "url": label["url"], "version": label["effective_date"], "last_verified": label["retrieved"], "review_status": repository.REVIEW_STATUS}
    return {"name": "CardioGuard medicine reference", "kind": "internal_reference", "url": None, "version": repository.REFERENCE_VERSION, "last_verified": None, "review_status": repository.REVIEW_STATUS}


def _matches(tags: set, selector: str) -> bool:
    return selector in tags


def interactions(cabinet: list[dict]) -> list[dict]:
    """Potential interactions between confirmed medicines, including inside one combination pack."""
    rules = repository.knowledge()["interactions"]
    known = [(cab, repository.entry(cab.get("medicine_key"))) for cab in cabinet if cab.get("user_confirmed")]
    known = [(cab, item) for cab, item in known if item]
    found, seen = [], set()

    for (cab_a, item_a), (cab_b, item_b) in combinations(known, 2):
        # Same active ingredient is a duplicate, reported separately.
        for ingredient_a in item_a["ingredients"]:
            for ingredient_b in item_b["ingredients"]:
                if ingredient_a == ingredient_b:
                    continue
                tags_a = repository.entry(ingredient_a)["tags"]
                tags_b = repository.entry(ingredient_b)["tags"]
                for rule in rules:
                    forward = _matches(tags_a, rule["a"]) and _matches(tags_b, rule["b"])
                    backward = _matches(tags_a, rule["b"]) and _matches(tags_b, rule["a"])
                    if not forward and not backward:
                        continue
                    identity = (rule["id"], *sorted([cab_a["id"], cab_b["id"]]))
                    if identity in seen:
                        continue
                    seen.add(identity)
                    found.append({
                        "id": rule["id"],
                        "level": rule["level"],
                        "medicine_ids": [cab_a["id"], cab_b["id"]],
                        "medicines": [_label(cab_a), _label(cab_b)],
                        "ingredients": [repository.entry(ingredient_a)["name"], repository.entry(ingredient_b)["name"]],
                        "kind": rule["kind"],
                        "why": rule["why"],
                        "medical": rule["medical"],
                        "advice": DISCUSS,
                        "source": _rule_source(rule["id"]),
                    })
    return sorted(found, key=lambda item: item["level"] != "important")


def duplicates(cabinet: list[dict]) -> list[dict]:
    by_ingredient: dict[str, list[dict]] = {}
    for cab in cabinet:
        item = repository.entry(cab.get("medicine_key"))
        if item and cab.get("user_confirmed"):
            for ingredient in item["ingredients"]:
                by_ingredient.setdefault(ingredient, []).append(cab)

    groups: dict[tuple, dict] = {}
    for ingredient, cabs in by_ingredient.items():
        if len(cabs) < 2:
            continue
        ids = tuple(sorted(cab["id"] for cab in cabs))
        name = repository.entry(ingredient)
        group = groups.setdefault(ids, {"medicine_ids": list(ids), "medicines": [_label(cab) for cab in cabs], "ingredients": [], "ingredients_hi": []})
        group["ingredients"].append(name["name"])
        group["ingredients_hi"].append(name["name_hi"])

    results = []
    for group in groups.values():
        shared, shared_hi = ", ".join(group.pop("ingredients")), ", ".join(group.pop("ingredients_hi"))
        results.append({
            **group,
            "ingredient": shared,
            "explain": {
                "en": f"These products appear to contain the same active ingredient: {shared}.",
                "hi": f"इन दवाओं में एक ही सक्रिय घटक लगता है: {shared_hi}।",
            },
            "advice": {
                "en": "Confirm with your doctor or pharmacist before taking both together.",
                "hi": "दोनों को साथ लेने से पहले डॉक्टर या फार्मासिस्ट से पुष्टि करें।",
            },
        })
    return results


def allergy_alerts(cabinet: list[dict], allergies: list[str]) -> list[dict]:
    terms = [term.strip().lower() for term in allergies if term and term.strip()]
    alerts = []
    for cab in cabinet:
        item = repository.entry(cab.get("medicine_key"))
        if not item:
            continue
        names = [item["name"].lower(), *(repository.entry(key)["name"].lower() for key in item["ingredients"]), *item["allergy_terms"], *(brand.lower() for brand in item["brands"])]
        for allergy in terms:
            if len(allergy) >= 3 and any(allergy in name or name in allergy for name in names):
                alerts.append({
                    "medicine_id": cab["id"],
                    "medicine": _label(cab),
                    "allergy": allergy,
                    "explain": {
                        "en": f"You have noted an allergy to \"{allergy}\". {item['name']} may be related to it.",
                        "hi": f"आपने \"{allergy}\" से एलर्जी दर्ज की है। {item['name_hi']} इससे जुड़ी हो सकती है।",
                    },
                    "advice": {
                        "en": "Please confirm with your doctor or pharmacist before taking this medicine.",
                        "hi": "यह दवा लेने से पहले कृपया डॉक्टर या फार्मासिस्ट से पुष्टि करें।",
                    },
                })
                break
    return alerts


def expiry_status(expiry: str | None, today: date) -> str:
    if not expiry:
        return "unknown"
    try:
        expires = date.fromisoformat(expiry)
    except ValueError:
        return "unknown"
    if expires < today:
        return "expired"
    return "expiring_soon" if (expires - today).days <= 60 else "ok"


def missing_information(cab: dict, match: dict, rx_item: dict | None) -> list[str]:
    missing = []
    if not cab.get("strength"):
        missing.append("strength")
    if not cab.get("expiry_date"):
        missing.append("expiry")
    if match["status"] != "no_prescription" and rx_item is not None:
        if not rx_item.get("frequency"):
            missing.append("frequency")
        if not rx_item.get("timing"):
            missing.append("timing")
    elif match["status"] == "no_prescription":
        missing.append("instructions")
    return missing
