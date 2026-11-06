"""Turn raw place candidates into two activities and one restaurant.

Every claim in an explanation is either (a) derived from the source data
(tags, address, distance, rating) or (b) phrased as general guidance about the
*type* of place. Nothing here invents hours, prices or availability.
"""

from __future__ import annotations

import math
import re
from typing import Any

# key: (label, indoor, base score, icon, why-it-suits-4-to-8-year-olds)
CATEGORIES: dict[str, tuple[str, bool, float, str, str]] = {
    "childrens_museum": (
        "Children's museum", True, 10, "museum",
        "Designed for hands-on play. Exhibits are made to be touched, climbed and explored — at exactly a 4-to-8-year-old’s pace.",
    ),
    "science_center": (
        "Science centre", True, 9, "science",
        "Push the buttons. Pull the levers. Interactive exhibits turn every “why?” into an experiment.",
    ),
    "aquarium": (
        "Aquarium", True, 9, "fish",
        "Sea life at eye level, short walks between tanks and plenty of “look!” moments. Easy on little legs.",
    ),
    "zoo": (
        "Zoo", False, 9, "paw",
        "Real animals, up close. Go at your own pace, with as many snack breaks as it takes.",
    ),
    "petting_zoo": (
        "Petting zoo / farm", False, 8, "paw",
        "Gentle, hands-on time with farm animals. Perfect for kids who want to pet everything.",
    ),
    "natural_history": (
        "Natural history museum", True, 7, "dino",
        "Fossils, skeletons and animals from around the world. Big wonder, all under one roof.",
    ),
    "planetarium": (
        "Planetarium", True, 7, "star",
        "The night sky, overhead and immersive. Shows are short — check each one’s recommended age.",
    ),
    "indoor_play": (
        "Indoor play centre", True, 7, "blocks",
        "Climb, slide, tumble, repeat. A reliable way to burn off energy, whatever the weather.",
    ),
    "trampoline_park": (
        "Trampoline park", True, 6, "bounce",
        "Bounce-all-day energy for active kids. Many venues run sessions for little ones — check age rules.",
    ),
    "theme_park": (
        "Theme / amusement park", False, 6, "ferris",
        "Rides, attractions and a proper big day out. Check height limits so no one sits a ride out.",
    ),
    "water_park": (
        "Water park", False, 5, "wave",
        "Made for warm days. Look for the shallow splash zones built for younger kids.",
    ),
    "mini_golf": (
        "Mini golf", False, 5, "flag",
        "Short holes, simple rules, plenty of giggles. No golf skills required.",
    ),
    "playground": (
        "Playground", False, 4, "swing",
        "Swings, slides and climbing frames. Free, easy and exactly right for this age.",
    ),
    "park": (
        "Park", False, 4, "tree",
        "Room to run, picnic and explore. Pairs well with just about any other plan.",
    ),
}

KID_WORDS = re.compile(
    r"child|kid|kinder|enfant|niñ|nin[oa]s|bambin|crian|barn|discover|explor|toy|jouet|spielzeug|dino", re.I
)
SCIENCE_WORDS = re.compile(r"scien|wissen|cienc|technik|techno|cité des|exploratorium", re.I)
NATURE_WORDS = re.compile(r"natural history|naturkunde|histoire naturelle|natur|ciencias naturales", re.I)


