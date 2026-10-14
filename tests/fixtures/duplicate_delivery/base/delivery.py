"""Deliberately failing, disposable fixture: enqueue is missing an atomic claim."""
import sqlite3


def database():
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE claims (event_id TEXT PRIMARY KEY)")
    db.execute("CREATE TABLE outbox (event_id TEXT NOT NULL)")
    return db


def deliver(db, event_id):
    with db:
        db.execute("INSERT INTO outbox(event_id) VALUES (?)", (event_id,))


def queued(db):
    return db.execute("SELECT count(*) FROM outbox").fetchone()[0]
