"""The deterministic safety rules. No database or network."""
from datetime import date

import pytest

from app.medicines import full_check, language_guard, prescription_match as rx, relevance, reminders, repository, safety
from app.medicines.identification import CONFIRM, HIGH, UNABLE, identify, parse_expiry
from app.medicines.prescription_parser import parse_line, parse_prescription
from app.medicines.text import same_strength

TODAY = date(2026, 11, 9)


def cab(id, key, strength=None, confirmed=True, **extra):
    item = repository.entry(key)
    return {"id": id, "medicine_key": key, "medicine_name": item["name"] if item else key, "strength": strength, "user_confirmed": confirmed, "brand_name": None, "expiry_date": None, **extra}


def line(id, key, strength, **extra):
    item = repository.entry(key)
    return {"id": id, "prescription_id": 1, "medicine_key": key, "medicine_name": item["name"] if item else key, "strength": strength, "confirmed": True, "frequency": "once_daily", "times_per_day": 1, "timing": ["night"], "as_needed": False, **extra}


# ---------- Identification ----------

def test_clear_pack_is_high_confidence():
    result = identify("ATORVA 20\nAtorvastatin Tablets IP 20 mg\nMfd by: Zydus Healthcare Ltd\nB.No. AT2045 EXP 03/2027", 88)
    assert result["status"] == HIGH and result["medicine_key"] == "atorvastatin" and result["strength"] == "20 mg"
    assert result["brand_name"] == "Atorva" and result["expiry_date"] == "2027-03-31" and result["batch_number"] == "AT2045"


def test_brand_with_a_bare_number_reads_the_strength():
    result = identify("Telma 40 Tablets", 90)
    assert result["status"] == HIGH and result["medicine_key"] == "telmisartan" and result["strength"] == "40 mg"


def test_combination_brand_resolves_to_the_combination():
    result = identify("Telma-AM 40/5\nTelmisartan 40 mg and Amlodipine 5 mg Tablets", 90)
    assert result["medicine_key"] == "telmisartan+amlodipine" and same_strength(result["strength"], "40 mg + 5 mg")


def test_missing_strength_needs_confirmation_not_a_guess():
    result = identify("Atorvastatin Tablets", 90)
    assert result["status"] == CONFIRM and result["strength"] is None and "strength_not_visible" in result["notes"]


def test_strength_that_does_not_exist_for_the_medicine_needs_confirmation():
    result = identify("Atorvastatin 25 mg", 90)
    assert result["status"] == CONFIRM and "unusual_strength" in result["notes"]


def test_misspelt_name_is_never_silently_accepted():
    result = identify("Atorvastatn 20 mg", 90)
    assert result["status"] == CONFIRM and result["medicine_key"] is None
    assert result["candidates"][0]["key"] == "atorvastatin"


def test_two_unrelated_medicines_are_not_merged():
    result = identify("Metoprolol 25 mg\nCetirizine 10 mg", 90)
    assert result["status"] == CONFIRM and result["medicine_key"] is None and len(result["candidates"]) == 2


@pytest.mark.parametrize("issue", ["blurry", "too_dark", "glare"])
def test_poor_images_are_not_guessed_from(issue):
    result = identify("Atorvastatin 20 mg", 90, [issue])
    assert result["status"] == UNABLE and result["reason"] == issue and result["medicine_key"] is None


def test_unreadable_ocr_is_not_guessed_from():
    assert identify("Atorvastatin 20 mg", 12)["status"] == UNABLE
    assert identify("~~ | 1 ;", 80)["status"] == UNABLE


def test_low_ocr_confidence_cannot_be_high():
    result = identify("Atorvastatin 20 mg", 45)
    assert result["status"] == CONFIRM and "low_read_confidence" in result["notes"]


def test_unknown_text_is_unable():
    assert identify("Store in a cool dry place away from children", 90)["status"] == UNABLE


def test_short_brand_needs_a_number_so_ordinary_words_do_not_match():
    assert identify("Pan shop near Mox lane", 90)["status"] == UNABLE
    assert identify("Pan 40 Tablets", 90)["medicine_key"] == "pantoprazole"


