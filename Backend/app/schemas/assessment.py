from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class ActionPlanItem(BaseModel):
    title: str
    detail: str

class HealthDataInput(BaseModel):
    age: int = Field(..., ge=1, le=120)
    sex: int = Field(..., description="0 for female, 1 for male")
    cp: Optional[int] = Field(None, ge=1, le=4, description="Chest pain type (1 typical angina, 2 atypical angina, 3 non-anginal pain, 4 no chest pain)")
    trestbps: int = Field(..., description="Resting blood pressure")
    chol: int = Field(..., description="Serum cholesterol in mg/dl")
    fbs: int = Field(..., description="Fasting blood sugar > 120 mg/dl (1 = true; 0 = false)")
    restecg: int = Field(..., description="Resting electrocardiographic results (0, 1, 2)")
    thalach: int = Field(..., description="Maximum heart rate achieved")
    exang: int = Field(..., description="Exercise induced angina (1 = yes; 0 = no)")
    oldpeak: float = Field(..., description="ST depression induced by exercise relative to rest")
    # Optional stress-test results (UCI codes). When all three are given, the extended model is used.
    slope: Optional[int] = Field(None, ge=1, le=3, description="Peak-exercise ST slope (1 upsloping, 2 flat, 3 downsloping)")
    ca: Optional[int] = Field(None, ge=0, le=3, description="Major vessels coloured by fluoroscopy (0-3)")
    thal: Optional[int] = Field(None, description="Thallium stress test (3 normal, 6 fixed defect, 7 reversible defect)")

    @field_validator('thal')
    @classmethod
    def _thal_code(cls, v):
        if v is not None and v not in (3, 6, 7):
            raise ValueError('thal must be 3 (normal), 6 (fixed defect) or 7 (reversible defect)')
        return v

    @model_validator(mode='after')
    def _extras_all_or_none(self):
        given = [v is not None for v in (self.slope, self.ca, self.thal)]
        if any(given) and not all(given):
            raise ValueError('Enter all three stress-test results (ST slope, major vessels, thallium test) or leave all three blank.')
        return self

class PredictionResponse(BaseModel):
    risk_probability: float
    risk_category: str
    shap_values: dict
    insights: list
    action_plan: list[ActionPlanItem]
    model_id: str = "standard"
    model_label: str = ""