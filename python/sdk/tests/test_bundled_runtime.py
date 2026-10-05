"""Keyless boot tests for the production exe and development dsh carrier.

Each carrier skips independently when absent. The SDK profile registers no
provider route by default, so each boot patches in a loopback pi-ai route; its
dummy key only satisfies route resolution, and initialize and shutdown do not
call a model.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from deepseek_harness import DeepSeekHarness, HarnessClient, HarnessConfig
from deepseek_harness.errors import JsonRpcError, TransportClosedError
from deepseek_harness_runtime import RUNTIME_MODE_ENV_VAR, resolve_bundled_launch_args

_MODES = ("exe", "node")
_PROVIDER = "boot"
_MODEL = "boot-model"


def _route_patch(tmp_path: Path) -> Path:
    patch = tmp_path / "route.patch.yml"
    patch.write_text(json.dumps([{
        "id": "llm-pi-ai",
        "config": {"providers": {_PROVIDER: {
            "apiKeyEnv": "BOOT_API_KEY",
            "api": "anthropic-messages",
            "baseURL": "http://127.0.0.1:9",
            "models": [{"id": _MODEL}],
        }}},
    }]))
    return patch


def _select_mode(mode: str, monkeypatch: pytest.MonkeyPatch) -> None:
    try:
        resolve_bundled_launch_args(mode)
    except FileNotFoundError as exc:
        pytest.skip(f"bundled {mode}-mode runtime unavailable on this machine: {exc}")
    monkeypatch.setenv(RUNTIME_MODE_ENV_VAR, mode)


def _client(tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch, *patches: Path) -> HarnessClient:
    _select_mode(mode, monkeypatch)
    return HarnessClient(
        HarnessConfig(
            dsh_home=str(tmp_path / "home"),
            patches=(str(_route_patch(tmp_path)), *(str(patch) for patch in patches)),
            cwd=str(tmp_path),
            env={
                "BOOT_API_KEY": "sk-dummy-for-boot",
                "DSH_PERMISSION_MODE": "danger-full-access",
                "DSH_TELEMETRY_DISABLED": "1",
            },
            request_timeout_seconds=120,
        )
    )


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_boots_the_sdk_profile(
    tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _client(tmp_path, mode, monkeypatch) as client:
        init = client.initialize(provider=_PROVIDER, cwd=str(tmp_path), model=_MODEL)

    assert init.serverInfo is not None
    assert init.serverInfo.name == "ahel-desktop-sdk-runtime"
    profile = json.loads((tmp_path / "home" / "profiles" / "sdk" / "package.json").read_text())
    assert profile["dsh"]["profile"]["bundles"] == [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-agent-tools",
        "@deepseek-ai/dsh-sdk-app",
    ]


@pytest.mark.parametrize("mode", _MODES)
def test_python_sdk_applies_an_ordered_profile_patch(
    tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _select_mode(mode, monkeypatch)
    patch = tmp_path / "persona.patch.yml"
    patch.write_text(json.dumps([{
        "id": "system-prompt",
        "config": {"persona": "Python SDK ordered patch marker."},
    }]))
    harness = DeepSeekHarness(
        provider=_PROVIDER,
        model=_MODEL,
        cwd=str(tmp_path),
        dsh_home=str(tmp_path / "home"),
        patches=(str(_route_patch(tmp_path)), str(patch)),
        env={"DSH_PERMISSION_MODE": "danger-full-access", "BOOT_API_KEY": "sk-dummy-for-boot"},
        request_timeout_seconds=120,
    )

    with harness:
        pass


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_surfaces_unbundled_plugin_failure(
    tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    patch = tmp_path / "missing.patch.yml"
    patch.write_text(json.dumps([{
        "insert": [{"id": "missing", "name": "@deepseek-ai/dsh-does-not-exist"}],
    }]))

    client = _client(tmp_path, mode, monkeypatch, patch)
    client.start()
    try:
        with pytest.raises((JsonRpcError, TransportClosedError, TimeoutError)) as excinfo:
            client.initialize(provider=_PROVIDER, cwd=str(tmp_path), model=_MODEL)
    finally:
        client.close()

    assert "@deepseek-ai/dsh-does-not-exist" in str(excinfo.value)
