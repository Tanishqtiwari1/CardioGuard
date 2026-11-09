"""Reminder rules. A reminder can only exist for instructions the patient confirmed from a prescription."""
import re
from datetime import date, timedelta

from app.medicines import prescription_match as rx
from app.medicines.prescription_parser import merge_timing

# Clock times are only a starting suggestion for a time of day the prescription actually states.
SUGGESTED_TIME = {
    "before_breakfast": "07:30", "morning": "08:00", "after_breakfast": "09:00", "empty_stomach": "07:00",
    "before_lunch": "12:30", "afternoon": "14:00", "after_lunch": "14:00",
    "evening": "18:00", "evening_or_night": "19:00", "before_dinner": "20:00",
    "after_dinner": "21:00", "night": "21:00", "bedtime": "22:00",
}
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
BLOCKING_MATCHES = {rx.STRENGTH_MISMATCH, rx.INGREDIENT_DIFFERENCE, rx.SIMILAR_NAME, rx.VERIFY, rx.NOT_ON_RX, rx.NO_RX}


class ReminderNotAllowed(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def suggested_times(line: dict) -> list[str]:
    """Only as many suggestions as the prescription states times of day. Never invents a schedule."""
    times = line.get("times_per_day")
    slots = [SUGGESTED_TIME[slot] for slot in merge_timing(line.get("timing") or []) if slot in SUGGESTED_TIME]
    slots = sorted(dict.fromkeys(slots))
    return slots if times and len(slots) == times else []


def validate(line: dict | None, cabinet: dict, match: dict, times: list[str]) -> None:
    if not cabinet.get("user_confirmed"):
        raise ReminderNotAllowed("medicine_unconfirmed")
    if match["status"] in BLOCKING_MATCHES or line is None:
        raise ReminderNotAllowed(match["status"] if match["status"] in BLOCKING_MATCHES else "no_prescription")
    if not line.get("confirmed"):
        raise ReminderNotAllowed("prescription_unconfirmed")
    if line.get("as_needed"):
        raise ReminderNotAllowed("as_needed")
    if not line.get("times_per_day"):
        raise ReminderNotAllowed("frequency_missing")
    if len(times) != line["times_per_day"] or len(set(times)) != len(times):
        raise ReminderNotAllowed("times_do_not_match_prescription")
    if not all(TIME_RE.match(value) for value in times):
        raise ReminderNotAllowed("invalid_time")


def end_date_for(start: date, duration_days: int | None) -> date | None:
    return start + timedelta(days=duration_days - 1) if duration_days else None


def is_due(reminder: dict, day: date) -> bool:
    if not reminder.get("active"):
        return False
    if day < reminder["start_date"] or (reminder.get("end_date") and day > reminder["end_date"]):
        return False
    days = reminder.get("days_of_week")
    return not days or day.weekday() in days
