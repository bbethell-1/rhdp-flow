"""Identity-based access control for the multi-cluster deploy picker.

Choosing a *deploy-target cluster* (Feature 2) is restricted to a small
allowlist of operators. rhdp-flow itself only holds a single shared API key and
has no per-user identity, so real identity comes from an OpenShift OAuth proxy
sidecar sitting in front of the app: it authenticates the user against the
cluster's OAuth and forwards the identity in the ``X-Forwarded-Email`` /
``X-Forwarded-User`` request headers.

The allowlist is configured via the ``DEPLOY_PICKER_ALLOWED_EMAILS`` environment
variable (comma-separated, case-insensitive). If unset it defaults to the two
approved operators. Enforcement is fail-closed: no recognised identity ⇒ no
access to cluster selection.
"""

from __future__ import annotations

import logging
import os

from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)

_DEFAULT_ALLOWED = "jdisrael@redhat.com,bbethell@redhat.com"


def _allowed_emails() -> set[str]:
    raw = os.environ.get("DEPLOY_PICKER_ALLOWED_EMAILS", _DEFAULT_ALLOWED)
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def get_user_email(request: Request) -> str | None:
    """Return the authenticated user's email from the OAuth proxy headers."""
    email = request.headers.get("X-Forwarded-Email") or request.headers.get(
        "X-Forwarded-User"
    )
    return email.strip().lower() if email else None


def is_picker_allowed(request: Request) -> bool:
    """True if the requesting user may choose a deploy-target cluster."""
    email = get_user_email(request)
    return bool(email and email in _allowed_emails())


def require_picker_access(request: Request) -> None:
    """Raise HTTP 403 unless the requesting user is on the picker allowlist.

    Called on deploy paths only when a non-default ``target_cluster`` is
    requested, so ordinary in-cluster deploys are unaffected.
    """
    if not is_picker_allowed(request):
        email = get_user_email(request) or "unauthenticated"
        logger.warning("Denied deploy-target selection for user %s", email)
        raise HTTPException(
            403,
            "Choosing a deploy-target cluster is restricted to approved operators.",
        )
