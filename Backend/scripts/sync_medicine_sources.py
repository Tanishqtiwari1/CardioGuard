"""Record which official FDA label backs each medicine and interaction rule.

Run from Backend/ with:  PYTHONPATH=. python scripts/sync_medicine_sources.py

For every ingredient this finds a real US FDA label through openFDA and stores its set id, effective
date and retrieval date in knowledge/label_sources.json. For every interaction rule it then checks
whether the label of one of the medicines involved actually mentions the other.

Medicines sold mainly in India may have no US label. They are left without one instead of being
given a made-up source, and the app then shows them as unverified against a label.
"""
import json
import sys
import time
from datetime import date
from pathlib import Path

import httpx

KNOWLEDGE = Path(__file__).resolve().parent.parent / "app" / "medicines" / "knowledge"
API = "https://api.fda.gov/drug/label.json"
SECTIONS = [
    "drug_interactions", "contraindications", "warnings_and_cautions", "warnings",
    "precautions", "adverse_reactions", "dosage_and_administration",
]
# openFDA uses US generic names.
US_NAMES = {
    "paracetamol": "acetaminophen",
    "salbutamol": "albuterol",
    "isosorbide_mononitrate": "isosorbide mononitrate",
    "isosorbide_dinitrate": "isosorbide dinitrate",
    "calcium_carbonate": "calcium carbonate",
    "potassium_chloride": "potassium chloride",
    "cholecalciferol": "cholecalciferol",
    "methylcobalamin": "cyanocobalamin",
    "ferrous_ascorbate": "ferrous sulfate",
    "clavulanate": "clavulanate",
}


def fetch_label(client: httpx.Client, name: str) -> dict | None:
    for query in (f'openfda.generic_name.exact:"{name.upper()}"', f'openfda.generic_name:"{name}"', f'openfda.substance_name:"{name}"'):
        for attempt in range(3):
            response = client.get(API, params={"search": query, "limit": 25})
            if response.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            break
        if response.status_code == 404:
            continue
        response.raise_for_status()
        # Prefer an oral, single-ingredient label with an interactions section (not eye drops or creams).
        results = sorted(
            response.json()["results"],
            key=lambda item: (
                "ORAL" not in item.get("openfda", {}).get("route", []),
                len(item.get("openfda", {}).get("substance_name", [])) != 1,
                "drug_interactions" not in item,
            ),
        )
        for result in results:
            if name.lower() in " ".join(result.get("openfda", {}).get("generic_name", [])).lower() or name.lower() in " ".join(result.get("openfda", {}).get("substance_name", [])).lower():
                return result
    return None


def label_text(label: dict) -> str:
    return " ".join(" ".join(label.get(section, [])) for section in SECTIONS).lower()


def members(tag: str, medicines: list[dict], classes: dict) -> list[str]:
    found = []
    for item in medicines:
        tags = {item["key"], item["class"], *classes[item["class"]]["groups"], *item.get("extra_tags", [])}
        if tag in tags:
            found.append(item["key"])
    return found


def main() -> int:
    data = json.loads((KNOWLEDGE / "medicines.json").read_text(encoding="utf-8"))
    classes = json.loads((KNOWLEDGE / "classes.json").read_text(encoding="utf-8"))
    rules = json.loads((KNOWLEDGE / "interactions.json").read_text(encoding="utf-8"))
    today = date.today().isoformat()
    labels, text_by_key, missing = {}, {}, []

    with httpx.Client(timeout=30, headers={"User-Agent": "CardioGuard-source-sync"}) as client:
        for item in data["ingredients"]:
            if item["key"] == "insulin":
                missing.append(item["key"])  # Many distinct products; no single label represents it.
                continue
            label = fetch_label(client, US_NAMES.get(item["key"], item["name"]))
            time.sleep(0.3)
            if not label or not label.get("set_id") or not label.get("effective_time"):
                missing.append(item["key"])
                continue
            raw = label["effective_time"]
            labels[item["key"]] = {
                "set_id": label["set_id"],
                "effective_date": f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}",
                "retrieved": today,
                "title": (label.get("openfda", {}).get("brand_name") or [item["name"]])[0],
                "url": f"https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={label['set_id']}",
            }
            text_by_key[item["key"]] = label_text(label)

    evidence, unsupported = {}, []
    names = {item["key"]: US_NAMES.get(item["key"], item["name"]).lower() for item in data["ingredients"]}
    for rule in rules:
        side_a, side_b = members(rule["a"], data["ingredients"], classes), members(rule["b"], data["ingredients"], classes)
        checked, supporting = 0, None
        # Each rule names the side whose label should mention the other. Any member can supply the evidence.
        own, other = (side_a, side_b) if rule["evidence_in"] == "a" else (side_b, side_a)
        terms = [term.lower() for term in rule["evidence_terms"]] + [names[key] for key in other]
        for key in own:
            if key not in text_by_key:
                continue
            checked += 1
            if any(term in text_by_key[key] for term in terms):
                supporting = key
                break
        if supporting:
            evidence[rule["id"]] = {"found": True, "label": labels[supporting], "ingredient": supporting}
        else:
            evidence[rule["id"]] = {"found": False, "checked": checked}
            unsupported.append(rule["id"])

    out = {"generated": today, "labels": labels, "interactions": evidence}
    (KNOWLEDGE / "label_sources.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Labels found: {len(labels)} of {len(data['ingredients'])}")
    print("No US label:", ", ".join(missing) or "none")
    print(f"Interaction rules supported by a label: {len(rules) - len(unsupported)} of {len(rules)}")
    print("Interaction rules needing manual sourcing:", ", ".join(unsupported) or "none")
    return 0


if __name__ == "__main__":
    sys.exit(main())
