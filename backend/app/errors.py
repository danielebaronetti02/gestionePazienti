"""Errori applicativi: i servizi li sollevano, l'API li trasforma in risposte JSON."""


class AppError(Exception):
    status = 400

    def __init__(self, detail: str, code: str = None):
        super().__init__(detail)
        self.detail = detail
        self.code = code


class Invalid(AppError):
    """Dati non validi (400)."""
    status = 400


class Unauthorized(AppError):
    """Accesso non effettuato o sessione scaduta (401)."""
    status = 401


class Forbidden(AppError):
    """Permessi insufficienti (403)."""
    status = 403


class NotFound(AppError):
    status = 404


class Conflict(AppError):
    """Dato duplicato (409)."""
    status = 409


class TooManyRequests(AppError):
    status = 429
