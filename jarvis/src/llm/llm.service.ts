import { Injectable } from '@nestjs/common';
import { OllamaService } from '../ollama/ollama.service';

@Injectable()
export class LlmService {
  constructor(private readonly ollama: OllamaService) {}

  async ask(prompt: string): Promise<string> {
    return this.ollama.generate(prompt);
  }

  async *askStream(prompt: string): AsyncGenerator<string> {
    yield* this.ollama.generateStream(prompt);
  }
}
