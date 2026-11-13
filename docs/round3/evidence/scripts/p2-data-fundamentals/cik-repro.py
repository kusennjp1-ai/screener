"""Reproduce the published invalid_payload signature with the shipped 8849bf9 sec-financials.py (path in argv[1])."""
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("sec", sys.argv[1]); sec = importlib.util.module_from_spec(spec); spec.loader.exec_module(sec)
ent = {"start": "2025-04-01", "end": "2025-06-30", "filed": "2025-08-01", "val": 1.0, "form": "10-Q", "accn": "a1"}
body = lambda **kw: {**kw, "facts": {"us-gaap": {"EarningsPerShareDiluted": {"units": {"USD/shares": [ent]}}}}}
cases = [("str_padded", 6, body(cik="0000000006")), ("str_plain", 6, body(cik="6")), ("missing", 6, body()), ("null", 6, body(cik=None)),
         ("int_other", 6, body(cik=999)), ("int_same", 6, body(cik=6)), ("float_same", 6, body(cik=6.0)), ("bool_true_cik1", 1, body(cik=True))]
for name, cik, payload in cases:
    r = sec.fetch_symbol("SYM", {"SYM": cik}, "2026-11-12", get=lambda url, p=payload: p)
    print(f"{name:15} status={r.get('status'):11} reason={r.get('reason')} cause={sec.invalid_cause(r) if r.get('reason') else None} invalid_detail={json.dumps(r.get('invalid_detail'))}")