def classify_activity(tags: dict[str, str], name: str) -> str | None:
    tourism, leisure, amenity = tags.get("tourism"), tags.get("leisure"), tags.get("amenity")
    museum = (tags.get("museum") or "").lower()
    if tourism == "museum" or amenity == "museum":
        if museum == "children" or KID_WORDS.search(name):
            return "childrens_museum"
        if museum in {"science", "technology"} or SCIENCE_WORDS.search(name):
            return "science_center"
        if museum in {"natural_history", "nature"} or NATURE_WORDS.search(name):
            return "natural_history"
        return None  # generic museums are rarely a safe pick for 4–8 year-olds
    if tourism == "aquarium" or amenity == "aquarium":
        return "aquarium"
    if tourism == "zoo" or tags.get("zoo"):
        return "petting_zoo" if tags.get("zoo") in {"petting_zoo", "farm"} else "zoo"
    if amenity == "planetarium":
        return "planetarium"
    if tourism == "theme_park":
        return "theme_park"
    return {
        "indoor_play": "indoor_play",
        "trampoline_park": "trampoline_park",
        "water_park": "water_park",
        "miniature_golf": "mini_golf",
        "playground": "playground",
        "park": "park",
    }.get(leisure or "")


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def osm_address(tags: dict[str, str]) -> str | None:
    street = " ".join(filter(None, [tags.get("addr:housenumber"), tags.get("addr:street")]))
    locality = " ".join(filter(None, [tags.get("addr:postcode"), tags.get("addr:city")]))
    return ", ".join(filter(None, [street, locality])) or None


# --------------------------------------------------------------------------- weather


def weather_context(days: list[dict[str, Any]] | None) -> dict[str, Any]:
    """Summarise the weekend for scoring. `days` may be None if weather failed."""
    if not days:
        return {"known": False, "indoor_bias": 0.0, "best_outdoor_day": None, "summary": None}
    names = ["Saturday", "Sunday"]
    friendly = [d["assessment"]["outdoor_friendly"] for d in days]
    wet = [d["assessment"]["wet"] for d in days]
    if not any(friendly):
        bias, summary = 1.0, "Rain is on the way both days. So we’ve leaned indoors."
    elif all(friendly):
        bias, summary = -0.5, "Dry and comfortable all weekend. So we’ve leaned outdoors."
    else:
        bias, summary = 0.25, "A mixed weekend. One idea for inside, one for out."
    # Pick the day best suited to being outside: friendly first, then lowest rain chance.
    ranked = sorted(
        range(len(days)),
        key=lambda i: (not friendly[i], days[i].get("precip_probability") or 0, -(days[i].get("temp_max") or 0)),
    )
    best = names[ranked[0]] if friendly[ranked[0]] else None
    return {"known": True, "indoor_bias": bias, "best_outdoor_day": best, "wet_days": [n for n, w in zip(names, wet) if w], "summary": summary}


def _weather_note(indoor: bool, ctx: dict[str, Any]) -> str | None:
    if not ctx["known"]:
        return "The forecast is unavailable, so this pick doesn’t factor in the weather."
    wet = ctx.get("wet_days", [])
    if indoor and wet:
        return f"Poor weather is forecast for {' and '.join(wet)}. This one’s indoors."
    if indoor:
        return "Indoors, so the weather won’t matter."
    if ctx["best_outdoor_day"]:
        return f"Best on {ctx['best_outdoor_day']}. It has the better forecast for being outside."
    return "Not ideal outdoor weather. Keep this one in your back pocket."


# --------------------------------------------------------------------------- activities


