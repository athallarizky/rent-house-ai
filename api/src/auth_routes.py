"""POST /auth/login — authenticate and return JWT.  GET /auth/me — current user info."""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from .auth import verify_password, create_access_token, get_current_user
from .users import get_user_by_email

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
async def login(req: LoginRequest):
    user = get_user_by_email(req.email)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Email atau password salah")
    token = create_access_token({"sub": user["email"], "role": user["role"]})
    return {"token": token, "user": {"email": user["email"], "role": user["role"]}}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return {"email": user["email"], "role": user["role"]}
