import secrets
import time

import pytest

from app.api import sos
from app.database.connection import SessionLocal
from app.models.sos import SosShare

POINT = {"lat": 28.63, "lon": 77.21, "accuracy_m": 15, "symptom_started_at": 1_800_000_000}


def share():
    return secrets.token_urlsafe(16), {"X-SOS-Key": secrets.token_urlsafe(32)}


@pytest.fixture(autouse=True)
def reset_rate_limit():
    sos._new_shares_by_ip.clear()


def test_works_without_login_and_updates_live(client):
    share_id, key = share()
    assert client.put(f"/api/v1/sos/{share_id}", json=POINT, headers=key).status_code == 200
    moved = {**POINT, "lat": 28.64, "hospital_name": "City Hospital", "hospital_lat": 28.65, "hospital_lon": 77.22}
    assert client.put(f"/api/v1/sos/{share_id}", json=moved, headers=key).status_code == 200
    seen = client.get(f"/api/v1/sos/{share_id}").json()
    assert seen["lat"] == 28.64 and seen["hospital_name"] == "City Hospital"
    assert "key_hash" not in seen


def test_someone_with_the_link_cannot_change_or_end_it(client):
    share_id, key = share()
    client.put(f"/api/v1/sos/{share_id}", json=POINT, headers=key)
    _, other = share()
    assert client.put(f"/api/v1/sos/{share_id}", json={**POINT, "lat": 1}, headers=other).status_code == 403
    assert client.delete(f"/api/v1/sos/{share_id}", headers=other).status_code == 403
    assert client.get(f"/api/v1/sos/{share_id}").json()["lat"] == 28.63


def test_ending_deletes_the_location(client):
    share_id, key = share()
    client.put(f"/api/v1/sos/{share_id}", json=POINT, headers=key)
    assert client.delete(f"/api/v1/sos/{share_id}", headers=key).status_code == 204
    assert client.get(f"/api/v1/sos/{share_id}").status_code == 404


def test_expired_share_is_deleted(client):
    share_id, key = share()
    client.put(f"/api/v1/sos/{share_id}", json=POINT, headers=key)
    with SessionLocal() as db:
        db.get(SosShare, share_id).created_at = time.time() - sos.SHARE_LIFETIME_SECONDS - 1
        db.commit()
    assert client.get(f"/api/v1/sos/{share_id}").status_code == 404
    with SessionLocal() as db:
        assert db.get(SosShare, share_id) is None


def test_new_shares_are_rate_limited_but_updates_are_not(client):
    share_id, key = share()
    client.put(f"/api/v1/sos/{share_id}", json=POINT, headers=key)
    for _ in range(sos.NEW_SHARES_PER_HOUR - 1):
        new_id, new_key = share()
        assert client.put(f"/api/v1/sos/{new_id}", json=POINT, headers=new_key).status_code == 200
    new_id, new_key = share()
    assert client.put(f"/api/v1/sos/{new_id}", json=POINT, headers=new_key).status_code == 429
    assert client.put(f"/api/v1/sos/{share_id}", json=POINT, headers=key).status_code == 200


def test_invalid_input_rejected(client):
    share_id, key = share()
    assert client.put(f"/api/v1/sos/{share_id}", json={**POINT, "lat": 200}, headers=key).status_code == 422
    assert client.put("/api/v1/sos/short", json=POINT, headers=key).status_code == 422
    assert client.put(f"/api/v1/sos/{share_id}", json=POINT).status_code == 422
