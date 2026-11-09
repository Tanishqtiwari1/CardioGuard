"""The only place an AI model is used, and it is off unless ANTHROPIC_API_KEY is set.

It does two narrow jobs and neither is a source of medical facts:
  read_image_text   copies the text printed in a photo. Identification still happens in identification.py.
  explain           rewords facts already taken from the reference data, and is checked by language_guard.

If a call fails, is refused or fails the guard, callers fall back to the verified reference text.
"""
import base64
import logging
import os

import anthropic

from app.medicines.language_guard import is_safe_explanation

logger = logging.getLogger(__name__)
MODEL = os.getenv("CARDIOGUARD_AI_MODEL", "claude-opus-5-5")
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_FALLBACK_BETA = ["server-side-fallback-2026-07-01"]

READ_PROMPT = (
    "Copy all text printed in this image of a medicine pack or prescription, line by line, exactly as written. "
    "Do not correct spellings, identify the medicine, or add anything that is not visibly printed. "
    "Where a word is unclear, write [unclear] rather than guessing it. "
    "If there is no readable text, reply with exactly NO_TEXT."
)
EXPLAIN_SYSTEM = (
    "You rewrite verified medicine information in simple words for a patient with no medical background. "
    "Use only the facts provided. Add no medical facts, numbers, doses, timings or advice of your own. "
    "Never tell the patient to start, stop, change or continue a medicine, and never say a medicine is right for them. "
    "Write two to four short sentences of plain text in the requested language."
)


def available() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(timeout=45.0, max_retries=1)


def _text_of(response) -> str | None:
    if response.stop_reason in {"refusal", "max_tokens"}:
        return None
    return "".join(block.text for block in response.content if block.type == "text").strip() or None


def _create(**kwargs):
    # A safety classifier can wrongly decline a request. The fallback retries it on another model.
    return _client().beta.messages.create(model=MODEL, betas=_FALLBACK_BETA, fallbacks="default", output_config={"effort": "low"}, **kwargs)


def read_image_text(image: bytes, media_type: str) -> str | None:
    """Returns the printed text, or None if it could not be read."""
    if not available() or media_type not in ALLOWED_IMAGE_TYPES:
        return None
    data = base64.standard_b64encode(image).decode("utf-8")
    try:
        response = _create(max_tokens=2000, messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}},
            {"type": "text", "text": READ_PROMPT},
        ]}])
    except anthropic.APIConnectionError:
        logger.warning("Vision read failed: connection error")
        return None
    except anthropic.RateLimitError:
        logger.warning("Vision read failed: rate limited")
        return None
    except anthropic.APIStatusError as error:
        logger.warning("Vision read failed: status %s", error.status_code)
        return None
    text = _text_of(response)
    return None if not text or text == "NO_TEXT" else text


def explain(facts: str, language: str) -> str | None:
    """A reworded explanation that passed the guard, or None to use the verified text as written."""
    if not available():
        return None
    target = "Hindi, in simple everyday words" if language == "hi" else "English"
    try:
        response = _create(max_tokens=1000, system=EXPLAIN_SYSTEM, messages=[{"role": "user", "content": f"Language: {target}\n\nVerified facts:\n{facts}"}])
    except (anthropic.APIConnectionError, anthropic.RateLimitError, anthropic.APIStatusError) as error:
        logger.warning("Explanation failed: %s", type(error).__name__)
        return None
    text = _text_of(response)
    return text if text and is_safe_explanation(text, facts) else None
