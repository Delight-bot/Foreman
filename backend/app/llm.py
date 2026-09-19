"""Thin wrapper around the Claude API: structured JSON calls with images."""
import base64
import logging
from typing import TypeVar

import anthropic
from pydantic import BaseModel

from . import config

log = logging.getLogger("foreman.llm")
T = TypeVar("T", bound=BaseModel)

_client: anthropic.Anthropic | None = None


class LLMUnavailable(RuntimeError):
    """Raised when the model cannot produce an answer; callers fall back to extractive mode."""


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def image_block(png: bytes, media_type: str = "image/png") -> dict:
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": base64.b64encode(png).decode()},
    }


def sniff_media_type(data: bytes) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return "image/jpeg"


def parse(system: str, content: list[dict], schema: type[T], effort: str = "medium",
          max_tokens: int = 16000) -> tuple[T, str]:
    """One structured call. Returns (parsed output, model that served it)."""
    try:
        resp = client().messages.parse(
            model=config.MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_format=schema,
            output_config={"effort": effort},
            # If the primary model declines, the API re-runs the request on its recommended fallback.
            extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
            extra_body={"fallbacks": "default"},
        )
    except anthropic.AuthenticationError as e:
        raise LLMUnavailable(f"authentication failed: {e.message}") from e
    except anthropic.RateLimitError as e:
        raise LLMUnavailable("rate limited") from e
    except anthropic.APIStatusError as e:
        raise LLMUnavailable(f"API error {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise LLMUnavailable("could not reach the Claude API") from e
    except anthropic.AnthropicError as e:
        # Includes missing credentials, raised at request time.
        raise LLMUnavailable(str(e)) from e

    if resp.stop_reason == "refusal":
        raise LLMUnavailable("the model declined this request")
    if resp.stop_reason == "max_tokens" or resp.parsed_output is None:
        raise LLMUnavailable("the model response was incomplete")
    return resp.parsed_output, resp.model
