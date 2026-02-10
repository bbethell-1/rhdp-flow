"""Shared pytest fixtures for RHDP-Flow tests."""

import json
import os
import subprocess
import tempfile

import pytest
import sys

# Ensure rhdp_flow is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rhdp_flow import (
    WorkshopSchedule,
    DeploymentResult,
    RHDPConfig,
)


# ============================================================================
# CSV Fixture Constants
# ============================================================================

BASIC_WORKSHOP_CSV = """\
CI Name,CI,Namespace,Users,Workshop_instance_count,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Multi_Asset,Asset_CIs,Multi_Workshop_Name,Concurrency,Instances,Campaign_ID
Experience OpenShift Virtualization Roadshow,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-bbethell-redhat-com,20,2,True,Workshop1,Admin,QA,Virt Roadshow Basic,15/02/2026 11:00,15/02/2026 19:00,17/02/2026 11:00,,,,,,
"""

MULTI_ASSET_OLD_CSV = """\
CI Name,CI,Namespace,Users,Workshop_instance_count,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Multi_Asset,Asset_CIs,Multi_Workshop_Name,Concurrency,Instances,Campaign_ID
Multi Asset Workshop,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-bbethell-redhat-com,20,,True,Pass1,Admin,QA,Summit Multi,19/02/2026 10:00,19/02/2026 18:00,21/02/2026 10:00,True,"openshift-cnv.ocp-virt-roadshow-multi-user.prod,zt-ansiblebu.ansible-network-automation-basics-lab-2.event",summit-multi-2026,,,
"""

MULTI_ASSET_GROUPED_CSV = """\
CI Name,CI,Namespace,Users,Workshop_instance_count,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Multi_Asset,Asset_CIs,Multi_Workshop_Name,Concurrency,Instances,Campaign_ID
Virt Roadshow Asset,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-bbethell-redhat-com,20,,True,VirtPass1,Admin,QA,Summit Demo,19/02/2026 10:00,19/02/2026 18:00,21/02/2026 10:00,,,summit-demo-2026,,,
Ansible Lab Asset,zt-ansiblebu.ansible-network-automation-basics-lab-2.event,user-bbethell-redhat-com,20,,True,AnsPass2,Admin,QA,Summit Demo,19/02/2026 10:00,19/02/2026 18:00,21/02/2026 10:00,,,summit-demo-2026,,,
"""

INSTANCES_AND_CONCURRENCY_CSV = """\
CI Name,CI,Namespace,Users,Workshop_instance_count,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Multi_Asset,Asset_CIs,Multi_Workshop_Name,Concurrency,Instances,Campaign_ID
OpenShift AI Workshop,openshift-ai.ai-workshop-multi-user.prod,user-bbethell-redhat-com,40,,True,AIPass1,Admin,Demo,AI Workshop,17/02/2026 10:00,17/02/2026 18:00,19/02/2026 10:00,,,,3,30,
"""

OLD_DATE_HEADERS_CSV = """\
CI Name,CI,Namespace,Users,Workshop_instance_count,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date,Auto-stop,Auto-destroy,Multi_Asset,Asset_CIs,Multi_Workshop_Name,Concurrency,Instances,Campaign_ID
Basic Workshop,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-bbethell-redhat-com,20,,True,Pass1,Admin,QA,Old Headers,15/02/2026 11:00,15/02/2026 19:00,17/02/2026 11:00,,,,,,
"""

MISSING_HEADERS_CSV = """\
CI Name,CI,Namespace
Basic Workshop,some-ci,some-ns
"""


# ============================================================================
# Factory functions
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
        campaign_id="",
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
    """
    overrides = overrides or {}

    def dispatcher(*args, **kwargs):
        cmd = args[0] if args else kwargs.get("args", [])
        if not cmd or len(cmd) < 2:
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        subcmd = cmd[1]
        resource_type = cmd[2] if len(cmd) > 2 else ""
        key = (subcmd, resource_type)
        if key in overrides:
            val = overrides[key]
            return val() if callable(val) else val

        if subcmd == "version":
            return subprocess.CompletedProcess(
                cmd, 0, stdout="Client Version: 4.14.0\n", stderr=""
            )

        if subcmd == "create":
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
            api_prefix = api_map.get(
                kind_lower, f"{kind_lower}.babylon.gpte.redhat.com"
            )
            if name_prefix.endswith("-"):
                actual_name = f"{name_prefix}abc12"
            else:
                actual_name = name_prefix
            stdout = f"{api_prefix}/{actual_name} created\n"
            return subprocess.CompletedProcess(cmd, 0, stdout=stdout, stderr="")

        if subcmd == "get":
            resource = cmd[2] if len(cmd) > 2 else ""
            if resource == "workshop":
                jsonpath_arg = None
                for arg in cmd:
                    if "jsonpath" in str(arg):
                        jsonpath_arg = arg
                        break
                if jsonpath_arg and "workshop-id" in jsonpath_arg:
                    return subprocess.CompletedProcess(cmd, 0, stdout="m5hzmw", stderr="")
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
                return subprocess.CompletedProcess(
                    cmd, 0,
                    stdout="workshop.babylon.gpte.redhat.com/test-workshop",
                    stderr=""
                )

            if resource == "workshopprovision":
                if any("jsonpath" in str(a) for a in cmd):
                    return subprocess.CompletedProcess(cmd, 0, stdout="test-workshop", stderr="")
                return subprocess.CompletedProcess(
                    cmd, 0,
                    stdout=json.dumps({
                        "items": [{
                            "metadata": {"name": "test-workshop"},
                            "spec": {
                                "lifespan": {"end": "2026-02-17T11:00:00Z"},
                                "count": 20,
                            },
                        }]
                    }),
                    stderr=""
                )

            if resource in ("resourceclaim", "resourceclaims"):
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

        if subcmd == "patch":
            resource = cmd[2] if len(cmd) > 2 else "resource"
            name = cmd[3] if len(cmd) > 3 else "unknown"
            return subprocess.CompletedProcess(
                cmd, 0, stdout=f"{resource}/{name} patched\n", stderr=""
            )

        if subcmd == "delete":
            return subprocess.CompletedProcess(cmd, 0, stdout="deleted\n", stderr="")

        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    return dispatcher


def write_csv_tempfile(csv_text):
    """Write CSV text to a temporary file, return path."""
    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".csv", delete=False, encoding="utf-8"
    )
    tmp.write(csv_text)
    tmp.close()
    return tmp.name


# ============================================================================
# Pytest fixtures
# ============================================================================

@pytest.fixture
def sample_schedule():
    return make_schedule()


@pytest.fixture
def mock_config():
    return make_config(dry_run=True)


@pytest.fixture
def dry_config():
    return make_config(dry_run=True)


@pytest.fixture
def basic_csv_file(tmp_path):
    p = tmp_path / "basic.csv"
    p.write_text(BASIC_WORKSHOP_CSV)
    return str(p)
