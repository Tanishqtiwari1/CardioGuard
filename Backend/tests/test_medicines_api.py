"""The whole patient journey through the HTTP API, plus privacy and AI safety."""
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.medicines import ai

BASE = "/api/v1/medicines"


def add(client, auth, key, strength, **extra):
    response = client.post(f"{BASE}/cabinet", headers=auth, json={"medicine_key": key, "strength": strength, "identification_confidence": "high", "user_confirmed": True, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def prescribe(client, auth, text, source_type="digital", confirm=True):
    response = client.post(f"{BASE}/prescriptions", headers=auth, json={"text": text, "source_type": source_type})
    assert response.status_code == 201, response.text
    prescription = response.json()
    if confirm:
        items = [{**{k: v for k, v in item.items() if k in {"id", "medicine_key", "medicine_name", "strength", "dose", "frequency", "timing", "food_relation", "duration_days", "instructions"}}, "confirmed": True} for item in prescription["items"]]
        response = client.put(f"{BASE}/prescriptions/{prescription['id']}", headers=auth, json={"items": items})
        assert response.status_code == 200, response.text
        prescription = response.json()
    return prescription


def test_requires_login(client):
    assert client.get(f"{BASE}/cabinet").status_code == 401
    assert client.post(f"{BASE}/identify", json={"text": "x"}).status_code == 401


def test_complete_journey(client, auth):
    found = client.post(f"{BASE}/identify", headers=auth, json={"text": "Atorvastatin Tablets 20 mg EXP 03/2030", "ocr_confidence": 90}).json()
    assert found["status"] == "high" and found["known_strengths"]

    saved = client.post(f"{BASE}/cabinet", headers=auth, json={**{k: found[k] for k in ("medicine_key", "strength", "dosage_form", "expiry_date")}, "identification_confidence": found["status"], "user_confirmed": True})
    assert saved.status_code == 201
    medicine_id = saved.json()["id"]

    assert client.put(f"{BASE}/profile", headers=auth, json={"conditions": ["high_cholesterol"], "labs": [{"key": "ldl", "value": 158, "date": "2026-10-01"}]}).status_code == 200
    prescribe(client, auth, "Tab Atorvastatin 20 mg once daily at night x 30 days")

    detail = client.get(f"{BASE}/cabinet/{medicine_id}", headers=auth).json()
    assert detail["relationship"]["status"] == "commonly_used"
    assert detail["prescription_match"]["status"] == "match"
    assert "158 mg/dL" in detail["report_context"][0]["text"]["en"]
    assert detail["information"]["what_is"]["hi"] and detail["source"]["kind"] == "fda_label"
    assert detail["can_create_reminder"] and detail["suggested_reminder_times"] == ["21:00"]

    today = date.today()
    reminder = client.post(f"{BASE}/reminders", headers=auth, json={"cabinet_medicine_id": medicine_id, "times": ["21:00"], "start_date": today.isoformat()})
    assert reminder.status_code == 201
    assert reminder.json()["end_date"] == (today + timedelta(days=29)).isoformat()
    reminder_id = reminder.json()["id"]

    logged = client.post(f"{BASE}/doses", headers=auth, json={"reminder_id": reminder_id, "scheduled_date": today.isoformat(), "scheduled_time": "21:00", "status": "taken"})
    assert logged.status_code == 200
    assert client.get(f"{BASE}/doses", headers=auth, params={"day": today.isoformat()}).json()[0]["doses"][0]["status"] == "taken"

    check = client.get(f"{BASE}/check", headers=auth).json()
    assert check["summary"]["consistent"] == 1 and check["summary"]["mismatches"] == 0
    events = [event["event_type"] for event in client.get(f"{BASE}/timeline", headers=auth).json()]
    assert {"medicine_added", "prescription_confirmed", "reminder_created"} <= set(events)


def test_saving_requires_patient_confirmation(client, auth):
    response = client.post(f"{BASE}/cabinet", headers=auth, json={"medicine_key": "atorvastatin", "strength": "20 mg", "identification_confidence": "high", "user_confirmed": False})
    assert response.status_code == 422


def test_unknown_key_is_rejected_and_unknown_name_is_labelled(client, auth):
    assert client.post(f"{BASE}/cabinet", headers=auth, json={"medicine_key": "nope", "user_confirmed": True}).status_code == 422
    saved = client.post(f"{BASE}/cabinet", headers=auth, json={"medicine_name": "Home remedy tablets", "identification_confidence": "manual", "entry_method": "manual", "user_confirmed": True}).json()
    detail = client.get(f"{BASE}/cabinet/{saved['id']}", headers=auth).json()
    assert detail["information"] is None and detail["overall"] == "needs_verification" and detail["source"] is None


def test_rescanning_the_same_product_does_not_create_a_duplicate(client, auth):
    first = add(client, auth, "paracetamol", "500 mg", brand_name="Crocin")
    second = add(client, auth, "paracetamol", "500 mg", brand_name="Crocin")
    assert first["id"] == second["id"]
    add(client, auth, "paracetamol", "500 mg", brand_name="Calpol")
    assert client.get(f"{BASE}/cabinet", headers=auth).json()["summary"]["duplicates"] == 1


def test_reminder_blocked_on_mismatch(client, auth):
    medicine = add(client, auth, "metoprolol", "50 mg")
    prescribe(client, auth, "Tab Metoprolol 25 mg once daily morning")
    detail = client.get(f"{BASE}/cabinet/{medicine['id']}", headers=auth).json()
    assert detail["prescription_match"]["status"] == "strength_mismatch" and detail["can_create_reminder"] is False
    response = client.post(f"{BASE}/reminders", headers=auth, json={"cabinet_medicine_id": medicine["id"], "times": ["08:00"]})
    assert response.status_code == 409 and response.json()["detail"]["code"] == "strength_mismatch"


def test_unconfirmed_prescription_is_not_used(client, auth):
    medicine = add(client, auth, "atorvastatin", "20 mg")
    prescribe(client, auth, "Tab Atorvastatin 20 mg OD night", confirm=False)
    detail = client.get(f"{BASE}/cabinet/{medicine['id']}", headers=auth).json()
    assert detail["prescription_match"]["status"] == "no_prescription"
    assert client.post(f"{BASE}/reminders", headers=auth, json={"cabinet_medicine_id": medicine["id"], "times": ["21:00"]}).status_code == 409


def test_handwritten_lines_are_never_high_confidence(client, auth):
    prescription = prescribe(client, auth, "Tab Atorvastatin 20 mg OD", source_type="handwritten", confirm=False)
    assert prescription["status"] == "needs_review"
    assert all(item["confidence"] == "needs_confirmation" for item in prescription["items"])


def test_unreadable_prescription_is_reported(client, auth):
    assert client.post(f"{BASE}/prescriptions", headers=auth, json={"text": "~~~ scribble"}).status_code == 422


def test_data_is_private_to_each_patient(client, auth, other_auth):
    medicine = add(client, auth, "atorvastatin", "20 mg")
    prescription = prescribe(client, auth, "Tab Atorvastatin 20 mg once daily night")
    reminder = client.post(f"{BASE}/reminders", headers=auth, json={"cabinet_medicine_id": medicine["id"], "times": ["21:00"]}).json()

    assert client.get(f"{BASE}/cabinet/{medicine['id']}", headers=other_auth).status_code == 404
    assert client.delete(f"{BASE}/cabinet/{medicine['id']}", headers=other_auth).status_code == 404
    assert client.put(f"{BASE}/prescriptions/{prescription['id']}", headers=other_auth, json={"items": []}).status_code == 404
    assert client.patch(f"{BASE}/reminders/{reminder['id']}", headers=other_auth, json={"active": False}).status_code == 404
    assert client.post(f"{BASE}/reminders", headers=other_auth, json={"cabinet_medicine_id": medicine["id"], "times": ["21:00"]}).status_code == 404
    assert client.get(f"{BASE}/cabinet", headers=other_auth).json()["medicines"] == []
    assert client.get(f"{BASE}/timeline", headers=other_auth).json() == []


def test_emergency_summary_needs_explicit_consent(client, auth):
    add(client, auth, "atorvastatin", "20 mg")
    client.put(f"{BASE}/profile", headers=auth, json={"conditions": ["diabetes"], "allergies": ["Penicillin"], "emergency_contact_name": "Asha", "emergency_contact_phone": "9999999999"})
    assert client.get(f"{BASE}/emergency-summary", headers=auth).status_code == 403

    assert client.post(f"{BASE}/emergency-consent", headers=auth).status_code == 200
    summary = client.get(f"{BASE}/emergency-summary", headers=auth).json()
    assert summary["medicines"][0]["name"] == "Atorvastatin" and summary["allergies"] == ["Penicillin"] and summary["conditions"] == ["Diabetes"]
    assert summary["emergency_contact"]["name"] == "Asha"

    assert client.delete(f"{BASE}/emergency-consent", headers=auth).status_code == 200
    assert client.get(f"{BASE}/emergency-summary", headers=auth).status_code == 403


def test_saved_profile_keeps_earlier_conditions_out_of_suggestions(client, auth):
    profile = client.put(f"{BASE}/profile", headers=auth, json={"conditions": ["Diabetes  ", "Diabetes"], "allergies": []}).json()
    assert profile["conditions"] == ["Diabetes"]


def test_snooze_moves_the_dose(client, auth):
    medicine = add(client, auth, "atorvastatin", "20 mg")
    prescribe(client, auth, "Tab Atorvastatin 20 mg once daily night")
    reminder = client.post(f"{BASE}/reminders", headers=auth, json={"cabinet_medicine_id": medicine["id"], "times": ["21:00"]}).json()
    today = date.today().isoformat()
    result = client.post(f"{BASE}/doses", headers=auth, json={"reminder_id": reminder["id"], "scheduled_date": today, "scheduled_time": "21:00", "status": "snoozed", "snooze_minutes": 30})
    assert result.json() == {"status": "snoozed", "snoozed_until": "21:30"}
    # A slot that isn't on the schedule cannot be logged.
    assert client.post(f"{BASE}/doses", headers=auth, json={"reminder_id": reminder["id"], "scheduled_date": today, "scheduled_time": "10:00", "status": "taken"}).status_code == 422


def test_reference_search(client, auth):
    results = client.get(f"{BASE}/reference/search", headers=auth, params={"q": "telma"}).json()
    assert {result["key"] for result in results} >= {"telmisartan", "telmisartan+amlodipine"}


# ---------- AI layer ----------

@pytest.fixture
def fake_model(monkeypatch):
    """Stands in for the model so tests can feed it good and bad output."""
    state = SimpleNamespace(reply="Atorvastatin helps lower cholesterol.", stop_reason="end_turn", calls=[])

    class Messages:
        def create(self, **kwargs):
            state.calls.append(kwargs)
            return SimpleNamespace(stop_reason=state.stop_reason, content=[SimpleNamespace(type="text", text=state.reply)])

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(ai, "_client", lambda: SimpleNamespace(beta=SimpleNamespace(messages=Messages())))
    return state


def test_ai_off_returns_verified_text(client, auth, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    medicine = add(client, auth, "atorvastatin", "20 mg")
    result = client.post(f"{BASE}/cabinet/{medicine['id']}/explain", headers=auth, json={"language": "en"}).json()
    assert result["generated"] is False and "Atorvastatin" in result["text"]
    assert client.get(f"{BASE}/capabilities", headers=auth).json()["ai_available"] is False


def test_safe_ai_wording_is_used(client, auth, fake_model):
    medicine = add(client, auth, "atorvastatin", "20 mg")
    result = client.post(f"{BASE}/cabinet/{medicine['id']}/explain", headers=auth, json={"language": "en"}).json()
    assert result == {"text": fake_model.reply, "generated": True}


@pytest.mark.parametrize("reply", ["You should take this every day.", "This medicine is correct for you.", "Take 40 mg at night.", "Stop taking it if you feel fine."])
def test_unsafe_ai_output_is_discarded(client, auth, fake_model, reply):
    fake_model.reply = reply
    medicine = add(client, auth, "atorvastatin", "20 mg")
    result = client.post(f"{BASE}/cabinet/{medicine['id']}/explain", headers=auth, json={"language": "en"}).json()
    assert result["generated"] is False and reply not in result["text"]


def test_refused_ai_call_falls_back(client, auth, fake_model):
    fake_model.stop_reason = "refusal"
    medicine = add(client, auth, "atorvastatin", "20 mg")
    assert client.post(f"{BASE}/cabinet/{medicine['id']}/explain", headers=auth, json={"language": "en"}).json()["generated"] is False


def test_vision_only_supplies_text_for_the_deterministic_pipeline(client, auth, fake_model):
    fake_model.reply = "Atorvastatin Tablets 20 mg"
    response = client.post(f"{BASE}/read-image", headers=auth, files={"file": ("a.png", b"123", "image/png")})
    assert response.json() == {"text": "Atorvastatin Tablets 20 mg"}
    prompt = fake_model.calls[0]["messages"][0]["content"][1]["text"]
    assert "Do not correct spellings, identify the medicine" in prompt


def test_vision_is_unavailable_without_a_key(client, auth, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert client.post(f"{BASE}/read-image", headers=auth, files={"file": ("a.png", b"123", "image/png")}).status_code == 503


def test_vision_rejects_other_files(client, auth, fake_model):
    assert client.post(f"{BASE}/read-image", headers=auth, files={"file": ("a.pdf", b"123", "application/pdf")}).status_code == 415
