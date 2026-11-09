"""HTTP layer for My Medicines. Medical decisions live in app.medicines; this file only stores and serves."""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.medicines import ai, full_check, identification, prescription_parser, reminders as reminder_rules, repository
from app.medicines import prescription_match as rx
from app.models.assessment import AssessmentHistory
from app.models.community import Screening
from app.models.medicine import CabinetMedicine, DoseLog, MedicalProfile, MedicineEvent, MedicineReminder, Prescription, PrescriptionItem
from app.models.user import User
from app.schemas.medicine import (
    CabinetCreate, CabinetUpdate, DoseLogCreate, ExplainRequest, IdentifyRequest, PrescriptionParse, PrescriptionUpdate,
    ProfileUpdate, ReminderCreate, ReminderUpdate,
)
from app.security import get_current_user

router = APIRouter(prefix="/medicines", tags=["medicines"])
MAX_IMAGE_BYTES = 8 * 1024 * 1024
TIMES_FOR_FREQUENCY = {"once_daily": 1, "twice_daily": 2, "three_daily": 3, "four_daily": 4}
DISCLAIMER = {
    "en": "CardioGuard explains and compares information. It does not prescribe or replace your doctor or pharmacist.",
    "hi": "CardioGuard जानकारी समझाता और मिलान करता है। यह दवा नहीं लिखता और न ही डॉक्टर या फार्मासिस्ट की जगह लेता है।",
}


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _log(db: Session, user: User, event: str, summary: str, details: dict | None = None) -> None:
    db.add(MedicineEvent(user_id=user.id, event_type=event, summary=summary, details=details))


def _profile(db: Session, user: User) -> MedicalProfile:
    profile = db.get(MedicalProfile, user.id)
    if not profile:
        profile = MedicalProfile(user_id=user.id, conditions=[], allergies=[], labs=[])
        db.add(profile)
        db.flush()
    return profile


def _profile_dict(profile: MedicalProfile) -> dict:
    return {
        "conditions": profile.conditions or [],
        "allergies": profile.allergies or [],
        "labs": profile.labs or [],
        "doctor_name": profile.doctor_name,
        "doctor_phone": profile.doctor_phone,
        "emergency_contact_name": profile.emergency_contact_name,
        "emergency_contact_phone": profile.emergency_contact_phone,
        "emergency_consent_at": profile.emergency_consent_at.isoformat() if profile.emergency_consent_at else None,
    }


def _cabinet_dict(row: CabinetMedicine) -> dict:
    return {
        "id": row.id,
        "medicine_key": row.medicine_key,
        "medicine_name": row.medicine_name,
        "generic_name": row.medicine_name if row.medicine_key else None,
        "brand_name": row.brand_name,
        "strength": row.strength,
        "dosage_form": row.dosage_form,
        "manufacturer": row.manufacturer,
        "expiry_date": row.expiry_date,
        "batch_number": row.batch_number,
        "identification_confidence": row.identification_confidence,
        "user_confirmed": row.user_confirmed,
        "entry_method": row.entry_method,
        "last_scanned_at": row.last_scanned_at.isoformat() if row.last_scanned_at else None,
    }


def _item_dict(item: PrescriptionItem) -> dict:
    return {column.name: getattr(item, column.name) for column in PrescriptionItem.__table__.columns}


def _prescription_dict(row: Prescription) -> dict:
    return {
        "id": row.id, "status": row.status, "source_type": row.source_type, "prescribed_by": row.prescribed_by,
        "prescribed_on": row.prescribed_on, "ocr_confidence": row.ocr_confidence,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "items": [_item_dict(item) for item in row.items],
    }


def _reminder_dict(row: MedicineReminder) -> dict:
    return {
        "id": row.id, "cabinet_medicine_id": row.cabinet_medicine_id, "prescription_item_id": row.prescription_item_id,
        "times": row.times, "days_of_week": row.days_of_week, "start_date": row.start_date, "end_date": row.end_date, "active": row.active,
    }


def _confirmed_rx_items(db: Session, user: User) -> list[dict]:
    rows = (
        db.query(PrescriptionItem).join(Prescription)
        .filter(Prescription.user_id == user.id, PrescriptionItem.confirmed.is_(True))
        .order_by(Prescription.created_at.desc(), PrescriptionItem.id).all()
    )
    return [_item_dict(row) for row in rows]


