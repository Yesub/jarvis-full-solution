"""Client HTTP pour envoyer l'audio enregistre au serveur STT."""

import logging

import requests

from config import Config

logger = logging.getLogger(__name__)


class SttClient:
    def __init__(self, config: Config):
        self._url = f"{config.stt_server_url}/transcribe"
        self._session = requests.Session()

    def transcribe(self, wav_bytes: bytes) -> str | None:
        """
        Envoie un fichier WAV au serveur STT via POST multipart.

        Retourne le texte transcrit, ou None en cas d'erreur.
        """
        try:
            resp = self._session.post(
                self._url,
                files={"audio": ("recording.wav", wav_bytes, "audio/wav")},
                timeout=30,
            )
            resp.raise_for_status()
            text = resp.json().get("text", "").strip()
            return text if text else None
        except requests.ConnectionError:
            logger.error("Impossible de joindre le serveur STT a %s", self._url)
            return None
        except requests.HTTPError as e:
            logger.error("Erreur du serveur STT: %s", e)
            return None
        except Exception:
            logger.exception("Erreur inattendue lors de la transcription")
            return None
