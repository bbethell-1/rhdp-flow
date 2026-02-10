"""Tests for read_csv_input and write_deployment_results."""

import csv
import io
import os
import tempfile

from rhdp_flow import read_csv_input, write_deployment_results, DeploymentResult
from tests.conftest import (
    BASIC_WORKSHOP_CSV,
    MULTI_ASSET_OLD_CSV,
    MULTI_ASSET_GROUPED_CSV,
    COUNT_EXPANSION_CSV,
    MULTI_REGION_CSV,
    MISSING_HEADERS_CSV,
    OLD_DATE_HEADERS_CSV,
    write_csv_tempfile,
)

import pytest


class TestCSVParsing:
    def setup_method(self):
        self._tmpfiles = []

    def teardown_method(self):
        for f in self._tmpfiles:
            try:
                os.unlink(f)
            except OSError:
                pass

    def _write(self, csv_text):
        path = write_csv_tempfile(csv_text)
        self._tmpfiles.append(path)
        return path

    def test_basic_single_row(self):
        path = self._write(BASIC_WORKSHOP_CSV)
        schedules = read_csv_input(path)
        assert len(schedules) == 1
        s = schedules[0]
        assert s.ci_name == "Experience OpenShift Virtualization Roadshow"
        assert s.ci == "openshift-cnv.ocp-virt-roadshow-multi-user.prod"
        assert s.namespace == "user-bbethell-redhat-com"
        assert s.users == 20
        assert s.enable_workshop_interface is True
        assert s.password == "Workshop1"

    def test_multi_asset_old_format(self):
        path = self._write(MULTI_ASSET_OLD_CSV)
        schedules = read_csv_input(path)
        assert len(schedules) == 1
        assert schedules[0].is_multi_asset is True
        assert "openshift-cnv" in schedules[0].asset_cis

    def test_grouped_multi_asset(self):
        path = self._write(MULTI_ASSET_GROUPED_CSV)
        schedules = read_csv_input(path)
        assert len(schedules) == 2
        assert schedules[0].multi_workshop_name == "summit-demo-2026"
        assert schedules[0].is_multi_asset is False

    def test_count_and_concurrency(self):
        path = self._write(COUNT_EXPANSION_CSV)
        schedules = read_csv_input(path)
        assert schedules[0].count == 2
        assert schedules[0].concurrency == 3

    def test_aws_region(self):
        path = self._write(MULTI_REGION_CSV)
        schedules = read_csv_input(path)
        assert schedules[0].aws_regions == "us-east-1,eu-west-1"

    def test_missing_required_headers_raises(self):
        path = self._write(MISSING_HEADERS_CSV)
        with pytest.raises(ValueError):
            read_csv_input(path)

    def test_empty_csv_raises(self):
        path = self._write(
            "CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,"
            "Activity,Purpose,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)\n"
        )
        with pytest.raises(ValueError):
            read_csv_input(path)

    def test_old_date_headers(self):
        path = self._write(OLD_DATE_HEADERS_CSV)
        schedules = read_csv_input(path)
        assert len(schedules) == 1
        assert schedules[0].provisioning_date == "15/02/2026 11:00"

    def test_write_deployment_results_roundtrip(self):
        results = [
            DeploymentResult(
                ci_name="Test", ci="test-ci", namespace="test-ns",
                guid="test-guid", url="https://example.com",
                status="verified", provisioning_date="15/02/2026 11:00",
                auto_stop="15/02/2026 19:00", auto_destroy="17/02/2026 11:00",
                timestamp="2026-02-15T11:00:00Z", error_message="",
            )
        ]
        output = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
        output.close()
        self._tmpfiles.append(output.name)
        write_deployment_results(results, output.name)
        with open(output.name) as f:
            rows = list(csv.DictReader(f))
        assert len(rows) == 1
        assert rows[0]["ci_name"] == "Test"
        assert rows[0]["status"] == "verified"

    def test_skip_incomplete_rows(self):
        csv_text = """\
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)
Valid Row,valid-ci,valid-ns,20,True,pass,Admin,QA,My Workshop,15/02/2026 11:00,15/02/2026 19:00,17/02/2026 11:00
,,,,,,,,,,,
"""
        path = self._write(csv_text)
        schedules = read_csv_input(path)
        assert len(schedules) == 1
        assert schedules[0].ci_name == "Valid Row"

    def test_stringio_input(self):
        """Test that read_csv_input accepts io.StringIO."""
        sio = io.StringIO(BASIC_WORKSHOP_CSV)
        schedules = read_csv_input(sio)
        assert len(schedules) == 1
        assert schedules[0].ci_name == "Experience OpenShift Virtualization Roadshow"
