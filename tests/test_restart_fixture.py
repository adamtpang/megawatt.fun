import importlib.util
from pathlib import Path
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

spec = importlib.util.spec_from_file_location('fixture', Path(__file__).resolve().parents[1] / 'demo/dispatch-bench/restart_fixture.py')
F = importlib.util.module_from_spec(spec)
spec.loader.exec_module(F)


class RestartContract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='megawatt-contract-')
        self.directory = Path(self.tmp.name)
        F.initialize(self.directory)

    def tearDown(self):
        self.tmp.cleanup()

    def test_actual_process_death_and_reopen_at_every_boundary(self):
        report = F.report()
        self.assertEqual(report['passed'], report['total'])
        self.assertEqual(report['total'], 6)
        for case in report['cases']:
            self.assertEqual(case['durable']['first_exit'], 0 if case['fault'] == 'none' else 86)
            self.assertLessEqual(case['durable']['applications'], 1)
        gap = next(c for c in report['cases'] if c['fault'] == 'after_action')
        self.assertEqual(gap['baseline']['applications'], 2)
        self.assertEqual(gap['durable']['applications'], 1)
        self.assertEqual(gap['durable']['retry'], 'reconciliation required')

    def test_same_id_with_changed_payload_never_applies(self):
        self.assertEqual(F.worker(self.directory, 'durable'), 'applied')
        command = dict(F.COMMAND, kwh=3)
        self.assertEqual(F.worker(self.directory, 'durable', command), 'identity conflict')
        self.assertEqual(F.snapshot(self.directory)['applications'], 1)

    def test_expiry_and_missing_freshness_have_no_effect(self):
        for now, telemetry in [(20, 20), (9, 9), (12, 10), (12, 13)]:
            with self.subTest(now=now, telemetry=telemetry):
                self.assertIn(F.worker(self.directory, 'durable', now=now, telemetry_at=telemetry), ['expired', 'stale'])
        self.assertEqual(F.snapshot(self.directory)['applications'], 0)

    def test_concurrent_same_command_claims_one_action(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            outcomes = [r['outcome'] for r in pool.map(lambda _: F.launch(self.directory, 'durable'), range(8))]
        self.assertEqual(outcomes.count('applied'), 1)
        self.assertEqual(F.snapshot(self.directory)['applications'], 1)

    def test_both_modes_share_reserve_and_loss_constraints(self):
        for i in range(15):
            F.worker(self.directory, 'durable', dict(F.COMMAND, id=f'cmd-{i}'))
        state = F.snapshot(self.directory)
        self.assertGreaterEqual(state['stored_kwh'], 7.5)
        self.assertAlmostEqual(state['exported_kwh'], (20 - 7.5) * (.88 ** .5), places=7)

    def test_invalid_payload_cannot_touch_actuator(self):
        for command in [dict(F.COMMAND, kwh=float('nan')), dict(F.COMMAND, kwh=True), dict(F.COMMAND, device='another-device')]:
            with self.assertRaises(ValueError):
                F.worker(self.directory, 'durable', command)
        self.assertEqual(F.snapshot(self.directory)['applications'], 0)


if __name__ == '__main__':
    unittest.main()
