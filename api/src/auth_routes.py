"""POST /auth/login — authenticate and return JWT.  GET /auth/me — current user info.
   PUT /auth/password — change password (authenticated)."""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from .auth import verify_password, create_access_token, get_current_user, hash_password
from .users import get_user_by_email, update_password

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


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.put("/password")
async def change_password(req: ChangePasswordRequest, user: dict = Depends(get_current_user)):
    if not verify_password(req.current_password, user["password_hash"]):
        raise HTTPException(400, "Password saat ini salah")
    if len(req.new_password) < 4:
        raise HTTPException(400, "Password baru minimal 4 karakter")
    new_hash = hash_password(req.new_password)
    update_password(user["email"], new_hash)
    return {"ok": True}
