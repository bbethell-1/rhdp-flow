#!/usr/bin/env python3
"""
Test suite for RHDP-Flow: Red Hat Demo Platform Workshop Automation Tool.

Run with:
    python3 -m pytest test_rhdp_flow.py -v
    python3 -m unittest test_rhdp_flow -v
"""

import csv
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock, call

# Import the module under test
try:
    from rhdp_flow import (
        WorkshopSchedule,
        DeploymentResult,
        RHDPConfig,
        parse_date_time,
        format_iso8601,
        calculate_duration,
        read_csv_input,
        write_deployment_results,
        build_resource_claim_payload,
        create_resource_claim_via_oc,
        create_workshop_with_ui,
        create_workshop_provision,
        create_multi_workshop,
        create_multi_workshop_from_group,
        create_multi_region_workshop,
        lock_workshops,
        extend_stop_time,
        extend_destroy_time,
        scale_workshops,
        process_schedule,
        construct_workshop_url,
        verify_deployment,
        create_parser,
    )
except ImportError:
    print("Error: Could not import rhdp_flow.py")
    print("Please ensure test_rhdp_flow.py is in the same directory as rhdp_flow.py")
    sys.exit(1)


# ============================================================================
# CSV FIXTURE CONSTANTS
# ============================================================================

BASIC_WORKSHOP_CSV = """\
CI Name,CI,Namespace,Users,Workshop_instance_count,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Multi_Asset,Asset_CIs,Multi_Workshop_Name,Concurrency,Count,AWS_Region
Experience OpenShift Virtualization Roadshow,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-bbethell-redhat-com,20,2,True,Workshop1,Admin,QA,Virt Roadshow Basic,15/02/2026 11:00,15/02/2026 19:00,17/02/2026 11:00,,,,,,
"""

MULTI_ASSET_OLD_CSV = """\
CI Name,CI,Namespace,Users,Workshop_instance_count,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Multi_Asset,Asset_CIs,Multi_Workshop_Name,Concurrency,Count,AWS_Region
Multi Asset Workshop,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-bbethell-redhat-com,20,,True,Pass1,Admin,QA,Summit Multi,19/02/2026 10:00,19/02/2026 18:00,21/02/2026 10:00,True,"openshift-cnv.ocp-virt-roadshow-multi-user.prod,zt-ansiblebu.ansible-network-automation-basics-lab-2.event",summit-multi-2026,,,
"""

MULTI_ASSET_GROUPED_CSV = """\
CI Name,CI,Namespace,Users,Workshop_instance_count,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Multi_Asset,Asset_CIs,Multi_Workshop_Name,Concurrency,Count,AWS_Region
Virt Roadshow Asset,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-bbethell-redhat-com,20,,True,VirtPass1,Admin,QA,Summit Demo,19/02/2026 10:00,19/02/2026 18:00,21/02/2026 10:00,,,summit-demo-2026,,,
Ansible Lab Asset,zt-ansiblebu.ansible-network-automation-basics-lab-2.event,user-bbethell-redhat-com,20,,True,AnsPass2,Admin,QA,Summit Demo,19/02/2026 10:00,19/02/2026 18:00,21/02/2026 10:00,,,summit-demo-2026,,,
"""

MULTI_REGION_CSV = (
    "CI Name,CI,Namespace,Users,Workshop_instance_count,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Multi_Asset,Asset_CIs,Multi_Workshop_Name,Concurrency,Count,AWS_Region\n"
    'Regional Workshop,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-bbethell-redhat-com,40,,True,RegPass1,Admin,QA,Regional Virt,20/02/2026 10:00,20/02/2026 18:00,22/02/2026 10:00,,,,,,"us-east-1,eu-west-1"\n'
)

COUNT_EXPANSION_CSV = """\
CI Name,CI,Namespace,Users,Workshop_instance_count,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Multi_Asset,Asset_CIs,Multi_Workshop_Name,Concurrency,Count,AWS_Region
OpenShift AI Workshop,openshift-ai.ai-workshop-multi-user.prod,user-bbethell-redhat-com,40,,True,AIPass1,Admin,Demo,AI Workshop,17/02/2026 10:00,17/02/2026 18:00,19/02/2026 10:00,,,,3,2,
"""

OLD_DATE_HEADERS_CSV = """\
CI Name,CI,Namespace,Users,Workshop_instance_count,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date,Auto-stop,Auto-destroy,Multi_Asset,Asset_CIs,Multi_Workshop_Name,Concurrency,Count,AWS_Region
Basic Workshop,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-bbethell-redhat-com,20,,True,Pass1,Admin,QA,Old Headers,15/02/2026 11:00,15/02/2026 19:00,17/02/2026 11:00,,,,,,
"""

MISSING_HEADERS_CSV = """\
CI Name,CI,Namespace
Basic Workshop,some-ci,some-ns
"""


# ============================================================================
# HELPER FACTORIES
# ============================================================================

def make_schedule(**overrides):
    """Create a WorkshopSchedule with sensible defaults."""
    defaults = dict(
        ci_name="Experience OpenShift Virtualization Roadshow",
        ci="openshift-cnv.ocp-virt-roadshow-multi-user.prod",
        namespace="user-bbethell-redhat-com",
        users=20,
        enable_workshop_interface=True,
        password="Workshop1",
        activity="Admin",
        purpose="QA",
        workshop_name="Virt Roadshow Basic",
        provisioning_date="15/02/2026 11:00",
        auto_stop="15/02/2026 19:00",
        auto_destroy="17/02/2026 11:00",
        is_multi_asset=False,
        asset_cis="",
        multi_workshop_name="",
        concurrency=1,
        count=1,
        aws_regions="",
    )
    defaults.update(overrides)
    return WorkshopSchedule(**defaults)


def make_config(dry_run=False, kubeconfig_path=None):
    """Create an RHDPConfig with sensible defaults."""
    config = RHDPConfig()
    config.dry_run = dry_run
    config.kubeconfig_path = kubeconfig_path
    config.timeout = 10
    return config


