"""Persistent faster-whisper STT server.

Keeps the model loaded in memory so subsequent requests are fast.
"""

import os
import tempfile
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, File, UploadFile
from faster_whisper import WhisperModel

MODEL_SIZE = os.getenv("WHISPER_MODEL", "turbo")
DEVICE = os.getenv("WHISPER_DEVICE", "auto")  # "auto", "cpu", or "cuda"
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "auto")
LANGUAGE = os.getenv("WHISPER_LANGUAGE", "fr")
PORT = int(os.getenv("STT_PORT", "8300"))

model: WhisperModel | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    print(f"Loading faster-whisper model '{MODEL_SIZE}' (device={DEVICE}, compute={COMPUTE_TYPE}) …")
    model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
    print("Model loaded – ready to transcribe.")
    yield
    model = None


app = FastAPI(lifespan=lifespan)


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    suffix = os.path.splitext(audio.filename or ".webm")[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name

    try:
        segments, _ = model.transcribe(tmp_path, language=LANGUAGE, beam_size=1, vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments)
        return {"text": text}
    finally:
        os.unlink(tmp_path)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
