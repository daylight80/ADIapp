import billing_helpers as b

END = 1_900_000_000


def test_reads_the_period_end_from_the_subscription_when_it_is_there():
    assert b.period_end_timestamp({"current_period_end": END}) == END


def test_reads_it_from_the_items_on_newer_api_versions():
    sub = {"items": {"data": [{"current_period_end": END}, {"current_period_end": END}]}}
    assert b.period_end_timestamp(sub) == END


def test_the_subscription_value_wins_over_the_items():
    assert b.period_end_timestamp({"current_period_end": END, "items": {"data": [{"current_period_end": END + 99}]}}) == END


def test_uses_the_earliest_item_end_if_cycles_differ():
    sub = {"items": {"data": [{"current_period_end": END + 500}, {"current_period_end": END}]}}
    assert b.period_end_timestamp(sub) == END


def test_none_when_stripe_gave_nothing_usable():
    assert b.period_end_timestamp({}) is None
    assert b.period_end_timestamp(None) is None
    assert b.period_end_timestamp({"current_period_end": None, "items": {"data": [{}, {"current_period_end": 0}]}}) is None
    assert b.period_end_timestamp({"current_period_end": "soon"}) is None
    assert b.period_end_iso({}) is None


def test_iso_text_is_utc():
    assert b.period_end_iso({"current_period_end": END}) == "2030-03-17T17:46:40+00:00"


def test_works_on_a_stripe_object_too():
    import stripe
    sub = stripe.Subscription.construct_from({"id": "sub_1", "items": {"object": "list", "data": [{"id": "si_1", "current_period_end": END}]}}, "sk_test_x")
    assert b.period_end_timestamp(sub) == END
