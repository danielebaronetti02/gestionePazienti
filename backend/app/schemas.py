"""Modelli Pydantic dei dati in ingresso. I campi enc_* e le chiavi sono già cifrati dal browser."""
from typing import Optional

from pydantic import BaseModel, Field


class Grants(BaseModel):
    clinical: Optional[str] = None
    identity: Optional[str] = None


class LoginIn(BaseModel):
    email: str
    auth_hash: str


class PasswordChangeIn(BaseModel):
    current_auth_hash: str
    new_auth_hash: str
    enc_private_key: str
    public_key: Optional[str] = None      # solo al primo accesso
    init_grants: Optional[Grants] = None  # solo il primo amministratore: chiavi dell'archivio


class PatientCreateIn(BaseModel):
    enc_identity: str
    enc_clinical: str
    tax_code_idx: Optional[str] = None


class PatientUpdateIn(BaseModel):
    enc_clinical: str
    enc_identity: Optional[str] = None    # omesso = anagrafica invariata
    tax_code_idx: Optional[str] = None
    audit_action: Optional[str] = None    # "archivia_paziente" / "ripristina_paziente"


class ExamsIn(BaseModel):
    items: list[str] = Field(default_factory=list)


class BlobIn(BaseModel):
    enc_data: str


class EventIn(BaseModel):
    action: str
    patient_code: Optional[str] = None
    details: Optional[str] = None


class UserCreateIn(BaseModel):
    email: str
    full_name: str
    role: str
    can_view_identity: bool = False
    active: bool = True
    auth_hash: str
    public_key: str
    enc_private_key: str
    grants: Grants


class UserUpdateIn(BaseModel):
    full_name: str
    role: str
    can_view_identity: bool = False
    active: bool = True
    grants: Optional[Grants] = None


class UserResetIn(BaseModel):
    auth_hash: str
    public_key: str
    enc_private_key: str
    grants: Grants


class PathologyIn(BaseModel):
    name: str


class ActiveIn(BaseModel):
    active: bool


class ExamTypeIn(BaseModel):
    name: str
    category: str = ""
    unit: str = ""


class ExamTypePatch(BaseModel):
    category: Optional[str] = None
    unit: Optional[str] = None
    active: Optional[bool] = None