def _owned(db: Session, model, row_id: int, user: User):
    row = db.query(model).filter(model.id == row_id, model.user_id == user.id).first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return row


def _analysis(db: Session, user: User) -> tuple[list[CabinetMedicine], list[dict], dict]:
    rows = db.query(CabinetMedicine).filter(CabinetMedicine.user_id == user.id).order_by(CabinetMedicine.created_at.desc(), CabinetMedicine.id.desc()).all()
    rx_items = _confirmed_rx_items(db, user)
    profile = _profile_dict(_profile(db, user))
    return rows, rx_items, full_check.run([_cabinet_dict(row) for row in rows], rx_items, profile, _today())


def _medicine_view(row: CabinetMedicine, assessed: dict, reminders: list[dict]) -> dict:
    item = repository.entry(row.medicine_key)
    source = item["source"] if item else None
    return {
        **_cabinet_dict(row),
        **assessed,
        "reference": {
            "type_label": item["type_label"], "medical_type": item["medical_type"], "use_short": item["use_short"], "name_hi": item["name_hi"],
        } if item else None,
        "source": source,
        "last_verified": source["last_verified"] if source else None,
        "reminder_active": any(reminder["active"] for reminder in reminders),
        "reminders": reminders,
    }


@router.get("/capabilities")
def capabilities(_: User = Depends(get_current_user)):
    return {"ai_available": ai.available(), "reference_version": repository.REFERENCE_VERSION, "review_status": repository.REVIEW_STATUS, "disclaimer": DISCLAIMER}


@router.get("/vocabulary")
def vocabulary(_: User = Depends(get_current_user)):
    data = repository.knowledge()
    return {"conditions": data["conditions"], "labs": data["labs"]}


@router.get("/reference/search")
def reference_search(q: str = Query(min_length=2, max_length=60), _: User = Depends(get_current_user)):
    return identification.search(q)


@router.post("/identify")
def identify(body: IdentifyRequest, _: User = Depends(get_current_user)):
    result = identification.identify(body.text, body.ocr_confidence, body.quality_issues)
    item = repository.entry(result["medicine_key"])
    result["known_strengths"] = item["strengths"] if item else []
    return result


@router.post("/read-image")
async def read_image(file: UploadFile = File(...), _: User = Depends(get_current_user)):
    """Optional AI text reading. The browser only calls this after the patient opts in."""
    if not ai.available():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Enhanced reading is not configured")
    if file.content_type not in ai.ALLOWED_IMAGE_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Please upload a JPEG, PNG or WebP photo")
    content = await file.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Photo is too large")
    # The photo is forwarded for reading and never stored.
    return {"text": ai.read_image_text(content, file.content_type) or ""}


