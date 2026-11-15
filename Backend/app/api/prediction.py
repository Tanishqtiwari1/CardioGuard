from fastapi import APIRouter, Depends, HTTPException, Query
import json
import logging
import os
from sqlalchemy.orm import Session
from app.database.connection import get_db
from app.models.assessment import AssessmentHistory
from app.models.user import User
from app.prediction_engine import get_engine
from app.security import get_current_user
from app.schemas.assessment import ActionPlanItem, HealthDataInput, PredictionResponse

router = APIRouter()
log = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
METRICS_PATH = os.path.join(BASE_DIR, 'ml', 'metrics.json')
METRICS_EXTENDED_PATH = os.path.join(BASE_DIR, 'ml', 'metrics_extended.json')

# Load both models at startup so a broken artefact fails loudly in the server log.
try:
    get_engine()
except Exception:
    log.exception("Error loading model artifacts")


def build_action_plan(data: HealthDataInput | dict) -> list[ActionPlanItem]:
    values = data.model_dump() if isinstance(data, HealthDataInput) else data
    priorities = []
    trestbps = values.get('trestbps')
    if trestbps is not None and trestbps >= 130:
        priorities.append(ActionPlanItem(title="Focus on blood pressure", detail="Discuss repeated elevated readings with a qualified clinician."))
    chol = values.get('chol')
    if chol is not None and chol >= 200:
        priorities.append(ActionPlanItem(title="Review cholesterol", detail="Consider discussing your lipid results with a qualified clinician."))
    thalach = values.get('thalach')
    if thalach is not None and thalach < 120:
        priorities.append(ActionPlanItem(title="Discuss activity tolerance", detail="Ask a qualified clinician what level of physical activity is appropriate for you."))
    if values.get('cp') in (1, 2):
        priorities.append(ActionPlanItem(title="Talk about chest pain", detail="Describe when your chest discomfort happens to a qualified clinician."))
    if values.get('exang') == 1:
        priorities.append(ActionPlanItem(title="Mention exercise-related symptoms", detail="Discuss any symptoms during activity with a qualified clinician."))
    oldpeak = values.get('oldpeak')
    if oldpeak is not None and oldpeak >= 2:
        priorities.append(ActionPlanItem(title="Review exercise-test signals", detail="Discuss this exercise-related measure with a qualified clinician."))
    if values.get('fbs') == 1:
        priorities.append(ActionPlanItem(title="Review fasting sugar", detail="Consider discussing this fasting-sugar reading with a qualified clinician."))
    return priorities[:4]


def calculate_model_metrics() -> dict:
    # Written by ml/train_model.py from the held-out test split, which is never used for training.
    with open(METRICS_PATH) as f:
        metrics = json.load(f)
    # Extended model (ml/train_extended_model.py), evaluated on the same held-out split.
    if os.path.exists(METRICS_EXTENDED_PATH):
        with open(METRICS_EXTENDED_PATH) as f:
            metrics['extended_model'] = json.load(f)
    return metrics

@router.post("/predict", response_model=PredictionResponse)
def predict_risk(data: HealthDataInput, persist: bool = Query(True), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        result = get_engine().predict(data.model_dump())
    except Exception as e:
        # Keep the technical detail in the server log, not in the patient's browser.
        log.exception("Prediction failed")
        raise HTTPException(status_code=500, detail="The analysis could not be completed. Please try again.") from e

    insights = []
    if data.trestbps > 130:
        insights.append("Your blood pressure is elevated. Consider monitoring it.")
    if data.chol > 200:
        insights.append("Cholesterol levels are above normal ranges.")

    if persist:
        values = data.model_dump()
        assessment = AssessmentHistory(
            user_id=user.id,
            **{k: values[k] for k in ('age', 'sex', 'cp', 'trestbps', 'chol', 'fbs', 'restecg', 'thalach',
                                      'exang', 'oldpeak', 'slope', 'ca', 'thal')},
            risk_probability=result.probability,
            risk_category=result.category,
            model_id=result.model_id,
        )
        db.add(assessment)
        db.commit()

    return PredictionResponse(
        risk_probability=result.probability,
        risk_category=result.category,
        shap_values=result.shap_values,
        insights=insights,
        action_plan=build_action_plan(data),
        model_id=result.model_id,
        model_label=result.model_label,
    )


@router.get("/model-insights")
def model_insights(user: User = Depends(get_current_user)):
    try:
        return calculate_model_metrics()
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Model evaluation is currently unavailable") from exc


@router.get("/history")
def assessment_history(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    records = db.query(AssessmentHistory).filter(AssessmentHistory.user_id == user.id).order_by(AssessmentHistory.created_at.desc()).all()
    return [
        {
            "id": record.id,
            "created_at": record.created_at,
            "risk_probability": record.risk_probability,
            "risk_category": record.risk_category,
            "form_data": {
                "age": record.age,
                "sex": record.sex,
                "cp": record.cp,
                "trestbps": record.trestbps,
                "chol": record.chol,
                "fbs": record.fbs,
                "restecg": record.restecg,
                "thalach": record.thalach,
                "exang": record.exang,
                "oldpeak": record.oldpeak,
                "slope": record.slope,
                "ca": record.ca,
                "thal": record.thal,
            },
            "model_id": record.model_id or "standard",
            "action_plan": [item.model_dump() for item in build_action_plan({
                "cp": record.cp,
                "trestbps": record.trestbps,
                "chol": record.chol,
                "thalach": record.thalach,
                "exang": record.exang,
                "oldpeak": record.oldpeak,
                "fbs": record.fbs,
            })],
        }
        for record in records
    ]