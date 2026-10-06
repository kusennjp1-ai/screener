import unittest
from institutional_holdings import select_reports, aggregate_archives
from unittest.mock import patch


class ReportsTest(unittest.TestCase):
    def setUp(self):
        self.submissions = {
            'base':{'CIK':'000123','PERIODOFREPORT':'31-MAR-2026','FILING_DATE':'01-MAY-2026','SUBMISSIONTYPE':'13F-HR'},
            'add':{'CIK':'000123','PERIODOFREPORT':'31-MAR-2026','FILING_DATE':'02-MAY-2026','SUBMISSIONTYPE':'13F-HR/A'},
            'replace':{'CIK':'000123','PERIODOFREPORT':'31-MAR-2026','FILING_DATE':'03-MAY-2026','SUBMISSIONTYPE':'13F-HR/A'},
        }
        self.covers={'base':{},'add':{'ISAMENDMENT':'Y','AMENDMENTTYPE':'NEW HOLDINGS'},'replace':{'ISAMENDMENT':'Y','AMENDMENTTYPE':'RESTATEMENT'}}

    def test_no_future_restatement(self):
        selected,missing=select_reports(self.submissions,self.covers,'2026-05-02',['2026-03-31'])
        self.assertEqual(set(selected),{'base','add'});self.assertFalse(missing)

    def test_restatement_replaces_entire_report(self):
        selected,_=select_reports(self.submissions,self.covers,'2026-05-03',['2026-03-31'])
        self.assertEqual(set(selected),{'replace'})
        self.assertEqual(selected['replace'][0],'123')

    def test_orphan_addition_is_unknown(self):
        selected,missing=select_reports({'add':self.submissions['add']},self.covers,'2026-05-03',['2026-03-31'])
        self.assertFalse(selected);self.assertEqual(len(missing),1)

    def test_notice_and_future_period_are_not_holdings(self):
        self.submissions['notice']={**self.submissions['base'],'SUBMISSIONTYPE':'13F-NT'}
        selected,_=select_reports(self.submissions,self.covers,'2026-05-01',['2026-03-31'])
        self.assertEqual(set(selected),{'base'})

    def test_count_is_managers_not_rows_shares_or_funds(self):
        submission=[dict(ACCESSION_NUMBER='a',CIK='000123',PERIODOFREPORT='31-MAR-2026',FILING_DATE='01-MAY-2026',SUBMISSIONTYPE='13F-HR')]
        holding=dict(ACCESSION_NUMBER='a',PUTCALL='',SSHPRNAMTTYPE='SH',SSHPRNAMT='10',CUSIP='007903107',NAMEOFISSUER='AMD',TITLEOFCLASS='COM')
        tables={'SUBMISSION':submission,'COVERPAGE':[], 'INFOTABLE':[holding,{**holding,'SSHPRNAMT':'99999'},{**holding,'PUTCALL':'PUT'},{**holding,'SSHPRNAMTTYPE':'PRN'}]}
        with patch('institutional_holdings.zipfile.ZipFile'),patch('institutional_holdings.table',side_effect=lambda archive,name:iter(tables[name])):
            result=aggregate_archives(['file.zip'],'2026-08-31',['2026-03-31','2026-06-30'])
        observations=result['securities']['007903107']['observations']
        self.assertEqual(len(observations),1)  # Missing quarter remains missing.
        self.assertEqual(observations[0]['manager_count'],1)




class RetainedHistoryTest(unittest.TestCase):
    def test_retains_older_quarters_without_changing_current_pair(self):
        from institutional_holdings import retain_reported_history
        previous = {"publication_cutoff": "2026-05-31", "securities": {"123456789": {"name": "A", "class": "COM", "observations": [{"period": "2025-12-31", "manager_count": 2}, {"period": "2026-03-31", "manager_count": 3}]}}}
        current = {"publication_cutoff": "2026-08-31", "periods": ["2026-03-31", "2026-06-30"], "securities": {"123456789": {"name": "A", "class": "COM", "observations": [{"period": "2026-03-31", "manager_count": 4}, {"period": "2026-06-30", "manager_count": 5}]}}}
        result = retain_reported_history(current, previous)["securities"]["123456789"]
        assert [o["manager_count"] for o in result["observations"]] == [4, 5]
        assert [o["manager_count"] for o in result["history"]] == [2, 4, 5]
        assert result["history"][0]["publication_cutoff"] == "2026-05-31"
        assert result["history"][1]["publication_cutoff"] == "2026-08-31"


    def test_class_changes_or_missing_current_periods_do_not_borrow_old_counts(self):
        from institutional_holdings import retain_reported_history
        previous = {"publication_cutoff": "2026-05-31", "securities": {"123456789": {"name": "A", "class": "COM", "observations": [{"period": "2025-12-31", "manager_count": 2}]}}}
        current = {"publication_cutoff": "2026-08-31", "periods": ["2026-03-31", "2026-06-30"], "securities": {"123456789": {"name": "A", "class": "CLASS B", "observations": [{"period": "2026-06-30", "manager_count": 5}]}}}
        result = retain_reported_history(current, previous)["securities"]["123456789"]
        assert len(result["history"]) == 1
        assert len(result["observations"]) == 1


class ExportProjectionTest(unittest.TestCase):
    def test_missing_latest_requested_quarter_is_not_replaced_by_older_history(self):
        import importlib.util
        from pathlib import Path
        spec = importlib.util.spec_from_file_location('institutional_export', Path(__file__).with_name('export-institutional.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        observations = [
            {'period': '2025-12-31', 'manager_count': 100, 'filing_date_first': '2026-01-10', 'filing_date_last': '2026-02-15'},
            {'period': '2026-03-31', 'manager_count': 110, 'filing_date_first': '2026-04-10', 'filing_date_last': '2026-05-15'},
        ]
        result = module.project_security_evidence('AAA', '123456789', {'observations': observations},
                                                  ['2025-12-31', '2026-03-31', '2026-06-30'], '2026-08-31',
                                                  '2026-09-25T22:00:00Z', {}, '2026-09-25')
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(result['requested_periods'], ['2026-03-31', '2026-06-30'])
        self.assertEqual([o['period'] for o in result['observations']], ['2026-03-31'])
        self.assertEqual(len(result['history']), 2)
        self.assertIsNone(result['manager_delta'])
        observations.append({'period': '2026-06-30', 'manager_count': 120, 'filing_date_first': '2026-07-10', 'filing_date_last': '2026-08-15'})
        complete = module.project_security_evidence('AAA', '123456789', {'observations': observations},
                                                    ['2025-12-31', '2026-03-31', '2026-06-30'], '2026-08-31',
                                                    '2026-09-25T22:00:00Z', {}, '2026-09-25')
        self.assertEqual(complete['status'], 'available')
        self.assertEqual([o['manager_count'] for o in complete['observations']], [110, 120])
        self.assertEqual(len(complete['history']), 3)

if __name__=='__main__':unittest.main()
