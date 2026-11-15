"""Clinical prediction engine: one entry point, two trained models.

* ``standard``: ml/model.pkl + ml/scaler.pkl (XGBoost, 10 inputs). Unchanged.
* ``extended``: ml/model_extended.pkl (scaler + XGBoost Pipeline, 13 inputs: the 10 above
  plus ST slope, major vessels on fluoroscopy and thallium stress test).

The extended model is used only when all three extra test results are supplied. Held-out
evaluation (ml/metrics_extended.json) showed it is better with those results, but worse than
the standard model when they are blank, so blank extras always go to the standard model.

Inputs use the raw UCI codes the models were trained on. Feature order is fixed below and
checked against the trained artefacts at load time.
"""
from __future__ import annotations

import logging
import os
import pickle
from dataclasses import dataclass

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
ML_DIR = os.path.join(BASE_DIR, 'ml')

STANDARD_FEATURES = ['age', 'sex', 'cp', 'trestbps', 'chol', 'fbs', 'restecg', 'thalach', 'exang', 'oldpeak']
EXTRA_FEATURES = ['slope', 'ca', 'thal']
EXTENDED_FEATURES = STANDARD_FEATURES + EXTRA_FEATURES

# Risk bands on the model probability (percent). Unchanged from the original CardioGuard
# thresholds; they are display bands for a model score, not clinical cut-offs.
LOW_THRESHOLD = 33.0    # score < 33  -> LOW
HIGH_THRESHOLD = 66.0   # score >= 66 -> HIGH, otherwise MODERATE

MODELS = {
    'standard': {'label': 'Standard clinical model (10 inputs)', 'features': STANDARD_FEATURES},
    'extended': {'label': 'Extended clinical model (13 inputs incl. stress-test results)', 'features': EXTENDED_FEATURES},
}


def risk_category(probability_pct: float) -> str:
    if probability_pct < LOW_THRESHOLD:
        return 'LOW'
    if probability_pct < HIGH_THRESHOLD:
        return 'MODERATE'
    return 'HIGH'


@dataclass
class Prediction:
    probability: float          # percent, 0-100
    category: str
    model_id: str
    model_label: str
    shap_values: dict           # feature -> contribution (log-odds), only for the model's features


class PredictionEngine:
    def __init__(self, ml_dir: str = ML_DIR):
        with open(os.path.join(ml_dir, 'model.pkl'), 'rb') as f:
            self._std_model = pickle.load(f)
        with open(os.path.join(ml_dir, 'scaler.pkl'), 'rb') as f:
            self._std_scaler = pickle.load(f)
        self._check_features(self._std_scaler, STANDARD_FEATURES, 'standard scaler')

        self._ext = None
        ext_path = os.path.join(ml_dir, 'model_extended.pkl')
        if os.path.exists(ext_path):
            with open(ext_path, 'rb') as f:
                self._ext = pickle.load(f)
            self._check_features(self._ext, EXTENDED_FEATURES, 'extended pipeline')
        else:
            log.warning('model_extended.pkl not found; all predictions use the standard model')

        self._explainers: dict = {}

    @staticmethod
    def _check_features(estimator, expected, name):
        found = getattr(estimator, 'feature_names_in_', None)
        if found is not None and list(found) != list(expected):
            raise RuntimeError(f'{name} was trained on {list(found)}, expected {expected}')
        n = getattr(estimator, 'n_features_in_', None)
        if n is not None and n != len(expected):
            raise RuntimeError(f'{name} expects {n} features, engine provides {len(expected)}')

    @property
    def extended_available(self) -> bool:
        return self._ext is not None

    def choose_model(self, values: dict) -> str:
        has_all = all(values.get(k) is not None for k in EXTRA_FEATURES)
        return 'extended' if has_all and self._ext is not None else 'standard'

    def _explainer(self, model_id, model):
        if model_id not in self._explainers:
            import shap
            self._explainers[model_id] = shap.TreeExplainer(model)
        return self._explainers[model_id]

    def predict(self, values: dict) -> Prediction:
        model_id = self.choose_model(values)
        features = MODELS[model_id]['features']
        missing = [k for k in features if k not in values]
        if missing:
            raise ValueError(f'Missing inputs: {missing}')
        # cp may be None for old saved assessments; XGBoost treats NaN as missing.
        frame = pd.DataFrame([{k: values[k] for k in features}], columns=features).astype(float)

        if model_id == 'extended':
            scaler, model = self._ext.named_steps['scaler'], self._ext.named_steps['model']
        else:
            scaler, model = self._std_scaler, self._std_model
        X = scaler.transform(frame)
        pos = list(model.classes_).index(1)
        probability = float(model.predict_proba(X)[0][pos] * 100)

        shap_vals = np.asarray(self._explainer(model_id, model).shap_values(X))
        row = shap_vals[0] if shap_vals.ndim == 2 else shap_vals[0, :, pos]
        shap_dict = {name: float(v) for name, v in zip(features, row)}

        return Prediction(
            probability=round(probability, 2),
            category=risk_category(probability),
            model_id=model_id,
            model_label=MODELS[model_id]['label'],
            shap_values=shap_dict,
        )


_engine: PredictionEngine | None = None


def get_engine() -> PredictionEngine:
    global _engine
    if _engine is None:
        _engine = PredictionEngine()
    return _engine
