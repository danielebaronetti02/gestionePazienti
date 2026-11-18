"""Applicazione FastAPI.

Sviluppo:    uvicorn app.main:app --reload            (frontend separato: cd frontend && npm run dev)
Produzione:  uvicorn app.main:app --host 0.0.0.0 --port 8000
             (dopo 'npm run build' il frontend compilato viene servito da qui, sullo stesso indirizzo)
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, db as dbmod
from .errors import AppError, NotFound
from .routers import admin, auth, vault

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
CSP = ("default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; "
       "connect-src 'self'; frame-ancestors 'none'; form-action 'self'")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """All'avvio: crea tabelle, cataloghi e (database vuoto) l'amministratore di seed."""
    if dbmod.init_db():
        print("\n" + "=" * 64 + f"\n  Creato l'amministratore {config.SEED_ADMIN_EMAIL}"
              "\n  con la password iniziale configurata: va cambiata al primo accesso.\n" + "=" * 64 + "\n")
    yield


app = FastAPI(title="Gestione Pazienti", version="3.0", lifespan=lifespan,
              docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")


# ---------------------------------------------------------------------------
# Errori → JSON {"detail": "...", "code": "..."}
# ---------------------------------------------------------------------------
@app.exception_handler(AppError)
async def app_error_handler(_request: Request, exc: AppError):
    return JSONResponse({"detail": exc.detail, "code": exc.code}, status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def validation_handler(_request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "richiesta"
    return JSONResponse({"detail": f"Dati non validi ({field}).", "code": "validation"}, status_code=400)


# ---------------------------------------------------------------------------
# Protezione CSRF e intestazioni di sicurezza
# ---------------------------------------------------------------------------
@app.middleware("http")
async def security_middleware(request: Request, call_next):
    path = request.url.path
    if request.method in MUTATING and path.startswith("/api/"):
        if request.headers.get(config.CSRF_HEADER) != config.CSRF_VALUE:
            return JSONResponse({"detail": "Richiesta non consentita.", "code": "csrf"}, status_code=403)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    if path.startswith("/api/") and not path.startswith("/api/docs"):
        response.headers.setdefault("Cache-Control", "no-store")
    if not path.startswith("/api/docs"):
        response.headers.setdefault("Content-Security-Policy", CSP)
    return response


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
for module in (auth, vault, admin):
    app.include_router(module.router)


# ---------------------------------------------------------------------------
# Frontend React compilato (frontend/dist), se presente
# ---------------------------------------------------------------------------
DIST = os.path.realpath(config.FRONTEND_DIST)
if os.path.isdir(DIST):
    if os.path.isdir(os.path.join(DIST, "assets")):
        app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def single_page_app(path: str):
        if path.startswith("api/"):
            raise NotFound("Risorsa non trovata.")
        candidate = os.path.realpath(os.path.join(DIST, path))
        if path and candidate.startswith(DIST + os.sep) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(DIST, "index.html"))  # le rotte le gestisce React