@pytest.mark.parametrize("text,expected", [
    ("EXP 03/2027", "2027-03-31"), ("Exp. Date: Feb 2028", "2028-02-29"), ("EXP: 12-26", "2026-12-31"),
    ("Mfg 01/2025", None), ("Exp 13/2026", None),
])
def test_expiry_parsing(text, expected):
    assert parse_expiry(text) == expected


def test_manufacturing_date_is_not_read_as_expiry():
    assert identify("Atorvastatin 20 mg Mfg. Date 01/2025", 90)["expiry_date"] is None


@pytest.mark.parametrize("left,right,same", [("20 mg", "20mg", True), ("0.25 mg", "250 mcg", True), ("25 mg", "50 mg", False), ("40 mg + 5 mg", "5 mg + 40 mg", True), (None, "20 mg", False)])
def test_strength_comparison(left, right, same):
    assert same_strength(left, right) is same


# ---------- Prescription parsing ----------

def test_parses_common_indian_notation():
    item = parse_line("Tab. Atorvastatin 20 mg OD HS x 30 days")
    assert item["medicine_key"] == "atorvastatin" and item["strength"] == "20 mg" and item["times_per_day"] == 1
    assert "bedtime" in item["timing"] and item["duration_days"] == 30 and item["confirmed"] is False


@pytest.mark.parametrize("text,times,timing", [
    ("Tab Telma 40 1-0-1", 2, ["morning", "night"]),
    ("Tab Metformin 500 mg 1-1-1 after food", 3, ["morning", "afternoon", "night"]),
    ("Tab Amlodipine 5 mg 0-0-1", 1, ["night"]),
])
def test_dose_patterns(text, times, timing):
    item = parse_line(text)
    assert item["times_per_day"] == times and item["timing"] == timing


def test_timing_is_never_invented():
    item = parse_line("Tab Atorvastatin 20 mg")
    assert item["frequency"] is None and item["times_per_day"] is None and item["timing"] == []
    assert reminders.suggested_times(item) == []


def test_after_dinner_is_read():
    item = parse_line("Atorvastatin 20 mg once daily after dinner")
    assert item["timing"] == ["after_dinner"] and item["times_per_day"] == 1


def test_a_meal_replaces_the_general_time_of_day():
    item = parse_line("Tab Telma 40 1-0-0 after breakfast")
    assert item["timing"] == ["after_breakfast"] and item["times_per_day"] == 1
    assert reminders.suggested_times(item) == ["09:00"]


def test_as_needed_has_no_schedule():
    item = parse_line("Tab Paracetamol 500 mg SOS")
    assert item["as_needed"] is True and item["times_per_day"] is None


def test_header_lines_are_skipped():
    parsed = parse_prescription("Dr. A Sharma\nName: Ravi\nDate: 10/10/2026\nTab Telma 40 OD morning\nAdvice: walk daily")
    assert [item["medicine_key"] for item in parsed["items"]] == ["telmisartan"]


def test_unreadable_medicine_line_stays_uncertain():
    item = parse_line("Tab Xyzzol 10 mg OD")
    assert item["medicine_key"] is None and item["confidence"] == "needs_confirmation"


# ---------- Relevance ----------

def test_commonly_used_relationship():
    result = relevance.assess(repository.entry("atorvastatin"), ["high_cholesterol"])
    assert result["status"] == relevance.COMMON and "commonly used" in result["summary"]["en"]


def test_unrelated_medicine_is_not_called_wrong():
    result = relevance.assess(repository.entry("cetirizine"), ["high_bp"])
    assert result["status"] == relevance.NOT_DIRECT
    text = result["summary"]["en"]
    assert "does not appear to directly treat" in text and "another reason" in text and "wrong" not in text.lower()


def test_aspirin_depends_on_indication():
    assert relevance.assess(repository.entry("aspirin"), ["high_bp"])["status"] == relevance.MAY_BE


def test_unknown_or_unconfirmed_needs_verification():
    assert relevance.assess(None, ["high_bp"])["status"] == relevance.VERIFY
    assert relevance.assess(repository.entry("atorvastatin"), ["high_cholesterol"], confirmed=False)["status"] == relevance.VERIFY


