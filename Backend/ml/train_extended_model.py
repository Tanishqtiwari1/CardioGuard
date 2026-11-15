"""Train the *extended* clinical model: the 10 standard inputs plus three test results
(ST slope, major vessels on fluoroscopy, thallium stress test).

Why a second model instead of replacing model.pkl
-------------------------------------------------
A head-to-head on the same held-out split (see metrics_extended.json) showed:
* Heartlytics' Random Forest algorithm was *not* better than CardioGuard's XGBoost on the
  same 10 inputs; the gain came from the three extra inputs.
* With the three inputs present, XGBoost + 13 inputs beats the current model.
* With the three inputs *blank*, the 13-input model under-predicts and misses more
  high-risk patients than the current model (those inputs are missing mostly at
  hospitals with high disease rates, so "missing" carries hospital information).
So the API uses this model only when all three are supplied, and model.pkl otherwise.

This script uses exactly the same de-duplication and stratified 20% held-out split as
train_model.py (random_state=42) and never touches model.pkl / scaler.pkl.
"""
import json
import os
import pickle

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score, precision_score,
                             recall_score, roc_auc_score)
from sklearn.model_selection import GridSearchCV, StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from evaluation import calibration_report

ML_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(ML_DIR, 'heart_disease_uci.csv')
BASE_FEATURES = ['age', 'sex', 'cp', 'trestbps', 'chol', 'fbs', 'restecg', 'thalach', 'exang', 'oldpeak']
EXTRA_FEATURES = ['slope', 'ca', 'thal']
MODEL_FEATURES = BASE_FEATURES + EXTRA_FEATURES  # fixed order used at inference
RANDOM_STATE = 42
GRID = {'model__max_depth': [2, 3, 4], 'model__learning_rate': [0.02, 0.05],
        'model__n_estimators': [200, 400], 'model__min_child_weight': [1, 3]}


def _metrics(y_true, probabilities, threshold=0.5) -> dict:
    predictions = (np.asarray(probabilities) >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, predictions, labels=[0, 1]).ravel()
    return {
        'count': int(len(y_true)),
        'accuracy': round(float(accuracy_score(y_true, predictions)), 4),
        'precision': round(float(precision_score(y_true, predictions, zero_division=0)), 4),
        'recall': round(float(recall_score(y_true, predictions, zero_division=0)), 4),
        'f1_score': round(float(f1_score(y_true, predictions, zero_division=0)), 4),
        'roc_auc': round(float(roc_auc_score(y_true, probabilities)), 4),
        'brier_score': calibration_report(y_true, probabilities)['brier_score'],
        'false_negatives': int(fn), 'false_positives': int(fp),
        'confusion_matrix': [[int(tn), int(fp)], [int(fn), int(tp)]],
    }


def _pipeline() -> Pipeline:
    return Pipeline([
        ('scaler', StandardScaler()),
        ('model', xgb.XGBClassifier(objective='binary:logistic', eval_metric='logloss', subsample=0.8,
                                    colsample_bytree=0.8, random_state=RANDOM_STATE)),
    ])


