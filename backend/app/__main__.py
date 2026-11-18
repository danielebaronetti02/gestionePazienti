"""Comandi da terminale.

    python -m app                          avvia il server su 127.0.0.1:8000 (solo questo PC)
    python -m app --host 0.0.0.0 --port 8080   anche dalla rete (serve HTTPS davanti)

Le password dimenticate le reimposta un amministratore dall'app
(il server non può farlo da solo: non possiede le chiavi dei dati).
Su Windows usate gli script nella cartella windows\ (vedi README).
"""
import argparse

from . import config


def main():
    parser = argparse.ArgumentParser(prog="python -m app", description="Gestione Pazienti")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    import uvicorn
    print(f"Dati in: {config.DATA_DIR}")
    uvicorn.run("app.main:app", host=args.host, port=args.port, proxy_headers=True)


if __name__ == "__main__":
    main()