def test_condition_we_do_not_know_needs_verification():
    assert relevance.assess(repository.entry("cetirizine"), ["Some rare thing"])["status"] == relevance.VERIFY


def test_report_context_never_judges_the_dose():
    context = relevance.report_context(repository.entry("atorvastatin"), [{"key": "ldl", "value": 158, "date": "2026-10-01"}])
    text = context[0]["text"]["en"]
    assert "158 mg/dL" in text and "Discuss your latest result" in text
    for word in ("adequate", "increase", "too low", "enough"):
        assert word not in text


# ---------- Prescription match ----------

def test_full_match():
    result = rx.compare(cab(1, "atorvastatin", "20 mg"), [line(9, "atorvastatin", "20 mg")])
    assert result["status"] == rx.MATCH and {c["key"]: c["status"] for c in result["checks"]}["strength"] == "matches"


def test_different_brand_same_generic_matches():
    result = rx.compare(cab(1, "telmisartan", "40 mg", brand_name="Telma"), [line(9, "telmisartan", "40 mg", brand_written="Telsar")])
    assert result["status"] == rx.MATCH


def test_strength_mismatch_message_is_exact_and_never_advises_a_dose():
    result = rx.compare(cab(1, "metoprolol", "50 mg"), [line(9, "metoprolol", "25 mg")])
    assert result["status"] == rx.STRENGTH_MISMATCH
    assert "25 mg" in result["message"]["en"] and "50 mg" in result["message"]["en"]
    assert result["advice"]["en"] == "Do not change the dose yourself. Confirm the medicine and dose with your doctor or pharmacist before taking it."
    assert not language_guard.violations(result["message"]["en"] + result["advice"]["en"])


def test_missing_strength_is_verification_not_a_match():
    assert rx.compare(cab(1, "atorvastatin", None), [line(9, "atorvastatin", "20 mg")])["status"] == rx.VERIFY


def test_combination_is_not_treated_as_the_single_medicine():
    assert rx.compare(cab(1, "telmisartan+hydrochlorothiazide", "40 mg + 12.5 mg"), [line(9, "telmisartan", "40 mg")])["status"] == rx.INGREDIENT_DIFFERENCE


def test_look_alike_names_are_flagged():
    assert rx.compare(cab(1, "losartan", "50 mg"), [line(9, "valsartan", "40 mg")])["status"] == rx.SIMILAR_NAME
    assert rx.compare(cab(1, "metformin", "500 mg"), [line(9, "metoprolol", "25 mg")])["status"] == rx.SIMILAR_NAME


def test_look_alike_is_not_flagged_when_the_prescribed_medicine_was_also_scanned():
    result = rx.compare(cab(1, "metformin", "500 mg"), [line(9, "metoprolol", "25 mg")], [frozenset({"metoprolol"})])
    assert result["status"] == rx.NOT_ON_RX


def test_not_on_prescription_is_neutral():
    result = rx.compare(cab(1, "cetirizine", "10 mg"), [line(9, "atorvastatin", "20 mg")])
    assert result["status"] == rx.NOT_ON_RX and "another" not in result["message"]["en"].lower() or "separately" in result["message"]["en"]


def test_no_prescription():
    assert rx.compare(cab(1, "atorvastatin", "20 mg"), [])["status"] == rx.NO_RX


# ---------- Interactions, duplicates, allergies ----------

def ids(found):
    return {item["id"] for item in found}


def test_detects_known_interactions():
    assert "nitrate_pde5" in ids(safety.interactions([cab(1, "isosorbide_mononitrate", "20 mg"), cab(2, "sildenafil", "50 mg")]))
    assert "anticoag_nsaid" in ids(safety.interactions([cab(1, "warfarin", "5 mg"), cab(2, "ibuprofen", "400 mg")]))
    assert "raas_potassium" in ids(safety.interactions([cab(1, "telmisartan", "40 mg"), cab(2, "spironolactone", "25 mg")]))


def test_interaction_found_inside_a_combination():
    assert "anticoag_antiplatelet" in ids(safety.interactions([cab(1, "warfarin", "5 mg"), cab(2, "aspirin+atorvastatin", "75 mg + 10 mg")]))


