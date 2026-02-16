import { Injectable, Logger } from '@nestjs/common';
import { readFile, unlink } from 'fs/promises';
import { basename, resolve } from 'path';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SttService {
  private readonly logger = new Logger(SttService.name);
  private readonly sttServerUrl: string;

  constructor(private readonly config: ConfigService) {
    this.sttServerUrl =
      this.config.get<string>('STT_SERVER_URL') ?? 'http://127.0.0.1:8300';
  }

  async transcribe(audioPath: string): Promise<{ text: string }> {
    const absAudio = resolve(audioPath);

    try {
      const fileBuffer = await readFile(absAudio);
      const fileName = basename(absAudio);
      const blob = new Blob([fileBuffer]);
      const form = new FormData();
      form.append('audio', blob, fileName);

      this.logger.debug(`Sending audio to STT server: ${this.sttServerUrl}`);

      const resp = await fetch(`${this.sttServerUrl}/transcribe`, {
        method: 'POST',
        body: form,
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`STT server error ${resp.status}: ${body}`);
      }

      const { text } = (await resp.json()) as { text: string };
      return { text: text.trim() };
    } finally {
      await unlink(absAudio).catch(() => {});
    }
  }
}
