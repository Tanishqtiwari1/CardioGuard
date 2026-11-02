import os
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.models.user import User
from app.models.password_reset import PasswordResetToken
from app.schemas.auth import ForgotPasswordRequest, LoginRequest, ResetPasswordRequest, TokenResponse, UserCreate, UserResponse
from app.security import create_access_token, create_password_reset_token, get_current_user, hash_password, hash_reset_token, verify_password

router = APIRouter()
RESET_MESSAGE = "If an account exists for that email, a password reset link has been sent."


def send_reset_email(email: str, token: str) -> None:
    resend_api_key = os.getenv("RESEND_API_KEY")
    from_email = os.getenv("RESEND_FROM_EMAIL")
    frontend_url = os.getenv("FRONTEND_URL", "https://tanishqtiwari1.github.io/CardioGuard/").rstrip("/")
    if not all((resend_api_key, from_email, frontend_url)):
        raise RuntimeError("Password reset email service is not configured")
    reset_url = f"{frontend_url}/#/reset-password?token={token}"
    payload = {
        "from": from_email,
        "to": [email],
        "subject": "Reset your CardioGuard password",
        "text": (
            "Use this link within one hour to reset your CardioGuard password:\n\n"
            f"{reset_url}\n\n"
            "If you did not request this, you can ignore this email."
        ),
    }
    timeout = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)
    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {resend_api_key}"},
            json=payload,
            timeout=timeout,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise RuntimeError("Password reset email could not be sent") from exc


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(data: UserCreate, db: Session = Depends(get_db)):
    if data.password != data.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    if len(data.password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Password must be 72 bytes or fewer")
    email = data.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(name=data.name.strip(), email=email, password_hash=hash_password(data.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return TokenResponse(access_token=create_access_token(user.id), user=user)


@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email.lower()).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    return TokenResponse(access_token=create_access_token(user.id), user=user)


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(data: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email.lower()).first()
    if user:
        token, token_hash, expires_at = create_password_reset_token()
        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used.is_(False),
        ).update({"used": True})
        db.add(PasswordResetToken(user_id=user.id, token_hash=token_hash, expires_at=expires_at))
        db.commit()
        try:
            send_reset_email(user.email, token)
        except Exception:
            db.rollback()
    return {"message": RESET_MESSAGE}


@router.post("/reset-password")
def reset_password(data: ResetPasswordRequest, db: Session = Depends(get_db)):
    if data.password != data.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    reset = db.query(PasswordResetToken).filter(
        PasswordResetToken.token_hash == hash_reset_token(data.token),
        PasswordResetToken.used.is_(False),
    ).first()
    if not reset:
        raise HTTPException(status_code=400, detail="This password reset link is invalid or expired")
    expires_at = reset.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This password reset link is invalid or expired")
    user = db.query(User).filter(User.id == reset.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="This password reset link is invalid or expired")
    user.password_hash = hash_password(data.password)
    reset.used = True
    db.commit()
    return {"message": "Your password has been reset. You can now sign in."}


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)):
    return user
