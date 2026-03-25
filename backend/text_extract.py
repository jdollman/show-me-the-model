"""Text extraction from URLs, PDFs, and raw text with validation."""

import ipaddress
import logging
import re
import socket
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# TODO: Show character count to the user before submission, with a warning
# when text exceeds ~50K chars (the original limit) about increased cost/time.
MAX_TEXT_LENGTH = None  # No limit (was 50_000)
MAX_PDF_SIZE = 10 * 1024 * 1024  # 10 MB

URL_PATTERN = re.compile(
    r"^https?://"
    r"(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+"
    r"[a-zA-Z]{2,}"
    r"(?:/[^\s]*)?$"
)


def _is_private_ip(hostname: str) -> bool:
    """Check if a hostname resolves to a private/reserved IP address."""
    try:
        for info in socket.getaddrinfo(hostname, None):
            addr = ipaddress.ip_address(info[4][0])
            if addr.is_private or addr.is_reserved or addr.is_loopback or addr.is_link_local:
                return True
    except socket.gaierror:
        pass
    return False


def validate_url(url: str) -> str:
    """Validate and return the URL, or raise ValueError."""
    url = url.strip()
    if not URL_PATTERN.match(url):
        raise ValueError(f"Invalid URL format: {url}")
    hostname = urlparse(url).hostname
    if not hostname or _is_private_ip(hostname):
        raise ValueError("URLs pointing to internal/private networks are not allowed")
    return url


def validate_text(text: str) -> str:
    """Validate raw text input length."""
    if not text or not text.strip():
        raise ValueError("Text input is empty")
    if MAX_TEXT_LENGTH and len(text) > MAX_TEXT_LENGTH:
        raise ValueError(f"Text too long ({len(text)} chars). Maximum is {MAX_TEXT_LENGTH}.")
    return text.strip()


async def extract_from_url(url: str) -> str:
    """Fetch and extract article text from a URL using trafilatura."""
    import trafilatura

    url = validate_url(url)
    logger.info("Fetching URL: %s", url)
    downloaded = trafilatura.fetch_url(url)
    if downloaded is None:
        raise ValueError(f"Could not fetch URL: {url}")
    text = trafilatura.extract(downloaded)
    if not text:
        raise ValueError(f"Could not extract text from URL: {url}")
    if MAX_TEXT_LENGTH and len(text) > MAX_TEXT_LENGTH:
        raise ValueError(
            f"Extracted text too long ({len(text)} chars). Maximum is {MAX_TEXT_LENGTH}."
        )
    return text


async def extract_from_markdown(file_bytes: bytes) -> str:
    """Extract text from Markdown file bytes (just decode UTF-8)."""
    try:
        text = file_bytes.decode("utf-8").strip()
    except UnicodeDecodeError:
        raise ValueError("Could not decode Markdown file (not valid UTF-8)")
    if not text:
        raise ValueError("Markdown file is empty")
    if MAX_TEXT_LENGTH and len(text) > MAX_TEXT_LENGTH:
        raise ValueError(
            f"Markdown text too long ({len(text)} chars). Maximum is {MAX_TEXT_LENGTH}."
        )
    return text


async def extract_from_pdf(file_bytes: bytes) -> str:
    """Extract text from PDF bytes using pymupdf."""
    import pymupdf

    if len(file_bytes) > MAX_PDF_SIZE:
        raise ValueError(f"PDF too large ({len(file_bytes)} bytes). Maximum is {MAX_PDF_SIZE}.")
    doc = pymupdf.open(stream=file_bytes, filetype="pdf")
    pages = []
    for page in doc:
        pages.append(page.get_text())
    doc.close()
    text = "\n".join(pages).strip()
    if not text:
        raise ValueError("Could not extract text from PDF (empty or image-only)")
    if MAX_TEXT_LENGTH and len(text) > MAX_TEXT_LENGTH:
        raise ValueError(
            f"Extracted text too long ({len(text)} chars). Maximum is {MAX_TEXT_LENGTH}."
        )
    return text
