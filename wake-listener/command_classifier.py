"""Classification des commandes vocales Jarvis en add / query / unknown."""

import re
from enum import Enum


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


def classify(text: str) -> tuple[CommandType, str]:
    """
    Classifie une transcription vocale Jarvis.

    Retourne (CommandType, contenu):
    - ADD   : contenu = texte sans le préfixe de commande
    - QUERY : contenu = texte complet
    - UNKNOWN: contenu = texte complet
    """
    normalized = text.strip()

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