def pick_activities(candidates: list[dict[str, Any]], ctx: dict[str, Any], limit: int = 2) -> list[dict[str, Any]]:
    scored = []
    for c in candidates:
        label, indoor, base, _, _ = CATEGORIES[c["category"]]
        score = base
        score += 2 if c.get("notable") else 0
        score += 1 if c.get("website") else 0
        score += 0.5 if c.get("address") else 0
        if c.get("rating"):
            score += max(0.0, (c["rating"] - 4.0)) * 3
        if c.get("rating_count", 0) < 20 and c.get("rating") is not None:
            score -= 1
        if ctx["known"]:
            bias = ctx["indoor_bias"]
            score += 4 * bias if indoor else -4 * max(bias, 0) + (2 if bias < 0 else 0)
        dist = c.get("distance_km") or 0
        score -= max(0.0, dist - 3) * 0.35
        scored.append((score, c))
    scored.sort(key=lambda s: -s[0])

    picks: list[dict[str, Any]] = []
    used_categories: set[str] = set()
    want_mix = ctx["known"] and 0 < ctx["indoor_bias"] < 1
    for _, c in scored:
        if len(picks) == limit:
            break
        if c["category"] in used_categories:
            continue
        indoor = CATEGORIES[c["category"]][1]
        if want_mix and picks and CATEGORIES[picks[0]["category"]][1] == indoor and _has_other(scored, indoor, used_categories):
            continue
        used_categories.add(c["category"])
        picks.append(c)

    out = []
    for c in picks:
        label, indoor, _, icon, why = CATEGORIES[c["category"]]
        out.append(
            {
                **{k: v for k, v in c.items() if k not in {"tags", "notable"}},
                "category_label": label,
                "indoor": indoor,
                "icon": icon,
                "why": why,
                "weather_note": _weather_note(indoor, ctx),
            }
        )
    return out


def _has_other(scored, indoor: bool, used: set[str]) -> bool:
    return any(CATEGORIES[c["category"]][1] != indoor and c["category"] not in used for _, c in scored)


# --------------------------------------------------------------------------- restaurant


def cuisine_kind(cuisine: str | None, name: str = "") -> str | None:
    """'italian' when the source explicitly says Italian, 'pizza' for pizzerias, else None."""
    values = [v.strip().lower() for v in re.split(r"[;,]", cuisine or "") if v.strip()]
    if any("italian" in v for v in values):
        return "italian"
    if any("pizza" in v for v in values):
        return "pizza"
    return None


def pick_restaurant(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    best, best_score = None, -math.inf
    for c in candidates:
        kind = c.get("cuisine_kind")
        if kind is None:
            continue  # never recommend something we cannot verify as Italian
        tags = c.get("tags") or {}
        score = 5.0 if kind == "italian" else 2.5
        score += 2 if c.get("website") else 0
        score += 1 if c.get("opening_hours") else 0
        score += 1 if c.get("address") else 0
        score += 2 if tags.get("kids_area") == "yes" or c.get("good_for_children") else 0
        score += 1 if tags.get("highchair") == "yes" else 0
        score += 0.5 if tags.get("outdoor_seating") == "yes" else 0
        if c.get("rating"):
            score += (c["rating"] - 4.0) * 4 + min(c.get("rating_count", 0), 2000) / 1000
        score -= max(0.0, (c.get("distance_km") or 0) - 1.5) * 0.6
        if score > best_score:
            best, best_score = c, score
    if not best:
        return None

    tags = best.get("tags") or {}
    facts = []
    if best["cuisine_kind"] == "italian":
        facts.append(f"Listed as Italian on {best['source']['name']}.")
    else:
        facts.append(f"Listed as a pizzeria on {best['source']['name']}. Italian-style, though a full Italian menu isn’t confirmed.")
    if best.get("rating"):
        facts.append(f"Rated {best['rating']:.1f} out of 5 across {best.get('rating_count', 0):,} Google reviews.")
    if best.get("distance_km") is not None and best["distance_km"] <= 2:
        facts.append("Close to the centre, so it fits around the day.")
    family = []
    if tags.get("kids_area") == "yes" or best.get("good_for_children"):
        family.append("marked as good for children" if best.get("good_for_children") else "has a kids' area")
    if tags.get("highchair") == "yes":
        family.append("high chairs listed")
    if tags.get("outdoor_seating") == "yes":
        family.append("outdoor seating listed")
    if tags.get("wheelchair") == "yes":
        family.append("wheelchair accessible")
    if family:
        facts.append("The listing also notes: " + ", ".join(family) + ".")
    facts.append("And pizza and pasta are a near-universal hit with kids.")
    return {
        **{k: v for k, v in best.items() if k not in {"tags", "notable"}},
        "why": " ".join(facts),
    }
