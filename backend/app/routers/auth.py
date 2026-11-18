"""Accesso, chiavi personali, cambio password."""
from fastapi import APIRouter, Depends, Request, Response

from .. import config
from ..context import Context
from ..deps import public_ctx, session_ctx, session_token
from ..schemas import LoginIn, PasswordChangeIn
from ..services import auth

router = APIRouter(prefix="/api", tags=["accesso"])


@router.get("/public-config")
def public_config():
    return auth.public_config()


@router.post("/auth/login")
def login(body: LoginIn, response: Response, ctx: Context = Depends(public_ctx)):
    user, token = auth.login(ctx, body.email, body.auth_hash)
    response.set_cookie(config.SESSION_COOKIE, token, httponly=True, samesite="strict",
                        secure=config.COOKIE_SECURE, path="/")
    return user


@router.post("/auth/logout")
def logout(request: Request, response: Response, ctx: Context = Depends(public_ctx)):
    auth.logout(ctx, session_token(request))
    response.delete_cookie(config.SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/auth/me")
def me(ctx: Context = Depends(session_ctx)):
    return auth.user_out(ctx.db, ctx.user)


@router.get("/auth/keys")
def keys(ctx: Context = Depends(session_ctx)):
    return auth.key_material(ctx)


@router.post("/auth/password")
def change_password(body: PasswordChangeIn, request: Request, ctx: Context = Depends(session_ctx)):
    return auth.change_password(ctx, body.model_dump(), session_token(request))
