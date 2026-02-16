"""Enregistrement audio post-wake avec detection de silence par RMS."""

import io
import math
import struct
import wave
import logging

import numpy as np
import pyaudio

from config import Config

logger = logging.getLogger(__name__)


def compute_rms(pcm: np.ndarray) -> float:
    """Calcule le RMS (root mean square) d'un frame PCM int16."""
    if len(pcm) == 0:
        return 0.0
    return float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2)))


def record_until_silence(stream: pyaudio.Stream, config: Config) -> bytes:
    """
    Enregistre depuis le stream PyAudio jusqu'a detection de silence.

    Arrete quand le RMS reste sous le seuil pendant `silence_duration_sec`
    ou quand `max_recording_sec` est atteint.

    Retourne les donnees audio encodees en WAV.
    """
    frames: list[bytes] = []
    frames_per_sec = config.sample_rate / config.chunk_size
    silence_frame_limit = int(config.silence_duration_sec * frames_per_sec)
    max_frames = int(config.max_recording_sec * frames_per_sec)
    silent_frames = 0

    logger.debug(
        "Enregistrement: seuil silence=%.0f, limite=%d frames (~%.1fs), max=%d frames",
        config.silence_threshold,
        silence_frame_limit,
        config.silence_duration_sec,
        max_frames,
    )

    for i in range(max_frames):
        raw = stream.read(config.chunk_size, exception_on_overflow=False)
        frames.append(raw)

        pcm = np.frombuffer(raw, dtype=np.int16)
        rms = compute_rms(pcm)

        if rms < config.silence_threshold:
            silent_frames += 1
        else:
            silent_frames = 0

        if silent_frames >= silence_frame_limit:
            logger.info(
                "Silence detecte apres %d frames (~%.1fs)",
                i + 1,
                (i + 1) / frames_per_sec,
            )
            break

    if silent_frames < silence_frame_limit:
        logger.info("Duree max d'enregistrement atteinte (%.0fs)", config.max_recording_sec)

    return encode_wav(frames, config.sample_rate)


def encode_wav(frames: list[bytes], sample_rate: int) -> bytes:
    """Encode une liste de frames PCM brutes en bytes WAV."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        for frame in frames:
            wf.writeframes(frame)
    return buf.getvalue()
