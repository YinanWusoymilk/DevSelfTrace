"""Convert DevSelfTrace v1 annotation files to the v2 format.

v1 files look like {"logs": [{"ID", "Timestamps": {"start", "end"}, "TimeInState",
"Label1", "Label2", "Label3"}]} and were written by DevSelfTrace 1 (used in the
FSE'26 study). v2 files store one key per dimension of the label set:
{"tool", "schemaVersion": 2, "labelset", "intervals": [{"id", "start", "end",
"duration", "intention", "actions": [{"action", "tool"}], "emotion"}]}.

The page converts a v1 file by itself when it opens one (same rules as here,
see convertV1 in app_study/static/core.js); this script converts many files at once.

Usage:
    python scripts/convert_v1_to_v2.py p01.json p02.json --out-dir converted/
    python scripts/convert_v1_to_v2.py old.json -o new.json --labels labels/cups.json

Without -o/--out-dir, p01.json is written to p01.v2.json next to it. Inputs are
never modified, and existing outputs are not replaced unless --force is given.
"""
import argparse
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_LABELS = os.path.join(ROOT, "labels", "s-iase.json")
SCHEMA_VERSION = 2


def is_text(value):
    return isinstance(value, str) and value.strip() != ""


def option_values(options):
    return {option if isinstance(option, str) else option.get("value") for option in options or []}


def split_pair(text, dimension):
    """Split "A, T" into its two fields. Custom labels may contain ", ", so prefer the split
    where the first part is a known first-field option, else where the second part is a known
    second-field option (or "null"), else the last ", ". Returns (parts, ambiguous)."""
    fields = dimension["fields"]
    first_known = option_values(fields[0].get("options"))
    second_known = option_values(fields[1].get("options"))
    cuts = []
    i = text.find(", ")
    while i != -1:
        cuts.append(i)
        i = text.find(", ", i + 1)
    if not cuts:
        return [text, None], False
    for i in cuts:
        if text[:i] in first_known:
            return [text[:i], text[i + 2:]], False
    for i in cuts:
        second = text[i + 2:]
        if second == "null" or second in second_known:
            return [text[:i], second], False
    i = cuts[-1]
    return [text[:i], text[i + 2:]], len(cuts) > 1


def parse_pairs(text, dimension):
    """Parse "([A, T]; [A2, T2])" into [{field0: A, field1: T}, ...]. Returns (pairs, ambiguous)."""
    pairs, ambiguous = [], []
    if not is_text(text) or text == "N/A":
        return pairs, ambiguous
    body = text.strip()
    if body.startswith("(") and body.endswith(")"):
        body = body[1:-1].strip()
    if body.startswith("["):
        body = body[1:]
    if body.endswith("]"):
        body = body[:-1]
    if body == "":
        return pairs, ambiguous
    for pair_text in body.split("]; ["):
        parts, is_ambiguous = split_pair(pair_text, dimension)
        pair = {}
        for field, value in zip(dimension["fields"], parts):
            pair[field["id"]] = None if value in (None, "", "null") else value
        pairs.append(pair)
        if is_ambiguous:
            ambiguous.append((pair_text, pair))
    return pairs, ambiguous


def as_number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else float(value)


def convert(data, labelset):
    """Convert a v1 session (dict) with the label set its logs were made with.
    Returns (v2 session, list of warnings)."""
    if not isinstance(data, dict) or not isinstance(data.get("logs"), list) or "intervals" in data:
        raise ValueError("not a DevSelfTrace v1 file (expected an object with a \"logs\" list)")
    warnings = []
    session = {"tool": "DevSelfTrace", "schemaVersion": SCHEMA_VERSION}
    if isinstance(data.get("revision"), int):
        session["revision"] = data["revision"]
    session["labelset"] = labelset
    intervals, seen, need_new_id = [], set(), []

    for n, log in enumerate(data["logs"], start=1):
        timestamps = log.get("Timestamps") or {}
        start, end = as_number(timestamps.get("start")), as_number(timestamps.get("end"))
        interval = {"id": log.get("ID"), "start": start, "end": end, "duration": round(end - start, 3)}
        for i, dim in enumerate(labelset["dimensions"]):
            raw = log.get(f"Label{i + 1}")
            if dim["type"] == "pairs":
                pairs, ambiguous = parse_pairs(raw, dim)
                interval[dim["id"]] = pairs or None
                for pair_text, pair in ambiguous:
                    reading = " + ".join(f'{field["label"].lower()} "{pair[field["id"]]}"' for field in dim["fields"])
                    warnings.append(f'Log {log.get("ID")}: "[{pair_text}]" can be split more than one way; read as {reading}.')
            else:
                interval[dim["id"]] = raw if is_text(raw) and raw != "N/A" else None
        if not isinstance(interval["id"], int) or isinstance(interval["id"], bool) or interval["id"] in seen:
            need_new_id.append(interval)
            warnings.append(f'Log {n} (ID {json.dumps(log.get("ID"))}) had a missing or repeated ID; it was given a new one.')
        else:
            seen.add(interval["id"])
        intervals.append(interval)

    max_id = max(seen, default=0)
    for interval in need_new_id:
        max_id += 1
        interval["id"] = max_id
    intervals.sort(key=lambda interval: (interval["start"], interval["id"]))
    session["lastId"] = max_id  # highest ID given so far; new intervals continue from here
    session["intervals"] = intervals
    return session, warnings


def output_path(input_path, args):
    if args.output:
        return args.output
    root, _ = os.path.splitext(os.path.basename(input_path))
    if args.out_dir:
        return os.path.join(args.out_dir, f"{root}.json")
    return os.path.join(os.path.dirname(input_path), f"{root}.v2.json")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Convert DevSelfTrace v1 annotation files to v2.")
    parser.add_argument("inputs", nargs="+", help="v1 JSON files")
    parser.add_argument("-o", "--output", help="output file (only with a single input)")
    parser.add_argument("--out-dir", help="write converted files into this folder")
    parser.add_argument("-l", "--labels", help="label set the files were annotated with, if they do not name one "
                                               "(default: labels/s-iase.json)")
    parser.add_argument("--force", action="store_true", help="replace existing output files")
    args = parser.parse_args(argv)
    if args.output and len(args.inputs) > 1:
        parser.error("-o/--output works with a single input; use --out-dir for several")

    with open(args.labels or DEFAULT_LABELS, encoding="utf-8") as f:
        default_labelset = json.load(f)
    if args.out_dir:
        os.makedirs(args.out_dir, exist_ok=True)

    failed = 0
    for input_path in args.inputs:
        target = output_path(input_path, args)
        try:
            if os.path.abspath(target) == os.path.abspath(input_path):
                raise ValueError("the output would replace the input")
            if os.path.exists(target) and not args.force:
                raise ValueError(f"{target} exists (use --force to replace it)")
            with open(input_path, encoding="utf-8") as f:
                data = json.load(f)
            labelset = data.get("labelset") if isinstance(data, dict) and isinstance(data.get("labelset"), dict) else default_labelset
            session, warnings = convert(data, labelset)
            with open(target, "w", encoding="utf-8") as f:
                json.dump(session, f, indent=4, ensure_ascii=False)
                f.write("\n")
        except (OSError, ValueError) as error:
            failed += 1
            print(f"{input_path}: not converted: {error}", file=sys.stderr)
            continue
        print(f"{input_path} -> {target} ({len(session['intervals'])} intervals)")
        for warning in warnings:
            print(f"  note: {warning}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
