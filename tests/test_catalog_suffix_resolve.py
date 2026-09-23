"""Wrong-suffix / bare-CI auto-correct for validate_catalog_item_exists."""

from unittest.mock import patch

from rhdp_flow import _catalog_exists_cache, validate_catalog_item_exists
from tests.conftest import make_config


def _clear_cache():
    _catalog_exists_cache.clear()


def test_wrong_event_suffix_auto_corrects_to_prod():
    """Labagator inventing .event when only .prod exists should still auto-fix."""
    _clear_cache()
    cfg = make_config()
    index = {
        "zt-rhelbu.zt-rhel-troubleshooting-1.prod": ["babylon-catalog-prod"],
    }
    with patch("rhdp_flow._catalog_name_index", return_value=index):
        exists, found_ns, suggestion, suggested_ci, options = validate_catalog_item_exists(
            "zt-rhelbu.zt-rhel-troubleshooting-1.event",
            "babylon-catalog-event",
            cfg,
        )
    assert exists is False
    assert found_ns is None
    assert suggested_ci == "zt-rhelbu.zt-rhel-troubleshooting-1.prod"
    assert "zt-rhelbu.zt-rhel-troubleshooting-1.prod" in options
    assert suggestion and ".prod" in suggestion


def test_bare_ci_prefers_event_when_both_published():
    _clear_cache()
    cfg = make_config()
    index = {
        "my-ci.event": ["babylon-catalog-event"],
        "my-ci.prod": ["babylon-catalog-prod"],
    }
    with patch("rhdp_flow._catalog_name_index", return_value=index):
        exists, _ns, _sug, suggested_ci, options = validate_catalog_item_exists(
            "my-ci", "babylon-catalog-prod", cfg
        )
    assert exists is False
    assert suggested_ci == "my-ci.event"
    assert set(options) == {"my-ci.event", "my-ci.prod"}


def test_bare_ci_defaults_to_prod_when_no_event():
    _clear_cache()
    cfg = make_config()
    index = {
        "zt-ansiblebu.zt-ans-bu-roadshow01.prod": ["babylon-catalog-prod"],
    }
    with patch("rhdp_flow._catalog_name_index", return_value=index):
        exists, _ns, suggestion, suggested_ci, options = validate_catalog_item_exists(
            "zt-ansiblebu.zt-ans-bu-roadshow01",
            "babylon-catalog-event",
            cfg,
        )
    assert exists is False
    assert suggested_ci == "zt-ansiblebu.zt-ans-bu-roadshow01.prod"
    assert options == ["zt-ansiblebu.zt-ans-bu-roadshow01.prod"]
    assert suggestion and "auto-correcting" in suggestion.lower()
