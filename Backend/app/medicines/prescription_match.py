"""Compares a scanned medicine with confirmed prescription lines. Flags differences; never resolves them."""
from app.medicines import repository
from app.medicines.text import edit_distance, normalise_alias, same_strength, strength_values

MATCH = "match"
STRENGTH_MISMATCH = "strength_mismatch"
INGREDIENT_DIFFERENCE = "ingredient_difference"
SIMILAR_NAME = "similar_name_mismatch"
VERIFY = "needs_verification"
NOT_ON_RX = "not_on_prescription"
NO_RX = "no_prescription"

CONFIRM_ADVICE = {
    "en": "Do not change the dose yourself. Confirm the medicine and dose with your doctor or pharmacist before taking it.",
    "hi": "खुराक खुद न बदलें। दवा लेने से पहले डॉक्टर या फार्मासिस्ट से दवा और खुराक की पुष्टि करें।",
}


def _check(key: str, status: str) -> dict:
    return {"key": key, "status": status}


def _result(status: str, item: dict | None, checks: list[dict], message: dict, detected: str | None, advice: dict | None = None) -> dict:
    return {
        "status": status,
        "prescription_item_id": item.get("id") if item else None,
        "prescription_id": item.get("prescription_id") if item else None,
        "prescribed_name": item.get("medicine_name") if item else None,
        "prescribed_strength": item.get("strength") if item else None,
        "detected_strength": detected,
        "checks": checks,
        "message": message,
        "advice": advice,
    }


def _similar(left: str | None, right: str | None) -> bool:
    """Names easily confused at a pharmacy counter: metformin/metoprolol, losartan/valsartan."""
    if not left or not right:
        return False
    left, right = normalise_alias(left), normalise_alias(right)
    return left != right and (left[:3] == right[:3] or (left[-5:] == right[-5:] and edit_distance(left, right, 5) <= 5))


def compare(cabinet: dict, rx_items: list[dict], scanned_elsewhere: list[frozenset] | None = None) -> dict:
    """`cabinet`: medicine_key, medicine_name, strength. `rx_items`: confirmed prescription lines, newest first.

    `scanned_elsewhere` holds the ingredient sets of the patient's other medicines. A prescription line
    already accounted for by one of them is not evidence that this medicine was a mix-up.
    """
    detected = cabinet.get("strength")
    if not rx_items:
        return _result(NO_RX, None, [], {
            "en": "No confirmed prescription to compare with yet.",
            "hi": "मिलान के लिए अभी कोई पुष्ट पर्चा नहीं है।",
        }, detected)

    entry = repository.entry(cabinet.get("medicine_key"))
    if not entry:
        return _result(VERIFY, None, [], {
            "en": "We could not match this medicine to our reference, so it could not be compared with your prescription.",
            "hi": "यह दवा हमारे संदर्भ से नहीं मिली, इसलिए पर्चे से इसका मिलान नहीं हो सका।",
        }, detected, CONFIRM_ADVICE)

    wanted = set(entry["ingredients"])
    candidates = [(item, repository.entry(item.get("medicine_key"))) for item in rx_items]

    exact = [item for item, rx_entry in candidates if rx_entry and set(rx_entry["ingredients"]) == wanted]
    if exact:
        # Several lines can name one medicine, such as an old and a new prescription. Prefer the one that agrees.
        for item in exact:
            if same_strength(item.get("strength"), detected):
                return _full_match(item, detected)
        return _strength_issue(exact[0], detected)

    for item, rx_entry in candidates:
        if rx_entry and set(rx_entry["ingredients"]) & wanted:
            return _result(INGREDIENT_DIFFERENCE, item, [_check("name", "differs")], {
                "en": f"Your prescription appears to list {item['medicine_name']}, but the medicine you scanned appears to contain {entry['name']}. They share an ingredient but are not the same product.",
                "hi": f"आपके पर्चे में {item['medicine_name']} लगती है, जबकि स्कैन की गई दवा में {entry['name']} लगती है। इनमें एक घटक समान है, पर ये एक ही दवा नहीं हैं।",
            }, detected, CONFIRM_ADVICE)

    for item, rx_entry in candidates:
        if rx_entry and frozenset(rx_entry["ingredients"]) in (scanned_elsewhere or []):
            continue
        if _similar(item.get("medicine_name"), entry["name"]):
            return _result(SIMILAR_NAME, item, [_check("name", "differs")], {
                "en": f"Your prescription appears to list {item['medicine_name']}, but the medicine you scanned appears to be {entry['name']}. These names look alike but are different medicines.",
                "hi": f"आपके पर्चे में {item['medicine_name']} लगती है, जबकि स्कैन की गई दवा {entry['name']} लगती है। ये नाम मिलते-जुलते हैं, पर दवाएं अलग हैं।",
            }, detected, CONFIRM_ADVICE)

    return _result(NOT_ON_RX, None, [_check("name", "not_found")], {
        "en": "This medicine does not appear on the prescription you uploaded. It may have been prescribed separately. Please check with your doctor or pharmacist if you are unsure.",
        "hi": "यह दवा आपके अपलोड किए पर्चे में नहीं दिखती। हो सकता है इसे अलग से दिया गया हो। संदेह होने पर डॉक्टर या फार्मासिस्ट से पूछें।",
    }, detected)


def _full_match(item: dict, detected: str | None) -> dict:
    checks = [_check("name", "matches"), _check("strength", "matches")]
    checks.append(_check("frequency", "available" if item.get("frequency") else "missing"))
    checks.append(_check("timing", "available" if item.get("timing") else "missing"))
    return _result(MATCH, item, checks, {
        "en": "This medicine appears to match your prescription.",
        "hi": "यह दवा आपके पर्चे से मेल खाती लगती है।",
    }, detected)


def _strength_issue(item: dict, detected: str | None) -> dict:
    prescribed = item.get("strength")
    if strength_values(prescribed) and strength_values(detected):
        return _result(STRENGTH_MISMATCH, item, [_check("name", "matches"), _check("strength", "differs")], {
            "en": f"Your prescription appears to specify {prescribed}, but the medicine you scanned appears to be {detected}.",
            "hi": f"आपके पर्चे में {prescribed} लगता है, जबकि स्कैन की गई दवा {detected} लगती है।",
        }, detected, CONFIRM_ADVICE)
    return _result(VERIFY, item, [_check("name", "matches"), _check("strength", "unknown")], {
        "en": "The medicine name matches, but we could not compare the strength. Please check it with your pharmacist.",
        "hi": "दवा का नाम मेल खाता है, पर ताकत का मिलान नहीं हो सका। कृपया फार्मासिस्ट से जांच लें।",
    }, detected, CONFIRM_ADVICE)
