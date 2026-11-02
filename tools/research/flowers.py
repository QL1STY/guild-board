"""R7: where each local specialty grows and how many one pass of the usual route gives.

Run: uv run python tools/research/flowers.py   (build time only; needs out/inventory.json, writes out/flowers.json)

Places: the HoYoLAB wiki's own entry for the specialty (the "Source" line of its Attributes; `out/raw/<entry_id>.json`),
  the phrases that start "Recommendation:". A specialty with no such phrase gets its "Source" phrases (the generic
  "Found in the wild" and "Grown in the Serenitea Pot" left out) and says so in `notes`.
Counts: the official HoYoLAB interactive map's label tree and point list (map 2, Teyvat), the same data the map shows:
  https://sg-public-api-static.hoyolab.com/common/map_user/ys_obc/v1/map/label/tree?map_id=2&app_sn=ys_obc&lang=en-us
  https://sg-public-api-static.hoyolab.com/common/map_user/ys_obc/v1/map/point/list?map_id=2&app_sn=ys_obc&lang=en-us
  - `map_points`: every node of the specialty on the map (the label's `point_count`, checked against the point list).
  - `route_items`: the item count in the name the map gives the specialty's recommended harvest route ("Windwheel Aster * 73"),
    `route_points` the route's node count without teleports (`point_cnt_without_trans`).
  - `per_pass` = `route_items` when the map has a recommended route (basis "route"), else `map_points` (basis "map_total":
    all the nodes of the specialty on the map, so the most one pass could give; confidence "low").
The counts are of the whole route or map, not of the one place the wiki recommends; the places are only where to start.
"""
from __future__ import annotations

import html
import json
import re
import sys
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
REFERENCE = HERE.parents[1] / "src" / "guildboard" / "reference" / "characters"
RAW = OUT / "raw"
CHECKED = date.today().isoformat()
MAP = "https://sg-public-api-static.hoyolab.com/common/map_user/ys_obc/v1/map/"
HEADERS = {"User-Agent": "Mozilla/5.0 (Guild Board research script)", "Origin": "https://act.hoyolab.com", "Referer": "https://act.hoyolab.com/"}
GENERIC = ("found in the wild", "grown in the serenitea pot")


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def phrases(source_html: str) -> list[str]:
    text = html.unescape(re.sub(r"<[^>]+>", "|", source_html))
    return [re.sub(r"\s+", " ", part).strip() for part in text.split("|") if part.strip()]


def place_of(phrase: str) -> str:
    """'Recommendation: Found in Fellfrost Peak' -> 'Fellfrost Peak'; 'Found near Snezhnograd' -> 'near Snezhnograd'."""
    phrase = re.sub(r"^Recommendation:\s*", "", phrase)
    phrase = re.sub(r"^Found\s+", "", phrase)
    return re.sub(r"^(in|on|at)\s+", "", phrase)


def wiki_places(entry_id: int) -> tuple[list[str], str, str]:
    """(places, basis, the whole Source text) from the wiki entry."""
    entry = json.loads((RAW / f"{entry_id}.json").read_text(encoding="utf-8"))
    source = ""
    for module in entry["modules"]:
        for component in module["components"]:
            if component["component_id"] == "baseInfo":
                info = {row["key"]: row["value"] for row in json.loads(component["data"])["list"]}
                source = info.get("Source", [""])[0]
    parts = phrases(source)
    recommended = [place_of(p) for p in parts if p.startswith("Recommendation:")]
    if recommended:
        return recommended, "recommendation", " / ".join(parts)
    others = [place_of(p) for p in parts if p.lower() not in GENERIC]
    return others, "source", " / ".join(parts)


def route_items(content: str) -> int | None:
    """'Windwheel Aster * 73' -> 73 (the route author's own count of the item)."""
    match = re.search(r"\*\s*(\d+)", content)
    return int(match.group(1)) if match else None


def norm(name: str) -> str:
    return re.sub(r"[^a-z]", "", name.lower())


