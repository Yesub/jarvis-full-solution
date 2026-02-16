"""
Jarvis Wake Word Listener.

Ecoute en continu le microphone, detecte "Hey Jarvis" via OpenWakeWord,
enregistre la commande vocale jusqu'au silence, puis envoie l'audio
au serveur STT pour transcription.
"""

import logging
import signal
import sys

import numpy as np
import pyaudio
import openwakeword
from openwakeword.model import Model

from config import load_config
from recorder import record_until_silence
from stt_client import SttClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("wake_listener")

running = True


def shutdown(sig, frame):
    global running
    logger.info("Signal d'arret recu.")
    running = False


def main():
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    config = load_config()

    # Telecharger les modeles OpenWakeWord si necessaire
    logger.info("Chargement du modele OpenWakeWord '%s'...", config.wake_model)
    openwakeword.utils.download_models()
    oww_model = Model(wakeword_models=[config.wake_model])

    # Initialiser PyAudio
    pa = pyaudio.PyAudio()
    stream = pa.open(
        format=pyaudio.paInt16,
        channels=1,
        rate=config.sample_rate,
        input=True,
        frames_per_buffer=config.chunk_size,
    )

    stt_client = SttClient(config)

    logger.info(
        "Ecoute du wake word '%s' en cours... (Ctrl+C pour arreter)",
        config.wake_model,
    )

    try:
        while running:
            # Lire un frame audio depuis le micro
            raw = stream.read(config.chunk_size, exception_on_overflow=False)
            audio_frame = np.frombuffer(raw, dtype=np.int16)

            # Prediction OpenWakeWord
            prediction = oww_model.predict(audio_frame)

            # Verifier si le wake word est detecte
            for model_name, score in prediction.items():
                if score >= config.wake_threshold:
                    logger.info(
                        "*** Wake word detecte! (modele=%s, score=%.3f)",
                        model_name,
                        score,
                    )

                    # Enregistrer jusqu'au silence
                    wav_bytes = record_until_silence(stream, config)
                    logger.info(
                        "Enregistrement termine (%d octets). Envoi au STT...",
                        len(wav_bytes),
                    )

                    # Transcrire
                    text = stt_client.transcribe(wav_bytes)

                    if text:
                        logger.info("TRANSCRIPTION: %s", text)
                        # TODO: Envoyer le texte au backend NestJS pour traitement
                    else:
                        logger.info("Aucune parole detectee ou transcription vide.")

                    # Reset du buffer OpenWakeWord apres traitement
                    oww_model.reset()
                    break

    finally:
        stream.stop_stream()
        stream.close()
        pa.terminate()
        logger.info("Listener arrete.")


if __name__ == "__main__":
    main()
