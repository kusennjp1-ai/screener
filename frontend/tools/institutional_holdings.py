"""SEC 13F reported-manager counts. No share-change or fund-count proxy.

Only public filings through a stated cutoff are used. Restatements replace a
report; NEW HOLDINGS amendments add to it. CIK is the reporting-manager unit,
not a fund, parent-company family, or a claim about unreported positions.
"""
from collections import defaultdict
from datetime import datetime
import csv
import io
import zipfile


def iso(value):
    for fmt in ("%d-%b-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except (ValueError, TypeError):
            pass
    return None


def table(archive, name):
    with archive.open(name + ".tsv") as stream:
        yield from csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig"), delimiter="\t")


def select_reports(submissions, covers, cutoff, periods):
    groups = defaultdict(list)
    for accession, sub in submissions.items():
        cover = covers.get(accession, {})
        period, filed = iso(sub.get("PERIODOFREPORT")), iso(sub.get("FILING_DATE"))
        if period not in periods or not filed or filed > cutoff or not sub.get("CIK"):
            continue
        if sub.get("SUBMISSIONTYPE") not in ("13F-HR", "13F-HR/A"):
            continue
        groups[(sub["CIK"].lstrip("0"), period)].append((filed, accession, cover))
    selected, incomplete = {}, []
    for key, versions in groups.items():
        active = []
        for filed, accession, cover in sorted(versions):
            amendment = str(cover.get("ISAMENDMENT", "")).lower() in ("y", "true", "1")
            kind = cover.get("AMENDMENTTYPE", "").upper()
            if not amendment or kind == "RESTATEMENT":
                active = [(accession, filed)]
            elif kind == "NEW HOLDINGS" and active:
                active.append((accession, filed))
            else:
                active = []
        if not active:
            incomplete.append(key)
        for accession, filed in active:
            selected[accession] = (*key, filed)
    return selected, incomplete


def aggregate_archives(paths, cutoff, periods):
    submissions, covers = {}, {}
    for path in paths:
        with zipfile.ZipFile(path) as archive:
            submissions.update((r["ACCESSION_NUMBER"], r) for r in table(archive, "SUBMISSION"))
            covers.update((r["ACCESSION_NUMBER"], r) for r in table(archive, "COVERPAGE"))
    selected, incomplete = select_reports(submissions, covers, cutoff, periods)
    holdings, issuers, dates, sources = defaultdict(set), {}, defaultdict(set), defaultdict(set)
    seen = set()
    for path in paths:
        with zipfile.ZipFile(path) as archive:
            for row in table(archive, "INFOTABLE"):
                accession = row["ACCESSION_NUMBER"]
                if accession not in selected or row.get("PUTCALL") or row.get("SSHPRNAMTTYPE") != "SH":
                    continue
                try:
                    positive = float(row["SSHPRNAMT"]) > 0
                except (ValueError, TypeError):
                    positive = False
                cusip = row.get("CUSIP", "").upper().strip()
                if not positive or len(cusip) != 9:
                    continue
                cik, period, filed = selected[accession]
                identity = (accession, cusip)
                if identity in seen:
                    continue
                seen.add(identity)
                holdings[(cusip, period)].add(cik)
                dates[(cusip, period)].add(filed)
                sources[(cusip, period)].add(accession)
                issuers.setdefault(cusip, {"name": row["NAMEOFISSUER"], "class": row["TITLEOFCLASS"]})
    result = {}
    for cusip, issuer in issuers.items():
        observations = []
        for period in sorted(periods):
            key = (cusip, period)
            # No reported holdings is unknown, not a fabricated zero.
            if key not in holdings:
                continue
            observations.append({"period": period, "manager_count": len(holdings[key]),
                                 "filing_date_first": min(dates[key]), "filing_date_last": max(dates[key]),
                                 "filings": sorted(sources[key])})
        result[cusip] = {**issuer, "observations": observations}
    return {"publication_cutoff": cutoff, "periods": sorted(periods), "securities": result,
            "reports_selected": len(selected), "incomplete_manager_periods": len(incomplete)}


def retain_reported_history(current, previous):
    """Keep older observations with their own cutoff and exact CUSIP/class identity.

    Current observations remain authoritative for the existing latest-two rule.
    Missing current periods never borrow an older observation for that rule.
    """
    for cusip, value in current.get("securities", {}).items():
        observations = [dict(o, publication_cutoff=current["publication_cutoff"])
                        for o in value["observations"]]
        old = previous.get("securities", {}).get(cusip)
        compatible = old and old.get("class") == value.get("class") and old.get("name") == value.get("name")
        earliest = min(current.get("periods", []), default="")
        retained = []
        if compatible:
            for observation in old.get("history", old.get("observations", [])):
                if observation["period"] < earliest:
                    retained.append(dict(observation, publication_cutoff=observation.get("publication_cutoff", previous.get("publication_cutoff"))))
        value["history"] = sorted(retained + observations, key=lambda o: o["period"])
    return current