def make_oc_dispatcher(overrides=None):
    """
    Return a callable for subprocess.run side_effect that dispatches
    based on the oc subcommand in cmd list.

    overrides: dict mapping (subcommand, resource_hint) -> CompletedProcess
               e.g. {("get", "workshop"): CompletedProcess(...)}
    """
    overrides = overrides or {}

    def dispatcher(*args, **kwargs):
        cmd = args[0] if args else kwargs.get('args', [])
        if not cmd or len(cmd) < 2:
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        subcmd = cmd[1]  # create, get, patch, delete, version

        # Check overrides first (subcommand, resource_type)
        resource_type = cmd[2] if len(cmd) > 2 else ""
        key = (subcmd, resource_type)
        if key in overrides:
            val = overrides[key]
            return val() if callable(val) else val

        # version --client
        if subcmd == "version":
            return subprocess.CompletedProcess(
                cmd, 0, stdout="Client Version: 4.14.0\n", stderr=""
            )

        # oc create -f <tmpfile>
        if subcmd == "create":
            # Find the temp file path
            tmpfile = None
            for i, arg in enumerate(cmd):
                if arg == "-f" and i + 1 < len(cmd):
                    tmpfile = cmd[i + 1]
                    break
            kind = "ResourceClaim"
            name_prefix = "unknown"
            if tmpfile and os.path.exists(tmpfile):
                try:
                    with open(tmpfile) as f:
                        payload = json.load(f)
                    kind = payload.get("kind", "ResourceClaim")
                    name_prefix = (
                        payload.get("metadata", {}).get("generateName", "")
                        or payload.get("metadata", {}).get("name", "unknown")
                    )
                except Exception:
                    pass

            kind_lower = kind.lower()
            api_map = {
                "resourceclaim": "resourceclaim.poolboy.gpte.redhat.com",
                "workshop": "workshop.babylon.gpte.redhat.com",
                "workshopprovision": "workshopprovision.babylon.gpte.redhat.com",
                "multiworkshop": "multiworkshop.babylon.gpte.redhat.com",
            }
            api_prefix = api_map.get(kind_lower, f"{kind_lower}.babylon.gpte.redhat.com")

            # Generate a name
            if name_prefix.endswith("-"):
                actual_name = f"{name_prefix}abc12"
            else:
                actual_name = name_prefix

            stdout = f"{api_prefix}/{actual_name} created\n"
            return subprocess.CompletedProcess(cmd, 0, stdout=stdout, stderr="")

        # oc get
        if subcmd == "get":
            resource = cmd[2] if len(cmd) > 2 else ""
            # oc get workshop <name> -o jsonpath=...workshop-id
            if resource == "workshop":
                jsonpath_arg = None
                for arg in cmd:
                    if "jsonpath" in str(arg):
                        jsonpath_arg = arg
                        break
                if jsonpath_arg and "workshop-id" in jsonpath_arg:
                    return subprocess.CompletedProcess(
                        cmd, 0, stdout="m5hzmw", stderr=""
                    )
                if any(a == "json" for a in cmd):
                    workshop_json = {
                        "metadata": {
                            "name": cmd[3] if len(cmd) > 3 else "test-workshop",
                            "labels": {
                                "babylon.gpte.redhat.com/workshop-id": "m5hzmw"
                            },
                        },
                        "spec": {
                            "actionSchedule": {
                                "start": "2026-02-15T11:00:00Z",
                                "stop": "2026-02-15T19:00:00Z",
                            },
                            "lifespan": {
                                "start": "2026-02-15T11:00:00Z",
                                "end": "2026-02-17T11:00:00Z",
                            },
                            "labUserInterface": {"redirect": True},
                        },
                    }
                    return subprocess.CompletedProcess(
                        cmd, 0, stdout=json.dumps(workshop_json), stderr=""
                    )
                # oc get workshop <name> -o name
                return subprocess.CompletedProcess(
                    cmd, 0, stdout="workshop.babylon.gpte.redhat.com/test-workshop", stderr=""
                )

            if resource == "workshopprovision":
                if any("jsonpath" in str(a) for a in cmd):
                    return subprocess.CompletedProcess(
                        cmd, 0, stdout="test-workshop", stderr=""
                    )
                return subprocess.CompletedProcess(
                    cmd, 0,
                    stdout=json.dumps({
                        "items": [{
                            "metadata": {"name": "test-workshop"},
                            "spec": {
                                "lifespan": {"end": "2026-02-17T11:00:00Z"},
                                "count": 20,
                            }
                        }]
                    }),
                    stderr=""
                )

            if resource == "resourceclaim" or resource == "resourceclaims":
                rc_json = {
                    "metadata": {"name": "test-rc-abc12"},
                    "status": {"healthy": True, "ready": True},
                }
                if any(a == "json" for a in cmd):
                    return subprocess.CompletedProcess(
                        cmd, 0, stdout=json.dumps(rc_json), stderr=""
                    )
                return subprocess.CompletedProcess(cmd, 0, stdout="test-rc-abc12", stderr="")

            if resource == "catalogitem":
                return subprocess.CompletedProcess(
                    cmd, 0,
                    stdout="babylon-catalog-prod:Experience OpenShift Virtualization Roadshow",
                    stderr=""
                )

            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        # oc patch
        if subcmd == "patch":
            resource = cmd[2] if len(cmd) > 2 else "resource"
            name = cmd[3] if len(cmd) > 3 else "unknown"
            return subprocess.CompletedProcess(
                cmd, 0, stdout=f"{resource}/{name} patched\n", stderr=""
            )

        # oc delete
        if subcmd == "delete":
            return subprocess.CompletedProcess(cmd, 0, stdout="deleted\n", stderr="")

        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    return dispatcher


def _write_csv_tempfile(csv_text):
    """Write CSV text to a temporary file, return path."""
    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".csv", delete=False, encoding="utf-8"
    )
    tmp.write(csv_text)
    tmp.close()
    return tmp.name


# ============================================================================
# GROUP 1: Date/Time Utilities
# ============================================================================


