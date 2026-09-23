from rhdp_flow import multi_asset_workshop_generate_name


def test_short_names_stay_readable():
    p = multi_asset_workshop_generate_name("rheltrouble", "short.ci")
    assert p == "rheltrouble-short-ci-"
    assert p.endswith("-")
    assert len(p) <= 58


def test_lb1577_assets_do_not_collide():
    """Naive truncation dropped -1/-2 and made all five LB1577 assets identical."""
    mw = "rheltrouble"
    prefixes = [
        multi_asset_workshop_generate_name(
            mw, f"summit-2026.lb1577-rhel-troubleshooting-{i}"
        )
        for i in range(1, 6)
    ]
    assert len(set(prefixes)) == 5, prefixes
    for p in prefixes:
        assert p.endswith("-")
        assert len(p) <= 58
        # final name = prefix + ~5 char suffix must fit in 63
        assert len(p) + 5 <= 63


def test_display_name_length_irrelevant():
    # Long display names are annotations; generateName comes from CI + multi name
    p = multi_asset_workshop_generate_name(
        "rheltrouble",
        "summit-2026.lb1577-rhel-troubleshooting-1",
    )
    assert "troubleshooting" in p or len(p) <= 58
    assert p.startswith("rheltrouble-")
