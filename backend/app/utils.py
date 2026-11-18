"""Funzioni di utilità."""
import datetime as dt


def today() -> str:
    return dt.date.today().isoformat()


def now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
