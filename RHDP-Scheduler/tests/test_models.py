"""Tests for WorkshopSchedule and DeploymentResult dataclasses."""

from rhdp_flow import WorkshopSchedule, DeploymentResult
from tests.conftest import make_schedule


def test_workshop_schedule_defaults():
    s = make_schedule()
    assert s.ci_name == "Experience OpenShift Virtualization Roadshow"
    assert s.users == 20
    assert s.is_multi_asset is False
    assert s.concurrency == 1
    assert s.salesforce_ids == ""


def test_workshop_schedule_overrides():
    s = make_schedule(users=40, instances=30, salesforce_ids="71403328")
    assert s.users == 40
    assert s.instances == 30
    assert s.salesforce_ids == "71403328"


def test_deployment_result_fields():
    r = DeploymentResult(
        ci_name="Test", ci="ci", namespace="ns",
        guid="g", url="u", status="verified",
        provisioning_date="", auto_stop="", auto_destroy="",
        timestamp="t", error_message="",
    )
    assert r.status == "verified"
    assert r.error_message == ""
    assert r.password == ""
