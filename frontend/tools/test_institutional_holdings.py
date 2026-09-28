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


if __name__=='__main__':unittest.main()
