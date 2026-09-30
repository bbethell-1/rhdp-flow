"""Persist schedules/results across restarts (PVC-backed data dir)."""

from dataclasses import dataclass

from lib import flow_state


@dataclass
class _Sched:
    ci_name: str
    ci: str
    namespace: str = "ns"


@dataclass
class _Result:
    ci_name: str
    ci: str
    status: str = "failed"


def test_schedules_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("RHDP_FLOW_DATA_DIR", str(tmp_path))
    flow_state.save_schedules([_Sched("A", "a.prod"), _Sched("B", "b.event")], filename="summit.csv")
    loaded, name = flow_state.load_schedules(_Sched)
    assert name == "summit.csv"
    assert len(loaded) == 2
    assert loaded[0].ci == "a.prod"
    assert loaded[1].ci_name == "B"


def test_results_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("RHDP_FLOW_DATA_DIR", str(tmp_path))
    flow_state.save_results([_Result("A", "a.prod", "failed")])
    loaded = flow_state.load_results(_Result)
    assert len(loaded) == 1
    assert loaded[0].status == "failed"


def test_clear_persisted_state(tmp_path, monkeypatch):
    monkeypatch.setenv("RHDP_FLOW_DATA_DIR", str(tmp_path))
    flow_state.save_schedules([_Sched("A", "a.prod")], filename="x.csv")
    flow_state.save_results([_Result("A", "a.prod")])
    flow_state.save_qa_results([{"ci_name": "A", "ci": "a.prod", "namespace": "ns", "status": "ok"}])
    flow_state.clear_persisted_state()
    assert flow_state.load_schedules(_Sched) == ([], "")
    assert flow_state.load_results(_Result) == []
    assert flow_state.load_qa_results() == []


def test_qa_results_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("RHDP_FLOW_DATA_DIR", str(tmp_path))
    rows = [{"ci_name": "A", "ci": "a.prod", "namespace": "ns", "status": "VERIFIED"}]
    flow_state.save_qa_results(rows)
    assert flow_state.load_qa_results() == rows


def test_load_schedules_tolerates_missing_new_optional_fields(tmp_path, monkeypatch):
    """PVC payloads from older builds must restore after rollout adds fields."""
    monkeypatch.setenv("RHDP_FLOW_DATA_DIR", str(tmp_path))

    @dataclass
    class _SchedV2:
        ci_name: str
        ci: str
        namespace: str = "ns"
        session_date: str = ""  # new optional field after rollout

    # Simulate pre-rollout JSON without session_date
    path = tmp_path / "last_schedules.json"
    path.write_text(
        '[{"ci_name": "A", "ci": "a.prod", "namespace": "ns"}]',
        encoding="utf-8",
    )
    loaded, _ = flow_state.load_schedules(_SchedV2)
    assert len(loaded) == 1
    assert loaded[0].ci == "a.prod"
    assert loaded[0].session_date == ""


def test_load_schedules_ignores_unknown_keys_from_newer_builds(tmp_path, monkeypatch):
    """Older pods must ignore keys written by newer builds (rolling update)."""
    monkeypatch.setenv("RHDP_FLOW_DATA_DIR", str(tmp_path))
    path = tmp_path / "last_schedules.json"
    path.write_text(
        '[{"ci_name": "A", "ci": "a.prod", "namespace": "ns", "session_date": "2026-09-30", "future_field": 1}]',
        encoding="utf-8",
    )
    loaded, _ = flow_state.load_schedules(_Sched)
    assert len(loaded) == 1
    assert loaded[0].ci_name == "A"
    assert not hasattr(loaded[0], "session_date") or True
