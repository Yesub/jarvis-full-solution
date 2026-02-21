"""Classification des commandes vocales Jarvis en add / query / unknown."""

import logging
import re
from enum import Enum
from typing import Optional

import requests

logger = logging.getLogger(__name__)


class CommandType(Enum):
    ADD = "add"
    QUERY = "query"
    UNKNOWN = "unknown"


# Patterns de commandes d'ajout — capturent le préfixe à supprimer du contenu
_ADD_PATTERNS = [
    r"^ajoute(?:\s+(?:que|qu'|une\s+information|une\s+info|le\s+fait\s+que))?\s+",
    r"^mémorise(?:\s+(?:que|qu'|le\s+fait\s+que))?\s+",
    r"^retiens(?:\s+(?:que|qu'|le\s+fait\s+que))?\s+",
    r"^note(?:\s+(?:que|qu'|le\s+fait\s+que))?\s+",
    r"^souviens[-\s]toi(?:\s+(?:que|qu'))?\s+",
    r"^n'?oublie\s+pas(?:\s+(?:que|qu'))?\s+",
    r"^enregistre(?:\s+(?:que|qu'|le\s+fait\s+que))?\s+",
]

# Patterns de commandes de requête — présents n'importe où dans le texte
_QUERY_PATTERNS = [
    r"\bqu['']?est[-\s]ce\s+que\b",
    r"\bqu['']?est[-\s]ce\s+qu['']",
    r"\brappelle[-\s]moi\b",
    r"\bdis[-\s]moi\b",
    r"\bqu['']?ai[-\s]je\b",
    r"\bqu['']?avais[-\s]je\b",
    r"\bqu['']?avons[-\s]nous\b",
    r"\bqu['']?est[-\s]il\b",
    r"\bquand\s+(?:est|ai|avais|se|a|dois)\b",
    r"\bà\s+quelle\s+heure\b",
    r"\bquel(?:le)?\s+(?:est|était|heure|jour|date)\b",
    r"\bai[-\s]je\s+(?:prévu|quelque\s+chose|un\s+rendez)\b",
    r"\bj['']?ai[-\s](?:prévu|quelque)\b",
]


def _classify_with_llm(
    text: str, jarvis_api_url: str
) -> "tuple[CommandType, str] | None":
    """
    Tente une classification via POST /agent/classify sur le backend NestJS.

    Retourne (CommandType, contenu) si la réponse est valide, None sinon.
    Le endpoint /agent/classify sera disponible à partir de la Phase 2.2.
    """
    url = f"{jarvis_api_url.rstrip('/')}/agent/classify"
    try:
        resp = requests.post(
            url,
            json={"text": text, "source": "wake_listener"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        intent_raw = data.get("intent", "").upper()
        content = data.get("content", text)

        if intent_raw == "ADD":
            return CommandType.ADD, content
        elif intent_raw == "QUERY":
            return CommandType.QUERY, content
        else:
            return CommandType.UNKNOWN, content

    except requests.ConnectionError:
        # Expected during Phase 2.1 — endpoint does not yet exist
        logger.debug(
            "Backend /agent/classify non disponible — fallback regex."
        )
        return None
    except requests.HTTPError as e:
        logger.warning("Erreur HTTP /agent/classify: %s — fallback regex.", e)
        return None
    except Exception:
        logger.exception(
            "Erreur inattendue lors de la classification LLM — fallback regex."
        )
        return None


def classify(
    text: str, jarvis_api_url: Optional[str] = None
) -> tuple[CommandType, str]:
    """
    Classifie une transcription vocale Jarvis.

    Si jarvis_api_url est fourni, tente d'abord la classification via le backend
    NestJS (/agent/classify). En cas d'échec, utilise les patterns regex locaux.

    Retourne (CommandType, contenu):
    - ADD   : contenu = texte sans le préfixe de commande
    - QUERY : contenu = texte complet
    - UNKNOWN: contenu = texte complet
    """
    normalized = text.strip()

    # Tenter la classification LLM si l'URL backend est disponible
    if jarvis_api_url:
        llm_result = _classify_with_llm(normalized, jarvis_api_url)
        if llm_result is not None:
            return llm_result

    # Fallback regex — miroir de IntentEngine.classifyWithRegex (TypeScript)

    # Tester les patterns d'ajout (ancrage en début de phrase)
    for pattern in _ADD_PATTERNS:
        match = re.match(pattern, normalized, re.IGNORECASE)
        if match:
            content = normalized[match.end():].strip()
            if content:
                return CommandType.ADD, content

    # Tester les patterns de requête (n'importe où dans le texte)
    for pattern in _QUERY_PATTERNS:
        if re.search(pattern, normalized, re.IGNORECASE):
            return CommandType.QUERY, normalized

    return CommandType.UNKNOWN, normalized
