"""Versione del programma e dello schema del database.

APP_VERSION    si mostra nell'app e negli script di aggiornamento.
SCHEMA_VERSION va aumentata di 1 a ogni modifica della struttura del database,
               aggiungendo la migrazione corrispondente in migrations.py.
"""
APP_VERSION = "3.2.0"
SCHEMA_VERSION = 2
