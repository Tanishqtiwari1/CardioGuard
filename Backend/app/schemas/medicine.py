from datetime import date as Date
from typing import Literal

from pydantic import BaseModel, Field, field_validator

TEXT_LIMIT = 8000


class IdentifyRequest(BaseModel):
    text: str = Field(default="", max_length=TEXT_LIMIT)
    ocr_confidence: float | None = Field(default=None, ge=0, le=100)
    quality_issues: list[Literal["blurry", "too_dark", "glare", "text_cut_off", "too_small"]] = []


class CabinetCreate(BaseModel):
    medicine_key: str | None = Field(default=None, max_length=120)
    medicine_name: str | None = Field(default=None, max_length=160)
    brand_name: str | None = Field(default=None, max_length=120)
    strength: str | None = Field(default=None, max_length=60)
    dosage_form: str | None = Field(default=None, max_length=40)
    manufacturer: str | None = Field(default=None, max_length=120)
    expiry_date: Date | None = None
    batch_number: str | None = Field(default=None, max_length=40)
    identification_confidence: Literal["high", "needs_confirmation", "unable", "manual"] = "manual"
    entry_method: Literal["scan", "manual"] = "scan"
    user_confirmed: bool = False


class CabinetUpdate(BaseModel):
    medicine_key: str | None = Field(default=None, max_length=120)
    medicine_name: str | None = Field(default=None, max_length=160)
    brand_name: str | None = Field(default=None, max_length=120)
    strength: str | None = Field(default=None, max_length=60)
    dosage_form: str | None = Field(default=None, max_length=40)
    expiry_date: Date | None = None
    user_confirmed: bool | None = None


class PrescriptionParse(BaseModel):
    text: str = Field(default="", max_length=TEXT_LIMIT)
    ocr_confidence: float | None = Field(default=None, ge=0, le=100)
    source_type: Literal["digital", "handwritten"] = "digital"


class PrescriptionItemInput(BaseModel):
    id: int | None = None
    medicine_key: str | None = Field(default=None, max_length=120)
    medicine_name: str | None = Field(default=None, max_length=160)
    strength: str | None = Field(default=None, max_length=60)
    dose: str | None = Field(default=None, max_length=40)
    frequency: Literal["once_daily", "twice_daily", "three_daily", "four_daily", "as_needed"] | None = None
    timing: list[str] = Field(default=[], max_length=6)
    food_relation: Literal["after_food", "before_food", "with_food"] | None = None
    duration_days: int | None = Field(default=None, ge=1, le=730)
    instructions: str | None = Field(default=None, max_length=300)
    confirmed: bool = False


class PrescriptionUpdate(BaseModel):
    items: list[PrescriptionItemInput] = Field(max_length=30)
    prescribed_by: str | None = Field(default=None, max_length=120)
    prescribed_on: Date | None = None


class LabValue(BaseModel):
    key: Literal["ldl", "total_cholesterol", "triglycerides", "hba1c", "fasting_glucose", "systolic_bp", "pulse"]
    value: float = Field(gt=0, le=2000)
    date: Date | None = None
    source: Literal["manual", "report"] = "manual"


class ProfileUpdate(BaseModel):
    conditions: list[str] = Field(default=[], max_length=40)
    allergies: list[str] = Field(default=[], max_length=40)
    labs: list[LabValue] = Field(default=[], max_length=40)
    doctor_name: str | None = Field(default=None, max_length=120)
    doctor_phone: str | None = Field(default=None, max_length=30)
    emergency_contact_name: str | None = Field(default=None, max_length=120)
    emergency_contact_phone: str | None = Field(default=None, max_length=30)

    @field_validator("conditions", "allergies")
    @classmethod
    def clean_list(cls, values: list[str]) -> list[str]:
        cleaned = [" ".join(value.split())[:80] for value in values]
        return list(dict.fromkeys(value for value in cleaned if value))


class ReminderCreate(BaseModel):
    cabinet_medicine_id: int
    times: list[str] = Field(min_length=1, max_length=6)
    days_of_week: list[int] | None = Field(default=None, max_length=7)
    start_date: Date | None = None
    end_date: Date | None = None

    @field_validator("days_of_week")
    @classmethod
    def valid_days(cls, days: list[int] | None) -> list[int] | None:
        if days is not None and (not days or any(day < 0 or day > 6 for day in days)):
            raise ValueError("Days must be between 0 (Monday) and 6 (Sunday)")
        return sorted(set(days)) if days else None


class ReminderUpdate(BaseModel):
    active: bool


class DoseLogCreate(BaseModel):
    reminder_id: int
    scheduled_date: Date
    scheduled_time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    status: Literal["taken", "skipped", "snoozed"]
    snooze_minutes: int | None = Field(default=None, ge=5, le=240)


class ExplainRequest(BaseModel):
    language: Literal["en", "hi"] = "en"
