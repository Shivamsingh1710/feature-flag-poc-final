from __future__ import annotations

import os
import inspect
import json
from pathlib import Path
from typing import Optional, Tuple, Dict, Any

from fastapi import FastAPI, HTTPException, Request
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

# GrowthBook & Flagsmith files (backend will read these directly)
GROWTHBOOK_FEATURES_FILE = os.getenv(
    "GROWTHBOOK_FEATURES_FILE", "../frontend/public/growthbook/features.json"
)
FLAGSMITH_ENV_FILE = os.getenv(
    "FLAGSMITH_ENV_FILE", "../frontend/public/flagsmith/environment.json"
)

# Normalize file paths to absolute
def _abs(p: str) -> Path:
    q = Path(p)
    return (BASE_DIR / q).resolve() if not q.is_absolute() else q

_ld_flags_path = _abs(LD_FLAGS_FILE)
_gb_features_path = _abs(GROWTHBOOK_FEATURES_FILE)
_fs_env_path = _abs(FLAGSMITH_ENV_FILE)

# -----------------------------
# Globals initialized at startup
# -----------------------------
_of_client = None          # flagd OpenFeature client
_ld_client = None          # LaunchDarkly client

# Cached docs for GrowthBook/Flagsmith
_gb_doc: Optional[Dict[str, Any]] = None
_gb_mtime: Optional[float] = None

_fs_doc: Optional[Dict[str, Any]] = None
_fs_mtime: Optional[float] = None

