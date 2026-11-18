"""Lettura del testo dalle FOTO dei documenti (OCR) con Tesseract, installato sul PC server.

Privacy: è l'unico caso in cui un dato in chiaro passa dal server. L'immagine arriva in memoria,
viene passata a Tesseract tramite stdin/stdout (nessun file su disco), il testo torna al browser e
nulla viene salvato. I PDF con testo invece vengono letti direttamente nel browser.
"""
import base64
import functools
import os
import shutil
import subprocess

from .. import config
from ..errors import Invalid
from ..security import audit

_WINDOWS_PATHS = (r"C:\Program Files\Tesseract-OCR\tesseract.exe", r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe")
_MAC_PATHS = ("/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract")


@functools.lru_cache(maxsize=1)
def tesseract_cmd() -> str | None:
    if config.TESSERACT_CMD:
        return config.TESSERACT_CMD if os.path.exists(config.TESSERACT_CMD) else None
    found = shutil.which("tesseract")
    if found:
        return found
    for path in _WINDOWS_PATHS + _MAC_PATHS:
        if os.path.exists(path):
            return path
    return None


@functools.lru_cache(maxsize=1)
def language() -> str:
    """ita+eng se è installata la lingua italiana, altrimenti eng."""
    cmd = tesseract_cmd()
    try:
        out = subprocess.run([cmd, "--list-langs"], capture_output=True, text=True, timeout=20).stdout
    except Exception:
        return "eng"
    langs = {line.strip() for line in out.splitlines()[1:]}
    return "ita+eng" if "ita" in langs and "eng" in langs else ("ita" if "ita" in langs else "eng")


def available() -> bool:
    return tesseract_cmd() is not None


def parse_tsv(tsv: str) -> list[dict]:
    """Uscita TSV di Tesseract → righe di parole con posizione orizzontale (come il testo dei PDF)."""
    lines: dict[tuple, dict] = {}
    rows = tsv.splitlines()
    for row in rows[1:]:
        f = row.split("\t")
        if len(f) < 12 or f[0] != "5" or not f[11].strip():
            continue
        key = (int(f[2]), int(f[3]), int(f[4]))                     # blocco, paragrafo, riga
        left, top, width, height = (int(v) for v in f[6:10])
        line = lines.setdefault(key, {"top": top, "items": []})
        line["top"] = min(line["top"], top)
        line["items"].append({"x": left, "w": width, "h": height, "str": f[11]})
    out = sorted(lines.values(), key=lambda line: line["top"])
    for line in out:
        line["items"].sort(key=lambda i: i["x"])
    return [{"y": -line["top"], "items": line["items"]} for line in out]


def read_image(ctx, image_b64: str) -> dict:
    ctx.require_edit()
    cmd = tesseract_cmd()
    if not cmd:
        raise Invalid("La lettura delle foto non è attiva: sul PC server manca Tesseract OCR (vedi README).")
    try:
        data = base64.b64decode(image_b64, validate=True)
    except Exception:
        raise Invalid("Immagine non valida.") from None
    if len(data) > config.OCR_MAX_BYTES:
        raise Invalid("Immagine troppo grande (massimo 15 MB).")
    if not (data.startswith(b"\x89PNG") or data.startswith(b"\xff\xd8")):
        raise Invalid("Formato immagine non supportato (servono PNG o JPEG).")
    try:
        res = subprocess.run([cmd, "stdin", "stdout", "-l", language(), "--psm", "6", "tsv"],
                             input=data, capture_output=True, timeout=120)
    except subprocess.TimeoutExpired:
        raise Invalid("La lettura della foto ha richiesto troppo tempo.") from None
    if res.returncode != 0:
        raise Invalid("Tesseract non è riuscito a leggere la foto.")
    lines = parse_tsv(res.stdout.decode("utf-8", errors="replace"))
    audit(ctx, "ocr_documento", details=f"{len(data) // 1024} KB, {len(lines)} righe")   # mai il contenuto
    ctx.db.commit()
    return {"lines": lines, "language": language()}
