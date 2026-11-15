from sqlalchemy import Column, ForeignKey, Integer, Float, String, DateTime
from sqlalchemy.sql import func
from app.database.connection import Base

class AssessmentHistory(Base):
    __tablename__ = "assessments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    
    age = Column(Integer)
    sex = Column(Integer)
    cp = Column(Integer, nullable=True)
    trestbps = Column(Integer)
    chol = Column(Integer)
    fbs = Column(Integer)
    restecg = Column(Integer)
    thalach = Column(Integer)
    exang = Column(Integer)
    oldpeak = Column(Float)
    slope = Column(Integer, nullable=True)
    ca = Column(Integer, nullable=True)
    thal = Column(Integer, nullable=True)
    model_id = Column(String(20), nullable=True)
    
    risk_probability = Column(Float)
    risk_category = Column(String(50))
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())