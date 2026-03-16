import { Injectable } from '@nestjs/common';
import { LlamaCppService } from '../llama-cpp/llama-cpp.service';

@Injectable()
export class LlmService {
  constructor(private readonly llama: LlamaCppService) {}

  async ask(prompt: string): Promise<string> {
    return this.llama.generate(prompt);
  }

  async *askStream(prompt: string): AsyncGenerator<string> {
    yield* this.llama.generateStream(prompt);
  }
}
