import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text
from app.database.connection import Base, engine
from app.models.assessment import AssessmentHistory
from app.models.community import Patient, Screening
from app.models.sos import SosShare
from app.models.password_reset import PasswordResetToken
from app.models.user import User
from app.api.auth import router as auth_router
from app.api.prediction import router as prediction_router
from app.api.screening import router as screening_router
from app.api.sos import router as sos_router

app = FastAPI(
    title="CardioGuard AI API",
    description="Backend API for Cardiovascular Risk Prediction",
    version="1.0.0"
)

cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174,https://tanishqtiwari1.github.io",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(prediction_router, prefix="/api/v1")
app.include_router(screening_router, prefix="/api/v1")
app.include_router(sos_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1/auth")

Base.metadata.create_all(bind=engine)

# create_all doesn't add columns to existing tables; add chest pain type to older databases.
if 'cp' not in {column['name'] for column in inspect(engine).get_columns('assessments')}:
    with engine.begin() as connection:
        connection.execute(text('ALTER TABLE assessments ADD COLUMN cp INTEGER'))

@app.get("/")
def health_check():
    return {"status": "Active", "message": "CardioGuard AI API is running"}