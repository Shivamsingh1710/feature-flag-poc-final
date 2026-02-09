from __future__ import annotations

import os
import inspect
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# -----------------------------
# Load backend/.env reliably
# -----------------------------
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
load_dotenv(dotenv_path=ENV_PATH)

# -----------------------------
# OpenFeature (flagd mode)
# -----------------------------
from openfeature import api as openfeature
from openfeature.evaluation_context import EvaluationContext
from openfeature.contrib.provider.flagd import FlagdProvider

# -----------------------------
# Config
# -----------------------------
FLAGD_HOST = os.getenv("FLAGD_HOST", "localhost")
FLAGD_PORT = int(os.getenv("FLAGD_PORT", "8013"))
FLAGD_TLS = os.getenv("FLAGD_TLS", "false").lower() in {"1", "true", "yes"}

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").rstrip("/")

BACKEND_PROVIDER = os.getenv("BACKEND_PROVIDER", "flagd").lower().strip()

LD_SDK_KEY = os.getenv("LD_SDK_KEY", "dummy-offline-sdk-key")
LD_FLAGS_FILE = os.getenv("LD_FLAGS_FILE", "./launchdarkly/ld-flags.json")

# Make LD flags file path absolute and robust
_ld_flags_path = Path(LD_FLAGS_FILE)
if not _ld_flags_path.is_absolute():
    _ld_flags_path = (BASE_DIR / _ld_flags_path).resolve()

# -----------------------------
# Globals initialized at startup
# -----------------------------
_of_client = None
_ld_client = None


# -----------------------------
# Helpers
# -----------------------------
def build_of_context(user_id: Optional[str]) -> EvaluationContext:
    uid = user_id or "anonymous"
    return EvaluationContext(
        targeting_key=uid,
        attributes={"userId": uid},
    )


def build_ld_context(user_id: Optional[str]):
    """
    LaunchDarkly Python SDK (newer versions) expects a Context object,
    not a dict. This fixes: "'dict' object has no attribute 'valid'".
    """
    uid = user_id or "anonymous"

    # Import here so only needed when LD provider is used
    from ldclient import Context

    # Build a single-kind context with key=uid
    # Add userId attribute too (optional)
    # If your SDK doesn't support builder(), fallback to create()
    if hasattr(Context, "builder"):
        b = Context.builder(uid)
        # add attributes used in rules if you ever use them
        b.set("userId", uid)
        return b.build()

    # Older-compatible fallback
    if hasattr(Context, "create"):
        return Context.create(uid)

    raise RuntimeError("LaunchDarkly SDK Context API not found (unexpected SDK version)")


# -----------------------------
# Provider wiring
# -----------------------------
def _init_flagd_openfeature() -> None:
    global _of_client
    provider = FlagdProvider(host=FLAGD_HOST, port=FLAGD_PORT, tls=FLAGD_TLS)
    openfeature.set_provider(provider)
    _of_client = openfeature.get_client("backend")
    print(f"[Backend] Provider=flagd ({FLAGD_HOST}:{FLAGD_PORT}, tls={FLAGD_TLS})")


