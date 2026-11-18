"""Logica dell'applicazione, indipendente da FastAPI.

Ogni funzione riceve un Context (db, utente, ip), controlla i permessi,
solleva errori di app.errors e restituisce dizionari pronti per il JSON.
"""
