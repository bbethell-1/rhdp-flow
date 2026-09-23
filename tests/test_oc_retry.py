import subprocess

from lib.oc_retry import is_transient_oc_failure, run_oc_with_retries


class _Cfg:
    retry_attempts = 3
    retry_delay = 0.01
    timeout = 5
    oc_command = "oc"


def test_transient_markers():
    assert is_transient_oc_failure("Unable to connect to the server: dial tcp 1.2.3.4:6443")
    assert is_transient_oc_failure("etcdserver: leader changed")
    assert is_transient_oc_failure(exc=subprocess.TimeoutExpired(cmd=["oc"], timeout=1))
    assert not is_transient_oc_failure('Error from server (AlreadyExists): resourceclaims "x" already exists')
    assert not is_transient_oc_failure("Error from server (Forbidden): ...")


def test_run_oc_retries_then_succeeds(monkeypatch):
    calls = {"n": 0}

    def fake_run(*_a, **_k):
        calls["n"] += 1
        if calls["n"] < 3:
            return subprocess.CompletedProcess(
                args=["oc"], returncode=1, stdout="", stderr="Unable to connect to the server: dial tcp"
            )
        return subprocess.CompletedProcess(args=["oc"], returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    result = run_oc_with_retries(["oc", "create", "-f", "x"], config=_Cfg())
    assert result.returncode == 0
    assert calls["n"] == 3


def test_run_oc_no_retry_on_already_exists(monkeypatch):
    calls = {"n": 0}

    def fake_run(*_a, **_k):
        calls["n"] += 1
        return subprocess.CompletedProcess(
            args=["oc"],
            returncode=1,
            stdout="",
            stderr='Error from server (AlreadyExists): workshops "x" already exists',
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    result = run_oc_with_retries(["oc", "create", "-f", "x"], config=_Cfg())
    assert result.returncode == 1
    assert calls["n"] == 1