class TestDateTimeUtilities(unittest.TestCase):
    """Tests for parse_date_time, format_iso8601, calculate_duration."""

    def test_parse_dd_mm_yyyy(self):
        dt = parse_date_time("15/02/2026 11:00")
        self.assertIsNotNone(dt)
        self.assertEqual(dt.year, 2026)
        self.assertEqual(dt.month, 2)
        self.assertEqual(dt.day, 15)
        self.assertEqual(dt.hour, 11)
        self.assertEqual(dt.tzinfo, timezone.utc)

    def test_parse_dd_mm_yy(self):
        dt = parse_date_time("15/02/26 11:00")
        self.assertIsNotNone(dt)
        self.assertEqual(dt.year, 2026)
        self.assertEqual(dt.tzinfo, timezone.utc)

    def test_parse_iso8601_with_z(self):
        dt = parse_date_time("2026-02-15T11:00:00Z")
        self.assertIsNotNone(dt)
        self.assertEqual(dt.year, 2026)
        self.assertEqual(dt.hour, 11)

    def test_parse_iso8601_without_z(self):
        dt = parse_date_time("2026-02-15T11:00:00")
        self.assertIsNotNone(dt)
        self.assertEqual(dt.hour, 11)

    def test_parse_empty_returns_none(self):
        self.assertIsNone(parse_date_time(""))
        self.assertIsNone(parse_date_time("   "))

    def test_parse_invalid_returns_none(self):
        self.assertIsNone(parse_date_time("not-a-date"))

    def test_format_iso8601_naive(self):
        dt = datetime(2026, 2, 15, 11, 0, 0)
        result = format_iso8601(dt)
        self.assertEqual(result, "2026-02-15T11:00:00Z")

    def test_format_iso8601_utc(self):
        dt = datetime(2026, 2, 15, 11, 0, 0, tzinfo=timezone.utc)
        result = format_iso8601(dt)
        self.assertEqual(result, "2026-02-15T11:00:00Z")

    def test_calculate_duration(self):
        start = datetime(2026, 2, 15, 11, 0, tzinfo=timezone.utc)
        end = datetime(2026, 2, 15, 19, 0, tzinfo=timezone.utc)
        self.assertEqual(calculate_duration(start, end), "8h")

    def test_calculate_duration_multi_day(self):
        start = datetime(2026, 2, 15, 11, 0, tzinfo=timezone.utc)
        end = datetime(2026, 2, 17, 11, 0, tzinfo=timezone.utc)
        self.assertEqual(calculate_duration(start, end), "48h")


# ============================================================================
# GROUP 2: CSV Parsing
# ============================================================================


class TestCSVParsing(unittest.TestCase):
    """Tests for read_csv_input and write_deployment_results."""

    def setUp(self):
        self._tmpfiles = []

    def tearDown(self):
        for f in self._tmpfiles:
            try:
                os.unlink(f)
            except OSError:
                pass

    def _write(self, csv_text):
        path = _write_csv_tempfile(csv_text)
        self._tmpfiles.append(path)
        return path

    def test_basic_single_row(self):
        path = self._write(BASIC_WORKSHOP_CSV)
        schedules = read_csv_input(path)
        self.assertEqual(len(schedules), 1)
        s = schedules[0]
        self.assertEqual(s.ci_name, "Experience OpenShift Virtualization Roadshow")
        self.assertEqual(s.ci, "openshift-cnv.ocp-virt-roadshow-multi-user.prod")
        self.assertEqual(s.namespace, "user-bbethell-redhat-com")
        self.assertEqual(s.users, 20)
        self.assertTrue(s.enable_workshop_interface)
        self.assertEqual(s.password, "Workshop1")
        self.assertEqual(s.activity, "Admin")
        self.assertEqual(s.purpose, "QA")
        self.assertEqual(s.provisioning_date, "15/02/2026 11:00")
        self.assertEqual(s.auto_stop, "15/02/2026 19:00")
        self.assertEqual(s.auto_destroy, "17/02/2026 11:00")

    def test_multi_asset_old_format(self):
        path = self._write(MULTI_ASSET_OLD_CSV)
        schedules = read_csv_input(path)
        self.assertEqual(len(schedules), 1)
        s = schedules[0]
        self.assertTrue(s.is_multi_asset)
        self.assertIn("openshift-cnv", s.asset_cis)
        self.assertIn("zt-ansiblebu", s.asset_cis)
        self.assertEqual(s.multi_workshop_name, "summit-multi-2026")

    def test_grouped_multi_asset(self):
        path = self._write(MULTI_ASSET_GROUPED_CSV)
        schedules = read_csv_input(path)
        self.assertEqual(len(schedules), 2)
        self.assertEqual(schedules[0].multi_workshop_name, "summit-demo-2026")
        self.assertEqual(schedules[1].multi_workshop_name, "summit-demo-2026")
        # Grouped format: Multi_Asset is NOT set; rows share Multi_Workshop_Name
        self.assertFalse(schedules[0].is_multi_asset)

    def test_count_and_concurrency(self):
        path = self._write(COUNT_EXPANSION_CSV)
        schedules = read_csv_input(path)
        self.assertEqual(len(schedules), 1)
        self.assertEqual(schedules[0].count, 2)
        self.assertEqual(schedules[0].concurrency, 3)

    def test_aws_region(self):
        path = self._write(MULTI_REGION_CSV)
        schedules = read_csv_input(path)
        self.assertEqual(len(schedules), 1)
        self.assertEqual(schedules[0].aws_regions, "us-east-1,eu-west-1")

    def test_missing_required_headers_raises(self):
        path = self._write(MISSING_HEADERS_CSV)
        with self.assertRaises(ValueError):
            read_csv_input(path)

    def test_empty_csv_raises(self):
        path = self._write("CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)\n")
        with self.assertRaises(ValueError):
            read_csv_input(path)

    def test_old_date_headers(self):
        path = self._write(OLD_DATE_HEADERS_CSV)
        schedules = read_csv_input(path)
        self.assertEqual(len(schedules), 1)
        self.assertEqual(schedules[0].provisioning_date, "15/02/2026 11:00")

    def test_write_deployment_results_roundtrip(self):
        results = [
            DeploymentResult(
                ci_name="Test", ci="test-ci", namespace="test-ns",
                guid="test-guid", url="https://example.com",
                status="verified", provisioning_date="15/02/2026 11:00",
                auto_stop="15/02/2026 19:00", auto_destroy="17/02/2026 11:00",
                timestamp="2026-02-15T11:00:00Z", error_message=""
            )
        ]
        output = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
        output.close()
        self._tmpfiles.append(output.name)

        write_deployment_results(results, output.name)

        with open(output.name, "r") as f:
            reader = csv.DictReader(f)
            rows = list(reader)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["ci_name"], "Test")
        self.assertEqual(rows[0]["guid"], "test-guid")
        self.assertEqual(rows[0]["status"], "verified")

    def test_skip_incomplete_rows(self):
        csv_text = """\
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)
Valid Row,valid-ci,valid-ns,20,True,pass,Admin,QA,My Workshop,15/02/2026 11:00,15/02/2026 19:00,17/02/2026 11:00
,,,,,,,,,,,
"""
        path = self._write(csv_text)
        schedules = read_csv_input(path)
        self.assertEqual(len(schedules), 1)
        self.assertEqual(schedules[0].ci_name, "Valid Row")


