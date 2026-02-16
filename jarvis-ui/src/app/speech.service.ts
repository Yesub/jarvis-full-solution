import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SpeechService {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('Enregistrement non démarré'));
        return;
      }
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        this.mediaRecorder?.stream.getTracks().forEach((t) => t.stop());
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }
}
