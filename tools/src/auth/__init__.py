"""OAuth and API key management stubs — extend for production use."""

def list_providers() -> list[str]:
    return []

def get_api_key(provider: str) -> str | None:
    import os
    env_map = {
        "anthropic": "ANTHROPIC_API_KEY",
        "openrouter": "OPENROUTER_API_KEY",
        "deepseek": "DEEPSEEK_API_KEY",
    }
    key = env_map.get(provider)
    return os.environ.get(key) if key else None