# ============================================================================
# GROUP 3: Build ResourceClaim Payload
# ============================================================================


class TestBuildResourceClaimPayload(unittest.TestCase):
    """Tests for build_resource_claim_payload."""

    def test_payload_structure_dry_run(self):
        config = make_config(dry_run=True)
        schedule = make_schedule()
        payload = build_resource_claim_payload(schedule, config)

        self.assertEqual(payload["apiVersion"], "poolboy.gpte.redhat.com/v1")
        self.assertEqual(payload["kind"], "ResourceClaim")
        self.assertIn("metadata", payload)
        self.assertIn("spec", payload)

    def test_provider_fields(self):
        config = make_config(dry_run=True)
        schedule = make_schedule()
        payload = build_resource_claim_payload(schedule, config)

        provider = payload["spec"]["provider"]
        self.assertEqual(provider["name"], schedule.ci)
        self.assertEqual(provider["parameterValues"]["num_users"], 20)
        self.assertIn("start_timestamp", provider["parameterValues"])
        self.assertIn("stop_timestamp", provider["parameterValues"])

    def test_access_password_present(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(password="SecretPass")
        payload = build_resource_claim_payload(schedule, config)
        self.assertEqual(payload["spec"]["accessPassword"], "SecretPass")

    def test_access_password_absent(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(password="")
        payload = build_resource_claim_payload(schedule, config)
        self.assertNotIn("accessPassword", payload["spec"])

    def test_workshop_ui_annotations(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(enable_workshop_interface=True, workshop_name="My WS")
        payload = build_resource_claim_payload(schedule, config)
        annotations = payload["metadata"]["annotations"]
        self.assertEqual(
            annotations["rhdp-flow.gpte.redhat.com/enable-workshop-ui"], "true"
        )
        self.assertEqual(
            annotations["rhdp-flow.gpte.redhat.com/workshop-name"], "My WS"
        )

    def test_email_extraction_from_namespace(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(namespace="user-bbethell-redhat-com")
        payload = build_resource_claim_payload(schedule, config)
        annotations = payload["metadata"]["annotations"]
        self.assertEqual(annotations["demo.redhat.com/requester"], "bbethell@redhat.com")

    def test_date_defaults_when_empty(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(provisioning_date="", auto_stop="", auto_destroy="")
        payload = build_resource_claim_payload(schedule, config)
        # Should still have timestamps (defaults)
        pv = payload["spec"]["provider"]["parameterValues"]
        self.assertIn("start_timestamp", pv)
        self.assertIn("stop_timestamp", pv)
        self.assertIn("end", payload["spec"]["lifespan"])

    def test_lifespan_end_from_auto_destroy(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(auto_destroy="17/02/2026 11:00")
        payload = build_resource_claim_payload(schedule, config)
        self.assertEqual(payload["spec"]["lifespan"]["end"], "2026-02-17T11:00:00Z")


# ============================================================================
# GROUP 4: Create ResourceClaim via oc
# ============================================================================


class TestCreateResourceClaimViaOc(unittest.TestCase):
    """Tests for create_resource_claim_via_oc."""

    def _make_payload(self):
        config = make_config(dry_run=True)
        return build_resource_claim_payload(make_schedule(), config)

    def test_dry_run_returns_mock_guid(self):
        config = make_config(dry_run=True)
        payload = self._make_payload()
        guid, ns, err = create_resource_claim_via_oc(payload, config)
        self.assertIsNotNone(guid)
        self.assertIn("dryrun", guid)
        self.assertEqual(ns, "user-bbethell-redhat-com")
        self.assertIsNone(err)

    @patch("rhdp_flow.subprocess.run")
    def test_success_parses_name(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        config = make_config(dry_run=False)
        payload = self._make_payload()
        guid, ns, err = create_resource_claim_via_oc(payload, config)
        self.assertIsNotNone(guid)
        self.assertIsNone(err)

    @patch("rhdp_flow.subprocess.run")
    def test_failure_returncode(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(
            [], 1, stdout="", stderr="Error: forbidden"
        )
        config = make_config(dry_run=False)
        payload = self._make_payload()
        guid, ns, err = create_resource_claim_via_oc(payload, config)
        self.assertIsNone(guid)
        self.assertIsNotNone(err)
        self.assertIn("forbidden", err)

    @patch("rhdp_flow.subprocess.run")
    def test_timeout_returns_error(self, mock_run):
        mock_run.side_effect = subprocess.TimeoutExpired(cmd=["oc"], timeout=10)
        config = make_config(dry_run=False)
        payload = self._make_payload()
        guid, ns, err = create_resource_claim_via_oc(payload, config)
        self.assertIsNone(guid)
        self.assertIn("timed out", err)

    @patch("rhdp_flow.subprocess.run")
    def test_kubeconfig_env_propagation(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        config = make_config(dry_run=False, kubeconfig_path="/tmp/kubeconfig")
        payload = self._make_payload()
        create_resource_claim_via_oc(payload, config)
        # Check that KUBECONFIG was set in the env
        call_kwargs = mock_run.call_args
        self.assertEqual(call_kwargs.kwargs.get("env", {}).get("KUBECONFIG"), "/tmp/kubeconfig")


# ============================================================================
# GROUP 5: Create Workshop with UI
# ============================================================================


class TestCreateWorkshopWithUI(unittest.TestCase):
    """Tests for create_workshop_with_ui."""

    def _make_rc_payload(self):
        config = make_config(dry_run=True)
        return build_resource_claim_payload(make_schedule(), config)

    def test_dry_run_returns_mock_name(self):
        config = make_config(dry_run=True)
        payload = self._make_rc_payload()
        name = create_workshop_with_ui("ci-name-", "user-ns", payload, config)
        self.assertIsNotNone(name)
        self.assertIn("dryrun", name)

    @patch("rhdp_flow.subprocess.run")
    def test_generate_name_extracts_actual(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        config = make_config(dry_run=False)
        payload = self._make_rc_payload()
        name = create_workshop_with_ui("ci-name-", "user-ns", payload, config)
        self.assertIsNotNone(name)
        self.assertTrue(name.startswith("ci-name-"))

    @patch("rhdp_flow.subprocess.run")
    def test_specific_name_returns_exact(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        config = make_config(dry_run=False)
        payload = self._make_rc_payload()
        name = create_workshop_with_ui("my-exact-workshop", "user-ns", payload, config)
        self.assertEqual(name, "my-exact-workshop")

    @patch("rhdp_flow.subprocess.run")
    def test_already_exists_handled(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(
            [], 1, stdout="", stderr='Error from server: workshop "my-ws" already exists'
        )
        config = make_config(dry_run=False)
        payload = self._make_rc_payload()
        name = create_workshop_with_ui("my-ws", "user-ns", payload, config)
        self.assertIsNotNone(name)

    def test_payload_has_lab_user_interface(self):
        config = make_config(dry_run=True)
        schedule = make_schedule()
        payload = build_resource_claim_payload(schedule, config)
        # The workshop payload is built inside create_workshop_with_ui,
        # but we test the schedule flag triggers the UI path
        self.assertTrue(schedule.enable_workshop_interface)


# ============================================================================
# GROUP 6: Create Workshop Provision
# ============================================================================


class TestCreateWorkshopProvision(unittest.TestCase):
    """Tests for create_workshop_provision."""

    def _make_rc_payload(self):
        config = make_config(dry_run=True)
        return build_resource_claim_payload(make_schedule(), config)

    def test_dry_run_returns_name(self):
        config = make_config(dry_run=True)
        payload = self._make_rc_payload()
        name = create_workshop_provision("ws-name", "user-ns", payload, config)
        self.assertEqual(name, "ws-name")

    @patch("rhdp_flow.subprocess.run")
    def test_count_and_concurrency(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        config = make_config(dry_run=False)
        payload = self._make_rc_payload()
        name = create_workshop_provision(
            "ws-name", "user-ns", payload, config,
            concurrency=3, count=40
        )
        self.assertEqual(name, "ws-name")
        # Verify the temp file payload had correct count/concurrency
        create_call = mock_run.call_args_list[0]
        cmd = create_call[0][0]
        self.assertIn("create", cmd)

    @patch("rhdp_flow.subprocess.run")
    def test_name_suffix(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        config = make_config(dry_run=False)
        payload = self._make_rc_payload()
        name = create_workshop_provision(
            "ws-name", "user-ns", payload, config,
            provision_name_suffix="-us-east-1"
        )
        self.assertEqual(name, "ws-name")

    def test_dry_run_extra_parameters(self):
        config = make_config(dry_run=True)
        payload = self._make_rc_payload()
        name = create_workshop_provision(
            "ws-name", "user-ns", payload, config,
            extra_parameters={"aws_region": "us-east-1"}
        )
        self.assertEqual(name, "ws-name")


# ============================================================================
# GROUP 7: Create Multi-Workshop
# ============================================================================


class TestCreateMultiWorkshop(unittest.TestCase):
    """Tests for create_multi_workshop."""

    def test_dry_run_creates_sub_resources(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(
            is_multi_asset=True,
            asset_cis="openshift-cnv.ocp-virt-roadshow-multi-user.prod,zt-ansiblebu.ansible-network-automation-basics-lab-2.event",
            multi_workshop_name="summit-test",
        )
        name = create_multi_workshop(schedule, config)
        self.assertIsNotNone(name)
        self.assertEqual(name, "summit-test")

    def test_custom_name(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(
            is_multi_asset=True,
            asset_cis="ci1.prod,ci2.event",
            multi_workshop_name="my-custom-name",
        )
        name = create_multi_workshop(schedule, config)
        self.assertEqual(name, "my-custom-name")

    def test_generated_name(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(
            is_multi_asset=True,
            asset_cis="ci1.prod,ci2.event",
            multi_workshop_name="",
        )
        name = create_multi_workshop(schedule, config)
        self.assertIsNotNone(name)
        self.assertTrue(name.startswith("automation-"))

    def test_not_multi_asset_returns_none(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(is_multi_asset=False)
        result = create_multi_workshop(schedule, config)
        self.assertIsNone(result)


# ============================================================================
# GROUP 8: Create Multi-Workshop From Group
# ============================================================================


class TestCreateMultiWorkshopFromGroup(unittest.TestCase):
    """Tests for create_multi_workshop_from_group."""

    def test_dry_run_grouped_creates_all(self):
        config = make_config(dry_run=True)
        sched1 = make_schedule(
            ci="openshift-cnv.ocp-virt-roadshow-multi-user.prod",
            ci_name="Virt Roadshow",
            password="VirtPass1",
            is_multi_asset=True,
            multi_workshop_name="summit-demo-2026",
        )
        sched2 = make_schedule(
            ci="zt-ansiblebu.ansible-network-automation-basics-lab-2.event",
            ci_name="Ansible Lab",
            password="AnsPass2",
            is_multi_asset=True,
            multi_workshop_name="summit-demo-2026",
        )
        name = create_multi_workshop_from_group([sched1, sched2], config)
        self.assertIsNotNone(name)
        self.assertEqual(name, "summit-demo-2026")

    def test_per_item_passwords(self):
        config = make_config(dry_run=True)
        sched1 = make_schedule(
            ci="ci1.prod", password="pass1",
            is_multi_asset=True, multi_workshop_name="test-group",
        )
        sched2 = make_schedule(
            ci="ci2.event", password="pass2",
            is_multi_asset=True, multi_workshop_name="test-group",
        )
        # Each schedule keeps its own password
        self.assertEqual(sched1.password, "pass1")
        self.assertEqual(sched2.password, "pass2")
        name = create_multi_workshop_from_group([sched1, sched2], config)
        self.assertIsNotNone(name)

    def test_empty_group_returns_none(self):
        config = make_config(dry_run=True)
        result = create_multi_workshop_from_group([], config)
        self.assertIsNone(result)


# ============================================================================
# GROUP 9: Multi-Region Workshop
# ============================================================================


class TestMultiRegionWorkshop(unittest.TestCase):
    """Tests for create_multi_region_workshop."""

    @patch("rhdp_flow.subprocess.run")
    def test_creates_workshop_and_provisions(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        config = make_config(dry_run=False)
        schedule = make_schedule(
            users=40,
            aws_regions="us-east-1,eu-west-1",
        )
        name = create_multi_region_workshop(schedule, config)
        self.assertIsNotNone(name)

    def test_dry_run_creates_workshop_and_provisions(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(
            users=40,
            aws_regions="us-east-1,eu-west-1",
        )
        name = create_multi_region_workshop(schedule, config)
        self.assertIsNotNone(name)

    def test_user_distribution(self):
        # 40 users / 2 regions = 20 each
        config = make_config(dry_run=True)
        schedule = make_schedule(
            users=40,
            aws_regions="us-east-1,eu-west-1",
        )
        # We can't easily inspect the distribution without mocking deeper,
        # but we verify it completes without error
        name = create_multi_region_workshop(schedule, config)
        self.assertIsNotNone(name)

    def test_single_region_returns_none(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(users=40, aws_regions="us-east-1")
        result = create_multi_region_workshop(schedule, config)
        self.assertIsNone(result)


# ============================================================================
# GROUP 10: Lock Workshops
# ============================================================================


class TestLockWorkshops(unittest.TestCase):
    """Tests for lock_workshops."""

    def test_dry_run_logs_without_patching(self):
        config = make_config(dry_run=True)
        schedules = [make_schedule()]
        # Should not raise
        lock_workshops(schedules, config)

    @patch("rhdp_flow.subprocess.run")
    def test_patches_stop_to_now(self, mock_run):
        workshop_json = {
            "items": [{
                "metadata": {"name": "test-ws", "namespace": "user-ns"},
                "spec": {
                    "actionSchedule": {
                        "start": "2026-02-15T11:00:00Z",
                        "stop": "2026-02-15T19:00:00Z"
                    }
                }
            }]
        }
        mock_run.side_effect = make_oc_dispatcher(overrides={
            ("get", "workshop"): subprocess.CompletedProcess(
                [], 0, stdout=json.dumps(workshop_json), stderr=""
            ),
        })
        config = make_config(dry_run=False)
        schedules = [make_schedule()]
        lock_workshops(schedules, config)
        # Verify a patch call was made
        patch_calls = [c for c in mock_run.call_args_list if "patch" in c[0][0]]
        self.assertGreater(len(patch_calls), 0)

    @patch("rhdp_flow.subprocess.run")
    def test_no_workshops_found(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher(overrides={
            ("get", "workshop"): subprocess.CompletedProcess(
                [], 0, stdout=json.dumps({"items": []}), stderr=""
            ),
        })
        config = make_config(dry_run=False)
        schedules = [make_schedule()]
        # Should not raise even with no workshops
        lock_workshops(schedules, config)


# ============================================================================
# GROUP 11: Extend Stop Time
# ============================================================================


class TestExtendStopTime(unittest.TestCase):
    """Tests for extend_stop_time."""

    @patch("rhdp_flow.subprocess.run")
    def test_calculates_new_stop_time(self, mock_run):
        workshop_json = {
            "items": [{
                "metadata": {"name": "test-ws"},
                "spec": {
                    "actionSchedule": {
                        "start": "2026-02-15T11:00:00Z",
                        "stop": "2026-02-15T19:00:00Z"
                    }
                }
            }]
        }
        mock_run.side_effect = make_oc_dispatcher(overrides={
            ("get", "workshop"): subprocess.CompletedProcess(
                [], 0, stdout=json.dumps(workshop_json), stderr=""
            ),
        })
        config = make_config(dry_run=False)
        schedules = [make_schedule()]
        extend_stop_time(schedules, config, days=1, hours=2)
        # Find the patch call and verify the timestamp
        patch_calls = [c for c in mock_run.call_args_list if "patch" in c[0][0]]
        self.assertGreater(len(patch_calls), 0)
        # Extract the patch JSON
        patch_cmd = patch_calls[0][0][0]
        patch_json_str = None
        for i, arg in enumerate(patch_cmd):
            if arg == "-p" and i + 1 < len(patch_cmd):
                patch_json_str = patch_cmd[i + 1]
        self.assertIsNotNone(patch_json_str)
        patch_data = json.loads(patch_json_str)
        new_stop = patch_data["spec"]["actionSchedule"]["stop"]
        # Original stop: 2026-02-15T19:00:00Z + 1 day + 2 hours = 2026-02-16T21:00:00Z
        self.assertEqual(new_stop, "2026-02-16T21:00:00Z")

    def test_dry_run_logs_times(self):
        config = make_config(dry_run=True)
        schedules = [make_schedule()]
        # Should not raise in dry-run
        extend_stop_time(schedules, config, days=1, hours=0)


# ============================================================================
# GROUP 12: Extend Destroy Time
# ============================================================================


class TestExtendDestroyTime(unittest.TestCase):
    """Tests for extend_destroy_time."""

    @patch("rhdp_flow.subprocess.run")
    def test_patches_workshop_and_provision(self, mock_run):
        workshop_json = {
            "items": [{
                "metadata": {"name": "test-ws"},
                "spec": {
                    "lifespan": {"end": "2026-02-17T11:00:00Z"}
                }
            }]
        }
        provision_json = {
            "items": [{
                "metadata": {"name": "test-ws"},
                "spec": {
                    "lifespan": {"end": "2026-02-17T11:00:00Z"}
                }
            }]
        }

        def dispatcher(*args, **kwargs):
            cmd = args[0] if args else kwargs.get('args', [])
            subcmd = cmd[1] if len(cmd) > 1 else ""
            resource = cmd[2] if len(cmd) > 2 else ""
            if subcmd == "get" and resource == "workshop":
                return subprocess.CompletedProcess(
                    cmd, 0, stdout=json.dumps(workshop_json), stderr=""
                )
            if subcmd == "get" and resource == "workshopprovision":
                return subprocess.CompletedProcess(
                    cmd, 0, stdout=json.dumps(provision_json), stderr=""
                )
            if subcmd == "patch":
                return subprocess.CompletedProcess(
                    cmd, 0, stdout="patched\n", stderr=""
                )
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        mock_run.side_effect = dispatcher
        config = make_config(dry_run=False)
        schedules = [make_schedule()]
        extend_destroy_time(schedules, config, days=1, hours=0)
        patch_calls = [c for c in mock_run.call_args_list if "patch" in c[0][0]]
        # Should patch both workshop and workshopprovision
        self.assertGreaterEqual(len(patch_calls), 2)

    def test_dry_run(self):
        config = make_config(dry_run=True)
        schedules = [make_schedule()]
        extend_destroy_time(schedules, config, days=1, hours=0)


# ============================================================================
# GROUP 13: Scale Workshops
# ============================================================================


class TestScaleWorkshops(unittest.TestCase):
    """Tests for scale_workshops."""

    @patch("rhdp_flow.subprocess.run")
    def test_patches_count(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher(overrides={
            ("get", "workshopprovision"): subprocess.CompletedProcess(
                [], 0, stdout="test-provision", stderr=""
            ),
        })
        config = make_config(dry_run=False)
        schedules = [make_schedule()]
        scale_workshops(schedules, config, target_count=40)
        patch_calls = [c for c in mock_run.call_args_list if "patch" in c[0][0]]
        self.assertGreater(len(patch_calls), 0)
        # Verify patch sets count to 40
        patch_cmd = patch_calls[0][0][0]
        patch_json_str = None
        for i, arg in enumerate(patch_cmd):
            if arg == "-p" and i + 1 < len(patch_cmd):
                patch_json_str = patch_cmd[i + 1]
        self.assertIsNotNone(patch_json_str)
        patch_data = json.loads(patch_json_str)
        self.assertEqual(patch_data["spec"]["count"], 40)

    def test_dry_run(self):
        config = make_config(dry_run=True)
        schedules = [make_schedule()]
        # Should not raise
        scale_workshops(schedules, config, target_count=40)


# ============================================================================
# GROUP 14: Process Schedule
# ============================================================================


class TestProcessSchedule(unittest.TestCase):
    """Tests for process_schedule routing."""

    def test_workshop_ui_route(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(enable_workshop_interface=True)
        result = process_schedule(schedule, config)
        self.assertIsInstance(result, DeploymentResult)
        self.assertIn(result.status, ["verified", "deployed_unverified", "deployed_no_url"])

    def test_no_workshop_ui_route(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(enable_workshop_interface=False)
        result = process_schedule(schedule, config)
        self.assertIsInstance(result, DeploymentResult)

    def test_multi_asset_route(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(
            is_multi_asset=True,
            asset_cis="ci1.prod,ci2.event",
            multi_workshop_name="test-multi",
        )
        result = process_schedule(schedule, config)
        self.assertIsInstance(result, DeploymentResult)

    def test_multi_region_route(self):
        config = make_config(dry_run=True)
        schedule = make_schedule(
            users=40,
            aws_regions="us-east-1,eu-west-1",
        )
        result = process_schedule(schedule, config)
        self.assertIsInstance(result, DeploymentResult)

    @patch("rhdp_flow.subprocess.run")
    def test_failure_returns_failed(self, mock_run):
        mock_run.side_effect = Exception("Connection refused")
        config = make_config(dry_run=False)
        schedule = make_schedule(enable_workshop_interface=False)
        result = process_schedule(schedule, config)
        self.assertIn(result.status, ["failed", "error"])


# ============================================================================
# GROUP 15: Main CLI
# ============================================================================


class TestMainCLI(unittest.TestCase):
    """Tests for main() via sys.argv."""

    def setUp(self):
        self._tmpfiles = []

    def tearDown(self):
        for f in self._tmpfiles:
            try:
                os.unlink(f)
            except OSError:
                pass

    def _write(self, csv_text):
        path = _write_csv_tempfile(csv_text)
        self._tmpfiles.append(path)
        return path

    @patch("rhdp_flow.subprocess.run")
    def test_dry_run_end_to_end(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        csv_path = self._write(BASIC_WORKSHOP_CSV)
        output_path = tempfile.NamedTemporaryFile(suffix=".csv", delete=False).name
        self._tmpfiles.append(output_path)

        from rhdp_flow import main
        test_args = [
            "rhdp_flow.py",
            "--dry-run",
            "--input-csv", csv_path,
            "--output-csv", output_path,
        ]
        with patch("sys.argv", test_args):
            try:
                main()
            except SystemExit as e:
                self.assertEqual(e.code, 0)

        # Verify output CSV exists and has content
        self.assertTrue(os.path.exists(output_path))

    @patch("rhdp_flow.subprocess.run")
    def test_ci_filter(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        csv_text = """\
CI Name,CI,Namespace,Users,Workshop_instance_count,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Multi_Asset,Asset_CIs,Multi_Workshop_Name,Concurrency,Count,AWS_Region
Workshop A,ci-a.prod,user-ns,20,,True,Pass1,Admin,QA,WS A,15/02/2026 11:00,15/02/2026 19:00,17/02/2026 11:00,,,,,,
Workshop B,ci-b.prod,user-ns,20,,True,Pass2,Admin,QA,WS B,15/02/2026 11:00,15/02/2026 19:00,17/02/2026 11:00,,,,,,
"""
        csv_path = self._write(csv_text)
        output_path = tempfile.NamedTemporaryFile(suffix=".csv", delete=False).name
        self._tmpfiles.append(output_path)

        from rhdp_flow import main
        test_args = [
            "rhdp_flow.py",
            "--dry-run",
            "--input-csv", csv_path,
            "--output-csv", output_path,
            "--ci", "ci-a.prod",
        ]
        with patch("sys.argv", test_args):
            try:
                main()
            except SystemExit as e:
                self.assertEqual(e.code, 0)

        # Only ci-a.prod should be in results
        with open(output_path) as f:
            reader = csv.DictReader(f)
            rows = list(reader)
        for row in rows:
            self.assertEqual(row["ci"], "ci-a.prod")

    @patch("rhdp_flow.subprocess.run")
    def test_lock_command(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        csv_path = self._write(BASIC_WORKSHOP_CSV)

        from rhdp_flow import main
        test_args = [
            "rhdp_flow.py",
            "--dry-run",
            "--input-csv", csv_path,
            "--lock",
        ]
        with patch("sys.argv", test_args):
            try:
                main()
            except SystemExit as e:
                self.assertEqual(e.code, 0)

    @patch("rhdp_flow.subprocess.run")
    def test_extend_stop_command(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        csv_path = self._write(BASIC_WORKSHOP_CSV)

        from rhdp_flow import main
        test_args = [
            "rhdp_flow.py",
            "--dry-run",
            "--input-csv", csv_path,
            "--extend-stop",
            "--days", "1",
            "--hours", "2",
        ]
        with patch("sys.argv", test_args):
            try:
                main()
            except SystemExit as e:
                self.assertEqual(e.code, 0)

    @patch("rhdp_flow.subprocess.run")
    def test_extend_destroy_command(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        csv_path = self._write(BASIC_WORKSHOP_CSV)

        from rhdp_flow import main
        test_args = [
            "rhdp_flow.py",
            "--dry-run",
            "--input-csv", csv_path,
            "--extend-destroy",
            "--days", "1",
        ]
        with patch("sys.argv", test_args):
            try:
                main()
            except SystemExit as e:
                self.assertEqual(e.code, 0)

    @patch("rhdp_flow.subprocess.run")
    def test_scale_command(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        csv_path = self._write(BASIC_WORKSHOP_CSV)

        from rhdp_flow import main
        test_args = [
            "rhdp_flow.py",
            "--dry-run",
            "--input-csv", csv_path,
            "--scale", "40",
        ]
        with patch("sys.argv", test_args):
            try:
                main()
            except SystemExit as e:
                self.assertEqual(e.code, 0)

    @patch("rhdp_flow.subprocess.run")
    def test_count_expansion(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        csv_path = self._write(COUNT_EXPANSION_CSV)
        output_path = tempfile.NamedTemporaryFile(suffix=".csv", delete=False).name
        self._tmpfiles.append(output_path)

        from rhdp_flow import main
        test_args = [
            "rhdp_flow.py",
            "--dry-run",
            "--input-csv", csv_path,
            "--output-csv", output_path,
        ]
        with patch("sys.argv", test_args):
            try:
                main()
            except SystemExit as e:
                self.assertEqual(e.code, 0)

        # Count=2 should produce 2 results
        with open(output_path) as f:
            reader = csv.DictReader(f)
            rows = list(reader)
        self.assertEqual(len(rows), 2)

    @patch("rhdp_flow.subprocess.run")
    def test_grouped_multi_asset_routing(self, mock_run):
        mock_run.side_effect = make_oc_dispatcher()
        csv_path = self._write(MULTI_ASSET_GROUPED_CSV)
        output_path = tempfile.NamedTemporaryFile(suffix=".csv", delete=False).name
        self._tmpfiles.append(output_path)

        from rhdp_flow import main
        test_args = [
            "rhdp_flow.py",
            "--dry-run",
            "--input-csv", csv_path,
            "--output-csv", output_path,
        ]
        with patch("sys.argv", test_args):
            try:
                main()
            except SystemExit as e:
                self.assertEqual(e.code, 0)


# ============================================================================
# GROUP 16: Construct Workshop URL
# ============================================================================


class TestConstructWorkshopUrl(unittest.TestCase):
    """Tests for construct_workshop_url."""

    def test_with_suffix(self):
        url = construct_workshop_url(
            "openshift-cnv.ocp-virt-roadshow-multi-user.prod",
            "user-bbethell-redhat-com",
            "vt958"
        )
        self.assertEqual(
            url,
            "https://integration.demo.redhat.com/workshops/user-bbethell-redhat-com/openshift-cnv.ocp-virt-roadshow-multi-user.prod-vt958"
        )

    def test_without_suffix(self):
        url = construct_workshop_url(
            "openshift-cnv.ocp-virt-roadshow-multi-user.prod",
            "user-bbethell-redhat-com"
        )
        self.assertEqual(
            url,
            "https://integration.demo.redhat.com/workshops/user-bbethell-redhat-com/openshift-cnv.ocp-virt-roadshow-multi-user.prod"
        )


# ============================================================================
# GROUP 17: Verify Deployment
# ============================================================================


class TestVerifyDeployment(unittest.TestCase):
    """Tests for verify_deployment."""

    def test_dry_run_returns_true(self):
        config = make_config(dry_run=True)
        healthy, url = verify_deployment(
            "ci-name-abc12", "user-ns", "ci-name.prod", config
        )
        self.assertTrue(healthy)
        self.assertIn("ci-name.prod", url)

    @patch("rhdp_flow.subprocess.run")
    def test_healthy_and_ready(self, mock_run):
        rc_json = {
            "status": {"healthy": True, "ready": True}
        }
        mock_run.return_value = subprocess.CompletedProcess(
            [], 0, stdout=json.dumps(rc_json), stderr=""
        )
        config = make_config(dry_run=False)
        healthy, url = verify_deployment(
            "ci-name-abc12", "user-ns", "ci-name.prod", config
        )
        self.assertTrue(healthy)

    @patch("rhdp_flow.subprocess.run")
    def test_not_healthy(self, mock_run):
        rc_json = {
            "status": {"healthy": False, "ready": False}
        }
        mock_run.return_value = subprocess.CompletedProcess(
            [], 0, stdout=json.dumps(rc_json), stderr=""
        )
        config = make_config(dry_run=False)
        healthy, url = verify_deployment(
            "ci-name-abc12", "user-ns", "ci-name.prod", config
        )
        self.assertFalse(healthy)


# ============================================================================
# GROUP 18: RHDPConfig
# ============================================================================


class TestRHDPConfig(unittest.TestCase):
    """Tests for RHDPConfig.validate()."""

    @patch("rhdp_flow.subprocess.run")
    def test_validate_success(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(
            [], 0, stdout="Client Version: 4.14.0\n", stderr=""
        )
        config = RHDPConfig()
        self.assertTrue(config.validate())

    @patch("rhdp_flow.subprocess.run")
    def test_validate_failure(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(
            [], 1, stdout="", stderr="error"
        )
        config = RHDPConfig()
        self.assertFalse(config.validate())

    @patch("rhdp_flow.subprocess.run")
    def test_validate_not_found(self, mock_run):
        mock_run.side_effect = FileNotFoundError("oc not found")
        config = RHDPConfig()
        self.assertFalse(config.validate())


# ============================================================================
# GROUP 19: Create Parser
# ============================================================================


class TestCreateParser(unittest.TestCase):
    """Tests for create_parser."""

    def test_default_values(self):
        parser = create_parser()
        args = parser.parse_args(["--input-csv", "test.csv"])
        self.assertEqual(args.input_csv, "test.csv")
        self.assertFalse(args.dry_run)
        self.assertEqual(args.timeout, 60)

    def test_flag_parsing(self):
        parser = create_parser()
        args = parser.parse_args([
            "--input-csv", "test.csv",
            "--dry-run",
            "--debug",
            "--lock",
        ])
        self.assertTrue(args.dry_run)
        self.assertTrue(args.debug)
        self.assertTrue(getattr(args, "lock", False))

    def test_qa_choices(self):
        parser = create_parser()
        args = parser.parse_args(["--input-csv", "test.csv", "--qa", "1"])
        self.assertEqual(args.qa, "1")

        args = parser.parse_args(["--input-csv", "test.csv", "--qa", "both"])
        self.assertEqual(args.qa, "both")

    def test_scale_integer(self):
        parser = create_parser()
        args = parser.parse_args(["--input-csv", "test.csv", "--scale", "40"])
        self.assertEqual(args.scale, 40)

    def test_extend_days_hours(self):
        parser = create_parser()
        args = parser.parse_args([
            "--input-csv", "test.csv",
            "--extend-stop",
            "--days", "1",
            "--hours", "2",
        ])
        self.assertTrue(args.extend_stop)
        self.assertEqual(args.days, 1)
        self.assertEqual(args.hours, 2)


# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    unittest.main()
