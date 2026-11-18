"""Costanti di dominio: stati degli esami, ruoli, cataloghi iniziali."""

STATUS = {
    "da_effettuare": "Da effettuare",
    "consegnato": "Consegnato – in attesa di risultato",
    "risultato": "Risultato disponibile",
}
STATUS_ORDER = {k: i for i, k in enumerate(STATUS)}

ROLES = {
    "admin": "Amministratore",
    "medico": "Medico",
    "lettura": "Sola consultazione",
}

SEXES = {"F": "Femmina", "M": "Maschio", "X": "Altro / non specificato"}

VISIT_TYPES = ["Prima visita", "Controllo", "Visita telefonica / telemedicina",
               "Day hospital", "Consulenza", "Altro"]

# Campi anagrafici: salvati cifrati nelle colonne enc_<campo>
ID_FIELDS = ["last_name", "first_name", "birth_date", "birth_place", "tax_code",
             "phone", "email", "address"]

CODE_PREFIX = "PZ-"
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # senza 0/O e 1/I
CODE_LENGTH = 6

DEFAULT_PATHOLOGIES = [
    "Morbo di Addison",
    "CAH classica",
    "CAH non classica",
    "Insufficienza surrenalica secondaria",
    "Altro",
]

DEFAULT_EXAMS = [
    # (categoria, nome, unità)
    ("Asse surrenalico", "Cortisolo basale (ore 8)", "µg/dL"),
    ("Asse surrenalico", "ACTH", "pg/mL"),
    ("Asse surrenalico", "Cortisolo salivare notturno", "nmol/L"),
    ("Asse surrenalico", "Cortisolo libero urinario 24 h", "µg/24h"),
    ("Asse surrenalico", "Test di soppressione con desametasone 1 mg (DST)", "µg/dL"),
    ("Asse surrenalico", "Test di stimolo con ACTH (Synacthen)", "µg/dL"),
    ("Elettroliti e mineralcorticoidi", "Sodio (Na+)", "mmol/L"),
    ("Elettroliti e mineralcorticoidi", "Potassio (K+)", "mmol/L"),
    ("Elettroliti e mineralcorticoidi", "Renina", "mU/L"),
    ("Elettroliti e mineralcorticoidi", "Aldosterone", "ng/dL"),
    ("Steroidi e androgeni", "17-OH-progesterone", "ng/mL"),
    ("Steroidi e androgeni", "Androstenedione", "ng/mL"),
    ("Steroidi e androgeni", "Testosterone totale", "ng/mL"),
    ("Steroidi e androgeni", "DHEA-S", "µg/dL"),
    ("Metabolico", "Glicemia", "mg/dL"),
    ("Imaging", "Ecografia testicolare", ""),
]
