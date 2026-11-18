"""Comandi da terminale.

    python -m app                          avvia il server su 0.0.0.0:8000
    python -m app --host 127.0.0.1 --port 8080

Le password dimenticate le reimposta un amministratore dall'app
(il server non può farlo da solo: non possiede le chiavi dei dati).
Su Windows usate gli script nella cartella windows\ (vedi README).
"""
import argparse

from . import config


def main():
    parser = argparse.ArgumentParser(prog="python -m app", description="Gestione Pazienti")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    import uvicorn
    print(f"Dati in: {config.DATA_DIR}")
    uvicorn.run("app.main:app", host=args.host, port=args.port, proxy_headers=True)


if __name__ == "__main__":
    main()
