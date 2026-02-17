"""Client HTTP pour le backend Jarvis (gestion de la mémoire conversationnelle)."""

import logging

import requests

from config import Config

logger = logging.getLogger(__name__)


class JarvisClient:
    def __init__(self, config: Config):
        self._base_url = config.jarvis_api_url.rstrip("/")
        self._session = requests.Session()

    def add_memory(self, text: str) -> dict | None:
        """
        Envoie un texte à mémoriser via POST /memory/add.

        Retourne la réponse JSON du backend, ou None en cas d'erreur.
        """
        try:
            resp = self._session.post(
                f"{self._base_url}/memory/add",
                json={"text": text, "source": "wake_listener"},
                timeout=15,
            )
            resp.raise_for_status()
            return resp.json()
        except requests.ConnectionError:
            logger.error(
                "Impossible de joindre le backend Jarvis à %s", self._base_url
            )
            return None
        except requests.HTTPError as e:
            logger.error("Erreur backend Jarvis (add): %s", e)
            return None
        except Exception:
            logger.exception("Erreur inattendue lors de l'ajout mémoire")
            return None

    def query_memory(self, question: str) -> dict | None:
        """
        Interroge la mémoire conversationnelle via POST /memory/query.

        Retourne la réponse JSON du backend (champs: answer, sources, topK,
        temporalContext?), ou None en cas d'erreur.
        """
        try:
            resp = self._session.post(
                f"{self._base_url}/memory/query",
                json={"query": question},
                timeout=180,
            )
            resp.raise_for_status()
            return resp.json()
        except requests.ConnectionError:
            logger.error(
                "Impossible de joindre le backend Jarvis à %s", self._base_url
            )
            return None
        except requests.HTTPError as e:
            logger.error("Erreur backend Jarvis (query): %s", e)
            return None
        except Exception:
            logger.exception("Erreur inattendue lors de la requête mémoire")
            return None
