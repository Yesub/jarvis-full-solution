"""Client TTS local utilisant Piper (neural text-to-speech offline)."""

import logging
import urllib.request
from pathlib import Path

import sounddevice as sd
from piper.voice import PiperVoice

from config import Config

logger = logging.getLogger(__name__)

_HF_BASE = (
    "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"
    "/fr/fr_FR/{voice}/{quality}"
)

MODELS_DIR = Path(__file__).parent / "models"


class TtsClient:
    """Synthèse vocale locale via Piper (modèle français)."""

    def __init__(self, config: Config):
        self._enabled = config.tts_enabled
        if not self._enabled:
            logger.info("TTS désactivé (TTS_ENABLED=false).")
            return

        model_path = self._ensure_model(config.tts_model)
        logger.info("Chargement du modèle Piper '%s'...", model_path.name)
        self._voice = PiperVoice.load(str(model_path))
        logger.info(
            "Modèle Piper chargé (sample_rate=%d).", self._voice.config.sample_rate
        )

    # ------------------------------------------------------------------
    # API publique
    # ------------------------------------------------------------------

    def speak(self, text: str) -> None:
        """Synthétise *text* et le joue sur le haut-parleur par défaut."""
        if not self._enabled:
            return
        if not text or not text.strip():
            return

        logger.debug("TTS: %s", text[:80])
        try:
            stream = sd.OutputStream(
                samplerate=self._voice.config.sample_rate,
                channels=1,
                dtype="int16",
            )
            stream.start()
            try:
                for chunk in self._voice.synthesize(text):
                    stream.write(chunk.audio_int16_array)
            finally:
                stream.stop()
                stream.close()
        except Exception:
            logger.exception("Erreur lors de la lecture TTS")

    # ------------------------------------------------------------------
    # Téléchargement du modèle
    # ------------------------------------------------------------------

    @staticmethod
    def _ensure_model(model_name: str) -> Path:
        """Télécharge le modèle Piper depuis HuggingFace si absent."""
        MODELS_DIR.mkdir(exist_ok=True)

        onnx_path = MODELS_DIR / f"{model_name}.onnx"
        json_path = MODELS_DIR / f"{model_name}.onnx.json"

        # Extraire voix et qualité depuis le nom (ex. "fr_FR-gilles-low" → "gilles", "low")
        parts = model_name.split("-")
        voice_short = parts[1] if len(parts) > 1 else model_name
        quality = parts[2] if len(parts) > 2 else "medium"

        if not onnx_path.exists():
            url = f"{_HF_BASE.format(voice=voice_short, quality=quality)}/{model_name}.onnx"
            logger.info("URL Piper: %s", url)
            logger.info("Téléchargement du modèle Piper: %s ...", url)
            urllib.request.urlretrieve(url, onnx_path)
            logger.info("Modèle téléchargé: %s", onnx_path)

        if not json_path.exists():
            url = f"{_HF_BASE.format(voice=voice_short, quality=quality)}/{model_name}.onnx.json"
            logger.info("Téléchargement de la config Piper: %s ...", url)
            urllib.request.urlretrieve(url, json_path)
            logger.info("Config téléchargée: %s", json_path)

        return onnx_path
