import address_search as a


def test_clean_query_needs_three_characters():
    assert a.clean_query("  sm ") is None
    assert a.clean_query(None) is None
    assert a.clean_query("  SM1   4LS ") == "SM1 4LS"
    assert len(a.clean_query("x" * 500)) == a.MAX_QUERY_CHARS


def test_autocomplete_is_limited_to_the_uk():
    assert a.autocomplete_body("sm1")["includedRegionCodes"] == ["gb"]


def test_parse_suggestions_keeps_only_usable_ones_and_caps_them():
    body = {"suggestions": [
        {"placePrediction": {"placeId": "p1", "text": {"text": "1 High St, Sutton SM1 1AA, UK"}}},
        {"placePrediction": {"placeId": "", "text": {"text": "no id"}}},
        {"queryPrediction": {"text": {"text": "not a place"}}},
        *[{"placePrediction": {"placeId": f"x{i}", "text": {"text": f"Place {i}"}}} for i in range(10)],
    ]}
    out = a.parse_suggestions(body)
    assert out[0] == {"place_id": "p1", "text": "1 High St, Sutton SM1 1AA, UK"}
    assert len(out) == a.MAX_SUGGESTIONS
    assert a.parse_suggestions({}) == []
    assert a.parse_suggestions(None) == []


def test_parse_place_splits_postcode_out_of_the_address():
    body = {
        "formattedAddress": "12 Abbey Road, London NW8 9AY, UK",
        "addressComponents": [{"longText": "NW8 9AY", "types": ["postal_code"]}],
    }
    assert a.parse_place(body) == {"address": "12 Abbey Road, London", "postcode": "NW8 9AY"}


def test_parse_place_when_the_postcode_is_its_own_part():
    body = {
        "formattedAddress": "5 Mill Lane, Bristol, BS1 3AB, United Kingdom",
        "addressComponents": [{"longText": "bs1 3ab", "types": ["postal_code"]}],
    }
    assert a.parse_place(body) == {"address": "5 Mill Lane, Bristol", "postcode": "BS1 3AB"}


def test_parse_place_without_a_postcode_keeps_the_whole_address():
    assert a.parse_place({"formattedAddress": "The Green, Ely, UK"}) == {"address": "The Green, Ely", "postcode": ""}
    assert a.parse_place({}) is None
    assert a.parse_place(None) is None


def test_limiter_blocks_after_the_limit_and_recovers_after_the_window():
    now = [0.0]
    lim = a.UserLimiter(limit=3, window=60, clock=lambda: now[0])
    assert [lim.allow("u") for _ in range(4)] == [True, True, True, False]
    assert lim.allow("someone-else") is True
    now[0] = 61
    assert lim.allow("u") is True


def test_daily_cap_applies_on_top_of_the_burst_limit():
    now = [0.0]
    lim = a.AddressLimits(clock=lambda: now[0])
    assert a.DAILY_LIMIT == 100
    allowed = 0
    for i in range(a.DAILY_LIMIT + 20):
        now[0] = i * 601  # spaced out so the 10-minute burst limit never bites
        if lim.allow("u"):
            allowed += 1
    # 601s apart, so only the first ~143 fit in a day; the daily cap stops it at 100
    assert allowed == a.DAILY_LIMIT
    assert lim.allow("other") is True


def test_a_refused_call_does_not_use_up_the_other_allowance():
    now = [0.0]
    lim = a.AddressLimits(clock=lambda: now[0])
    lim.daily.limit = 1000  # out of the way, so this test is only about the burst limit
    for _ in range(a.LIMIT_PER_WINDOW):
        assert lim.allow("u")
    assert lim.allow("u") is False        # burst limit reached
    assert len(lim.daily._hits["u"]) == a.LIMIT_PER_WINDOW  # the refusal was not counted against the day
