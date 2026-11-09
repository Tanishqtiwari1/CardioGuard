"""Combines the deterministic checks into one patient-level result. No I/O."""
from datetime import date

from app.medicines import prescription_match as rx, relevance, repository, safety

MISMATCH_STATUSES = {rx.STRENGTH_MISMATCH, rx.INGREDIENT_DIFFERENCE, rx.SIMILAR_NAME}


def _issue(kind: str, severity: str, ident: str, title: dict, body: dict, action: dict, medicine_ids: list[int], escalate: str = "pharmacist", extra: dict | None = None) -> dict:
    return {"id": f"{kind}:{ident}", "type": kind, "severity": severity, "title": title, "body": body, "action": action, "medicine_ids": medicine_ids, "escalate": escalate, **(extra or {})}


def assess_medicine(cab: dict, rx_items: list[dict], profile: dict, today: date, scanned_elsewhere: list[frozenset] | None = None) -> dict:
    item = repository.entry(cab.get("medicine_key"))
    confirmed = bool(cab.get("user_confirmed"))
    relation = relevance.assess(item, profile.get("conditions", []), confirmed)
    match = rx.compare(cab, rx_items, scanned_elsewhere) if confirmed else rx._result(rx.VERIFY, None, [], {
        "en": "Confirm this medicine first so it can be compared with your prescription.",
        "hi": "पर्चे से मिलान के लिए पहले इस दवा की पुष्टि करें।",
    }, cab.get("strength"))
    rx_item = next((line for line in rx_items if line.get("id") == match["prescription_item_id"]), None)
    expiry = safety.expiry_status(cab.get("expiry_date"), today)

    if not item or not confirmed or relation["status"] == relevance.VERIFY:
        overall = "needs_verification"
    elif match["status"] in MISMATCH_STATUSES:
        overall = "mismatch"
    elif expiry == "expired" or match["status"] in {rx.VERIFY, rx.NOT_ON_RX}:
        overall = "needs_verification"
    elif relation["status"] == relevance.NOT_DIRECT:
        overall = "other_use"
    elif relation["status"] == relevance.NO_PROFILE and match["status"] != rx.MATCH:
        overall = "needs_information"
    else:
        overall = "consistent"

    return {
        "overall": overall,
        "relationship": relation,
        "prescription_match": match,
        "prescription_item": rx_item,
        "expiry_status": expiry,
        "missing": safety.missing_information(cab, match, rx_item),
        "cautions": relevance.condition_cautions(item, profile.get("conditions", [])),
        "report_context": relevance.report_context(item, profile.get("labs", [])),
    }


