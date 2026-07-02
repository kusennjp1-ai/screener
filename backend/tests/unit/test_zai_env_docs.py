"""Regression checks for Z.AI env examples and Compose propagation."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_backend_env_example_documents_zai_settings() -> None:
    content = (ROOT / "backend" / ".env.example").read_text()

    assert "ZAI_API_KEY=" in content
    assert "ZAI_API_KEYS=" in content
    assert "ZAI_API_BASE=https://api.z.ai/api/paas/v4" in content


def test_docker_env_example_documents_zai_settings() -> None:
    content = (ROOT / ".env.docker.example").read_text()

    assert "ZAI_API_KEY=" in content
    assert "ZAI_API_KEYS=" in content
    assert "ZAI_API_BASE=https://api.z.ai/api/paas/v4" in content
    assert "not from backend/.env" in content


def test_docker_compose_forwards_zai_settings_to_theme_services() -> None:
    """Every backend-family service must receive the Z.AI settings.

    The compose file forwards them via the shared ``x-app-env`` anchor
    (mapping-form environment merged with ``<<:``), so assert semantically
    on the loaded YAML rather than counting raw list-form strings.
    """
    import yaml

    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text())

    app_env = compose.get("x-app-env") or {}
    assert app_env.get("ZAI_API_KEY") == "${ZAI_API_KEY:-}"
    assert app_env.get("ZAI_API_KEYS") == "${ZAI_API_KEYS:-}"
    assert app_env.get("ZAI_API_BASE") == "${ZAI_API_BASE:-https://api.z.ai/api/paas/v4}"

    # The anchor must actually reach the theme-processing services: safe_load
    # resolves the ``<<: *app-env`` merges, so each service's environment
    # carries the keys.
    services = compose.get("services") or {}
    forwarded = [
        name
        for name, svc in services.items()
        if isinstance(svc, dict)
        and isinstance(svc.get("environment"), dict)
        and svc["environment"].get("ZAI_API_KEY") == "${ZAI_API_KEY:-}"
        and svc["environment"].get("ZAI_API_KEYS") == "${ZAI_API_KEYS:-}"
    ]
    assert len(forwarded) >= 4, f"Z.AI env reaches only: {forwarded}"
