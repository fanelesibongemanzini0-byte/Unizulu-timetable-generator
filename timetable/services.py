"""
Talks to mycelcat.unizulu.ac.za (CELCAT Web Publisher) - a public,
unauthenticated site - and turns its XML into JSON-friendly data.

  1. finder.xml    -> list of ALL modules (id, code, name, dept)
  2. m{id}.xml      -> the timetable XML for a single module

No login or browser automation involved; both are public XML documents
meant to be machine-readable (they ship with an XSLT stylesheet).
"""

import time
import threading
from xml.etree import ElementTree as ET

import requests
from django.conf import settings

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

_module_cache = {"modules": [], "fetched_at": 0}
_cache_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Module list (finder.xml)
# ---------------------------------------------------------------------------
def _fetch_finder_modules():
    resp = requests.get(f"{settings.CELCAT_BASE_URL}/finder.xml", timeout=20)
    resp.raise_for_status()
    root = ET.fromstring(resp.content)

    modules = []
    seen_ids = set()
    for resource in root.findall("resource"):
        if resource.get("type") != "module":
            continue
        mod_id = resource.get("id")
        if mod_id in seen_ids:
            continue
        seen_ids.add(mod_id)

        name_el = resource.find("name")
        raw_name = (name_el.text or "").strip() if name_el is not None else ""
        code, _, title = raw_name.partition(",")

        dept_el = resource.find("dept")
        faculty_el = resource.find("faculty")

        modules.append({
            "id": mod_id,
            "code": code.strip(),
            "title": title.strip(),
            "dept": dept_el.text if dept_el is not None else None,
            "faculty": faculty_el.text if faculty_el is not None else None,
        })

    return modules


def get_modules(force_refresh=False):
    with _cache_lock:
        is_stale = (time.time() - _module_cache["fetched_at"]) > settings.CELCAT_CACHE_TTL_SECONDS
        if force_refresh or is_stale or not _module_cache["modules"]:
            _module_cache["modules"] = _fetch_finder_modules()
            _module_cache["fetched_at"] = time.time()
        return _module_cache["modules"]


def search_modules(query):
    modules = get_modules()
    q = (query or "").strip().lower()
    if not q:
        return modules[:50]
    return [
        m for m in modules
        if q in m["code"].lower()
        or q in m["title"].lower()
        or q in (m["dept"] or "").lower()
    ][:100]


# ---------------------------------------------------------------------------
# Per-module timetable (m{id}.xml)
# ---------------------------------------------------------------------------
def _item_text(item_el):
    """An <item> either wraps an <a>CODE (TITLE)</a> or is plain text itself."""
    if item_el is None:
        return ""
    a_el = item_el.find("a")
    if a_el is not None and a_el.text:
        return a_el.text.strip()
    return (item_el.text or "").strip()


def fetch_module_timetable(module_id):
    resp = requests.get(f"{settings.CELCAT_BASE_URL}/m{module_id}.xml", timeout=20)
    resp.raise_for_status()
    root = ET.fromstring(resp.content)

    option_el = root.find("option")
    subheading_el = option_el.find("subheading") if option_el is not None else None
    subheading = subheading_el.text if subheading_el is not None else ""

    events = []
    for ev in root.findall("event"):
        day_idx = int(ev.findtext("day", default="0"))

        module_item = ev.find("resources/module/item")
        room_item = ev.find("resources/room/item")
        staff_item = ev.find("resources/staff/item")

        events.append({
            "id": ev.get("id"),
            "dayIndex": day_idx,
            "dayName": DAY_NAMES[day_idx] if day_idx < len(DAY_NAMES) else f"Day {day_idx}",
            "startTime": ev.findtext("starttime"),
            "endTime": ev.findtext("endtime"),
            "prettyTimes": ev.findtext("prettytimes"),
            "category": ev.findtext("category"),
            "prettyWeeks": ev.findtext("prettyweeks"),
            "rawWeeks": ev.findtext("rawweeks"),
            "module": _item_text(module_item),
            "room": _item_text(room_item),
            "staff": _item_text(staff_item),
            "sourceModuleId": str(module_id),
        })

    return {"moduleId": str(module_id), "subheading": subheading, "events": events}


def build_timetable(module_ids):
    modules_data = []
    failed = []
    for mod_id in module_ids:
        try:
            modules_data.append(fetch_module_timetable(mod_id))
        except (requests.RequestException, ET.ParseError):
            failed.append(mod_id)

    all_events = [ev for m in modules_data for ev in m["events"]]
    clashes = _find_clashes(all_events)

    return {
        "modules": [{"moduleId": m["moduleId"], "subheading": m["subheading"]} for m in modules_data],
        "events": all_events,
        "clashes": clashes,
        "failedModuleIds": failed,
    }


# ---------------------------------------------------------------------------
# Clash detection
# ---------------------------------------------------------------------------
def _time_to_minutes(t):
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _weeks_overlap(raw_a, raw_b):
    if not raw_a or not raw_b:
        return True  # unknown -> assume possible overlap
    for a, b in zip(raw_a, raw_b):
        if a == "Y" and b == "Y":
            return True
    return False


def _find_clashes(events):
    clashes = []
    for i in range(len(events)):
        for j in range(i + 1, len(events)):
            a, b = events[i], events[j]
            if a["dayIndex"] != b["dayIndex"]:
                continue
            if a["sourceModuleId"] == b["sourceModuleId"]:
                continue  # same module, e.g. lecture + tutorial - not a clash

            a_start, a_end = _time_to_minutes(a["startTime"]), _time_to_minutes(a["endTime"])
            b_start, b_end = _time_to_minutes(b["startTime"]), _time_to_minutes(b["endTime"])

            time_overlaps = a_start < b_end and b_start < a_end
            if not time_overlaps:
                continue
            if not _weeks_overlap(a["rawWeeks"], b["rawWeeks"]):
                continue

            clashes.append({"eventIdA": a["id"], "eventIdB": b["id"], "day": a["dayName"]})

    return clashes
