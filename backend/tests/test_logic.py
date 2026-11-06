from datetime import date

from app.recommend import classify_activity, cuisine_kind, pick_activities, pick_restaurant, weather_context
from app.weekend import target_weekend


def test_weekend_rules():
    # 2026-11-02 is a Monday
    assert target_weekend(date(2026, 11, 2)) == (date(2026, 11, 7), date(2026, 11, 8))
    assert target_weekend(date(2026, 11, 6)) == (date(2026, 11, 7), date(2026, 11, 8))  # Friday
    assert target_weekend(date(2026, 11, 7)) == (date(2026, 11, 7), date(2026, 11, 8))  # Saturday -> today
    assert target_weekend(date(2026, 11, 8)) == (date(2026, 11, 14), date(2026, 11, 15))  # Sunday -> next
    assert target_weekend(date(2026, 12, 31)) == (date(2027, 1, 2), date(2027, 1, 3))  # year boundary


def test_classify():
    assert classify_activity({"tourism": "museum", "museum": "children"}, "X") == "childrens_museum"
    assert classify_activity({"tourism": "museum"}, "Museum of Fine Art") is None
    assert classify_activity({"tourism": "zoo", "zoo": "petting_zoo"}, "Farm") == "petting_zoo"
    assert classify_activity({"leisure": "playground"}, "Swings") == "playground"


def test_cuisine():
    assert cuisine_kind("regional;italian") == "italian"
    assert cuisine_kind("pizza") == "pizza"
    assert cuisine_kind("burger") is None
    assert cuisine_kind(None) is None


def _day(wet: bool, prob: int):
    return {"precip_probability": prob, "temp_max": 18, "assessment": {"wet": wet, "outdoor_friendly": not wet}}


def _cand(cat: str, name: str, dist: float = 2):
    return {"id": name, "name": name, "category": cat, "distance_km": dist, "source": {"name": "t"}}


def test_rain_prefers_indoor():
    ctx = weather_context([_day(True, 80), _day(True, 70)])
    picks = pick_activities([_cand("zoo", "Zoo"), _cand("aquarium", "Aq"), _cand("childrens_museum", "CM")], ctx)
    assert {p["category"] for p in picks} == {"aquarium", "childrens_museum"}


def test_mixed_weather_pairs_indoor_and_outdoor():
    ctx = weather_context([_day(False, 10), _day(True, 80)])
    assert ctx["best_outdoor_day"] == "Saturday"
    picks = pick_activities([_cand("aquarium", "Aq"), _cand("childrens_museum", "CM"), _cand("zoo", "Zoo")], ctx)
    assert sorted(p["indoor"] for p in picks) == [False, True]


def test_no_weather_still_recommends():
    picks = pick_activities([_cand("zoo", "Zoo"), _cand("aquarium", "Aq")], weather_context(None))
    assert len(picks) == 2 and "unavailable" in picks[0]["weather_note"]


def test_restaurant_requires_verified_cuisine():
    assert pick_restaurant([{"name": "Bistro", "cuisine_kind": None, "source": {"name": "t"}}]) is None
    r = pick_restaurant([{"name": "Luigi", "cuisine_kind": "italian", "distance_km": 1, "source": {"name": "OSM"}, "tags": {}}])
    assert r["name"] == "Luigi" and "Italian" in r["why"]