def _init_launchdarkly_file_mode() -> None:
    """
    LaunchDarkly local evaluation using file datasource (offline-like).
    No cloud calls; reads from local JSON file only.
    """
    global _ld_client

    if not _ld_flags_path.exists():
        raise RuntimeError(f"[LaunchDarkly] Flags file not found: {_ld_flags_path}")

    import ldclient
    from ldclient.config import Config
    from ldclient.integrations import Files

    file_data_source = Files.new_data_source(
        paths=[str(_ld_flags_path)],
        auto_update=True
    )

    # Build Config kwargs compatible with multiple LD SDK versions
    cfg_kwargs = {"send_events": False}

    sig = inspect.signature(Config.__init__)
    params = sig.parameters

    if "update_processor_class" in params:
        cfg_kwargs["update_processor_class"] = file_data_source
    elif "data_source" in params:
        cfg_kwargs["data_source"] = file_data_source
    elif "update_processor" in params:
        cfg_kwargs["update_processor"] = file_data_source
    else:
        raise RuntimeError(
            "[LaunchDarkly] Unsupported SDK version: cannot attach file datasource. "
            f"Config params={list(params.keys())}"
        )

    # IMPORTANT: do NOT set offline=True here (can force defaults-only behavior)
    ldclient.set_config(Config(LD_SDK_KEY, **cfg_kwargs))
    _ld_client = ldclient.get()

    # Some versions allow waiting for init; safe to ignore errors
    if hasattr(_ld_client, "wait_for_initialization"):
        try:
            _ld_client.wait_for_initialization(2)
        except Exception:
            pass

    print(f"[Backend] Provider=launchdarkly (file={_ld_flags_path})")


def ff_bool(flag_key: str, default: bool, user_id: str) -> bool:
    if BACKEND_PROVIDER == "launchdarkly":
        if _ld_client is None:
            raise RuntimeError("LaunchDarkly client not initialized")
        ctx = build_ld_context(user_id)
        return bool(_ld_client.variation(flag_key, ctx, default))

    if _of_client is None:
        raise RuntimeError("OpenFeature client not initialized")
    ctx = build_of_context(user_id)
    return bool(_of_client.get_boolean_value(flag_key, default, ctx))


def ff_str(flag_key: str, default: str, user_id: str) -> str:
    if BACKEND_PROVIDER == "launchdarkly":
        if _ld_client is None:
            raise RuntimeError("LaunchDarkly client not initialized")
        ctx = build_ld_context(user_id)
        v = _ld_client.variation(flag_key, ctx, default)
        return str(v)

    if _of_client is None:
        raise RuntimeError("OpenFeature client not initialized")
    ctx = build_of_context(user_id)
    return str(_of_client.get_string_value(flag_key, default, ctx))


# -----------------------------
# FastAPI app
# -----------------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_init() -> None:
    global BACKEND_PROVIDER
    BACKEND_PROVIDER = os.getenv("BACKEND_PROVIDER", BACKEND_PROVIDER).lower().strip()

    try:
        if BACKEND_PROVIDER == "launchdarkly":
            _init_launchdarkly_file_mode()
        else:
            _init_flagd_openfeature()
    except Exception as e:
        print(f"[Backend] Startup init failed: {e}")
        raise


# -----------------------------
# Routes
# -----------------------------
@app.get("/api/healthz")
def healthz() -> dict:
    return {
        "status": "ok",
        "backendProvider": BACKEND_PROVIDER,
        "frontendOrigin": FRONTEND_ORIGIN,
        "ldFlagsFile": str(_ld_flags_path) if BACKEND_PROVIDER == "launchdarkly" else None,
    }


@app.get("/api/flags")
def get_flags(userId: str = "anonymous") -> dict:
    try:
        new_badge = ff_bool("new-badge", False, userId)
        cta_color = ff_str("cta-color", "blue", userId)
        api_enabled = ff_bool("api-new-endpoint-enabled", False, userId)

        return {
            "newBadge": new_badge,
            "ctaColor": cta_color,
            "apiNewEndpointEnabled": api_enabled,
            "provider": BACKEND_PROVIDER,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Flag evaluation failed: {e}")


@app.get("/api/hello")
def hello(userId: str = "anonymous") -> dict:
    on = ff_bool("new-badge", False, userId)
    return {"message": "New feature is ON 🎉 (from backend)"} if on else {"message": "New feature is OFF (from backend)"}


@app.get("/api/secret")
def secret(userId: str = "anonymous") -> dict:
    allowed = ff_bool("api-new-endpoint-enabled", False, userId)
    if not allowed:
        raise HTTPException(status_code=403, detail="Feature disabled by flag")
    return {"secret": "🍪 super secret data"}