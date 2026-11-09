"""How a medicine relates to the patient's own conditions. Explains a relationship; never recommends."""
from app.medicines import repository

COMMON = "commonly_used"
MAY_BE = "may_be_related"
NOT_DIRECT = "not_directly_related"
VERIFY = "needs_verification"
NO_PROFILE = "no_conditions"
_ORDER = [COMMON, MAY_BE, VERIFY, NOT_DIRECT]


def _reason(relation: str, name: dict, condition: dict, use: dict) -> dict:
    if relation == COMMON:
        return {
            "en": f"{name['en']} is commonly used for {condition['en'].lower()}.",
            "hi": f"{name['hi']} {condition['hi']} में अक्सर दी जाती है।",
        }
    if relation == MAY_BE:
        return {
            "en": f"{name['en']} can be used in situations related to {condition['en'].lower()}. The exact reason depends on your own health. Your doctor can explain why it was chosen.",
            "hi": f"{name['hi']} {condition['hi']} से जुड़ी स्थितियों में दी जा सकती है। सही कारण आपकी अपनी सेहत पर निर्भर करता है। डॉक्टर आपको बता सकते हैं कि इसे क्यों चुना गया।",
        }
    if relation == VERIFY:
        return {
            "en": f"We cannot tell how this medicine relates to {condition['en']}. Please check with your doctor or pharmacist.",
            "hi": f"हम यह नहीं बता सकते कि यह दवा {condition['hi']} से कैसे जुड़ी है। कृपया डॉक्टर या फार्मासिस्ट से पूछें।",
        }
    return {
        "en": f"{name['en']} is commonly used for {use['en'].lower()}. It does not appear to directly treat {condition['en'].lower()}. It may have been prescribed for another reason.",
        "hi": f"{name['hi']} अक्सर {use['hi']} के लिए दी जाती है। यह {condition['hi']} का सीधा इलाज नहीं लगती। हो सकता है इसे किसी अन्य कारण से दिया गया हो।",
    }


def assess(item: dict | None, conditions: list[str], confirmed: bool = True) -> dict:
    """Relationship of one medicine to the patient's conditions."""
    labels = [repository.condition_label(key) for key in conditions]
    if item is None or not confirmed:
        return {
            "status": VERIFY,
            "conditions": [],
            "summary": {
                "en": "We need the medicine confirmed before we can compare it with your health details.",
                "hi": "आपकी सेहत की जानकारी से मिलान करने से पहले दवा की पुष्टि ज़रूरी है।",
            },
        }
    if not conditions:
        return {
            "status": NO_PROFILE,
            "conditions": [],
            "summary": {
                "en": "Add your health conditions to see how this medicine relates to them.",
                "hi": "यह दवा आपकी स्थितियों से कैसे जुड़ी है, यह देखने के लिए अपनी स्वास्थ्य स्थितियां जोड़ें।",
            },
        }

    name = {"en": item["name"], "hi": item["name_hi"]}
    results = []
    for key, label in zip(conditions, labels):
        if key in item["links"]:
            relation = item["links"][key]
        elif repository.is_known_condition(key):
            relation = NOT_DIRECT
        else:
            relation = VERIFY  # A condition the patient typed that isn't in our reference.
        results.append({"key": key, "label": label, "relation": relation, "reason": _reason(relation, name, label, item["use_short"])})

    results.sort(key=lambda row: _ORDER.index(row["relation"]))
    # Once a link is found, listing every condition the medicine doesn't treat is only noise.
    if results[0]["relation"] in (COMMON, MAY_BE):
        results = [row for row in results if row["relation"] != NOT_DIRECT]
    return {"status": results[0]["relation"], "conditions": results, "summary": results[0]["reason"]}


def condition_cautions(item: dict | None, conditions: list[str]) -> list[dict]:
    if not item:
        return []
    return [
        {"condition": repository.condition_label(key), "text": item["cautions"][key]}
        for key in conditions if key in item["cautions"]
    ]


def report_context(item: dict | None, labs: list[dict]) -> list[dict]:
    """Links a medicine to the patient's latest result. It never judges whether a dose is adequate."""
    if not item:
        return []
    vocabulary = repository.knowledge()["labs"]
    context = []
    for lab_key in item["labs"]:
        latest = max((lab for lab in labs if lab.get("key") == lab_key), key=lambda lab: lab.get("date") or "", default=None)
        if not latest:
            continue
        label = vocabulary[lab_key]
        value = f"{latest['value']:g} {label['unit']}"
        context.append({
            "lab": lab_key,
            "value": latest["value"],
            "unit": label["unit"],
            "date": latest.get("date"),
            "text": {
                "en": f"Your latest result shows {label['en']} of {value}. {item['name']} is commonly used for {item['use_short']['en'].lower()}. Discuss your latest result and medication plan with your doctor.",
                "hi": f"आपकी ताज़ा रिपोर्ट में {label['hi']} {value} है। {item['name_hi']} अक्सर {item['use_short']['hi']} के लिए दी जाती है। अपनी ताज़ा रिपोर्ट और दवा की योजना पर डॉक्टर से बात करें।",
            },
        })
    return context