def test_no_false_interaction():
    assert safety.interactions([cab(1, "atorvastatin", "20 mg"), cab(2, "telmisartan", "40 mg")]) == []


def test_unconfirmed_medicines_are_not_screened():
    assert safety.interactions([cab(1, "warfarin", "5 mg", confirmed=False), cab(2, "ibuprofen", "400 mg")]) == []


def test_every_interaction_explains_itself_and_defers_to_a_professional():
    for found in safety.interactions([cab(1, "warfarin", "5 mg"), cab(2, "aspirin", "75 mg"), cab(3, "amiodarone", "200 mg"), cab(4, "digoxin", "0.25 mg")]):
        assert found["why"]["en"] and found["why"]["hi"] and found["kind"]["en"] and found["source"]["name"]
        assert "doctor or pharmacist" in found["advice"]["en"]


def test_duplicates_across_brands():
    groups = safety.duplicates([cab(1, "paracetamol", "500 mg", brand_name="Crocin"), cab(2, "paracetamol", "500 mg", brand_name="Calpol")])
    assert groups[0]["medicine_ids"] == [1, 2] and "same active ingredient" in groups[0]["explain"]["en"]
    assert "overdos" not in groups[0]["explain"]["en"].lower() and "before taking both together" in groups[0]["advice"]["en"]


def test_duplicate_inside_a_combination():
    groups = safety.duplicates([cab(1, "paracetamol", "500 mg"), cab(2, "paracetamol+ibuprofen", "325 mg + 400 mg")])
    assert groups[0]["ingredient"] == "Paracetamol"


def test_allergy_alert_through_drug_class():
    alerts = safety.allergy_alerts([cab(1, "amoxicillin", "500 mg")], ["Penicillin"])
    assert alerts and alerts[0]["medicine_id"] == 1
    assert safety.allergy_alerts([cab(1, "atorvastatin", "20 mg")], ["Penicillin"]) == []


def test_expiry_status():
    assert safety.expiry_status("2026-10-31", TODAY) == "expired"
    assert safety.expiry_status("2026-12-01", TODAY) == "expiring_soon"
    assert safety.expiry_status("2028-01-31", TODAY) == "ok"
    assert safety.expiry_status(None, TODAY) == "unknown"


# ---------- Reminders ----------

def validated(item, cabinet, match, times):
    return reminders.validate(item, cabinet, match, times)


@pytest.mark.parametrize("line_change,cab_change,times,code", [
    ({}, {"strength": "50 mg"}, ["21:00"], rx.STRENGTH_MISMATCH),
    ({"confirmed": False}, {}, ["21:00"], "prescription_unconfirmed"),
    ({"times_per_day": None, "frequency": None}, {}, ["21:00"], "frequency_missing"),
    ({"as_needed": True}, {}, ["21:00"], "as_needed"),
    ({}, {"user_confirmed": False}, ["21:00"], "medicine_unconfirmed"),
    ({}, {}, ["08:00", "21:00"], "times_do_not_match_prescription"),
    ({}, {}, ["25:00"], "invalid_time"),
])
def test_uncertain_instructions_cannot_become_reminders(line_change, cab_change, times, code):
    item = line(9, "atorvastatin", "20 mg", **line_change)
    cabinet = {**cab(1, "atorvastatin", "20 mg"), **cab_change}
    with pytest.raises(reminders.ReminderNotAllowed) as blocked:
        validated(item, cabinet, rx.compare(cabinet, [item]), times)
    assert blocked.value.code == code


def test_valid_reminder_passes():
    item = line(9, "atorvastatin", "20 mg")
    cabinet = cab(1, "atorvastatin", "20 mg")
    validated(item, cabinet, rx.compare(cabinet, [item]), ["21:00"])


def test_suggested_times_only_when_the_prescription_states_them():
    assert reminders.suggested_times({"times_per_day": 1, "timing": ["night"]}) == ["21:00"]
    assert reminders.suggested_times({"times_per_day": 2, "timing": []}) == []
    assert reminders.suggested_times({"times_per_day": 2, "timing": ["night"]}) == []


# ---------- Full check ----------

