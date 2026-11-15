"""Tests for the routed clinical prediction engine (standard 10-input / extended 13-input)."""
import os
import pickle

import pandas as pd
import pytest

from app.prediction_engine import (EXTENDED_FEATURES, HIGH_THRESHOLD, LOW_THRESHOLD, STANDARD_FEATURES,
                                   get_engine, risk_category)

ML = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'ml')

LOW = {'age': 41, 'sex': 0, 'cp': 2, 'trestbps': 130, 'chol': 204, 'fbs': 0, 'restecg': 0,
       'thalach': 172, 'exang': 0, 'oldpeak': 1.4}
HIGH = {'age': 62, 'sex': 1, 'cp': 4, 'trestbps': 150, 'chol': 268, 'fbs': 0, 'restecg': 2,
        'thalach': 118, 'exang': 1, 'oldpeak': 2.2}
LOW_EXTRAS = {'slope': 1, 'ca': 0, 'thal': 3}
HIGH_EXTRAS = {'slope': 2, 'ca': 2, 'thal': 7}


def _old_standard_probability(values):
    """The pre-upgrade code path, reproduced verbatim, for a parity check."""
    model = pickle.load(open(os.path.join(ML, 'model.pkl'), 'rb'))
    scaler = pickle.load(open(os.path.join(ML, 'scaler.pkl'), 'rb'))
    X = scaler.transform(pd.DataFrame([values], columns=STANDARD_FEATURES).astype(float))
    return round(float(model.predict_proba(X)[0][list(model.classes_).index(1)] * 100), 2)


@pytest.mark.parametrize('values', [LOW, HIGH, {**HIGH, 'cp': None}])
def test_standard_path_matches_previous_behaviour(values):
    result = get_engine().predict({**values, 'slope': None, 'ca': None, 'thal': None})
    assert result.model_id == 'standard'
    assert result.probability == _old_standard_probability(values)
    assert set(result.shap_values) == set(STANDARD_FEATURES)


def test_extended_model_used_only_with_all_three_extras():
    engine = get_engine()
    assert engine.extended_available
    assert engine.choose_model({**HIGH, **HIGH_EXTRAS}) == 'extended'
    assert engine.choose_model({**HIGH, 'slope': 2, 'ca': None, 'thal': 7}) == 'standard'
    result = engine.predict({**HIGH, **HIGH_EXTRAS})
    assert result.model_id == 'extended'
    assert set(result.shap_values) == set(EXTENDED_FEATURES)


def test_higher_risk_profile_scores_higher_on_both_models():
    engine = get_engine()
    assert engine.predict(HIGH).probability > engine.predict(LOW).probability
    assert engine.predict({**HIGH, **HIGH_EXTRAS}).probability > engine.predict({**LOW, **LOW_EXTRAS}).probability


def test_extras_change_the_estimate_sensibly():
    engine = get_engine()
    base = {**HIGH, **LOW_EXTRAS}
    # More diseased vessels on fluoroscopy should not lower the model estimate for this profile.
    assert engine.predict({**base, 'ca': 3}).probability >= engine.predict({**base, 'ca': 0}).probability


def test_prediction_is_deterministic():
    engine = get_engine()
    a = engine.predict({**HIGH, **HIGH_EXTRAS})
    b = engine.predict({**HIGH, **HIGH_EXTRAS})
    assert a.probability == b.probability and a.shap_values == b.shap_values


def test_shap_is_consistent_with_probability():
    """SHAP values (log-odds) plus the base value reproduce the model's probability."""
    import math
    engine = get_engine()
    for values in ({**HIGH}, {**HIGH, **HIGH_EXTRAS}):
        result = engine.predict(values)
        model_id = result.model_id
        model = engine._ext.named_steps['model'] if model_id == 'extended' else engine._std_model
        base = float(engine._explainer(model_id, model).expected_value)
        logit = base + sum(result.shap_values.values())
        assert abs(100 / (1 + math.exp(-logit)) - result.probability) < 0.5


