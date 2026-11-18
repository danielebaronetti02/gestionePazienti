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
    # insufficienza surrenalica
    "Morbo di Addison",
    "Sindrome polighiandolare autoimmune tipo 1 (APS-1)",
    "Sindrome polighiandolare autoimmune tipo 2 (APS-2)",
    "Adrenoleucodistrofia (X-ALD)",
    "Insufficienza surrenalica primaria (altra causa)",
    "Insufficienza surrenalica secondaria",
    "Insufficienza surrenalica terziaria iatrogena (da glucocorticoidi)",
    "Ipoplasia surrenalica congenita (NR0B1/DAX1)",
    "Deficit familiare di glucocorticoidi (MC2R/MRAP)",
    # iperplasia surrenalica congenita
    "CAH classica",
    "CAH classica con perdita di sali",
    "CAH classica virilizzante semplice",
    "CAH non classica",
    "CAH da deficit di 11β-idrossilasi",
    "CAH da deficit di 17α-idrossilasi",
    "CAH da deficit di 3β-HSD",
    "CAH da deficit di POR",
    "Iperplasia lipoidea congenita (StAR)",
    # ipercortisolismo
    "Malattia di Cushing (ACTH-dipendente ipofisaria)",
    "Sindrome da ACTH ectopico",
    "Sindrome di Cushing da adenoma surrenalico",
    "Iperplasia macronodulare bilaterale primaria (PBMAH)",
    "Malattia nodulare pigmentata primitiva (PPNAD)",
    "Secrezione autonoma lieve di cortisolo (MACS)",
    "Sindrome di Cushing iatrogena",
    # mineralcorticoidi
    "Iperaldosteronismo primario da adenoma (APA)",
    "Iperaldosteronismo primario da iperplasia bilaterale",
    "Iperaldosteronismo familiare",
    "Eccesso apparente di mineralcorticoidi",
    "Ipoaldosteronismo iporeninemico",
    "Pseudoipoaldosteronismo",
    # masse e tumori
    "Incidentaloma surrenalico non secernente",
    "Feocromocitoma",
    "Paraganglioma",
    "Carcinoma corticosurrenalico",
    "Tumore surrenalico androgeno-secernente",
    "Mielolipoma / cisti / metastasi surrenalica",
    # altro
    "Resistenza ai glucocorticoidi",
    "Altro",
]

