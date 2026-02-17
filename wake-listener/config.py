"""Configuration du Wake Listener via variables d'environnement."""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Config:
    # OpenWakeWord
    wake_model: str = "hey_jarvis"
    wake_threshold: float = 0.5

    # Audio / Silence
    silence_threshold: float = 500.0
    silence_duration_sec: float = 3.0
    max_recording_sec: float = 30.0
    chunk_size: int = 1280  # ~80ms a 16kHz
    sample_rate: int = 16000

    # STT Server
    stt_server_url: str = "http://127.0.0.1:8300"

    # Jarvis Backend API
    jarvis_api_url: str = "http://127.0.0.1:3000"


def load_config() -> Config:
    return Config(
        wake_model=os.getenv("WAKE_MODEL", "hey_jarvis"),
        wake_threshold=float(os.getenv("WAKE_THRESHOLD", "0.5")),
        silence_threshold=float(os.getenv("SILENCE_THRESHOLD", "500")),
        silence_duration_sec=float(os.getenv("SILENCE_DURATION_SEC", "3.0")),
        max_recording_sec=float(os.getenv("MAX_RECORDING_SEC", "30.0")),
        chunk_size=int(os.getenv("CHUNK_SIZE", "1280")),
        sample_rate=int(os.getenv("SAMPLE_RATE", "16000")),
        stt_server_url=os.getenv("STT_SERVER_URL", "http://127.0.0.1:8300"),
        jarvis_api_url=os.getenv("JARVIS_API_URL", "http://127.0.0.1:3000"),
    )
