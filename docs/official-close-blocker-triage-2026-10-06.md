# Official identity/status triage for the fourteen Oct 5 close blockers

Read-only research observed October 6, 2026. No source rows, universe membership,
prices, provider requests, exclusion policy or website were changed. Exact
URLs, event dates and class/CIK/CUSIP identifiers are recorded in the adjacent
`financial-source-evidence/official-close-blocker-triage-2026-10-06.json`.

The fourteen missing/stale closes are not one undifferentiated acquisition
failure. Official evidence supports nine retired original issues and five
continuing securities with ticker/venue changes. None should receive fabricated
Oct 5 closes; continuing instruments must not silently disappear from coverage.

| Prior symbol | Official effective evidence | Review proposal |
|---|---|---|
| LBRDA / LBRDK | Nasdaq identifies separate Class A/Class C CUSIPs and last trading Aug 19; merger closed Aug 20, formal suspension Aug 21. [Exchange notice](https://www.nasdaqtrader.com/TraderNews.aspx?id=ECA2026-577) | Dated retirement of original issues. Quarantine the retained LBRDA Aug 21 bar, later than the official last trading date. |
| EA | Common stock last traded Aug 4; suspension Aug 5. [Nasdaq](https://www.nasdaqtrader.com/TraderNews.aspx?id=ECA2026-545) | Dated retirement, no Oct 5 EA fetch. |
| APGE | Common stock last traded Sep 2; merger closed Sep 3; suspension Sep 4. [Nasdaq](https://www.nasdaqtrader.com/TraderNews.aspx?id=ECA2026-607) | Dated retirement; distinguish unrelated APOG. |
| CRNX | Last traded Aug 31; merger closed Sep 1; suspension Sep 2. [Nasdaq](https://www.nasdaqtrader.com/TraderNews.aspx?id=ECA2026-628) | Dated retirement, no replacement with VRTX prices. |
| KALV | Last traded Jun 10; merger closed Jun 11; formal suspension Jun 12. [Nasdaq](https://nasdaqtrader.com/TraderNews.aspx?id=ECA2026-390) | Dated retirement, keeping last-trade and formal-suspension dates distinct. |
| NUVL | Class A shares last traded Jul 14; merger closed Jul 15; suspension Jul 16. [Nasdaq](https://www.nasdaqtrader.com/TraderNews.aspx?id=ECA2026-493) | Dated retirement, no replacement with GSK. |
| TWO | Common shares cancelled in completed Aug 25 merger; filing requests pre-open suspension that day. [Issuer 8-K](https://www.sec.gov/Archives/edgar/data/1465740/000110465926100622/tm2621794d1_8k.htm) | Retire common issue only; preferred stock/notes are separate securities. |
| WBS | Aug 20 completed acquisition, common shares exchanged, pre-open NYSE withdrawal requested. [Issuer 8-K](https://www.sec.gov/Archives/edgar/data/801337/000119312526357758/d919931d8k.htm) | Dated common-stock retirement; do not splice consideration into historical prices. |
| EQR | SEC CIK 906107 continued as Vivmark; common shares continue under VMRK from Aug 18, with existing certificates valid. [Issuer 8-K](https://www.sec.gov/Archives/edgar/data/906107/000114036126033377/ef20080318_8k.htm) | Review dated ticker/issuer continuity. Keep covered; target VMRK after mapping review. |
| AXIA | Common ADR CUSIP 15234Q207/ISIN US15234Q2075 left NYSE Aug 6 and continued OTC as AXIAY Aug 7. [Citi depositary](https://depositaryreceipts.citi.com/adr/guides/pgm_d.aspx?cusip=15234Q207&pageId=16&subpageID=104&typeDisplay=A) | Review exit from a listed-exchange universe; this is not global nontrading. No substitution with Brazilian AXIA3 or preferred ADSs. |
| ET / SUN | SEC filings identify the common units; TXSE confirms the primary-listing move on Oct 5. [Exchange completion](https://www.txse.com/press/texas-stock-exchange-celebrates-move-of-energy-transfer-partnership-s-primary-listings) | Keep required; review dated venue and provider mapping, preserving separate preferred/SUNC identities. |
| DDS | SEC registration and TXSE notice identify Class A common stock with primary transfer scheduled Oct 5. [Registration](https://www.sec.gov/Archives/edgar/data/28917/000110465926111370/tm2626135d1_8a12b.htm), [exchange notice](https://www.txse.com/alerts/adbdaf8a-27af-4643-9e6a-c0655cf92561) | Keep required; confirm effective mapping and Oct 5 observation. DDT is a different security. |

TXSE's actual exchange MIC is **TXSE**, distinct from NYSE Texas. Its official
[identifier page](https://www.txse.com/regulations/id-codes) establishes this;
the current repository US catalog enumerates only XNYS, XNAS and XASE. This
is a concrete mapping gap to investigate. The timing is consistent with the
three Oct 5 omissions, but no provider or ingestion telemetry was newly fetched
to establish whether omission, mapping or ingress rejection caused each one.

AXIA illustrates why static profile pages are insufficient: its issuer FAQ
still displays the old NYSE ticker, while the dated issuer/regulator notice and
depositary milestone identify the later OTC transition. Announced transactions
alone were not treated as closed; the retirement proposals above use updated
exchange or completed-transaction filings.

The next bounded price work is therefore four continuing listed instruments
(ET, SUN, DDS and VMRK after identity mapping), plus an explicit scope decision
for AXIAY OTC. Before any request, inspect retained rejection telemetry and bind
the official identities/class transitions. If separately approved, request only
completed Oct 5 bars, exclude Oct 6 intraday bars, and preserve actual Oct 6
retrieval time. Financial current-knowledge clocks remain separate. No mass
universe refetch is justified by these fourteen records.

Nine retirement records and the AXIA universe exit still require a reviewed,
dated cohort-transition contract before altering the protected cohort. EQR and
the three venue transfers require continuity records, not exclusions. Preserve
all prior historical/audit rows. Rerun old/new membership, instrument identity,
session/price equality and technical eligibility after any approved repair.
The 37 short supplied histories remain a separate technical-history limitation;
they already have valid current closes and are not part of these fourteen.
