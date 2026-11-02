import hashlib
import hmac
import time
from collections import defaultdict, deque
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.models.sos import SosShare

# No login here: a person having an emergency may be signed out, and family have no account.
# Reading needs the unguessable link; writing also needs a key only the sender's phone holds.
router = APIRouter(prefix="/sos")

SHARE_LIFETIME_SECONDS = 6 * 60 * 60
NEW_SHARES_PER_HOUR = 20
ShareId = Path(..., pattern=r"^[A-Za-z0-9_-]{22,64}$")
_new_shares_by_ip: dict[str, deque] = defaultdict(deque)


class SosUpdate(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    accuracy_m: Optional[float] = Field(None, ge=0, le=100000)
    symptom_started_at: Optional[float] = Field(None, ge=0)
    hospital_name: Optional[str] = Field(None, max_length=200)
    hospital_lat: Optional[float] = Field(None, ge=-90, le=90)
    hospital_lon: Optional[float] = Field(None, ge=-180, le=180)


def key_hash(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def purge_expired(db: Session) -> None:
    db.query(SosShare).filter(SosShare.created_at < time.time() - SHARE_LIFETIME_SECONDS).delete()
    db.commit()


def allow_new_share(request: Request) -> bool:
    # Render's proxy appends the real client address last.
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[-1].strip() or (request.client.host if request.client else "unknown")
    now = time.time()
    recent = _new_shares_by_ip[ip]
    while recent and recent[0] < now - 3600:
        recent.popleft()
    if len(recent) >= NEW_SHARES_PER_HOUR:
        return False
    recent.append(now)
    return True


@router.put("/{share_id}")
def update_share(data: SosUpdate, request: Request, share_id: str = ShareId,
                 x_sos_key: str = Header(..., min_length=32, max_length=128), db: Session = Depends(get_db)):
    purge_expired(db)
    now = time.time()
    share = db.get(SosShare, share_id)
    if share:
        if not hmac.compare_digest(share.key_hash, key_hash(x_sos_key)):
            raise HTTPException(status_code=403, detail="This share belongs to another device")
    else:
        if not allow_new_share(request):
            raise HTTPException(status_code=429, detail="Too many new shares. Please try again later.")
        share = SosShare(id=share_id, key_hash=key_hash(x_sos_key), created_at=now, updated_at=now, lat=data.lat, lon=data.lon)
        db.add(share)
    for field, value in data.model_dump().items():
        setattr(share, field, value)
    share.updated_at = now
    db.commit()
    return {"expires_at": share.created_at + SHARE_LIFETIME_SECONDS}


@router.get("/{share_id}")
def read_share(share_id: str = ShareId, db: Session = Depends(get_db)):
    purge_expired(db)
    share = db.get(SosShare, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="This location share has ended")
    return {
        "lat": share.lat,
        "lon": share.lon,
        "accuracy_m": share.accuracy_m,
        "symptom_started_at": share.symptom_started_at,
        "hospital_name": share.hospital_name,
        "hospital_lat": share.hospital_lat,
        "hospital_lon": share.hospital_lon,
        "updated_at": share.updated_at,
        "server_time": time.time(),
    }


@router.delete("/{share_id}", status_code=204)
def end_share(share_id: str = ShareId, x_sos_key: str = Header(..., min_length=32, max_length=128), db: Session = Depends(get_db)):
    share = db.get(SosShare, share_id)
    if share:
        if not hmac.compare_digest(share.key_hash, key_hash(x_sos_key)):
            raise HTTPException(status_code=403, detail="This share belongs to another device")
        db.delete(share)
        db.commit()
    return Response(status_code=204)