def train_and_save():
    df = pd.read_csv(DATA_PATH).drop_duplicates(subset=BASE_FEATURES + ['target'])
    X, y = df[MODEL_FEATURES], df['target']
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=RANDOM_STATE)
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)

    train_complete = X_train[EXTRA_FEATURES].notna().all(axis=1)
    test_complete = X_test[EXTRA_FEATURES].notna().all(axis=1)

    # Two candidate training sets: all training rows, or only rows with the extra inputs
    # measured. Choose with cross-validation on *complete* training rows (the only rows this
    # model will ever score); the held-out test set is not used for this choice.
    candidates = {}
    for name, mask in (('all_rows', pd.Series(True, index=X_train.index)), ('complete_rows', train_complete)):
        search = GridSearchCV(_pipeline(), GRID, scoring='roc_auc', cv=cv)
        search.fit(X_train[mask], y_train[mask])
        est = search.best_estimator_
        scores = []
        for tr, va in cv.split(X_train, y_train):
            tr_idx, va_idx = X_train.index[tr], X_train.index[va]
            tr_idx = tr_idx[mask.loc[tr_idx].to_numpy()]
            va_idx = va_idx[train_complete.loc[va_idx].to_numpy()]
            fold = _pipeline().set_params(**search.best_params_).fit(X_train.loc[tr_idx], y_train.loc[tr_idx])
            scores.append(roc_auc_score(y_train.loc[va_idx], fold.predict_proba(X_train.loc[va_idx])[:, 1]))
        candidates[name] = {'estimator': est, 'params': search.best_params_,
                            'cv_auc_complete_rows': float(np.mean(scores)), 'cv_auc_std': float(np.std(scores))}
        print(f"{name:14s} CV ROC-AUC on complete rows: {np.mean(scores):.3f} ± {np.std(scores):.3f}  {search.best_params_}")

    chosen_name = max(candidates, key=lambda k: candidates[k]['cv_auc_complete_rows'])
    pipeline = candidates[chosen_name]['estimator']
    print(f"Chosen training set: {chosen_name}")

    # Held-out evaluation: current deployed model vs extended model on the same patients.
    with open(os.path.join(ML_DIR, 'model.pkl'), 'rb') as f:
        base_model = pickle.load(f)
    with open(os.path.join(ML_DIR, 'scaler.pkl'), 'rb') as f:
        base_scaler = pickle.load(f)
    base_idx = list(base_model.classes_).index(1)
    p_base = base_model.predict_proba(base_scaler.transform(X_test[BASE_FEATURES]))[:, base_idx]
    p_ext = pipeline.predict_proba(X_test[MODEL_FEATURES])[:, list(pipeline.classes_).index(1)]

    yc = y_test[test_complete]
    report = {
        'model': 'XGBoost (scaler + model in one sklearn Pipeline)',
        'features': MODEL_FEATURES,
        'used_when': 'All three of slope, ca and thal are provided; otherwise the standard 10-input model is used.',
        'dataset': f'UCI Heart Disease database: {len(df)} unique patients (Cleveland, Hungary, Switzerland, VA Long Beach)',
        'evaluation_method': 'Same stratified 20% held-out split as train_model.py (random_state=42); '
                             'never used for training, tuning or model selection.',
        'training_set': chosen_name,
        'best_params': {k.replace('model__', ''): v for k, v in candidates[chosen_name]['params'].items()},
        'cv_roc_auc_complete_rows': round(candidates[chosen_name]['cv_auc_complete_rows'], 4),
        'cv_roc_auc_std': round(candidates[chosen_name]['cv_auc_std'], 4),
        'candidates_cv_roc_auc': {k: round(v['cv_auc_complete_rows'], 4) for k, v in candidates.items()},
        'comparison': {
            'test_rows_with_extra_inputs': {
                'standard_model': _metrics(yc, p_base[test_complete.to_numpy()]),
                'extended_model': _metrics(yc, p_ext[test_complete.to_numpy()]),
            },
        },
        'feature_importance': sorted(
            ({'feature': n, 'importance': round(float(v), 6)}
             for n, v in zip(MODEL_FEATURES, pipeline.named_steps['model'].feature_importances_)),
            key=lambda d: d['importance'], reverse=True),
        'calibration': calibration_report(yc, p_ext[test_complete.to_numpy()], n_bins=5),
        'note': 'Small evaluation set (patients with all three test results, mostly Cleveland). '
                'Differences of a few patients; treat as indicative, not definitive.',
    }

    for name, block in report['comparison']['test_rows_with_extra_inputs'].items():
        print(f"{name:15s} n={block['count']} acc={block['accuracy']} prec={block['precision']} "
              f"recall={block['recall']} f1={block['f1_score']} auc={block['roc_auc']} "
              f"brier={block['brier_score']} FN={block['false_negatives']} FP={block['false_positives']}")

    with open(os.path.join(ML_DIR, 'model_extended.pkl'), 'wb') as f:
        pickle.dump(pipeline, f)
    with open(os.path.join(ML_DIR, 'metrics_extended.json'), 'w') as f:
        json.dump(report, f, indent=2)
    print("Saved model_extended.pkl and metrics_extended.json.")


if __name__ == '__main__':
    train_and_save()
