import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2] / "agent"))
from error_parser import classify_bug_type, parse_errors_json


class TestErrorParser:
    def test_classify_ruff_import(self):
        err = {"source": "ruff", "message": "unused import", "rule_code": "F401"}
        assert classify_bug_type(err) == "IMPORT"

    def test_classify_ruff_indentation(self):
        err = {"source": "ruff", "message": "indentation error", "rule_code": "E111"}
        assert classify_bug_type(err) == "INDENTATION"

    def test_classify_ruff_syntax(self):
        err = {"source": "ruff", "message": "syntax error", "rule_code": "E999"}
        assert classify_bug_type(err) == "SYNTAX"

    def test_classify_ruff_linting(self):
        err = {"source": "ruff", "message": "line too long", "rule_code": "E501"}
        assert classify_bug_type(err) == "LINTING"

    def test_classify_pytest_assertion(self):
        err = {"source": "pytest", "message": "AssertionError: assert 1 == 2"}
        assert classify_bug_type(err) == "LOGIC"

    def test_classify_pytest_type_error(self):
        err = {"source": "pytest", "message": "TypeError: expected int got str"}
        assert classify_bug_type(err) == "TYPE_ERROR"

    def test_classify_pytest_import_error(self):
        err = {"source": "pytest", "message": "ImportError: no module named foo"}
        assert classify_bug_type(err) == "IMPORT"

    def test_parse_errors_json_valid(self, tmp_path):
        errors_file = tmp_path / "errors.json"
        errors_data = [
            {
                "file": "src/utils.py",
                "line": 15,
                "message": "F401 `os` imported but unused",
                "source": "ruff",
                "rule_code": "F401",
            },
            {
                "file": "src/main.py",
                "line": 22,
                "message": "AssertionError: assert 3 == 4",
                "source": "pytest",
            },
        ]
        errors_file.write_text(json.dumps(errors_data))

        parsed = parse_errors_json(str(errors_file))
        assert len(parsed) == 2
        # Sorted by severity: LOGIC first, then IMPORT
        assert parsed[0]["bug_type"] == "LOGIC"
        assert parsed[0]["file_path"] == "src/main.py"
        assert parsed[1]["bug_type"] == "IMPORT"
        assert parsed[1]["file_path"] == "src/utils.py"

    def test_parse_errors_json_missing_file(self, tmp_path):
        result = parse_errors_json(str(tmp_path / "nonexistent.json"))
        assert result == []

    def test_parse_errors_json_invalid_json(self, tmp_path):
        errors_file = tmp_path / "errors.json"
        errors_file.write_text("not json")
        result = parse_errors_json(str(errors_file))
        assert result == []


# ═══════════════════════════════════════════════════════════════════════
# Fix Generator Tests
# ═══════════════════════════════════════════════════════════════════════
