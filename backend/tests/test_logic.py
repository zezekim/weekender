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


# --------------------------------------------------------------------------- weather extras

from app.providers.weather import best_window, uv_note  # noqa: E402


def _hours(probs, icon="clear"):
    return [{"time": f"2026-11-07T{h:02d}:00", "precip_probability": p, "icon": icon} for h, p in zip(range(8, 21), probs)]


def test_best_window_finds_longest_dry_run():
    #        08  09  10  11  12  13  14  15  16  17  18  19  20
    probs = [60, 50, 10, 10, 10, 20, 70, 80, 10, 10, 90, 90, 90]
    assert best_window(_hours(probs)) == {"start": "2026-11-07T10:00", "end": "2026-11-07T14:00"}


def test_best_window_none_when_wet_all_day():
    assert best_window(_hours([80] * 13)) is None
    assert best_window(_hours([0] * 13, icon="rain")) is None


def test_uv_note_thresholds():
    assert uv_note(1) is None and uv_note(None) is None
    assert "Moderate" in uv_note(4) and "High" in uv_note(6.5) and "Very high" in uv_note(9)


# --------------------------------------------------------------------------- alternates

from app.recommend import rank_activities, rank_restaurants  # noqa: E402


def test_alternates_exclude_picks_and_prefer_new_categories():
    cands = [_cand("zoo", "Z1"), _cand("zoo", "Z2"), _cand("aquarium", "A1"), _cand("playground", "P1"), _cand("park", "K1")]
    picks, alts = rank_activities(cands, weather_context(None), alternates=3)
    assert len(picks) == 2 and not {p["id"] for p in picks} & {a["id"] for a in alts}
    # a brand-new category beats a second zoo
    assert alts[0]["category"] not in {p["category"] for p in picks}


def test_rank_restaurants_only_verified():
    rows = [
        {"name": "Pizzeria", "cuisine_kind": "pizza", "distance_km": 0.5, "source": {"name": "OSM"}, "tags": {}},
        {"name": "Trattoria", "cuisine_kind": "italian", "distance_km": 1.0, "source": {"name": "OSM"}, "tags": {}},
        {"name": "Burger", "cuisine_kind": None, "source": {"name": "OSM"}},
    ]
    ranked = rank_restaurants(rows)
    assert [r["name"] for r in ranked] == ["Trattoria", "Pizzeria"]


# --------------------------------------------------------------------------- cache

import asyncio  # noqa: E402

from app.core import Cache, SourceError  # noqa: E402


def test_cache_serves_stale_when_source_fails(tmp_path):
    c = Cache(tmp_path / "c.sqlite3")

    async def ok():
        return {"v": 1}

    async def boom():
        raise SourceError("X", "down")

    async def run():
        assert await c.get_or_set("k", -1, ok, stale_for=60) == ({"v": 1}, "fresh")  # already expired
        assert await c.get_or_set("k", 60, boom, stale_for=60) == ({"v": 1}, "stale")
        try:
            await c.get_or_set("other", 60, boom, stale_for=60)
        except SourceError:
            return True

    assert asyncio.run(run())
