"""Dipendenze FastAPI: connessione al database e utente collegato (Context)."""
from fastapi import Depends, Request

from . import config, db as dbmod, security
from .context import Context
from .errors import Forbidden, Unauthorized


def get_db():
    con = dbmod.connect()
    try:
        yield con
    finally:
        con.close()


def _client_ip(request: Request):
    return request.client.host if request.client else None


def session_token(request: Request):
    return request.cookies.get(config.SESSION_COOKIE)


def public_ctx(request: Request, db=Depends(get_db)) -> Context:
    """Contesto per le pagine pubbliche (login, primo avvio)."""
    user = security.user_from_session(db, session_token(request))
    return Context(db=db, user=user, ip=_client_ip(request))


def session_ctx(ctx: Context = Depends(public_ctx)) -> Context:
    """Utente collegato (anche se deve ancora cambiare la password)."""
    if ctx.user is None:
        raise Unauthorized("Sessione scaduta o accesso non effettuato.")
    return ctx


def user_ctx(ctx: Context = Depends(session_ctx)) -> Context:
    """Utente collegato e con password già personalizzata: è il caso normale."""
    if ctx.user["must_change_pw"]:
        raise Forbidden("Imposta una nuova password personale prima di continuare.", code="must_change_password")
    return ctx
