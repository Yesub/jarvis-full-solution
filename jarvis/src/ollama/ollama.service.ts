import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type OllamaEmbedResponse = {
  model: string;
  embeddings: number[][];
};

type OllamaGenerateResponse = {
  model: string;
  response: string;
  done: boolean;
};

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);
  private readonly baseUrl: string;
  private readonly llmModel: string;
  private readonly embedModel: string;
  private readonly smallModel: string;
  private readonly largeModel: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl =
      this.config.get<string>('OLLAMA_BASE_URL') ?? 'http://127.0.0.1:11434';
    this.llmModel =
      this.config.get<string>('OLLAMA_LLM_MODEL') ?? 'mistral:latest';
    this.embedModel =
      this.config.get<string>('OLLAMA_EMBED_MODEL') ?? 'qwen3-embedding:8b';
    this.smallModel =
      this.config.get<string>('OLLAMA_SMALL_MODEL') ?? 'qwen3:4b';
    this.largeModel =
      this.config.get<string>('OLLAMA_LARGE_MODEL') ?? 'gpt-oss:20b';
  }

  private resolveModel(model: 'small' | 'medium' | 'large'): string {
    switch (model) {
      case 'small':
        return this.smallModel;
      case 'medium':
        return this.llmModel;
      case 'large':
        return this.largeModel;
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/api/embed`;
    this.logger.debug(`Calling Ollama embed: ${url}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.embedModel,
        input: texts,
        truncate: true,
      }),
    });

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Ollama embed failed: ${res.status} ${await res.text()}`,
      );
    }
    const json = (await res.json()) as OllamaEmbedResponse;
    return json.embeddings;
  }

  async *generateStream(
    prompt: string,
    system?: string,
  ): AsyncGenerator<string> {
    const url = `${this.baseUrl}/api/generate`;
    this.logger.debug(`Calling Ollama generate (stream): ${url}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.llmModel,
        prompt,
        system,
        stream: true,
      }),
    });

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Ollama generate failed: ${res.status} ${await res.text()}`,
      );
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.trim()) continue;
        const json = JSON.parse(line) as OllamaGenerateResponse;
        if (json.response) yield json.response;
      }
    }

    if (buffer.trim()) {
      const json = JSON.parse(buffer) as OllamaGenerateResponse;
      if (json.response) yield json.response;
    }
  }

  async generateWith(
    model: 'small' | 'medium' | 'large',
    prompt: string,
    system?: string,
  ): Promise<string> {
    const modelName = this.resolveModel(model);
    const url = `${this.baseUrl}/api/generate`;
    this.logger.debug(
      `Calling Ollama generate (${model}=${modelName}): ${url}`,
    );
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          prompt,
          system,
          stream: false,
        }),
      });

      if (!res.ok) {
        throw new InternalServerErrorException(
          `Ollama generate failed: ${res.status} ${await res.text()}`,
        );
      }
      const json = (await res.json()) as OllamaGenerateResponse;
      return json.response;
    } catch (error) {
      this.logger.error(`Ollama generateWith(${model}) error`, error);
      throw error instanceof InternalServerErrorException
        ? error
        : new ServiceUnavailableException('LLM service unreachable');
    }
  }

  async *generateStreamWith(
    model: 'small' | 'medium' | 'large',
    prompt: string,
    system?: string,
  ): AsyncGenerator<string> {
    const modelName = this.resolveModel(model);
    const url = `${this.baseUrl}/api/generate`;
    this.logger.debug(
      `Calling Ollama generate stream (${model}=${modelName}): ${url}`,
    );

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, prompt, system, stream: true }),
    });

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Ollama generate failed: ${res.status} ${await res.text()}`,
      );
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.trim()) continue;
        const json = JSON.parse(line) as OllamaGenerateResponse;
        if (json.response) yield json.response;
      }
    }

    if (buffer.trim()) {
      const json = JSON.parse(buffer) as OllamaGenerateResponse;
      if (json.response) yield json.response;
    }
  }

  async generate(prompt: string, system?: string): Promise<string> {
    const url = `${this.baseUrl}/api/generate`;
    this.logger.debug(`Calling Ollama generate: ${url}`);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.llmModel,
          prompt,
          system,
          stream: false,
        }),
      });

      if (!res.ok) {
        throw new InternalServerErrorException(
          `Ollama generate failed: ${res.status} ${await res.text()}`,
        );
      }
      const json = (await res.json()) as OllamaGenerateResponse;
      return json.response;
    } catch (error) {
      this.logger.error('Ollama generate error', error);
      throw error instanceof InternalServerErrorException
        ? error
        : new ServiceUnavailableException('LLM service unreachable');
    }
  }
}
