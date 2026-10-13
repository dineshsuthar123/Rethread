from delivery import database, deliver, queued


def test_duplicate_delivery():
    db = database()
    for _ in range(5):
        deliver(db, "one-event")
    assert queued(db) == 1
