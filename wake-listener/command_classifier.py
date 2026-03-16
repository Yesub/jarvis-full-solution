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
        logger.info("Tentative de classification LLM via %s", url)
        resp = requests.post(
            url,
            json={"text": text, "source": "wake_listener"},
            timeout=120,
        )
        logger.debug("Classification LLM — requête POST %s avec payload: %s", url, {"text": text, "source": "wake_listener"})
        resp.raise_for_status()
        logger.debug("Classification LLM — réponse reçue: %s", resp.json())
        data = resp.json()

        intent_raw = data.get("primary", "").lower()
        content = data.get("extractedContent", text)

        logger.debug(
            "Classification LLM réussie. intent=%s content=%s", intent_raw, content
        )

        if intent_raw == "memory_add":
            return CommandType.ADD, content
        elif intent_raw in ("memory_query", "rag_question", "general_question"):
            return CommandType.QUERY, content
        else:
            return CommandType.UNKNOWN, content

    except requests.ConnectionError:
        # Expected during Phase 2.1 — endpoint does not yet exist
        logger.debug("Backend /agent/classify non disponible — fallback regex.")
        return None
    except requests.Timeout:
        logger.warning("Timeout /agent/classify (%ss) — fallback regex.", 30)
        return None
    except requests.HTTPError as e:
        logger.warning("Erreur HTTP /agent/classify: %s — fallback regex.", e)
        return None
    except Exception:
        logger.exception(
            "Erreur inattendue lors de la classification LLM — fallback regex."
        )
        return None


def _classify_with_regex(text: str) -> "tuple[CommandType, str] | None":
    """
    Classifie via patterns regex locaux.

    Retourne (CommandType, contenu) si un pattern correspond, None si UNKNOWN.
    """
    # Tester les patterns d'ajout (ancrage en début de phrase)
    for pattern in _ADD_PATTERNS:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            content = text[match.end():].strip()
            if content:
                return CommandType.ADD, content

    # Tester les patterns de requête (n'importe où dans le texte)
    for pattern in _QUERY_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return CommandType.QUERY, text

    return None


def classify(
    text: str, jarvis_api_url: Optional[str] = None
) -> tuple[CommandType, str]:
    """
    Classifie une transcription vocale Jarvis.

    Stratégie : regex d'abord (instantané), puis LLM uniquement si regex = UNKNOWN
    (pour désambiguïser les cas comme "Qu'est-ce qu'on mange demain soir ?").

    Retourne (CommandType, contenu):
    - ADD   : contenu = texte sans le préfixe de commande
    - QUERY : contenu = texte complet
    - UNKNOWN: contenu = texte complet
    """
    normalized = text.strip()
    logger.info("Classification de: %s", normalized)

    # Regex d'abord — instantané, couvre les cas explicites
    regex_result = _classify_with_regex(normalized)
    if regex_result is not None:
        logger.debug("Classification regex: %s", regex_result[0].value)
        return regex_result

    # Fallback LLM pour les cas ambigus que regex ne couvre pas
    if jarvis_api_url:
        logger.info("Regex UNKNOWN — tentative classification LLM via %s", jarvis_api_url)
        llm_result = _classify_with_llm(normalized, jarvis_api_url)
        if llm_result is not None:
            return llm_result

    return CommandType.UNKNOWN, normalized
