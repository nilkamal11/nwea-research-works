"""Checks for analytical scope, API validation, export parity, and asset boundaries."""

from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from python_d3.analytics import QueryError, ResearchAnalytics, parse_query
from python_d3.app import create_app
from python_d3.export import OUTPUT, serialize


class AnalyticsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.analytics = ResearchAnalytics()

    def test_snapshot_totals_and_full_network(self):
        view = self.analytics.query({"roster_only": "false"})
        self.assertEqual(view["summary"], {"records": 317, "bylines": 293, "pdfs": 137,
                                           "contributors": 228, "roster_contributors": 22})
        self.assertEqual((len(view["graph"]["nodes"]), len(view["graph"]["links"])), (228, 626))

    def test_roster_restricts_graph_without_changing_record_scope(self):
        roster = self.analytics.query()
        everyone = self.analytics.query({"roster_only": "false"})
        self.assertEqual((len(roster["graph"]["nodes"]), len(roster["graph"]["links"])), (22, 56))
        self.assertEqual(roster["works"], everyone["works"])
        self.assertTrue(all(node["roster"] for node in roster["graph"]["nodes"]))

    def test_matrix_counts_unique_records_with_multiple_type_memberships(self):
        view = self.analytics.query()
        row = next(row for row in view["matrix"]["rows"] if row["theme"] == "Growth")
        self.assertEqual(row["total"], 45)
        self.assertEqual(sum(row["cells"]), 46)

    def test_conjunctive_filters_preserve_chart_drilldown_scope(self):
        view = self.analytics.query({"cls": "Journal article", "theme": "Equity"})
        self.assertEqual(view["summary"]["records"], 28)
        self.assertTrue(all("Journal article" in work["cls"] and "Equity" in work["themes"] for work in view["works"]))

    def test_search_year_pdf_and_author_filters(self):
        view = self.analytics.query({"q": " MEGAN KUHFELD ", "author": "Megan Kuhfeld", "y0": "2020", "y1": "2024", "pdf": "true"})
        self.assertGreater(view["summary"]["records"], 0)
        for work in view["works"]:
            self.assertIn("Megan Kuhfeld", work["authors"])
            self.assertTrue(work["pdf"])
            self.assertLessEqual("2020", work["year"])
            self.assertLessEqual(work["year"], "2024")

    def test_network_memberships_agree_with_underlying_records(self):
        view = self.analytics.query({"theme": "Growth", "roster_only": "false"})
        records = {work["id"]: work for work in view["works"]}
        for link in view["graph"]["links"]:
            expected = [work["id"] for work in view["works"] if link["source"] in work["authors"] and link["target"] in work["authors"]]
            self.assertEqual(link["record_ids"], expected)
            self.assertEqual(link["shared"], len(expected))
            self.assertTrue(set(link["record_ids"]) <= records.keys())

    def test_high_threshold_retains_isolated_nodes(self):
        graph = self.analytics.query({"min_shared": "317", "roster_only": "false"})["graph"]
        self.assertEqual(len(graph["nodes"]), 228)
        self.assertEqual(graph["links"], [])
        self.assertEqual(graph["isolated"], 228)

    def test_empty_selection_has_consistent_empty_outputs(self):
        view = self.analytics.query({"q": "no-such-record-843906120"})
        self.assertEqual(view["summary"]["records"], 0)
        self.assertEqual(view["graph"], {"nodes": [], "links": [], "isolated": 0})
        self.assertEqual(view["matrix"], {"types": [], "rows": []})
        self.assertTrue(all(not values for values in view["counts"].values()))

    def test_bad_queries_are_rejected_before_analysis(self):
        queries = [{"unexpected": "x"}, {"q": "x" * 301}, {"y0": "20"}, {"y0": "0000"},
                   {"y0": "2025", "y1": "2020"}, {"pdf": "yes"}, {"roster_only": "1"},
                   {"min_shared": True}, {"min_shared": 0}, {"min_shared": 318}, {"min_shared": "1.5"}]
        for values in queries:
            with self.subTest(values=values):
                with self.assertRaises(QueryError):
                    parse_query(values)

    def test_export_is_deterministic_and_matches_committed_data(self):
        first = serialize(self.analytics)
        self.assertEqual(first, serialize(self.analytics))
        self.assertEqual(first, OUTPUT.read_bytes())
        self.assertEqual(json.loads(first), self.analytics.bootstrap())

    def test_bad_dataset_cannot_bypass_the_shared_validator(self):
        data = deepcopy(self.analytics.dataset)
        data["works"][0]["nwea"] = ["not in the saved roster"]
        with self.assertRaises(ValueError):
            ResearchAnalytics(data)


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.web_root = Path(cls.temp.name) / "public"
        cls.web_root.mkdir()
        (cls.web_root / "index.html").write_text('<html data-mode="static"><body>Dashboard</body></html>', encoding="utf-8")
        (cls.web_root / "app.js").write_text('"use strict";', encoding="utf-8")
        (cls.web_root / ".env").write_text("private fixture", encoding="utf-8")
        (Path(cls.temp.name) / "secret.txt").write_text("private fixture", encoding="utf-8")
        cls.app = create_app(web_root=cls.web_root)
        cls.app.testing = True
        cls.client = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_page_uses_api_mode_and_root_redirects(self):
        self.assertEqual(self.client.get("/").headers["Location"], "/python-d3/")
        response = self.client.get("/python-d3/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'data-mode="api"', response.data)
        self.assertNotIn(b'data-mode="static"', response.data)
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")

    def test_api_bootstrap_matches_static_export(self):
        response = self.client.get("/python-d3/api/bootstrap")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, json.loads(OUTPUT.read_bytes()))

    def test_api_view_computes_filtered_data(self):
        response = self.client.get("/python-d3/api/view?cls=Journal%20article&theme=Equity")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["summary"]["records"], 28)
        self.assertNotIn("Access-Control-Allow-Origin", response.headers)

    def test_api_invalid_queries_return_json_400(self):
        queries = ["q=" + "x" * 301, "q=one&q=two", "extra=1", "y0=abc", "y0=2025&y1=2020",
                   "pdf=1", "roster_only=yes", "min_shared=0", "min_shared=318", "min_shared=-1",
                   "min_shared=1.5", "min_shared=" + "9" * 5000]
        for query in queries:
            with self.subTest(query=query[:80]):
                response = self.client.get("/python-d3/api/view?" + query)
                self.assertEqual(response.status_code, 400)
                self.assertTrue(response.json["error"])
        self.assertEqual(self.client.get("/python-d3/api/bootstrap?q=x").status_code, 400)

    def test_only_public_assets_are_served(self):
        with self.client.get("/python-d3/app.js") as response:
            self.assertEqual(response.status_code, 200)
        blocked = ["/.git/config", "/data.js", "/python_d3/app.py", "/python-d3/.env", "/python-d3/../secret.txt",
                   "/python-d3/%2e%2e/secret.txt", "/python-d3/%5c..%5csecret.txt", "/python-d3/%00", "/python-d3/missing.js"]
        for path in blocked:
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_api_rejects_mutating_methods(self):
        response = self.client.post("/python-d3/api/view", json={})
        self.assertEqual(response.status_code, 405)


if __name__ == "__main__":
    unittest.main()
