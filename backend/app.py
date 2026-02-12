# backend/app.py
from __future__ import annotations

import os
import inspect
import json
import time
import hashlib
from pathlib import Path
from typing import Optional, Tuple, Dict, Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# -----------------------------
# Load backend/.env reliably
# -----------------------------
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
load_dotenv(dotenv_path=ENV_PATH)

# --- TLS helper: auto-inject certifi CA bundle so HTTPS works in Python on Windows ---
# --- TLS helper: prefer Windows trust store; fallback to certifi bundle ---
try:
    # Use OS trust store if available (best for Windows in corp setups)
    import truststore  # type: ignore
    truststore.inject_into_ssl()
    truststore.inject_into_urllib3()
    print("[TLS] Using Windows trust store via truststore")
except Exception as e:
    print(f"[TLS] truststore unavailable, falling back to certifi: {e}")
    try:
        import certifi  # type: ignore
        ca_path = certifi.where()
        os.environ.setdefault("SSL_CERT_FILE", ca_path)
        os.environ.setdefault("REQUESTS_CA_BUNDLE", ca_path)
        print(f"[TLS] Using CA bundle: {ca_path}")
    except Exception as ee:
        print(f"[TLS] Warning: could not set certifi CA bundle automatically: {ee}")

# -----------------------------
# OpenFeature (flagd mode)
# -----------------------------
from openfeature import api as openfeature
from openfeature.evaluation_context import EvaluationContext
from openfeature.contrib.provider.flagd import FlagdProvider

# -----------------------------
# Flagsmith server SDK (online)
# -----------------------------
from flagsmith import Flagsmith  # pip install flagsmith

# -----------------------------
# Config
# -----------------------------
FLAGD_HOST = os.getenv("FLAGD_HOST", "localhost")
FLAGD_PORT = int(os.getenv("FLAGD_PORT", "8013"))
FLAGD_TLS = os.getenv("FLAGD_TLS", "false").lower() in {"1", "true", "yes"}

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").rstrip("/")

BACKEND_PROVIDER = os.getenv("BACKEND_PROVIDER", "flagd").lower().strip()

# LaunchDarkly (file/eval offline)
LD_SDK_KEY = os.getenv("LD_SDK_KEY", "dummy-offline-sdk-key")
LD_FLAGS_FILE = os.getenv("LD_FLAGS_FILE", "./launchdarkly/ld-flags.json")

# LaunchDarkly ONLINE (server SDK)
LD_ONLINE_SDK_KEY = os.getenv("LD_ONLINE_SDK_KEY")  # real server SDK key (keep secret)
LD_ONLINE_BASE_URI = os.getenv("LD_ONLINE_BASE_URI")  # optional (relay proxy URI)
LD_ONLINE_STREAM_URI = os.getenv("LD_ONLINE_STREAM_URI")  # optional
LD_ONLINE_EVENTS_URI = os.getenv("LD_ONLINE_EVENTS_URI")  # optional
LD_ONLINE_INIT_TIMEOUT_SECONDS = float(os.getenv("LD_ONLINE_INIT_TIMEOUT_SECONDS", "3"))
LD_ONLINE_SEND_EVENTS = os.getenv("LD_ONLINE_SEND_EVENTS", "false").lower() in {"1", "true", "yes"}

# GrowthBook (offline file)
GROWTHBOOK_FEATURES_FILE = os.getenv("GROWTHBOOK_FEATURES_FILE", "growthbook/features.json")

# Flagsmith (offline file)
FLAGSMITH_ENV_FILE = os.getenv("FLAGSMITH_ENV_FILE", "flagsmith/environment.json")

# Flagsmith Online (server-side)
FLAGSMITH_ENV_KEY = os.getenv("FLAGSMITH_ENV_KEY")  # SECRET: server env key (starts with "ser.")
FLAGSMITH_API_URL = os.getenv("FLAGSMITH_API_URL")  # optional override (self-hosted or explicit cloud URL)
FLAGSMITH_TLS_INSECURE = os.getenv("FLAGSMITH_TLS_INSECURE", "false").lower() in {"1", "true", "yes"}
FLAGSMITH_REQUEST_TIMEOUT_SECONDS = float(os.getenv("FLAGSMITH_REQUEST_TIMEOUT_SECONDS", "3"))

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

# IMPORTANT: Separate LD clients (no singleton)
_ld_client = None          # LaunchDarkly client (file/offline)
_ld_online_client = None   # LaunchDarkly client (online/server)

_fs_online_client: Optional[Flagsmith] = None  # Flagsmith Online

# Cached docs for GrowthBook/Flagsmith (offline)
_gb_doc: Optional[Dict[str, Any]] = None
_gb_mtime: Optional[float] = None
_fs_doc: Optional[Dict[str, Any]] = None
_fs_mtime: Optional[float] = None