# (categoria, nome, unità, codice nomenclatore, sinonimi separati da "|")
# Codici e sinonimi servono all'importazione da PDF/foto per riconoscere l'esame.
DEFAULT_EXAMS = [
    ("Asse surrenalico", "Cortisolo basale (ore 8)", "µg/dL", "", "cortisolo|cortisolo basale|cortisolemia|cortisolo ore 8"),
    ("Asse surrenalico", "ACTH", "pg/mL", "", "corticotropina|ormone adrenocorticotropo"),
    ("Asse surrenalico", "Cortisolo salivare notturno", "nmol/L", "", "cortisolo salivare"),
    ("Asse surrenalico", "Cortisolo libero urinario 24 h", "µg/24h", "", "cortisolo libero urinario|cortisoluria|ufc"),
    ("Asse surrenalico", "Test di soppressione con desametasone 1 mg (DST)", "µg/dL", "", "dst|test al desametasone"),
    ("Asse surrenalico", "Test di stimolo con ACTH (Synacthen)", "µg/dL", "", "synacthen|test al synacthen|test con acth"),
    ("Asse surrenalico", "Synacthen basse dosi (1 µg) – cortisolo 30 min", "µg/dL", "", ""),
    ("Asse surrenalico", "Cortisolo sierico a mezzanotte", "µg/dL", "", "cortisolo mezzanotte"),
    ("Asse surrenalico", "Test di Liddle (desametasone 2 mg × 48 h)", "µg/dL", "", ""),
    ("Asse surrenalico", "Test con desametasone 8 mg", "µg/dL", "", ""),
    ("Asse surrenalico", "Test al CRH", "pg/mL", "", ""),
    ("Asse surrenalico", "Test desametasone-CRH", "µg/dL", "", ""),
    ("Asse surrenalico", "Test al metirapone", "µg/dL", "", ""),
    ("Asse surrenalico", "Test di tolleranza insulinica (ITT)", "µg/dL", "", "itt"),
    ("Elettroliti e mineralcorticoidi", "Sodio (Na+)", "mmol/L", "", "sodio|na|natremia"),
    ("Elettroliti e mineralcorticoidi", "Potassio (K+)", "mmol/L", "", "potassio|k|kaliemia|potassiemia"),
    ("Elettroliti e mineralcorticoidi", "Cloro", "mmol/L", "", "cl|cloremia"),
    ("Elettroliti e mineralcorticoidi", "Renina", "mU/L", "", "renina diretta|renina attiva"),
    ("Elettroliti e mineralcorticoidi", "Attività reninica plasmatica (PRA)", "ng/mL/h", "", "pra|attivita reninica"),
    ("Elettroliti e mineralcorticoidi", "Aldosterone", "ng/dL", "", "aldosterone plasmatico"),
    ("Elettroliti e mineralcorticoidi", "Rapporto aldosterone/renina (ARR)", "", "", "arr|rapporto aldosterone renina"),
    ("Elettroliti e mineralcorticoidi", "Test di carico salino", "ng/dL", "", ""),
    ("Elettroliti e mineralcorticoidi", "Test al captopril", "ng/dL", "", ""),
    ("Catecolamine", "Metanefrine plasmatiche libere", "pg/mL", "", "metanefrina plasmatica|metanefrine plasmatiche"),
    ("Catecolamine", "Normetanefrine plasmatiche libere", "pg/mL", "", "normetanefrina plasmatica|normetanefrine plasmatiche"),
    ("Catecolamine", "3-metossitiramina plasmatica", "pg/mL", "", "metossitiramina"),
    ("Catecolamine", "Metanefrine urinarie frazionate 24 h", "µg/24h", "", "metanefrine urinarie"),
    ("Catecolamine", "Cromogranina A", "ng/mL", "", "cga"),
    ("Steroidi e androgeni", "17-OH-progesterone", "ng/mL", "", "17 idrossiprogesterone|17ohp|17 oh progesterone|17alfa idrossiprogesterone"),
    ("Steroidi e androgeni", "17-OHP dopo ACTH (60 min)", "ng/mL", "", ""),
    ("Steroidi e androgeni", "21-desossicortisolo", "ng/mL", "", "21 deossicortisolo"),
    ("Steroidi e androgeni", "11-desossicortisolo", "ng/mL", "", "11 deossicortisolo|composto s"),
    ("Steroidi e androgeni", "Desossicorticosterone (DOC)", "ng/dL", "", "doc"),
    ("Steroidi e androgeni", "Progesterone", "ng/mL", "", ""),
    ("Steroidi e androgeni", "Androstenedione", "ng/mL", "", "delta 4 androstenedione|d4 androstenedione"),
    ("Steroidi e androgeni", "Testosterone totale", "ng/mL", "", "testosterone"),
    ("Steroidi e androgeni", "Testosterone libero", "pg/mL", "", ""),
    ("Steroidi e androgeni", "DHEA-S", "µg/dL", "", "dheas|deidroepiandrosterone solfato|dhea solfato"),
    ("Steroidi e androgeni", "DHEA", "ng/mL", "", "deidroepiandrosterone"),
    ("Steroidi e androgeni", "SHBG", "nmol/L", "", "sex hormone binding globulin"),
    ("Steroidi e androgeni", "11-chetotestosterone", "nmol/L", "", "11 ketotestosterone|11kt"),
    ("Steroidi e androgeni", "Profilo steroideo sierico (LC-MS/MS)", "", "", ""),
    ("Steroidi e androgeni", "Profilo steroideo urinario (GC-MS)", "", "", ""),
    ("Gonadi e fertilità", "LH", "mU/mL", "", "ormone luteinizzante|lutropina"),
    ("Gonadi e fertilità", "FSH", "mU/mL", "", "ormone follicolostimolante|follitropina"),
    ("Gonadi e fertilità", "Inibina B", "pg/mL", "", ""),
    ("Gonadi e fertilità", "AMH", "ng/mL", "", "ormone antimulleriano"),
    ("Gonadi e fertilità", "Estradiolo", "pg/mL", "", "17 beta estradiolo|e2"),
    ("Gonadi e fertilità", "Spermiogramma", "", "", "esame del liquido seminale"),
    ("Tiroide e autoimmunità", "TSH", "mU/L", "90.42.1", "tireotropina|tsh reflex"),
    ("Tiroide e autoimmunità", "FT4", "ng/dL", "90.42.3", "tiroxina libera|ft4"),
    ("Tiroide e autoimmunità", "FT3", "pg/mL", "90.43.3", "triiodotironina libera|triodotironina libera"),
    ("Tiroide e autoimmunità", "Anticorpi anti-21-idrossilasi", "U/mL", "", "anti 21 idrossilasi|anticorpi antisurrene"),
    ("Tiroide e autoimmunità", "Anticorpi anti-TPO", "UI/mL", "", "anti tpo|anticorpi anti tireoperossidasi|abtpo"),
    ("Tiroide e autoimmunità", "Anti-transglutaminasi IgA", "U/mL", "", "anti transglutaminasi|ttg iga"),
    ("Tiroide e autoimmunità", "Anti-GAD", "U/mL", "", "anticorpi anti gad"),
    ("Metabolico", "Glicemia", "mg/dL", "90.27.1", "glucosio|glucosio s|glicemia a digiuno"),
    ("Metabolico", "HbA1c", "mmol/mol", "", "emoglobina glicata|hb glicata"),
    ("Metabolico", "Insulina", "µU/mL", "", "insulinemia"),
    ("Metabolico", "Colesterolo totale", "mg/dL", "90.14.3", "colesterolo"),
    ("Metabolico", "Colesterolo HDL", "mg/dL", "90.14.1", "hdl"),
    ("Metabolico", "Colesterolo LDL", "mg/dL", "", "ldl"),
    ("Metabolico", "Trigliceridi", "mg/dL", "90.43.2", "trigliceridemia"),
    ("Metabolico", "Creatinina", "mg/dL", "", "creatininemia"),
    ("Metabolico", "eGFR", "mL/min/1.73m²", "", "filtrato glomerulare|velocita di filtrazione glomerulare"),
    ("Metabolico", "Calcio", "mg/dL", "", "calcemia|calcio totale"),
    ("Metabolico", "25-OH vitamina D", "ng/mL", "", "vitamina d|25 oh vitamina d|25 idrossivitamina d"),
    ("Metabolico", "Vitamina B12", "pg/mL", "", "cobalamina"),
    ("Metabolico", "Densitometria ossea (DXA)", "T-score", "", "moc|dexa|densitometria"),
    ("Emocromo e urine", "Emocromo completo", "", "90.62.2", "emocromo|emocromo citom e form|emocromo con formula"),
    ("Emocromo e urine", "Emoglobina", "g/dL", "", "hb"),
    ("Emocromo e urine", "Globuli bianchi", "10³/µL", "", "leucociti|gb|wbc"),
    ("Emocromo e urine", "Eosinofili (%)", "%", "", "eosinofili"),
    ("Emocromo e urine", "Piastrine", "10³/µL", "", "plt"),
    ("Emocromo e urine", "Esame urine completo", "", "90.44.3", "esame delle urine|urine esame completo|esame urine"),
    ("Genetica", "Genotipo CYP21A2", "", "", "cyp21a2"),
    ("Genetica", "Acidi grassi a catena molto lunga (VLCFA)", "", "", "vlcfa"),
    ("Genetica", "Pannello genetico feocromocitoma/paraganglioma", "", "", ""),
    ("Imaging", "Ecografia testicolare", "", "", "eco testicolare|ecografia scrotale"),
    ("Imaging", "RM testicolare", "", "", ""),
    ("Imaging", "Ecografia pelvica / ovarica", "", "", ""),
    ("Imaging", "TC surreni", "HU", "", "tc addome surreni"),
    ("Imaging", "RM surreni", "", "", ""),
    ("Imaging", "RM ipofisi", "", "", "rm sella turcica"),
    ("Imaging", "Età ossea (Rx mano-polso)", "anni", "", "eta ossea"),
    ("Imaging", "PET ⁶⁸Ga-DOTATATE / ¹⁸F-DOPA", "", "", ""),
    ("Imaging", "Scintigrafia MIBG", "", "", "mibg"),
]
