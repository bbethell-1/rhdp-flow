from lib.deploy_pace import deploy_pace_seconds


def test_auto_scales_with_batch_size():
    assert deploy_pace_seconds(1) == 0.0
    assert deploy_pace_seconds(9) == 0.0
    assert deploy_pace_seconds(10) == 0.5
    assert deploy_pace_seconds(24) == 0.5
    assert deploy_pace_seconds(25) == 1.0
    assert deploy_pace_seconds(100) == 1.0


def test_override_wins_and_clamps():
    assert deploy_pace_seconds(100, override=2.5) == 2.5
    assert deploy_pace_seconds(1, override=0) == 0.0
    assert deploy_pace_seconds(1, override=-3) == 0.0