# For Flagsmith quick lookup (rebuilt when file reloads)
_fs_feature_id_by_name: Dict[str, int] = {}
_fs_segment_by_id: Dict[int, Dict[str, Any]] = {}
_fs_states_by_fid: Dict[int, list] = {}

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
    Build LaunchDarkly Context for given userId.
    """
    uid = user_id or "anonymous"
    from ldclient import Context
    if hasattr(Context, "builder"):
        b = Context.builder(uid)
        b.set("userId", uid)
        return b.build()
    if hasattr(Context, "create"):
        return Context.create(uid)
    raise RuntimeError("LaunchDarkly SDK Context API not found")

def _load_json_with_cache(path: Path, last_mtime: Optional[float]) -> Tuple[Optional[Dict[str, Any]], Optional[float]]:
    """
    Read a JSON file only if modified (based on mtime).
    Returns (new_doc_or_None, new_mtime_or_old).
    """
    if not path.exists():
        raise RuntimeError(f"JSON file not found: {path}")
    mtime = path.stat().st_mtime
    if last_mtime is None or mtime > last_mtime:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f), mtime
    return None, last_mtime

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
        raise RuntimeError("[LaunchDarkly] Unsupported SDK version: cannot attach file datasource.")

    # Do NOT set offline=True (can force defaults-only behavior in some SDK versions with file source)
    ldclient.set_config(Config(LD_SDK_KEY, **cfg_kwargs))
    _ld_client = ldclient.get()
    if hasattr(_ld_client, "wait_for_initialization"):
        try:
            _ld_client.wait_for_initialization(2)
        except Exception:
            pass

    print(f"[Backend] Provider=launchdarkly (file={_ld_flags_path})")

# -----------------------------
# GrowthBook evaluator (offline JSON)
# -----------------------------
def _gb_reload_if_needed() -> None:
    global _gb_doc, _gb_mtime
    doc, new_mtime = _load_json_with_cache(_gb_features_path, _gb_mtime)
    if doc is not None:
        _gb_doc = doc
        _gb_mtime = new_mtime

def _gb_get_value(flag_key: str, default: Any, user_id: str) -> Any:
    _gb_reload_if_needed()
    if not _gb_doc:
        return default
    feat = _gb_doc.get(flag_key)
    if not feat:
        return default

    attrs = {"userId": user_id}
    # Rules: [{ "condition": { "userId": "pradyun" }, "force": true }]
    for rule in feat.get("rules", []):
        cond = rule.get("condition", {})
        matched = all(str(attrs.get(k)) == str(v) for k, v in (cond or {}).items())
        if matched:
            return rule.get("force", feat.get("defaultValue", default))
    return feat.get("defaultValue", default)

# -----------------------------
# Flagsmith evaluator (offline JSON with segments + feature_states)
# -----------------------------
def _fs_reload_if_needed() -> None:
    global _fs_doc, _fs_mtime, _fs_feature_id_by_name, _fs_segment_by_id, _fs_states_by_fid
    doc, new_mtime = _load_json_with_cache(_fs_env_path, _fs_mtime)
    if doc is None:
        return
    _fs_doc = doc
    _fs_mtime = new_mtime

    _fs_feature_id_by_name.clear()
    for f in (_fs_doc.get("features") or []):
        _fs_feature_id_by_name[str(f["name"])] = int(f["id"])

    _fs_segment_by_id.clear()
    for s in (_fs_doc.get("segments") or []):
        _fs_segment_by_id[int(s["id"])] = s

    _fs_states_by_fid.clear()
    for st in (_fs_doc.get("feature_states") or []):
        fid = int(st["feature_id"])
        arr = _fs_states_by_fid.get(fid, [])
        arr.append(st)
        _fs_states_by_fid[fid] = arr

def _fs_match_segment(segment: Dict[str, Any], attrs: Dict[str, Any]) -> bool:
    for rule in segment.get("rules") or []:
        if rule.get("type") != "ALL":
            continue
        for cond in rule.get("conditions") or []:
            op = cond.get("operator")
            prop = cond.get("property")
            val = cond.get("value")
            if op == "EQUAL":
                if str(attrs.get(prop)) != str(val):
                    return False
            else:
                # unsupported → no match
                return False
    return True

def _fs_resolve_state(flag_key: str, attrs: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    _fs_reload_if_needed()
    if not _fs_doc:
        return None

    fid = _fs_feature_id_by_name.get(flag_key)
    if not fid:
        return None

    states = _fs_states_by_fid.get(fid) or []
    if not states:
        return None

    matched_seg_ids = []
    for seg_id, seg in _fs_segment_by_id.items():
        if _fs_match_segment(seg, attrs):
            matched_seg_ids.append(seg_id)

    # Prefer segment-specific state in file order
    for st in states:
        if st.get("segment_id") is not None and int(st["segment_id"]) in matched_seg_ids:
            return st

    # Fall back to no-segment state
    for st in states:
        if st.get("segment_id") is None:
            return st
    return None

def _fs_bool_from_state(state: Optional[Dict[str, Any]], default: bool) -> bool:
    if not state:
        return bool(default)
    if state.get("value") is None:
        return bool(state.get("enabled", default))
    return bool(state["value"])

def _fs_str_from_state(state: Optional[Dict[str, Any]], default: str) -> str:
    if not state:
        return str(default)
    if state.get("value") is None:
        return str(default)
    return str(state["value"])

# -----------------------------
# Unified evaluators
# -----------------------------
def _effective_provider(req_provider: Optional[str]) -> str:
    p = (req_provider or BACKEND_PROVIDER or "flagd").lower().strip()
    if p not in {"flagd", "launchdarkly", "growthbook", "flagsmith"}:
        p = BACKEND_PROVIDER
    return p

def ff_bool(flag_key: str, default: bool, user_id: str, provider: Optional[str] = None) -> bool:
    p = _effective_provider(provider)
    if p == "launchdarkly":
        if _ld_client is None:
            raise RuntimeError("LaunchDarkly client not initialized")
        ctx = build_ld_context(user_id)
        return bool(_ld_client.variation(flag_key, ctx, default))

    if p == "flagd":
        if _of_client is None:
            raise RuntimeError("OpenFeature (flagd) client not initialized")
        ctx = build_of_context(user_id)
        return bool(_of_client.get_boolean_value(flag_key, default, ctx))

    if p == "growthbook":
        return bool(_gb_get_value(flag_key, default, user_id))

    if p == "flagsmith":
        state = _fs_resolve_state(flag_key, {"userId": user_id})
        return _fs_bool_from_state(state, default)

    # fallback
    return bool(default)

def ff_str(flag_key: str, default: str, user_id: str, provider: Optional[str] = None) -> str:
    p = _effective_provider(provider)
    if p == "launchdarkly":
        if _ld_client is None:
            raise RuntimeError("LaunchDarkly client not initialized")
        ctx = build_ld_context(user_id)
        v = _ld_client.variation(flag_key, ctx, default)
        return str(v)

    if p == "flagd":
        if _of_client is None:
            raise RuntimeError("OpenFeature (flagd) client not initialized")
        ctx = build_of_context(user_id)
        return str(_of_client.get_string_value(flag_key, default, ctx))

    if p == "growthbook":
        v = _gb_get_value(flag_key, default, user_id)
        return str(v)

    if p == "flagsmith":
        state = _fs_resolve_state(flag_key, {"userId": user_id})
        return _fs_str_from_state(state, default)

    return str(default)

# -----------------------------
# FastAPI app
# -----------------------------
app = FastAPI()

# DEV: open CORS to avoid origin mismatches blocking your button clicks.
# Once validated, you can revert to [FRONTEND_ORIGIN].
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # <-- permissive for dev
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple request logging to confirm the backend is hit when clicking buttons
@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"[HTTP] {request.method} {request.url}")
    try:
        response = await call_next(request)
        return response
    finally:
        pass

@app.on_event("startup")
def startup_init() -> None:
    """
    Initialize providers on startup.
    We'll prep flagd OpenFeature client and LD client so they're ready
    if chosen per-request. GrowthBook/Flagsmith load lazily on use.
    """
    global BACKEND_PROVIDER
    BACKEND_PROVIDER = os.getenv("BACKEND_PROVIDER", BACKEND_PROVIDER).lower().strip()

    # Try to init both; don't crash the app if one fails (others still usable)
    try:
        _init_flagd_openfeature()
    except Exception as e:
        print(f"[Backend] flagd init warning: {e}")
    try:
        _init_launchdarkly_file_mode()
    except Exception as e:
        print(f"[Backend] launchdarkly init warning: {e}")

# -----------------------------
# Routes (provider-aware)
# -----------------------------
@app.get("/api/healthz")
def healthz(provider: Optional[str] = None) -> dict:
    p = _effective_provider(provider)
    return {
        "status": "ok",
        "backendProviderDefault": BACKEND_PROVIDER,
        "effectiveProvider": p,
        "frontendOrigin": FRONTEND_ORIGIN,
        "ldFlagsFile": str(_ld_flags_path) if p == "launchdarkly" else None,
        "growthbookFile": str(_gb_features_path) if p == "growthbook" else None,
        "flagsmithFile": str(_fs_env_path) if p == "flagsmith" else None,
    }

@app.get("/api/flags")
def get_flags(userId: str = "anonymous", provider: Optional[str] = None) -> dict:
    try:
        new_badge = ff_bool("new-badge", False, userId, provider)
        cta_color = ff_str("cta-color", "blue", userId, provider)
        api_enabled = ff_bool("api-new-endpoint-enabled", False, userId, provider)
        return {
            "newBadge": new_badge,
            "ctaColor": cta_color,
            "apiNewEndpointEnabled": api_enabled,
            "provider": _effective_provider(provider),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Flag evaluation failed: {e}")

@app.get("/api/hello")
def hello(userId: str = "anonymous", provider: Optional[str] = None) -> dict:
    on = ff_bool("new-badge", False, userId, provider)
    return {"message": "New feature is ON 🎉 (from backend)"} if on else {"message": "New feature is OFF (from backend)"}

@app.get("/api/secret")
def secret(userId: str = "anonymous", provider: Optional[str] = None) -> dict:
    allowed = ff_bool("api-new-endpoint-enabled", False, userId, provider)
    if not allowed:
        raise HTTPException(status_code=403, detail="Feature disabled by flag")
    return {"secret": "🍪 super secret data"}