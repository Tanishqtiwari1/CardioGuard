from sqlalchemy import JSON, Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database.connection import Base


class MedicalProfile(Base):
    """The health details a patient chose to give for medicine checks."""
    __tablename__ = "medical_profiles"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    conditions = Column(JSON, nullable=False, default=list)
    allergies = Column(JSON, nullable=False, default=list)
    labs = Column(JSON, nullable=False, default=list)
    doctor_name = Column(String(120))
    doctor_phone = Column(String(30))
    emergency_contact_name = Column(String(120))
    emergency_contact_phone = Column(String(30))
    # Set only when the patient opts in, and cleared when they withdraw.
    emergency_consent_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CabinetMedicine(Base):
    __tablename__ = "cabinet_medicines"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # Empty when the medicine isn't in the reference data; it then shows as "information unavailable".
    medicine_key = Column(String(120))
    medicine_name = Column(String(160), nullable=False)
    brand_name = Column(String(120))
    strength = Column(String(60))
    dosage_form = Column(String(40))
    manufacturer = Column(String(120))
    expiry_date = Column(String(10))
    batch_number = Column(String(40))
    identification_confidence = Column(String(24), nullable=False)
    user_confirmed = Column(Boolean, nullable=False, default=False)
    entry_method = Column(String(16), nullable=False, default="scan")
    last_scanned_at = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    reminders = relationship("MedicineReminder", backref="medicine", cascade="all, delete-orphan")


class Prescription(Base):
    __tablename__ = "prescriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type = Column(String(20), nullable=False, default="digital")  # digital | handwritten
    status = Column(String(20), nullable=False, default="needs_review")  # needs_review | confirmed
    prescribed_by = Column(String(120))
    prescribed_on = Column(String(10))
    ocr_confidence = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    items = relationship("PrescriptionItem", backref="prescription", cascade="all, delete-orphan", order_by="PrescriptionItem.id")


class PrescriptionItem(Base):
    __tablename__ = "prescription_items"

    id = Column(Integer, primary_key=True, index=True)
    prescription_id = Column(Integer, ForeignKey("prescriptions.id", ondelete="CASCADE"), nullable=False, index=True)
    raw_line = Column(String(300))
    medicine_key = Column(String(120))
    medicine_name = Column(String(160))
    brand_written = Column(String(120))
    strength = Column(String(60))
    dose = Column(String(40))
    frequency = Column(String(20))
    times_per_day = Column(Integer)
    as_needed = Column(Boolean, nullable=False, default=False)
    timing = Column(JSON, nullable=False, default=list)
    food_relation = Column(String(20))
    duration_days = Column(Integer)
    duration_text = Column(String(40))
    instructions = Column(String(300))
    confidence = Column(String(24), nullable=False, default="needs_confirmation")
    confirmed = Column(Boolean, nullable=False, default=False)


class MedicineReminder(Base):
    __tablename__ = "medicine_reminders"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    cabinet_medicine_id = Column(Integer, ForeignKey("cabinet_medicines.id", ondelete="CASCADE"), nullable=False, index=True)
    prescription_item_id = Column(Integer, ForeignKey("prescription_items.id", ondelete="SET NULL"))
    times = Column(JSON, nullable=False)
    days_of_week = Column(JSON)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    logs = relationship("DoseLog", backref="reminder", cascade="all, delete-orphan")


class DoseLog(Base):
    __tablename__ = "dose_logs"
    __table_args__ = (UniqueConstraint("reminder_id", "scheduled_date", "scheduled_time", name="uq_dose_slot"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    reminder_id = Column(Integer, ForeignKey("medicine_reminders.id", ondelete="CASCADE"), nullable=False, index=True)
    scheduled_date = Column(Date, nullable=False)
    scheduled_time = Column(String(5), nullable=False)
    status = Column(String(10), nullable=False)  # taken | skipped | snoozed
    snoozed_until = Column(String(5))
    logged_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MedicineEvent(Base):
    """Audit trail and the patient's medication timeline."""
    __tablename__ = "medicine_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String(40), nullable=False)
    summary = Column(Text, nullable=False)
    details = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