def run(cabinet: list[dict], rx_items: list[dict], profile: dict, today: date) -> dict:
    known = [(cab["id"], repository.entry(cab.get("medicine_key"))) for cab in cabinet]
    ingredient_sets = [(cab_id, frozenset(item["ingredients"])) for cab_id, item in known if item]
    assessed = {
        cab["id"]: assess_medicine(cab, rx_items, profile, today, [sets for cab_id, sets in ingredient_sets if cab_id != cab["id"]])
        for cab in cabinet
    }
    interactions = safety.interactions(cabinet)
    duplicates = safety.duplicates(cabinet)
    allergies = safety.allergy_alerts(cabinet, profile.get("allergies", []))
    issues: list[dict] = []

    for cab in cabinet:
        info = assessed[cab["id"]]
        name = safety._label(cab) or "Unnamed medicine"
        match = info["prescription_match"]
        if match["status"] in MISMATCH_STATUSES:
            issues.append(_issue("mismatch", "important", str(cab["id"]), {"en": "Possible prescription mismatch", "hi": "पर्चे से संभावित अंतर"}, match["message"], match["advice"], [cab["id"]], "doctor", {"medicine": name}))
        elif match["status"] == rx.VERIFY or (not cab.get("user_confirmed")):
            issues.append(_issue("verify", "review", str(cab["id"]), {"en": "Needs confirmation", "hi": "पुष्टि ज़रूरी"}, match["message"], {"en": "Open this medicine and check its details.", "hi": "यह दवा खोलें और जानकारी जांचें।"}, [cab["id"]], "pharmacist", {"medicine": name}))
        elif match["status"] == rx.NOT_ON_RX:
            issues.append(_issue("not_on_prescription", "review", str(cab["id"]), {"en": "Not on your prescription", "hi": "पर्चे में नहीं"}, match["message"], {"en": "Ask your doctor or pharmacist if you are unsure.", "hi": "संदेह होने पर डॉक्टर या फार्मासिस्ट से पूछें।"}, [cab["id"]], "pharmacist", {"medicine": name}))

        if info["expiry_status"] == "expired":
            issues.append(_issue("expired", "important", str(cab["id"]), {"en": "Past the printed expiry date", "hi": "छपी एक्सपायरी तारीख निकल चुकी"}, {"en": f"{name} appears to be past its expiry date ({cab.get('expiry_date')}).", "hi": f"{name} की एक्सपायरी तारीख ({cab.get('expiry_date')}) निकल चुकी लगती है।"}, {"en": "Ask your pharmacist what to do with it and how to get a new supply.", "hi": "फार्मासिस्ट से पूछें कि इसका क्या करें और नई दवा कैसे लें।"}, [cab["id"]], "pharmacist", {"medicine": name}))

    for alert in allergies:
        issues.append(_issue("allergy", "important", f"{alert['medicine_id']}:{alert['allergy']}", {"en": "Possible allergy concern", "hi": "संभावित एलर्जी"}, alert["explain"], alert["advice"], [alert["medicine_id"]], "doctor", {"medicine": alert["medicine"]}))
    for found in interactions:
        issues.append(_issue("interaction", "important" if found["level"] == "important" else "review", f"{found['id']}:{found['medicine_ids'][0]}:{found['medicine_ids'][1]}", {"en": "Potential interaction", "hi": "संभावित परस्पर असर"}, found["why"], found["advice"], found["medicine_ids"], "pharmacist", {"interaction": found}))
    for group in duplicates:
        issues.append(_issue("duplicate", "review", "-".join(map(str, group["medicine_ids"])), {"en": "Possible duplicate medicines", "hi": "संभावित दोहरी दवाएं"}, group["explain"], group["advice"], group["medicine_ids"], "pharmacist", {"duplicate": group}))

    order = ["allergy", "mismatch", "interaction", "expired", "duplicate", "verify", "not_on_prescription"]
    issues.sort(key=lambda issue: (issue["severity"] != "important", order.index(issue["type"])))
    counts = [info["overall"] for info in assessed.values()]
    missing_timing = [cab["id"] for cab in cabinet if {"timing", "instructions", "frequency"} & set(assessed[cab["id"]]["missing"])]
    prescription_on_file = bool(rx_items)

    return {
        "medicines": assessed,
        "issues": issues,
        "summary": {
            "total": len(cabinet),
            "consistent": counts.count("consistent"),
            "needs_verification": counts.count("needs_verification"),
            "needs_information": counts.count("needs_information"),
            "other_use": counts.count("other_use"),
            "mismatches": counts.count("mismatch"),
            "duplicates": len(duplicates),
            "interactions": len(interactions),
            "allergies": len(allergies),
            "expired": sum(info["expiry_status"] == "expired" for info in assessed.values()),
        },
        "sections": {
            "identification": {"confirmed": sum(bool(cab.get("user_confirmed")) for cab in cabinet), "unconfirmed": sum(not cab.get("user_confirmed") for cab in cabinet), "not_in_reference": sum(not repository.entry(cab.get("medicine_key")) for cab in cabinet)},
            "relevance": {status: sum(info["relationship"]["status"] == status for info in assessed.values()) for status in (relevance.COMMON, relevance.MAY_BE, relevance.NOT_DIRECT, relevance.VERIFY, relevance.NO_PROFILE)},
            "prescription": {"on_file": prescription_on_file, "matches": sum(info["prescription_match"]["status"] == rx.MATCH for info in assessed.values()), "not_on_prescription": sum(info["prescription_match"]["status"] == rx.NOT_ON_RX for info in assessed.values())},
            "strength": {"matches": sum(any(check["key"] == "strength" and check["status"] == "matches" for check in info["prescription_match"]["checks"]) for info in assessed.values()), "differs": sum(info["prescription_match"]["status"] == rx.STRENGTH_MISMATCH for info in assessed.values())},
            "duplicates": duplicates,
            "interactions": interactions,
            "missing": {"instructions": missing_timing, "strength": [cab["id"] for cab in cabinet if not cab.get("strength")], "expiry": [cab["id"] for cab in cabinet if not cab.get("expiry_date")]},
            "expiry": {"expired": [cab["id"] for cab in cabinet if assessed[cab["id"]]["expiry_status"] == "expired"], "expiring_soon": [cab["id"] for cab in cabinet if assessed[cab["id"]]["expiry_status"] == "expiring_soon"]},
        },
        "unmatched_prescription_items": _unscanned(cabinet, rx_items),
        "checked_at": today.isoformat(),
    }


def _unscanned(cabinet: list[dict], rx_items: list[dict]) -> list[dict]:
    """Prescribed medicines the patient has not scanned yet."""
    scanned = set()
    for cab in cabinet:
        item = repository.entry(cab.get("medicine_key"))
        if item:
            scanned.add(frozenset(item["ingredients"]))
    unmatched = []
    for line in rx_items:
        item = repository.entry(line.get("medicine_key"))
        if not item or frozenset(item["ingredients"]) not in scanned:
            unmatched.append({"id": line.get("id"), "medicine_name": line.get("medicine_name"), "strength": line.get("strength")})
    return unmatched