def test_full_check_summary():
    cabinet = [
        cab(1, "atorvastatin", "20 mg"), cab(2, "telmisartan", "40 mg"), cab(3, "metoprolol", "50 mg"),
        cab(4, "cetirizine", "10 mg", expiry_date="2025-01-31"), cab(5, None, None, medicine_name="Unknown pills"),
        cab(6, "paracetamol", "500 mg", brand_name="Crocin"), cab(7, "paracetamol", "500 mg", brand_name="Calpol"),
    ]
    items = [line(1, "atorvastatin", "20 mg"), line(2, "telmisartan", "40 mg"), line(3, "metoprolol", "25 mg")]
    result = full_check.run(cabinet, items, {"conditions": ["high_cholesterol", "high_bp"], "allergies": [], "labs": []}, TODAY)
    summary = result["summary"]
    assert summary["consistent"] == 2 and summary["mismatches"] == 1 and summary["duplicates"] == 1 and summary["expired"] == 1
    assert result["medicines"][5]["overall"] == "needs_verification"
    assert result["issues"][0]["severity"] == "important"
    assert {issue["type"] for issue in result["issues"]} >= {"mismatch", "expired", "duplicate"}


def test_prescribed_but_not_scanned_is_listed():
    result = full_check.run([], [line(1, "atorvastatin", "20 mg")], {"conditions": []}, TODAY)
    assert result["unmatched_prescription_items"][0]["medicine_name"] == "Atorvastatin"


# ---------- Language and data quality ----------

def every_text():
    data = repository.knowledge()
    for item in data["entries"].values():
        for field in ("what_is", "type_label", "use_short"):
            yield from item[field].values()
        for field in ("uses", "precautions", "side_effects", "seek_help"):
            for text in item[field]:
                yield from text.values()
        for text in item["cautions"].values():
            yield from text.values()
    for rule in data["interactions"]:
        yield from rule["why"].values()
        yield from rule["kind"].values()


def test_reference_data_contains_no_forbidden_wording():
    offenders = [(text, language_guard.violations(text)) for text in every_text() if language_guard.violations(text)]
    assert not offenders, offenders


def test_simple_view_has_no_jargon():
    offenders = [text for text in every_text() if language_guard.jargon(text)]
    assert not offenders, offenders


def test_every_medicine_is_complete_in_both_languages():
    for item in repository.all_entries():
        assert item["what_is"]["en"] and item["what_is"]["hi"], item["key"]
        assert item["uses"] and item["precautions"] and item["side_effects"] and item["seek_help"], item["key"]
        for use in item["uses"]:
            assert use["en"] and use["hi"]
        assert item["source"]["name"] and item["source"]["review_status"], item["key"]


def test_sources_are_honest():
    """A medicine with no real FDA label must not claim to have been verified against one."""
    labelled = repository.entry("atorvastatin")["source"]
    assert labelled["kind"] == "fda_label" and labelled["labels"][0]["set_id"] and labelled["last_verified"]
    unlabelled = repository.entry("cilnidipine")["source"]
    assert unlabelled["kind"] == "internal_reference" and unlabelled["last_verified"] is None
    assert repository.REVIEW_STATUS == "pending_clinical_review"


def test_brand_names_are_unambiguous():
    from app.medicines.text import alias_index
    conflicts = {alias: hits for alias, hits in alias_index().items() if len(hits) > 1}
    assert not conflicts, conflicts


@pytest.mark.parametrize("text", [
    "This medicine is correct for you.", "You should take this medicine.", "Stop taking this medicine.",
    "Take 25 mg instead.", "Reduce your dose.", "This pack is authentic.",
])
def test_guard_catches_forbidden_phrases(text):
    assert language_guard.violations(text)


def test_guard_allows_required_phrases():
    for text in ["This medicine is commonly used for this condition.", "Do not stop taking it without speaking to your doctor."]:
        assert not language_guard.violations(text)


def test_generated_text_cannot_add_numbers():
    assert language_guard.is_safe_explanation("It lowers cholesterol.", "Lowers cholesterol. 20 mg")
    assert not language_guard.is_safe_explanation("Use 40 mg each day.", "Lowers cholesterol. 20 mg")
