from delivery import database, deliver, queued


def test_retry_delivery():
    db = database()
    deliver(db, "evt_42")
    deliver(db, "evt_42")
    assert queued(db) == 1


def test_distinct_events():
    db = database()
    deliver(db, "evt_1")
    deliver(db, "evt_2")
    assert queued(db) == 2
