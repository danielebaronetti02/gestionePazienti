"""Archivio cifrato: pazienti, esami, visite, eventi del registro."""
from fastapi import APIRouter, Depends

from ..context import Context
from ..deps import user_ctx
from ..schemas import BlobIn, EventIn, ExamsIn, PatientCreateIn, PatientUpdateIn
from ..services import vault

router = APIRouter(prefix="/api", tags=["archivio"])


@router.get("/meta")
def meta(ctx: Context = Depends(user_ctx)):
    return vault.meta(ctx)


@router.get("/vault")
def get_vault(opening: bool = False, ctx: Context = Depends(user_ctx)):
    return vault.get_vault(ctx, opening=opening)


@router.post("/patients", status_code=201)
def create_patient(body: PatientCreateIn, ctx: Context = Depends(user_ctx)):
    return vault.create_patient(ctx, body.model_dump())


@router.put("/patients/{patient_id}")
def update_patient(patient_id: int, body: PatientUpdateIn, ctx: Context = Depends(user_ctx)):
    vault.update_patient(ctx, patient_id, body.model_dump())
    return {"ok": True}


@router.post("/patients/{patient_id}/exams", status_code=201)
def add_exams(patient_id: int, body: ExamsIn, ctx: Context = Depends(user_ctx)):
    return {"ids": vault.add_exams(ctx, patient_id, body.items)}


@router.put("/exams/{exam_id}")
def update_exam(exam_id: int, body: BlobIn, ctx: Context = Depends(user_ctx)):
    vault.update_exam(ctx, exam_id, body.enc_data)
    return {"ok": True}


@router.delete("/exams/{exam_id}")
def delete_exam(exam_id: int, ctx: Context = Depends(user_ctx)):
    vault.delete_exam(ctx, exam_id)
    return {"ok": True}


@router.post("/patients/{patient_id}/visits", status_code=201)
def add_visit(patient_id: int, body: BlobIn, ctx: Context = Depends(user_ctx)):
    return {"id": vault.add_visit(ctx, patient_id, body.enc_data)}


@router.delete("/visits/{visit_id}")
def delete_visit(visit_id: int, ctx: Context = Depends(user_ctx)):
    vault.delete_visit(ctx, visit_id)
    return {"ok": True}


@router.post("/audit/event")
def client_event(body: EventIn, ctx: Context = Depends(user_ctx)):
    vault.client_event(ctx, body.action, body.patient_code, body.details)
    return {"ok": True}
