"""Amministrazione (solo amministratori): utenti e chiavi, cataloghi, registro accessi."""
from fastapi import APIRouter, Depends

from ..context import Context
from ..deps import user_ctx
from ..schemas import ActiveIn, ExamTypeIn, ExamTypePatch, PathologyIn, UserCreateIn, UserResetIn, UserUpdateIn
from ..services import admin

router = APIRouter(prefix="/api/admin", tags=["amministrazione"])


@router.get("/users")
def list_users(ctx: Context = Depends(user_ctx)):
    return admin.list_users(ctx)


@router.get("/users/{user_id}")
def get_user(user_id: int, ctx: Context = Depends(user_ctx)):
    return admin.get_user(ctx, user_id)


@router.post("/users", status_code=201)
def create_user(body: UserCreateIn, ctx: Context = Depends(user_ctx)):
    return {"id": admin.create_user(ctx, body.model_dump())}


@router.put("/users/{user_id}")
def update_user(user_id: int, body: UserUpdateIn, ctx: Context = Depends(user_ctx)):
    admin.update_user(ctx, user_id, body.model_dump())
    return {"ok": True}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, ctx: Context = Depends(user_ctx)):
    admin.delete_user(ctx, user_id)
    return {"ok": True}


@router.post("/users/{user_id}/reset-password")
def reset_user_password(user_id: int, body: UserResetIn, ctx: Context = Depends(user_ctx)):
    admin.reset_user_password(ctx, user_id, body.model_dump())
    return {"ok": True}


@router.get("/catalogs")
def catalogs(ctx: Context = Depends(user_ctx)):
    return admin.catalogs(ctx)


@router.post("/pathologies", status_code=201)
def add_pathology(body: PathologyIn, ctx: Context = Depends(user_ctx)):
    admin.add_pathology(ctx, body.name)
    return {"ok": True}


@router.patch("/pathologies/{pathology_id}")
def set_pathology_active(pathology_id: int, body: ActiveIn, ctx: Context = Depends(user_ctx)):
    admin.set_pathology_active(ctx, pathology_id, body.active)
    return {"ok": True}


@router.post("/exam-types", status_code=201)
def add_exam_type(body: ExamTypeIn, ctx: Context = Depends(user_ctx)):
    return {"id": admin.add_exam_type(ctx, body.model_dump())}


@router.delete("/exam-types/{type_id}")
def delete_exam_type(type_id: int, ctx: Context = Depends(user_ctx)):
    admin.delete_exam_type(ctx, type_id)
    return {"ok": True}


@router.delete("/pathologies/{pathology_id}")
def delete_pathology(pathology_id: int, ctx: Context = Depends(user_ctx)):
    admin.delete_pathology(ctx, pathology_id)
    return {"ok": True}


@router.patch("/exam-types/{type_id}")
def update_exam_type(type_id: int, body: ExamTypePatch, ctx: Context = Depends(user_ctx)):
    admin.update_exam_type(ctx, type_id, body.model_dump())
    return {"ok": True}


@router.get("/audit")
def audit_log(q: str = "", ctx: Context = Depends(user_ctx)):
    return admin.audit_log(ctx, q=q)
