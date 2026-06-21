"""Admin-only user management routes — GET/POST/PUT/DELETE /users."""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from .auth import require_admin, hash_password
from .users import list_users, get_user_by_id, create_user, update_user, delete_user

router = APIRouter(prefix="/users", tags=["users"])


class CreateUserRequest(BaseModel):
    email: str
    password: str
    role: str = "user"


class UpdateUserRequest(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None


@router.get("")
async def get_users(admin: dict = Depends(require_admin)):
    return {"users": list_users()}


@router.post("")
async def post_user(req: CreateUserRequest, admin: dict = Depends(require_admin)):
    if len(req.password) < 4:
        raise HTTPException(400, "Password minimal 4 karakter")
    if req.role not in ("admin", "user"):
        raise HTTPException(400, "Role harus admin atau user")
    user = create_user(req.email, hash_password(req.password), req.role)
    if not user:
        raise HTTPException(409, "Email sudah terdaftar")
    return {"user": user}


@router.put("/{user_id}")
async def put_user(user_id: str, req: UpdateUserRequest, admin: dict = Depends(require_admin)):
    existing = get_user_by_id(user_id)
    if not existing:
        raise HTTPException(404, "User tidak ditemukan")
    if req.role and req.role not in ("admin", "user"):
        raise HTTPException(400, "Role harus admin atau user")
    pw_hash = hash_password(req.password) if req.password else None
    updated = update_user(user_id, email=req.email, role=req.role, password_hash=pw_hash)
    if not updated:
        raise HTTPException(404, "User tidak ditemukan")
    return {"user": {"id": updated["id"], "email": updated["email"], "role": updated["role"], "created_at": updated["created_at"]}}


@router.delete("/{user_id}")
async def del_user(user_id: str, admin: dict = Depends(require_admin)):
    if admin["id"] == user_id:
        raise HTTPException(400, "Tidak bisa menghapus akun sendiri")
    if not delete_user(user_id):
        raise HTTPException(404, "User tidak ditemukan")
    return {"ok": True}
