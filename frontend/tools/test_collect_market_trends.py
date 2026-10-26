import importlib.util
import json
from pathlib import Path
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.error import URLError

spec = importlib.util.spec_from_file_location('collector', Path(__file__).with_name('collect-market-trends.py'))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

def page(day='2026-10-23', calls=100, puts=75, ratio='.75'):
    value = {'optionsData': {'ratios': [{'name': 'TOTAL PUT/CALL RATIO', 'value': ratio}], 'SUM OF ALL PRODUCTS': [{'name': 'VOLUME', 'call': calls, 'put': puts, 'total': calls+puts}]}, 'selectedDate': day}
    text = '25:' + json.dumps(['$', '$L1', None, {'data': value}]) + '\n'
    parts = [text[:70], text[70:]]
    return ''.join('<script>self.__next_f.push('+json.dumps([1, part])+')</script>' for part in parts).encode()

class CollectorTests(unittest.TestCase):
    def test_join_json_frames_and_verify_total_volume(self):
        self.assertEqual(collector.parse_cboe(page(), '2026-10-23'), {'date':'2026-10-23', 'calls':100, 'puts':75, 'reported_ratio':.75})

    def test_ignored_date_and_wrong_ratio_fail_closed(self):
        for raw in [page(day='2026-10-22'), page(ratio='1.5'), page(calls=0)]:
            with self.assertRaises(ValueError):
                collector.parse_cboe(raw, '2026-10-23')

    def test_real_zero_put_volume_is_not_unknown(self):
        self.assertEqual(collector.parse_cboe(page(puts=0, ratio='0.00'), '2026-10-23')['puts'], 0)

    def test_schema_change_is_not_silently_accepted(self):
        with self.assertRaises(ValueError):
            collector.parse_cboe(b'<html>no dated records</html>', '2026-10-23')

    def test_failure_preserves_previous_dates_without_manufacturing_current_values(self):
        source = json.loads((Path(__file__).parent.parent/'data/market-trend-source-2026-10-23.json').read_text(encoding='utf-8'))
        source['as_of_date'] = '2026-10-22'
        source['calendar']['sessions'] = source['calendar']['sessions'][:-1]
        for index in source['indices']:
            index['bars'] = index['bars'][:-1]
        source['put_call']['observations'] = source['put_call']['observations'][:-1]
        with TemporaryDirectory(prefix='market-trend-test-') as directory:
            output = Path(directory)/'source.json'
            output.write_text(json.dumps(source),encoding='utf-8')
            before = output.read_bytes()
            with patch.object(collector, 'fetch', side_effect=URLError('test unavailable')):
                with self.assertRaises(URLError):
                    collector.collect('2026-10-23', output, allow_unavailable=False)
                self.assertEqual(output.read_bytes(), before)
                collector.collect('2026-10-23', output, allow_unavailable=True)
            result = json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(result['indices'][0]['bars'][-1]['date'], '2026-10-22')
            self.assertTrue(result['indices'][0]['retained_after_fetch_failure'])
            self.assertEqual(result['put_call']['observations'][-2]['calls'], source['put_call']['observations'][-1]['calls'])
            self.assertIsNone(result['put_call']['observations'][-1]['calls'])
            self.assertIsNone(result['put_call']['observations'][-1]['puts'])

if __name__ == '__main__':
    unittest.main()
