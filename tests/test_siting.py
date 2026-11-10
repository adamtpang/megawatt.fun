"""Parsers for the siting snapshot. No network."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_siting as siting


class SitingParseTest(unittest.TestCase):
    def test_diurnal_spread_keeps_a_negative_day(self):
        rows = []
        for day, charge, discharge in (("2026-01-01", 10, 30), ("2026-01-02", 40, 20)):
            for hour in (11, 12, 13, 14):
                rows.append((day, hour, charge))
            for hour in (20, 21):
                rows.append((day, hour, discharge))
        out = siting.summarize_hourly(rows)
        self.assertEqual(out["days"], 2)
        self.assertEqual(out["diurnal"], 0)
        self.assertEqual(out["negativeDays"], 1)
        self.assertEqual(out["daily"][0]["spread"], 20)
        self.assertEqual(out["daily"][1]["spread"], -20)

    def test_incomplete_clock_is_dropped(self):
        rows = [( "2026-01-01", hour, 1) for hour in (11, 12, 13, 20, 21)]
        out = siting.summarize_hourly(rows)
        self.assertEqual(out["days"], 0)
        self.assertIsNone(out["diurnal"])

    def test_duplicate_hour_is_averaged(self):
        rows = [
            ("2026-01-01", 11, 0),
            ("2026-01-01", 11, 20),
        ]
        for hour in (12, 13, 14):
            rows.append(("2026-01-01", hour, 10))
        for hour in (20, 21):
            rows.append(("2026-01-01", hour, 20))
        out = siting.summarize_hourly(rows)
        self.assertEqual(out["days"], 1)
        self.assertAlmostEqual(out["daily"][0]["charge"], 10)

    def test_territory_flags(self):
        dereg, retail, noi = siting.territory_flag([], ["centerpoint"])
        self.assertEqual(dereg, "deregulated")
        self.assertEqual(retail, ["centerpoint"])
        self.assertEqual(noi, [])
        coop, _retail, noi = siting.territory_flag(
            [{"name": "Austin Energy", "ownership": "Municipal"}], []
        )
        self.assertEqual(coop, "coop_muni")
        self.assertEqual(noi, ["Austin Energy"])
        split, _retail, noi = siting.territory_flag(
            [{"name": "Pedernales Electric Coop", "ownership": "Cooperative"}],
            ["oncor"],
        )
        self.assertEqual(split, "split")
        opted, _retail, noi = siting.territory_flag(
            [{"name": "City of Lubbock - (TX)", "ownership": "Municipal"}],
            ["lpl"],
        )
        self.assertEqual(opted, "deregulated")
        self.assertEqual(noi, [])
        unknown, _retail, _noi = siting.territory_flag([], [])
        self.assertEqual(unknown, "unknown")

    def test_acs_owner_occupied_one_unit(self):
        text = "\n".join([
            "GEO_ID|NAME|B25032_003E|B25032_004E",
            "1400000US48201540100|Census Tract 5401|10|2",
            "1400000US48201540101|Census Tract 5401.01|-666666666|3",
            "860Z200US77002|ZCTA5 77002|4|1",
            "1400000US06001400100|California tract|9|9",
        ])
        path = Path(self.id().replace(".", "_") + ".acs")
        # parse_acs reads a path; use a temp file via the function's decoder by writing bytes.
        import tempfile
        with tempfile.NamedTemporaryFile("wb", suffix=".dat", delete=False) as handle:
            handle.write(text.encode())
            name = handle.name
        try:
            tracts, zctas, delimiter = siting.parse_acs(Path(name))
        finally:
            Path(name).unlink()
        self.assertEqual(delimiter, "|")
        by_id = {row["geoid"]: row for row in tracts}
        self.assertEqual(set(by_id), {"48201540100", "48201540101"})
        self.assertEqual(by_id["48201540100"]["countyGeoid"], "48201")
        self.assertEqual(by_id["48201540100"]["singleFamily"], 12)
        self.assertIsNone(by_id["48201540101"]["singleFamily"])
        self.assertEqual(zctas["77002"]["singleFamily"], 5)
        self.assertNotIn("06001400100", by_id)

    def test_settlement_point_row(self):
        import io
        import zipfile
        body = "ResourceNode,SettlementLoadZone,Substation,VoltageLevel\nCR_RN,HOUSTON,WAP,\nHB_HOUSTON,,,\n"
        blob = io.BytesIO()
        with zipfile.ZipFile(blob, "w") as archive:
            archive.writestr("Settlement_Points.csv", body)
        points = siting.parse_settlement_points(blob.getvalue())
        by_name = {point["name"]: point for point in points}
        self.assertEqual(by_name["CR_RN"]["zone"], "LZ_HOUSTON")
        self.assertEqual(by_name["CR_RN"]["kind"], "resource-node")
        self.assertEqual(by_name["CR_RN"]["substation"], "WAP")
        self.assertEqual(by_name["HB_HOUSTON"]["kind"], "hub")
        self.assertNotIn("owner", by_name["CR_RN"])

    def test_noie_zone_overrides_the_bus_zone(self):
        import io
        import zipfile
        bus = "ELECTRICAL_BUS,SUBSTATION,SETTLEMENT_LOAD_ZONE\n1,BARTON,LZ_SOUTH\n2,BARTON,LZ_SOUTH\n"
        noie = "PHYSICAL_LOAD,NOIE,SUBSTATION\nB1,LZ_AEN,BARTON\n"
        blob = io.BytesIO()
        with zipfile.ZipFile(blob, "w") as archive:
            archive.writestr("Settlement_Points.csv", bus)
            archive.writestr("NOIE_Mapping.csv", noie)
        rows = {row["name"]: row for row in siting.parse_zone_substations(blob.getvalue())}
        self.assertEqual(rows["BARTON"]["zone"], "LZ_AEN")
        self.assertEqual(rows["BARTON"]["zoneSource"], "noie")

    def test_large_load_phrases_are_required(self):
        with self.assertRaises(ValueError):
            siting.require_phrase("no numbers here", "8927 MW", "LLWG")
        siting.require_phrase("Of the 8927 MW that have received Approval to Energize", "8927 MW", "LLWG")


if __name__ == "__main__":
    unittest.main()