# For Flagsmith offline quick lookup (rebuilt when file reloads)
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
    uid = user_id or "anonymous"
    from ldclient import Context  # type: ignore
    if hasattr(Context, "builder"):
        b = Context.builder(uid)
        b.set("userId", uid)
        return b.build()
    if hasattr(Context, "create"):
        return Context.create(uid)
    raise RuntimeError("LaunchDarkly SDK Context API not found")

def _load_json_with_cache(path: Path, last_mtime: Optional[float]) -> Tuple[Optional[Dict[str, Any]], Optional[float]]:
    if not path.exists():
        raise RuntimeError(f"JSON file not found: {path}")
    mtime = path.stat().st_mtime
    if last_mtime is None or mtime > last_mtime:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f), mtime
    return None, last_mtime

def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

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
    Initialize a dedicated LaunchDarkly client with the Files data source (auto-update).
    Avoid the global singleton to prevent being overridden by LD online init.
    """
    global _ld_client

    if not _ld_flags_path.exists():
        raise RuntimeError(f"[LaunchDarkly] Flags file not found: {_ld_flags_path}")

    # Imports
    import ldclient  # type: ignore
    from ldclient import LDClient  # type: ignore
    from ldclient.config import Config  # type: ignore
    from ldclient.integrations import Files  # type: ignore

    file_data_source = Files.new_data_source(paths=[str(_ld_flags_path)], auto_update=True)

    cfg_kwargs: Dict[str, Any] = {"send_events": False}
    sig = inspect.signature(Config.__init__)
    params = sig.parameters

    # Prefer modern param 'data_source' if present
    if "data_source" in params:
        cfg_kwargs["data_source"] = file_data_source
        param_used = "data_source"
    # Else try legacy names
    elif "update_processor_class" in params:
        cfg_kwargs["update_processor_class"] = file_data_source
        param_used = "update_processor_class"
    elif "update_processor" in params:
        cfg_kwargs["update_processor"] = file_data_source
        param_used = "update_processor"
    else:
        raise RuntimeError("[LaunchDarkly] Unsupported SDK version: cannot attach file data source")

    config = Config(LD_SDK_KEY, **cfg_kwargs)
    _ld_client = LDClient(config)

    # Initial wait (non-fatal on timeout)
    if hasattr(_ld_client, "wait_for_initialization"):
        try:
            _ld_client.wait_for_initialization(2)
        except Exception:
            pass

    print(f"[Backend] Provider=launchdarkly (file={_ld_flags_path}, auto_update=True, via {param_used})")

def _init_launchdarkly_online() -> None:
    """
    Initialize a separate LaunchDarkly Server SDK client in ONLINE mode (streaming/polling).
    """
    global _ld_online_client
    if not LD_ONLINE_SDK_KEY:
        raise RuntimeError("LaunchDarkly online: LD_ONLINE_SDK_KEY not set")

    import ldclient  # type: ignore
    from ldclient import LDClient  # type: ignore
    from ldclient.config import Config  # type: ignore

    cfg_kwargs: Dict[str, Any] = {
        "send_events": LD_ONLINE_SEND_EVENTS,
    }
    # Optional relay proxy URIs
    if LD_ONLINE_BASE_URI:
        cfg_kwargs["base_uri"] = LD_ONLINE_BASE_URI
    if LD_ONLINE_STREAM_URI:
        cfg_kwargs["stream_uri"] = LD_ONLINE_STREAM_URI
    if LD_ONLINE_EVENTS_URI:
        cfg_kwargs["events_uri"] = LD_ONLINE_EVENTS_URI

    config = Config(LD_ONLINE_SDK_KEY, **cfg_kwargs)
    _ld_online_client = LDClient(config)

    if hasattr(_ld_online_client, "wait_for_initialization"):
        try:
            _ld_online_client.wait_for_initialization(LD_ONLINE_INIT_TIMEOUT_SECONDS)
        except Exception as e:
            print(f"[Backend] LaunchDarkly online init wait failed: {e}")
    print("[Backend] Provider=launchdarkly-online (server SDK)")

def _init_flagsmith_online() -> None:
    global _fs_online_client
    if not FLAGSMITH_ENV_KEY:
        raise RuntimeError("Flagsmith online: FLAGSMITH_ENV_KEY not set")

    if FLAGSMITH_TLS_INSECURE:
        # DEMO ONLY: disables TLS verification process-wide for Python requests.
        os.environ["PYTHONHTTPSVERIFY"] = "0"
        print("[WARN] Flagsmith-online: PYTHONHTTPSVERIFY=0 (TLS verification disabled)")

    _fs_online_client = Flagsmith(
        environment_key=FLAGSMITH_ENV_KEY,
        api_url=FLAGSMITH_API_URL or None,            # NOTE: correct kwarg is api_url
        enable_local_evaluation=False,                # force online HTTP calls
        request_timeout_seconds=FLAGSMITH_REQUEST_TIMEOUT_SECONDS,
    )
    print(f"[Backend] Provider=flagsmith-online (server SDK, timeout={FLAGSMITH_REQUEST_TIMEOUT_SECONDS}s, insecure={FLAGSMITH_TLS_INSECURE})")

# -----------------------------
# GrowthBook evaluators (offline file)
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
    for st in states:
        if st.get("segment_id") is not None and int(st["segment_id"]) in matched_seg_ids:
            return st
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
# Flagsmith ONLINE evaluators (server SDK) — fail-fast + log
# -----------------------------
def _fsm_online_bool(flag_key: str, default: bool, user_id: str) -> bool:
    if _fs_online_client is None:
        raise RuntimeError("Flagsmith online client not initialized")
    try:
        flags = _fs_online_client.get_identity_flags(
            identifier=user_id or "anonymous",
            traits={"userId": user_id or "anonymous"},
        )
        v = flags.is_feature_enabled(flag_key)
        return bool(v) if v is not None else bool(default)
    except Exception as e:
        print(f"[Flagsmith-online] bool('{flag_key}') for '{user_id}' failed: {e}")
        return bool(default)

def _fsm_online_str(flag_key: str, default: str, user_id: str) -> str:
    if _fs_online_client is None:
        raise RuntimeError("Flagsmith online client not initialized")
    try:
        flags = _fs_online_client.get_identity_flags(
            identifier=user_id or "anonymous",
            traits={"userId": user_id or "anonymous"},
        )
        v = flags.get_feature_value(flag_key)
        return str(v) if v is not None else str(default)
    except Exception as e:
        print(f"[Flagsmith-online] str('{flag_key}') for '{user_id}' failed: {e}")
        return str(default)

# -----------------------------
# Unified evaluators
# -----------------------------
def _effective_provider(req_provider: Optional[str]) -> str:
    p = (req_provider or BACKEND_PROVIDER or "flagd").lower().strip()
    if p not in {
        "flagd",
        "launchdarkly",
        "launchdarkly-online",
        "growthbook",
        "flagsmith",
        "flagsmith-online",
    }:
        p = BACKEND_PROVIDER
    return p

def ff_bool(flag_key: str, default: bool, user_id: str, provider: Optional[str] = None) -> bool:
    p = _effective_provider(provider)
    if p == "launchdarkly":
        if _ld_client is None:
            raise RuntimeError("LaunchDarkly (file mode) client not initialized")
        ctx = build_ld_context(user_id)
        return bool(_ld_client.variation(flag_key, ctx, default))
    if p == "launchdarkly-online":
        if _ld_online_client is None:
            raise RuntimeError("LaunchDarkly online client not initialized")
        ctx = build_ld_context(user_id)
        return bool(_ld_online_client.variation(flag_key, ctx, default))
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
    if p == "flagsmith-online":
        return _fsm_online_bool(flag_key, default, user_id)
    return bool(default)

def ff_str(flag_key: str, default: str, user_id: str, provider: Optional[str] = None) -> str:
    p = _effective_provider(provider)
    if p == "launchdarkly":
        if _ld_client is None:
            raise RuntimeError("LaunchDarkly (file mode) client not initialized")
        ctx = build_ld_context(user_id)
        v = _ld_client.variation(flag_key, ctx, default)
        return str(v)
    if p == "launchdarkly-online":
        if _ld_online_client is None:
            raise RuntimeError("LaunchDarkly online client not initialized")
        ctx = build_ld_context(user_id)
        v = _ld_online_client.variation(flag_key, ctx, default)
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
    if p == "flagsmith-online":
        return _fsm_online_str(flag_key, default, user_id)
    return str(default)

# -----------------------------
# FastAPI app
# -----------------------------
app = FastAPI()

app.mount("/static/growthbook", StaticFiles(directory=BASE_DIR / "growthbook"), name="growthbook-static")
app.mount("/static/flagsmith", StaticFiles(directory=BASE_DIR / "flagsmith"), name="flagsmith-static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # permissive for dev
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    global BACKEND_PROVIDER
    BACKEND_PROVIDER = os.getenv("BACKEND_PROVIDER", BACKEND_PROVIDER).lower().strip()
    try:
        _init_flagd_openfeature()
    except Exception as e:
        print(f"[Backend] flagd init warning: {e}")
    try:
        _init_launchdarkly_file_mode()
    except Exception as e:
        print(f"[Backend] launchdarkly (file) init warning: {e}")
    try:
        _init_launchdarkly_online()
    except Exception as e:
        print(f"[Backend] launchdarkly-online init warning: {e}")
    try:
        _init_flagsmith_online()
    except Exception as e:
        print(f"[Backend] flagsmith-online init warning: {e}")

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
        "ldOnline": (p == "launchdarkly-online"),
        "growthbookFile": str(_gb_features_path) if p == "growthbook" else None,
        "flagsmithFile": str(_fs_env_path) if p == "flagsmith" else None,
        "flagsmithOnline": (p == "flagsmith-online"),
        "tls": {
            "SSL_CERT_FILE": os.environ.get("SSL_CERT_FILE"),
            "REQUESTS_CA_BUNDLE": os.environ.get("REQUESTS_CA_BUNDLE"),
            "PYTHONHTTPSVERIFY": os.environ.get("PYTHONHTTPSVERIFY"),
        },
        "ldFile": {
            "path": str(_ld_flags_path) if p == "launchdarkly" else None,
            "mtime": (_ld_flags_path.stat().st_mtime if _ld_flags_path.exists() and p == "launchdarkly" else None),
        }
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

# --- Diagnostics ---

# Flagsmith ONLINE diag (kept)
import requests

@app.get("/api/diag/flagsmith-online")
def diag_flagsmith_online(userId: str = "anonymous") -> dict:
    try:
        b = _fsm_online_bool("new-badge", False, userId)
        s = _fsm_online_str("cta-color", "blue", userId)
        a = _fsm_online_bool("api-new-endpoint-enabled", False, userId)
        return {"ok": True, "newBadge": b, "ctaColor": s, "apiNewEndpointEnabled": a}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/api/diag/flagsmith-online-raw")
def diag_flagsmith_online_raw(userId: str = "anonymous") -> dict:
    base = (FLAGSMITH_API_URL or "https://edge.api.flagsmith.com/api/v1/").rstrip("/")
    url = f"{base}/identities/"
    headers = {
        "X-Environment-Key": (FLAGSMITH_ENV_KEY or "").strip(),
        "Content-Type": "application/json",
    }
    body = {
        "identifier": userId or "anonymous",
        "traits": [{"trait_key": "userId", "trait_value": userId or "anonymous"}],
    }
    try:
        resp = requests.post(url, headers=headers, json=body, timeout=FLAGSMITH_REQUEST_TIMEOUT_SECONDS)
        try:
            parsed = resp.json()
        except Exception:
            parsed = resp.text[:2000]
        return {
            "url": url,
            "status": resp.status_code,
            "ok": resp.ok,
            "headers": dict(resp.headers),
            "body": parsed,
            "sent_headers": {"X-Environment-Key_present": bool(headers["X-Environment-Key"])},
        }
    except Exception as e:
        return {
            "url": url,
            "error": repr(e),
            "sent_headers": {"X-Environment-Key_present": bool(headers["X-Environment-Key"])},
        }

# LaunchDarkly ONLINE diag
@app.get("/api/diag/launchdarkly-online")
def diag_launchdarkly_online(userId: str = "anonymous") -> dict:
    try:
        if _ld_online_client is None:
            return {"ok": False, "error": "launchdarkly online client not initialized"}
        ctx = build_ld_context(userId)
        b = bool(_ld_online_client.variation("new-badge", ctx, False))
        s = str(_ld_online_client.variation("cta-color", ctx, "blue"))
        a = bool(_ld_online_client.variation("api-new-endpoint-enabled", ctx, False))
        return {
            "ok": True,
            "sample": {"newBadge": b, "ctaColor": s, "apiNewEndpointEnabled": a},
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}

# LaunchDarkly FILE diag – backend eval using file mode
@app.get("/api/diag/launchdarkly-file")
def diag_launchdarkly_file(userId: str = "anonymous") -> dict:
    try:
        if _ld_client is None:
            return {"ok": False, "error": "launchdarkly file-mode client not initialized"}
        ctx = build_ld_context(userId)
        b = bool(_ld_client.variation("new-badge", ctx, False))
        s = str(_ld_client.variation("cta-color", ctx, "blue"))
        a = bool(_ld_client.variation("api-new-endpoint-enabled", ctx, False))
        info = {
            "file_path": str(_ld_flags_path),
            "file_exists": _ld_flags_path.exists(),
            "file_mtime": (_ld_flags_path.stat().st_mtime if _ld_flags_path.exists() else None),
        }
        return {"ok": True, "info": info, "sample": {"newBadge": b, "ctaColor": s, "apiNewEndpointEnabled": a}}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# LaunchDarkly FILE diag – mtime + sha256 to confirm actual on-disk changes
@app.get("/api/diag/launchdarkly-file-hash")
def diag_launchdarkly_file_hash() -> dict:
    try:
        exists = _ld_flags_path.exists()
        return {
            "ok": True,
            "path": str(_ld_flags_path),
            "exists": exists,
            "mtime": (_ld_flags_path.stat().st_mtime if exists else None),
            "sha256": (_sha256_file(_ld_flags_path) if exists else None),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}