def main() -> int:
    inventory = json.loads((OUT / "inventory.json").read_text(encoding="utf-8"))
    specialties: dict[str, dict] = {}
    for character in inventory["characters"]:
        spec = character.get("local_specialty")
        if spec:
            specialties[spec["key"]] = spec
    tree = fetch_json(MAP + "label/tree?map_id=2&app_sn=ys_obc&lang=en-us")["data"]["tree"]
    labels = {}
    for top in tree:
        if top["name"] == "Local Specialties":
            labels = {norm(child["name"]): child for child in top["children"]}
    points = fetch_json(MAP + "point/list?map_id=2&app_sn=ys_obc&lang=en-us")["data"]["point_list"]
    in_list = Counter(p["label_id"] for p in points)

    flowers = []
    for key, spec in sorted(specialties.items(), key=lambda kv: kv[1]["name"]):
        places, basis, source_text = wiki_places(spec["entry_id"])
        label = labels.get(norm(spec["name"]))
        if label is None:  # the map names Rukkhashava Mushrooms in the singular
            label = next((v for k, v in labels.items() if k.startswith(norm(spec["name"]).rstrip("s"))), None)
        notes = []
        if basis == "source":
            notes.append("the wiki gives no Recommendation; places are its Source lines")
        if not places:
            notes.append("the wiki names no place")
        record = {
            "key": spec["key"], "name": spec["name"], "region": spec["region"], "entry_id": spec["entry_id"],
            "places": "; ".join(places), "places_list": places, "places_basis": basis, "wiki_source_text": source_text,
            "map_label_id": None, "map_points": None, "route_items": None, "route_points": None,
            "per_pass": None, "per_pass_basis": None, "confidence": "none", "notes": "",
        }
        if label is None:
            notes.append("not found on the official map")
        else:
            map_points = int(label["point_count"])
            route = (label.get("recommend_route_list") or [None])[0]
            items = route_items(route["content"]) if route else None
            record.update(map_label_id=label["id"], map_points=map_points)
            if in_list[label["id"]] != map_points:
                notes.append(f"the map's point list holds {in_list[label['id']]} nodes, its label says {map_points}")
            if route and items:
                record.update(route_items=items, route_points=int(route["point_cnt_without_trans"]), per_pass=items,
                              per_pass_basis="route", confidence="medium")
                if abs(items - route["point_cnt_without_trans"]) > 0.1 * items:
                    notes.append(f"the route's own count ({items}) and its node count ({route['point_cnt_without_trans']}) differ by more than 10%")
                    record["confidence"] = "low"
            else:
                record.update(per_pass=map_points, per_pass_basis="map_total", confidence="low")
                notes.append("the map has no recommended route; per_pass is every node on the map")
        record["notes"] = "; ".join(notes)
        flowers.append(record)

    document = {
        "checked": CHECKED,
        "sources": [
            "https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/entry_page?entry_page_id=<entry_id> (each specialty's 'Source' line, the 'Recommendation' phrases), checked " + CHECKED,
            "https://sg-public-api-static.hoyolab.com/common/map_user/ys_obc/v1/map/label/tree?map_id=2&app_sn=ys_obc&lang=en-us (point_count and recommend_route_list of each Local Specialties label), checked " + CHECKED,
            "https://sg-public-api-static.hoyolab.com/common/map_user/ys_obc/v1/map/point/list?map_id=2&app_sn=ys_obc&lang=en-us (every node, counted per label_id), checked " + CHECKED,
        ],
        "per_pass_definition": "route_items of the official map's recommended harvest route when it has one; otherwise every node of the specialty on the map. Counts cover the whole route or map, not the one place named in `places`.",
        "flowers": flowers,
    }
    OUT.mkdir(exist_ok=True)
    (OUT / "flowers.json").write_text(json.dumps(document, indent=2, ensure_ascii=False) + chr(10), encoding="utf-8")
    # The schema's shape (schema/flowers.schema.json): flowers by key, each with name, places, per_pass and notes. The map
    # counts and the basis go into `notes`; the fuller file stays in out/flowers.json.
    shaped_flowers = {}
    for f in flowers:
        bits = [f"per_pass is the {'recommended harvest route on' if f['per_pass_basis'] == 'route' else 'whole count of nodes on'} the official map "
                f"({f['map_points']} nodes on the map" + (f", route {f['route_items']} items over {f['route_points']} nodes" if f['route_items'] else "") + f"; confidence {f['confidence']})"]
        if f["notes"]:
            bits.append(f["notes"])
        shaped_flowers[f["key"]] = {"name": f["name"], "places": f["places"], "per_pass": f["per_pass"], "notes": "; ".join(bits)}
    shaped = {"checked": CHECKED, "sources": document["sources"] + [document["per_pass_definition"]], "flowers": shaped_flowers}
    (REFERENCE / "flowers.json").write_text(json.dumps(shaped, indent=2, ensure_ascii=False) + chr(10), encoding="utf-8")
    basis_count = Counter(f["per_pass_basis"] for f in flowers)
    print(f"{len(flowers)} specialties; per_pass basis {dict(basis_count)}")
    for f in flowers:
        if f["notes"] or f["confidence"] != "medium":
            print(f"  {f['key']}: {f['per_pass']} ({f['confidence']}) {f['notes']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