@router.get("/cabinet")
def cabinet(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows, _, result = _analysis(db, user)
    db.commit()
    all_reminders = db.query(MedicineReminder).filter(MedicineReminder.user_id == user.id).all()
    medicines = [
        _medicine_view(row, result["medicines"][row.id], [_reminder_dict(r) for r in all_reminders if r.cabinet_medicine_id == row.id])
        for row in rows
    ]
    return {"medicines": medicines, "summary": result["summary"], "issues": result["issues"], "disclaimer": DISCLAIMER}


@router.post("/cabinet", status_code=status.HTTP_201_CREATED)
def add_to_cabinet(body: CabinetCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not body.user_confirmed:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Please confirm the medicine details before saving")
    item = repository.entry(body.medicine_key)
    if body.medicine_key and not item:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown medicine")
    name = item["name"] if item else (body.medicine_name or "").strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A medicine name is required")

    now = datetime.now(timezone.utc)
    existing = None
    if item:
        # Scanning the same product again refreshes it, otherwise it would show as its own duplicate.
        candidates = db.query(CabinetMedicine).filter(
            CabinetMedicine.user_id == user.id, CabinetMedicine.medicine_key == item["key"], CabinetMedicine.strength == body.strength
        ).all()
        existing = next((row for row in candidates if (row.brand_name or None) == (body.brand_name or None)), None)

    if existing:
        row = existing
        row.last_scanned_at = now
        for field in ("dosage_form", "manufacturer", "batch_number"):
            setattr(row, field, getattr(body, field) or getattr(row, field))
        if body.expiry_date:
            row.expiry_date = body.expiry_date.isoformat()
        row.identification_confidence = body.identification_confidence
        row.user_confirmed = True
    else:
        row = CabinetMedicine(
            user_id=user.id, medicine_key=item["key"] if item else None, medicine_name=name[:160], brand_name=body.brand_name,
            strength=body.strength, dosage_form=body.dosage_form, manufacturer=body.manufacturer,
            expiry_date=body.expiry_date.isoformat() if body.expiry_date else None, batch_number=body.batch_number,
            identification_confidence=body.identification_confidence, user_confirmed=True, entry_method=body.entry_method, last_scanned_at=now,
        )
        db.add(row)
    db.flush()
    _log(db, user, "medicine_added", f"{name} {body.strength or ''}".strip(), {
        "medicine_id": row.id, "confidence": body.identification_confidence, "method": body.entry_method, "reference_version": repository.REFERENCE_VERSION,
    })
    db.commit()
    return _cabinet_dict(row)


@router.get("/cabinet/{medicine_id}")
def medicine_detail(medicine_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _owned(db, CabinetMedicine, medicine_id, user)
    _, _, result = _analysis(db, user)
    db.commit()
    reminders = [_reminder_dict(r) for r in row.reminders]
    view = _medicine_view(row, result["medicines"][row.id], reminders)
    item = repository.entry(row.medicine_key)
    related = [issue for issue in result["issues"] if row.id in issue["medicine_ids"]]
    line = view["prescription_item"]
    return {
        **view,
        "information": repository.public_entry(item) if item else None,
        "issues": related,
        "suggested_reminder_times": reminder_rules.suggested_times(line) if line else [],
        "can_create_reminder": _reminder_block(row, view, line) is None,
        "reminder_blocked_reason": _reminder_block(row, view, line),
        "disclaimer": DISCLAIMER,
    }


def _reminder_block(row: CabinetMedicine, view: dict, line: dict | None) -> str | None:
    try:
        count = (line or {}).get("times_per_day") or 1
        reminder_rules.validate(line, _cabinet_dict(row), view["prescription_match"], [f"{hour:02d}:00" for hour in range(count)])
    except reminder_rules.ReminderNotAllowed as blocked:
        return blocked.code
    return None


@router.patch("/cabinet/{medicine_id}")
def update_medicine(medicine_id: int, body: CabinetUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _owned(db, CabinetMedicine, medicine_id, user)
    changes = body.model_dump(exclude_unset=True)
    if "medicine_key" in changes:
        item = repository.entry(changes["medicine_key"])
        if changes["medicine_key"] and not item:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown medicine")
        if item:
            changes["medicine_name"] = item["name"]
    if changes.get("expiry_date"):
        changes["expiry_date"] = changes["expiry_date"].isoformat()
    for field, value in changes.items():
        setattr(row, field, value)
    _log(db, user, "medicine_edited", row.medicine_name, {"medicine_id": row.id, "fields": sorted(changes)})
    db.commit()
    return _cabinet_dict(row)


@router.delete("/cabinet/{medicine_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_medicine(medicine_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _owned(db, CabinetMedicine, medicine_id, user)
    _log(db, user, "medicine_removed", row.medicine_name, {"medicine_id": row.id})
    db.delete(row)
    db.commit()


@router.post("/cabinet/{medicine_id}/explain")
def explain(medicine_id: int, body: ExplainRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Optional simpler wording. Always returns the verified text if AI is off, fails or is rejected by the guard."""
    row = _owned(db, CabinetMedicine, medicine_id, user)
    item = repository.entry(row.medicine_key)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No reference information for this medicine")
    verified = item["what_is"][body.language]
    facts = "\n".join([verified, *(use[body.language] for use in item["uses"]), *(point[body.language] for point in item["precautions"])])
    text = ai.explain(facts, body.language)
    return {"text": text or verified, "generated": bool(text)}


@router.post("/prescriptions", status_code=status.HTTP_201_CREATED)
def parse_prescription(body: PrescriptionParse, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    parsed = prescription_parser.parse_prescription(body.text)
    if not parsed["readable"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "We could not read any medicines from this prescription")
    row = Prescription(user_id=user.id, source_type=body.source_type, ocr_confidence=body.ocr_confidence, status="needs_review")
    for line in parsed["items"]:
        fields = {key: value for key, value in line.items() if key != "candidates"}
        # Handwriting is unreliable, so nothing read from it is ever presented as high confidence.
        if body.source_type == "handwritten":
            fields["confidence"] = "needs_confirmation"
        row.items.append(PrescriptionItem(**fields))
    db.add(row)
    db.flush()
    _log(db, user, "prescription_uploaded", f"{len(parsed['items'])} medicines read", {"prescription_id": row.id, "source_type": body.source_type, "ocr_confidence": body.ocr_confidence})
    db.commit()
    view = _prescription_dict(row)
    candidates = iter(line["candidates"] for line in parsed["items"])
    for item in view["items"]:
        item["candidates"] = next(candidates)
    return view


@router.get("/prescriptions")
def list_prescriptions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(Prescription).filter(Prescription.user_id == user.id).order_by(Prescription.created_at.desc(), Prescription.id.desc()).all()
    return [_prescription_dict(row) for row in rows]


@router.put("/prescriptions/{prescription_id}")
def update_prescription(prescription_id: int, body: PrescriptionUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _owned(db, Prescription, prescription_id, user)
    existing = {item.id: item for item in row.items}
    kept = set()
    for incoming in body.items:
        item = existing.get(incoming.id) if incoming.id else None
        if incoming.id and item is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Prescription line not found")
        reference = repository.entry(incoming.medicine_key)
        if incoming.medicine_key and not reference:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown medicine")
        if incoming.confirmed and not (incoming.medicine_name or reference):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A confirmed line needs a medicine name")
        if item is None:
            item = PrescriptionItem(raw_line=None, confidence="needs_confirmation")
            row.items.append(item)
        item.medicine_key = incoming.medicine_key
        item.medicine_name = reference["name"] if reference else incoming.medicine_name
        item.strength = incoming.strength
        item.dose = incoming.dose
        item.frequency = incoming.frequency
        item.times_per_day = TIMES_FOR_FREQUENCY.get(incoming.frequency)
        item.as_needed = incoming.frequency == "as_needed"
        item.timing = incoming.timing
        item.food_relation = incoming.food_relation
        item.duration_days = incoming.duration_days
        item.instructions = incoming.instructions
        item.confirmed = incoming.confirmed
        db.flush()
        kept.add(item.id)
    for item_id, item in existing.items():
        if item_id not in kept:
            row.items.remove(item)
    row.prescribed_by = body.prescribed_by
    row.prescribed_on = body.prescribed_on.isoformat() if body.prescribed_on else None
    row.status = "confirmed" if row.items and all(item.confirmed for item in row.items) else "needs_review"
    if row.status == "confirmed":
        _log(db, user, "prescription_confirmed", f"{len(row.items)} medicines confirmed", {"prescription_id": row.id})
    db.commit()
    return _prescription_dict(row)


@router.delete("/prescriptions/{prescription_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_prescription(prescription_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _owned(db, Prescription, prescription_id, user)
    _log(db, user, "prescription_removed", "Prescription removed", {"prescription_id": row.id})
    db.delete(row)
    db.commit()


@router.get("/check")
def check(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows, _, result = _analysis(db, user)
    _log(db, user, "full_check", f"{len(rows)} medicines checked", {"summary": result["summary"], "reference_version": repository.REFERENCE_VERSION})
    db.commit()
    names = {row.id: _cabinet_dict(row) for row in rows}
    return {**result, "cabinet": names, "disclaimer": DISCLAIMER}


@router.get("/profile")
def get_profile(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = _profile(db, user)
    db.commit()
    return {**_profile_dict(profile), "suggestions": _suggestions(db, user, profile)}


def _suggestions(db: Session, user: User, profile: MedicalProfile) -> dict:
    """Facts found in earlier CardioGuard results. Shown as suggestions; never added without the patient."""
    screening = db.query(Screening).filter(Screening.owner_id == user.id, Screening.patient_id.is_(None)).order_by(Screening.screened_at.desc()).first()
    assessment = db.query(AssessmentHistory).filter(AssessmentHistory.user_id == user.id).order_by(AssessmentHistory.created_at.desc()).first()
    conditions, labs = [], []
    if screening:
        if screening.hypertension:
            conditions.append("high_bp")
        if screening.diabetes:
            conditions.append("diabetes")
        if screening.prior_stroke:
            conditions.append("previous_stroke")
        if screening.systolic_bp:
            labs.append({"key": "systolic_bp", "value": screening.systolic_bp, "date": screening.screened_at.date().isoformat() if screening.screened_at else None})
    if assessment and assessment.chol:
        labs.append({"key": "total_cholesterol", "value": assessment.chol, "date": assessment.created_at.date().isoformat() if assessment.created_at else None})
    return {"conditions": [key for key in conditions if key not in (profile.conditions or [])], "labs": labs}


@router.put("/profile")
def update_profile(body: ProfileUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = _profile(db, user)
    data = body.model_dump()
    data["labs"] = [{**lab, "date": lab["date"].isoformat() if lab["date"] else None} for lab in data["labs"]]
    for field, value in data.items():
        setattr(profile, field, value)
    _log(db, user, "profile_updated", "Health details updated", {"conditions": len(data["conditions"]), "allergies": len(data["allergies"])})
    db.commit()
    return {**_profile_dict(profile), "suggestions": _suggestions(db, user, profile)}


@router.post("/reminders", status_code=status.HTTP_201_CREATED)
def create_reminder(body: ReminderCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _owned(db, CabinetMedicine, body.cabinet_medicine_id, user)
    _, _, result = _analysis(db, user)
    info = result["medicines"][row.id]
    line = info["prescription_item"]
    try:
        reminder_rules.validate(line, _cabinet_dict(row), info["prescription_match"], body.times)
    except reminder_rules.ReminderNotAllowed as blocked:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": blocked.code}) from blocked

    start = body.start_date or _today()
    end = body.end_date or reminder_rules.end_date_for(start, line.get("duration_days"))
    if end and end < start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "End date is before start date")
    reminder = MedicineReminder(
        user_id=user.id, cabinet_medicine_id=row.id, prescription_item_id=line["id"], times=sorted(body.times),
        days_of_week=body.days_of_week, start_date=start, end_date=end,
    )
    db.add(reminder)
    db.flush()
    _log(db, user, "reminder_created", f"{row.medicine_name}: {', '.join(reminder.times)}", {"reminder_id": reminder.id, "prescription_item_id": line["id"]})
    db.commit()
    return _reminder_dict(reminder)


@router.get("/reminders")
def list_reminders(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(MedicineReminder).filter(MedicineReminder.user_id == user.id).order_by(MedicineReminder.id).all()
    return [{**_reminder_dict(row), "medicine_name": row.medicine.medicine_name, "brand_name": row.medicine.brand_name, "strength": row.medicine.strength} for row in rows]


@router.patch("/reminders/{reminder_id}")
def update_reminder(reminder_id: int, body: ReminderUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _owned(db, MedicineReminder, reminder_id, user)
    row.active = body.active
    _log(db, user, "reminder_paused" if not body.active else "reminder_resumed", row.medicine.medicine_name, {"reminder_id": row.id})
    db.commit()
    return _reminder_dict(row)


@router.delete("/reminders/{reminder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reminder(reminder_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _owned(db, MedicineReminder, reminder_id, user)
    _log(db, user, "reminder_removed", row.medicine.medicine_name, {"reminder_id": row.id})
    db.delete(row)
    db.commit()


@router.get("/doses")
def doses(day: date | None = None, days: int = Query(default=1, ge=1, le=14), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Scheduled doses, newest day first. `day` should be the patient's local date."""
    last = day or _today()
    first = last - timedelta(days=days - 1)
    rows = db.query(MedicineReminder).filter(MedicineReminder.user_id == user.id).all()
    logs = db.query(DoseLog).filter(DoseLog.user_id == user.id, DoseLog.scheduled_date >= first, DoseLog.scheduled_date <= last).all()
    by_slot = {(log.reminder_id, log.scheduled_date, log.scheduled_time): log for log in logs}
    result = []
    for offset in range(days):
        current = last - timedelta(days=offset)
        doses_today = []
        for row in rows:
            if not reminder_rules.is_due(_reminder_dict(row), current):
                continue
            for time_value in row.times:
                log = by_slot.get((row.id, current, time_value))
                doses_today.append({
                    "reminder_id": row.id, "cabinet_medicine_id": row.cabinet_medicine_id, "medicine_name": row.medicine.medicine_name,
                    "brand_name": row.medicine.brand_name, "strength": row.medicine.strength, "scheduled_date": current, "scheduled_time": time_value,
                    "status": log.status if log else None, "snoozed_until": log.snoozed_until if log else None,
                })
        result.append({"date": current, "doses": sorted(doses_today, key=lambda dose: dose["scheduled_time"])})
    return result


@router.post("/doses")
def log_dose(body: DoseLogCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    reminder = _owned(db, MedicineReminder, body.reminder_id, user)
    if body.scheduled_time not in reminder.times or not reminder_rules.is_due(_reminder_dict(reminder), body.scheduled_date):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That dose is not on this reminder's schedule")
    log = db.query(DoseLog).filter_by(reminder_id=reminder.id, scheduled_date=body.scheduled_date, scheduled_time=body.scheduled_time).first()
    if not log:
        log = DoseLog(user_id=user.id, reminder_id=reminder.id, scheduled_date=body.scheduled_date, scheduled_time=body.scheduled_time, status=body.status)
        db.add(log)
    log.status = body.status
    log.snoozed_until = None
    if body.status == "snoozed":
        moved = datetime.combine(body.scheduled_date, datetime.strptime(body.scheduled_time, "%H:%M").time()) + timedelta(minutes=body.snooze_minutes or 15)
        log.snoozed_until = moved.strftime("%H:%M")
    _log(db, user, f"dose_{body.status}", f"{reminder.medicine.medicine_name} {body.scheduled_time}", {"reminder_id": reminder.id, "date": body.scheduled_date.isoformat()})
    db.commit()
    return {"status": log.status, "snoozed_until": log.snoozed_until}


@router.get("/timeline")
def timeline(limit: int = Query(default=50, ge=1, le=200), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    hidden = ("dose_taken", "dose_skipped", "dose_snoozed", "full_check")
    rows = (
        db.query(MedicineEvent)
        .filter(MedicineEvent.user_id == user.id, MedicineEvent.event_type.notin_(hidden))
        .order_by(MedicineEvent.created_at.desc(), MedicineEvent.id.desc()).limit(limit).all()
    )
    return [{"id": row.id, "event_type": row.event_type, "summary": row.summary, "created_at": row.created_at.isoformat() if row.created_at else None} for row in rows]


@router.post("/emergency-consent")
def give_consent(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = _profile(db, user)
    profile.emergency_consent_at = datetime.now(timezone.utc)
    _log(db, user, "emergency_consent_given", "Emergency summary turned on")
    db.commit()
    return _profile_dict(profile)


@router.delete("/emergency-consent")
def withdraw_consent(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = _profile(db, user)
    profile.emergency_consent_at = None
    _log(db, user, "emergency_consent_withdrawn", "Emergency summary turned off")
    db.commit()
    return _profile_dict(profile)


@router.get("/emergency-summary")
def emergency_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = _profile(db, user)
    if not profile.emergency_consent_at:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Emergency summary is turned off")
    rows, _, _ = _analysis(db, user)
    vocabulary_labs = repository.knowledge()["labs"]
    suggestions = _suggestions(db, user, profile)
    latest: dict[str, dict] = {}
    for lab in [*suggestions["labs"], *(profile.labs or [])]:
        if lab["key"] not in latest or (lab.get("date") or "") >= (latest[lab["key"]].get("date") or ""):
            latest[lab["key"]] = lab
    return {
        "name": user.name,
        "medicines": [
            {"name": row.medicine_name, "brand_name": row.brand_name, "strength": row.strength, "confirmed": row.user_confirmed}
            for row in rows
        ],
        "allergies": profile.allergies or [],
        "conditions": [repository.condition_label(key)["en"] for key in (profile.conditions or [])],
        "recent_results": [{"label": vocabulary_labs[key]["en"], "value": lab["value"], "unit": vocabulary_labs[key]["unit"], "date": lab.get("date")} for key, lab in latest.items()],
        "emergency_contact": {"name": profile.emergency_contact_name, "phone": profile.emergency_contact_phone},
        "consent_at": profile.emergency_consent_at.isoformat(),
    }


__all__ = ["router", "rx"]
