#!/usr/bin/env python3
"""Shared HTTP client settings for Polymarket-facing scripts."""

from __future__ import annotations

import httpx


DEFAULT_TIMEOUT = 20.0


def create_pm_http_client(*, timeout: float = DEFAULT_TIMEOUT) -> httpx.Client:
    """Use HTTP/1.1 explicitly to avoid intermittent TLS EOFs seen with defaults."""
    return httpx.Client(timeout=timeout, http2=False)
