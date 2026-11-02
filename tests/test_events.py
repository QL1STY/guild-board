from guildboard.events import QUEUE_SIZE, EventBus


def test_subscribers_receive_events():
    bus = EventBus()
    first, second = bus.subscribe(), bus.subscribe()
    bus.publish("game_started", at="2026-10-13T08:00:00+00:00")
    assert first.get_nowait() == {"type": "game_started", "at": "2026-10-13T08:00:00+00:00"}
    assert second.get_nowait()["type"] == "game_started"


def test_unsubscribed_queue_gets_nothing():
    bus = EventBus()
    queue = bus.subscribe()
    bus.unsubscribe(queue)
    bus.unsubscribe(queue)  # a second time is harmless
    bus.publish("sync_started")
    assert queue.empty()


def test_a_stalled_listener_loses_its_oldest_events():
    bus = EventBus()
    queue = bus.subscribe()
    for number in range(QUEUE_SIZE + 5):
        bus.publish("tick", number=number)
    assert queue.qsize() == QUEUE_SIZE
    assert queue.get_nowait()["number"] == 5