def test_risk_category_thresholds():
    assert risk_category(LOW_THRESHOLD - 0.01) == 'LOW'
    assert risk_category(LOW_THRESHOLD) == 'MODERATE'
    assert risk_category(HIGH_THRESHOLD - 0.01) == 'MODERATE'
    assert risk_category(HIGH_THRESHOLD) == 'HIGH'


# ---- API ----------------------------------------------------------------------------------
def test_api_standard_and_extended(client, auth):
    r = client.post('/api/v1/predict?persist=false', json=HIGH, headers=auth)
    assert r.status_code == 200 and r.json()['model_id'] == 'standard'
    r = client.post('/api/v1/predict?persist=false', json={**HIGH, **HIGH_EXTRAS}, headers=auth)
    body = r.json()
    assert r.status_code == 200 and body['model_id'] == 'extended'
    assert body['risk_category'] in {'LOW', 'MODERATE', 'HIGH'}
    assert {'slope', 'ca', 'thal'} <= set(body['shap_values'])


@pytest.mark.parametrize('bad', [
    {'slope': 2},                                  # partial extras
    {'slope': 2, 'ca': 1},                         # partial extras
    {'slope': 2, 'ca': 1, 'thal': 5},              # invalid thal code
    {'slope': 4, 'ca': 1, 'thal': 3},              # slope out of range
    {'slope': 2, 'ca': 9, 'thal': 3},              # ca out of range
    {'age': -3},
    {'trestbps': 'high'},
])
def test_api_rejects_invalid_input(client, auth, bad):
    r = client.post('/api/v1/predict?persist=false', json={**HIGH, **bad}, headers=auth)
    assert r.status_code == 422


def test_api_rejects_missing_field_and_malformed_body(client, auth):
    payload = dict(HIGH); payload.pop('chol')
    assert client.post('/api/v1/predict', json=payload, headers=auth).status_code == 422
    r = client.post('/api/v1/predict', content='not json', headers={**auth, 'Content-Type': 'application/json'})
    assert r.status_code == 422


def test_history_stores_extras_and_model(client, auth):
    client.post('/api/v1/predict', json={**HIGH, **HIGH_EXTRAS}, headers=auth)
    client.post('/api/v1/predict', json=LOW, headers=auth)
    records = client.get('/api/v1/history', headers=auth).json()
    # Both rows can share a timestamp (second resolution), so don't rely on order.
    by_model = {r['model_id']: r for r in records}
    assert by_model['standard']['form_data']['ca'] is None
    assert by_model['extended']['form_data']['thal'] == 7
    assert by_model['extended']['form_data']['slope'] == 2


def test_model_insights_include_extended_metrics(client, auth):
    body = client.get('/api/v1/model-insights', headers=auth).json()
    ext = body['extended_model']
    assert ext['features'][-3:] == ['slope', 'ca', 'thal']
    assert 'standard_model' in ext['comparison']['test_rows_with_extra_inputs']


def test_patient_name_is_stored_cleaned_and_ignored_by_the_model(client, auth):
    plain = client.post('/api/v1/predict?persist=false', json=HIGH, headers=auth).json()
    named = client.post('/api/v1/predict', json={**HIGH, 'patient_name': '  Vikram   Singh '}, headers=auth).json()
    assert named['risk_probability'] == plain['risk_probability']
    records = client.get('/api/v1/history', headers=auth).json()
    assert any(r['patient_name'] == 'Vikram Singh' for r in records)
    blank = client.post('/api/v1/predict?persist=false', json={**HIGH, 'patient_name': '   '}, headers=auth)
    assert blank.status_code == 200
    too_long = client.post('/api/v1/predict?persist=false', json={**HIGH, 'patient_name': 'x' * 121}, headers=auth)
    assert too_long.status_code == 422
