"""Applicazione FastAPI.

Sviluppo:    uvicorn app.main:app --reload            (frontend separato: cd frontend && npm run dev)
Produzione:  python -m app --port 8000   (oppure gli script in windows/ e mac/)
             (dopo 'npm run build' il frontend compilato viene servito da qui, sullo stesso indirizzo)
"""
import mimetypes
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import backup, config, db as dbmod
from .version import APP_VERSION
from .errors import AppError, NotFound
from .routers import admin, auth, vault

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
CSP = ("default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; "
       "connect-src 'self'; frame-ancestors 'none'; form-action 'self'")


async def _daily_backups():
    """Un backup del database al giorno (in <cartella dati>/backup, si tengono gli ultimi 30)."""
    import asyncio
    while True:
        try:
            saved = await asyncio.to_thread(backup.daily_backup_if_due)
            if saved:
                print(f"Backup giornaliero: {saved}", flush=True)
        except Exception as exc:          # un backup fallito non deve fermare il server
            print(f"Backup giornaliero non riuscito: {exc}", flush=True)
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """All'avvio: sposta i dati dalla vecchia posizione, aggiorna il database, crea l'admin iniziale."""
    import asyncio
    moved = dbmod.move_legacy_data()
    if moved:
        print(f"Dati spostati da backend/data a {moved}", flush=True)
    print(f"Gestione Pazienti {APP_VERSION} - dati in {os.path.dirname(config.DB_PATH)}", flush=True)
    if dbmod.init_db():
        where = (f"la password iniziale è nel file\n  {config.seed_password_file()}"
                 if os.path.exists(config.seed_password_file()) else "con la password di PAZIENTI_ADMIN_PASSWORD")
        print("\n" + "=" * 64 + f"\n  Creato l'amministratore {config.SEED_ADMIN_EMAIL}:\n  {where}"
              "\n  Va cambiata al primo accesso.\n" + "=" * 64 + "\n", flush=True)
    task = asyncio.create_task(_daily_backups()) if config.BACKUP_ENABLED else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="Gestione Pazienti", version=APP_VERSION, lifespan=lifespan,
              docs_url="/api/docs" if config.API_DOCS else None, redoc_url=None,
              openapi_url="/api/openapi.json" if config.API_DOCS else None)


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
# Tipi corretti per i file del frontend: su alcuni Windows il registro associa .js a text/plain
# e il browser (con X-Content-Type-Options: nosniff) rifiuterebbe gli script e il lettore PDF.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")

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
