#!/usr/bin/env python3
"""Weekly report generator for HF inference provider snapshots.

Diffs first vs last snapshot of a given ISO week, computes per-provider uptime
across all snapshots in that week, and writes a report JSON.

Usage:
    python3 scripts/weekly-report.py [--week 2026-W09] [--test]

Default week: the most recent complete ISO week (previous week).
--test: run with inline mock data, print PASS/FAIL, exit.

Stdlib only -- no pip install needed.
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone


# Snapshot entry indices
M_MODEL = 0
M_PROV = 1
M_STATUS = 2
M_TOKS = 3
M_LATENCY = 4
M_IN_PRICE = 5
M_OUT_PRICE = 6


def parse_week(week_str):
    """Parse 'YYYY-WNN' into (year, week_number). Returns (year, week)."""
    m = re.match(r"^(\d{4})-W(\d{2})$", week_str)
    if not m:
        raise ValueError(f"Invalid week format: {week_str!r} (expected YYYY-WNN)")
    return int(m.group(1)), int(m.group(2))


def week_boundaries(year, week):
    """Return (monday_00:00, sunday_23:59:59) as UTC datetimes for the given ISO week."""
    # ISO week: Monday is day 1. Jan 4 is always in week 1.
    jan4 = datetime(year, 1, 4, tzinfo=timezone.utc)
    # Monday of week 1
    week1_monday = jan4 - timedelta(days=jan4.isoweekday() - 1)
    monday = week1_monday + timedelta(weeks=week - 1)
    sunday_end = monday + timedelta(days=6, hours=23, minutes=59, seconds=59)
    return monday, sunday_end


def prev_iso_week():
    """Return (year, week) for the most recent complete ISO week."""
    now = datetime.now(timezone.utc)
    last_week = now - timedelta(weeks=1)
    iso = last_week.isocalendar()
    return iso[0], iso[1]


def find_snapshot_files(snap_dir, start, end):
    """Find snapshot files whose timestamp falls within [start, end]."""
    files = []
    if not os.path.isdir(snap_dir):
        return files
    for fname in sorted(os.listdir(snap_dir)):
        if not fname.endswith(".json"):
            continue
        # Parse YYYY-MM-DDTHH-MM.json
        m = re.match(r"^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2})\.json$", fname)
        if not m:
            continue
        ts = datetime.strptime(m.group(1), "%Y-%m-%dT%H-%M").replace(tzinfo=timezone.utc)
        if start <= ts <= end:
            files.append(os.path.join(snap_dir, fname))
    return files


def load_snapshot(path):
    """Load a snapshot file and return its data list."""
    with open(path) as f:
        snap = json.load(f)
    return snap.get("d", [])


def build_index(entries):
    """Build {(model, provider): entry} from snapshot entries."""
    idx = {}
    for e in entries:
        key = (e[M_MODEL], e[M_PROV])
        idx[key] = e
    return idx


def pct_change(old, new):
    """Percentage change from old to new. Returns None if old is zero/None."""
    if old is None or new is None or old == 0:
        return None
    return round((new - old) / abs(old) * 100, 1)


def diff_snapshots(first_entries, last_entries):
    """Diff first vs last snapshot. Returns report sections."""
    first = build_index(first_entries)
    last = build_index(last_entries)

    first_keys = set(first.keys())
    last_keys = set(last.keys())

    added_keys = last_keys - first_keys
    removed_keys = first_keys - last_keys
    common_keys = first_keys & last_keys

    # Group by model to determine model-level adds/removes
    first_models = defaultdict(set)
    last_models = defaultdict(set)
    for model, prov in first_keys:
        first_models[model].add(prov)
    for model, prov in last_keys:
        last_models[model].add(prov)

    # Model added = appears in last but not in first at all
    models_added = []
    for model in sorted(set(last_models) - set(first_models)):
        models_added.append({
            "model": model,
            "providers": sorted(last_models[model]),
        })

    # Model removed = appears in first but not in last at all
    models_removed = []
    for model in sorted(set(first_models) - set(last_models)):
        models_removed.append({
            "model": model,
            "providers": sorted(first_models[model]),
        })

    # Provider changes = all individual (model, provider) additions/removals
    provider_changes = []
    for model, prov in sorted(added_keys):
        provider_changes.append({
            "model": model, "provider": prov, "change": "added",
        })
    for model, prov in sorted(removed_keys):
        provider_changes.append({
            "model": model, "provider": prov, "change": "removed",
        })

    # Price, speed, status changes on common keys
    price_changes = []
    speed_changes = []
    status_changes = []

    for key in sorted(common_keys):
        fe, le = first[key], last[key]
        model, prov = key

        # Price changes (>1% threshold)
        for field, idx in [("input", M_IN_PRICE), ("output", M_OUT_PRICE)]:
            old_val, new_val = fe[idx], le[idx]
            if old_val is not None and new_val is not None and old_val != new_val:
                pct = pct_change(old_val, new_val)
                if pct is not None and abs(pct) > 1.0:
                    price_changes.append({
                        "model": model, "provider": prov, "field": field,
                        "old": old_val, "new": new_val, "pct": pct,
                    })

        # Speed changes (>10% threshold)
        old_tok, new_tok = fe[M_TOKS], le[M_TOKS]
        if old_tok is not None and new_tok is not None and old_tok != new_tok:
            pct = pct_change(old_tok, new_tok)
            if pct is not None and abs(pct) > 10.0:
                speed_changes.append({
                    "model": model, "provider": prov,
                    "old": old_tok, "new": new_tok, "pct": pct,
                })

        # Status changes
        old_st, new_st = fe[M_STATUS], le[M_STATUS]
        if old_st != new_st:
            status_changes.append({
                "model": model, "provider": prov,
                "old": old_st, "new": new_st,
            })

    return {
        "models_added": models_added,
        "models_removed": models_removed,
        "provider_changes": provider_changes,
        "price_changes": price_changes,
        "speed_changes": speed_changes,
        "status_changes": status_changes,
    }


def compute_uptime(all_snapshots_entries):
    """Compute per-provider uptime across all snapshots.

    A provider is "live" in a snapshot if it has at least one entry with status "l".
    """
    provider_live_counts = defaultdict(int)
    provider_total_counts = defaultdict(int)

    for entries in all_snapshots_entries:
        # Collect all providers and whether they have a live entry
        providers_in_snap = defaultdict(bool)
        for e in entries:
            prov = e[M_PROV]
            if e[M_STATUS] == "l":
                providers_in_snap[prov] = True
            elif prov not in providers_in_snap:
                providers_in_snap[prov] = False

        for prov, is_live in providers_in_snap.items():
            provider_total_counts[prov] += 1
            if is_live:
                provider_live_counts[prov] += 1

    uptime = {}
    for prov in sorted(provider_total_counts):
        total = provider_total_counts[prov]
        live = provider_live_counts[prov]
        uptime[prov] = {
            "live_pct": round(live / total * 100, 1) if total > 0 else 0.0,
            "samples": total,
        }
    return uptime


def generate_report(week_str, year, week, snap_files, all_entries):
    """Generate the full report dict."""
    start, end = week_boundaries(year, week)

    first_entries = all_entries[0]
    last_entries = all_entries[-1]

    diff = diff_snapshots(first_entries, last_entries)
    uptime = compute_uptime(all_entries)

    summary = {
        "models_added": len(diff["models_added"]),
        "models_removed": len(diff["models_removed"]),
        "providers_added": sum(1 for pc in diff["provider_changes"] if pc["change"] == "added"),
        "providers_removed": sum(1 for pc in diff["provider_changes"] if pc["change"] == "removed"),
        "price_changes": len(diff["price_changes"]),
        "speed_changes": len(diff["speed_changes"]),
        "status_changes": len(diff["status_changes"]),
    }

    now = datetime.now(timezone.utc)

    return {
        "week": week_str,
        "period": {
            "from": start.isoformat(),
            "to": end.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        },
        "generated": now.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "snapshots_used": len(all_entries),
        "summary": summary,
        **diff,
        "uptime": uptime,
    }


def run_test():
    """Run with inline mock data and verify assertions."""
    # Mock snapshot entries: [model, provider, status, tok/s, latency_ms, in_price, out_price]
    snap_mon = [
        ["org/model-A", "provX", "l", 100.0, 50, 1.0, 2.0],
        ["org/model-B", "provX", "l", 80.0, 60, 1.5, 3.0],
        ["org/model-A", "provY", "l", 90.0, 55, 1.2, 2.5],
    ]

    snap_wed = [
        ["org/model-A", "provX", "l", 100.0, 50, 1.0, 1.0],  # output price 2.0 -> 1.0 (-50%)
        ["org/model-B", "provX", "l", 80.0, 60, 1.5, 3.0],
        ["org/model-A", "provY", "l", 90.0, 55, 1.2, 2.5],
        ["org/model-C", "provX", "l", 120.0, 40, 0.5, 1.0],  # new model
    ]

    snap_sun = [
        # model-B removed from provX
        ["org/model-A", "provX", "l", 150.0, 50, 1.0, 1.0],  # speed 100 -> 150 (+50%)
        ["org/model-A", "provY", "e", 90.0, 55, 1.2, 2.5],   # status l -> e
        ["org/model-C", "provX", "l", 120.0, 40, 0.5, 1.0],
    ]

    all_entries = [snap_mon, snap_wed, snap_sun]
    first = snap_mon
    last = snap_sun

    diff = diff_snapshots(first, last)
    uptime = compute_uptime(all_entries)

    errors = []

    # models_added = 1 (C is new across all providers)
    if len(diff["models_added"]) != 1:
        errors.append(f"models_added: expected 1, got {len(diff['models_added'])}")
    elif diff["models_added"][0]["model"] != "org/model-C":
        errors.append(f"models_added[0]: expected org/model-C, got {diff['models_added'][0]['model']}")

    # models_removed = 1 (B removed from all providers)
    if len(diff["models_removed"]) != 1:
        errors.append(f"models_removed: expected 1, got {len(diff['models_removed'])}")
    elif diff["models_removed"][0]["model"] != "org/model-B":
        errors.append(f"models_removed[0]: expected org/model-B, got {diff['models_removed'][0]['model']}")

    # provider_changes: B removed from provX, C added on provX
    pc = diff["provider_changes"]
    if len(pc) != 2:
        errors.append(f"provider_changes: expected 2, got {len(pc)}")
    else:
        added_pcs = [p for p in pc if p["change"] == "added"]
        removed_pcs = [p for p in pc if p["change"] == "removed"]
        if len(added_pcs) != 1 or added_pcs[0]["model"] != "org/model-C":
            errors.append(f"provider_changes added: expected C on provX, got {added_pcs}")
        if len(removed_pcs) != 1 or removed_pcs[0]["model"] != "org/model-B":
            errors.append(f"provider_changes removed: expected B on provX, got {removed_pcs}")

    # price_changes: A on provX output dropped 2.0 -> 1.0 = -50%
    if len(diff["price_changes"]) != 1:
        errors.append(f"price_changes: expected 1, got {len(diff['price_changes'])}")
    else:
        pc = diff["price_changes"][0]
        if pc["model"] != "org/model-A" or pc["provider"] != "provX":
            errors.append(f"price_changes[0]: wrong model/provider: {pc}")
        if pc["field"] != "output":
            errors.append(f"price_changes[0]: expected field=output, got {pc['field']}")
        if pc["pct"] != -50.0:
            errors.append(f"price_changes[0]: expected pct=-50.0, got {pc['pct']}")

    # speed_changes: A on provX 100 -> 150 = +50%
    if len(diff["speed_changes"]) != 1:
        errors.append(f"speed_changes: expected 1, got {len(diff['speed_changes'])}")
    else:
        sc = diff["speed_changes"][0]
        if sc["model"] != "org/model-A" or sc["provider"] != "provX":
            errors.append(f"speed_changes[0]: wrong model/provider: {sc}")
        if sc["pct"] != 50.0:
            errors.append(f"speed_changes[0]: expected pct=50.0, got {sc['pct']}")

    # status_changes: A on provY l -> e
    if len(diff["status_changes"]) != 1:
        errors.append(f"status_changes: expected 1, got {len(diff['status_changes'])}")
    else:
        stc = diff["status_changes"][0]
        if stc["model"] != "org/model-A" or stc["provider"] != "provY":
            errors.append(f"status_changes[0]: wrong model/provider: {stc}")
        if stc["old"] != "l" or stc["new"] != "e":
            errors.append(f"status_changes[0]: expected l->e, got {stc['old']}->{stc['new']}")

    # uptime: provX live in all 3 (100%), provY live in 2/3 (66.7%)
    if "provX" not in uptime:
        errors.append("uptime: missing provX")
    elif uptime["provX"]["live_pct"] != 100.0:
        errors.append(f"uptime provX: expected 100.0, got {uptime['provX']['live_pct']}")
    elif uptime["provX"]["samples"] != 3:
        errors.append(f"uptime provX samples: expected 3, got {uptime['provX']['samples']}")

    if "provY" not in uptime:
        errors.append("uptime: missing provY")
    elif uptime["provY"]["live_pct"] != 66.7:
        errors.append(f"uptime provY: expected 66.7, got {uptime['provY']['live_pct']}")
    elif uptime["provY"]["samples"] != 3:
        errors.append(f"uptime provY samples: expected 3, got {uptime['provY']['samples']}")

    if errors:
        print("FAIL")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)
    else:
        print("PASS (all assertions passed)")
        sys.exit(0)


def main():
    parser = argparse.ArgumentParser(description="Generate weekly report from snapshots")
    parser.add_argument("--week", help="ISO week (YYYY-WNN), default: previous week")
    parser.add_argument("--test", action="store_true", help="Run inline tests and exit")
    args = parser.parse_args()

    if args.test:
        run_test()
        return

    # Determine week
    if args.week:
        year, week = parse_week(args.week)
        week_str = args.week
    else:
        year, week = prev_iso_week()
        week_str = f"{year}-W{week:02d}"

    start, end = week_boundaries(year, week)
    print(f"Generating report for {week_str}")
    print(f"  Period: {start.date()} to {end.date()}")

    # Find snapshot files
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    snap_dir = os.path.join(root, "snapshots")
    files = find_snapshot_files(snap_dir, start, end)

    if len(files) < 2:
        print(f"  Found {len(files)} snapshot(s) -- need at least 2. Skipping.")
        sys.exit(1)

    print(f"  Found {len(files)} snapshots")

    # Load all snapshots
    all_entries = []
    for f in files:
        entries = load_snapshot(f)
        if entries:
            all_entries.append(entries)

    if len(all_entries) < 2:
        print(f"  Only {len(all_entries)} non-empty snapshot(s). Skipping.")
        sys.exit(1)

    # Generate report
    report = generate_report(week_str, year, week, files, all_entries)

    # Write output
    report_dir = os.path.join(snap_dir, "reports")
    os.makedirs(report_dir, exist_ok=True)
    out_path = os.path.join(report_dir, f"{week_str}.json")

    with open(out_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"  Wrote {out_path}")
    print(f"  Summary: +{report['summary']['models_added']} models, "
          f"-{report['summary']['models_removed']} models, "
          f"{report['summary']['price_changes']} price changes, "
          f"{report['summary']['speed_changes']} speed changes")


if __name__ == "__main__":
    main()
