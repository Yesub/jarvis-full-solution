/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
/**
 * LlamaCppService — remplace OllamaService pour une inférence LLM locale directe.
 *
 * Avantages vs Ollama HTTP :
 * - Pas de couche réseau (pas de localhost:11434) → latence réduite de 50-70 %
 * - Contrôle direct du contexte, de la température, du GPU offloading
 * - Un seul processus Node.js, pas de daemon externe à gérer
 *
 * Limitation : un seul modèle GGUF chargé en mémoire pour toutes les tailles
 * (small/medium/large). generateWith() utilise donc toujours le même modèle.
 *
 * Note ESM : node-llama-cpp est un module ESM pur avec top-level await.
 * NestJS tourne en CommonJS — import statique → ERR_REQUIRE_ASYNC_MODULE.
 * Solution : import() dynamique dans onModuleInit(), types via "import type"
 * (effacés à la compilation, jamais exécutés par require()).
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// "import type" uniquement — jamais transformé en require() par tsc/ts-node
import type {
  Llama,
  LlamaModel,
  LlamaContext,
  LlamaContextSequence,
  LlamaCompletion,
  LlamaEmbeddingContext,
  Token,
} from 'node-llama-cpp';
import * as path from 'path';
import * as fs from 'fs';

// Interface minimale pour le module chargé dynamiquement —
// évite "any" tout en restant compatible avec l'import() runtime.
interface LlamaCppModule {
  getLlama(): Promise<Llama>;
  LlamaCompletion: new (opts: {
    contextSequence: LlamaContextSequence;
  }) => LlamaCompletion;
}

@Injectable()
export class LlamaCppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LlamaCppService.name);

  private readonly llmModelPath: string;
  private readonly embedModelPath: string;
  private readonly gpuLayers: number;
  private readonly contextSize: number;
  private readonly temperature: number;

  private llama: Llama | null = null;
  private llmModel: LlamaModel | null = null;
  private llmContext: LlamaContext | null = null;
  private embedModel: LlamaModel | null = null;
  private embedContext: LlamaEmbeddingContext | null = null;
  private llamaCpp: LlamaCppModule | null = null;

  private llmReady = false;
  private embedReady = false;

  constructor(private readonly config: ConfigService) {
    const projectRoot = process.cwd();

    const llmRelPath =
      this.config.get<string>('LLAMA_CPP_LLM_MODEL_PATH') ??
      './models/mistral-7b-instruct.gguf';
    const embedRelPath =
      this.config.get<string>('LLAMA_CPP_EMBED_MODEL_PATH') ??
      './models/bge-small-en-v1.5.gguf';

    this.llmModelPath = path.resolve(projectRoot, llmRelPath);
    this.embedModelPath = path.resolve(projectRoot, embedRelPath);
    this.gpuLayers = parseInt(
      this.config.get<string>('LLAMA_CPP_GPU_LAYERS') ?? '30',
      10,
    );
    this.contextSize = parseInt(
      this.config.get<string>('LLAMA_CPP_CONTEXT_SIZE') ?? '2048',
      10,
    );
    this.temperature = parseFloat(
      this.config.get<string>('LLAMA_CPP_TEMPERATURE') ?? '0.7',
    );

    this.logger.log(`LLM model path   : ${this.llmModelPath}`);
    this.logger.log(`Embed model path : ${this.embedModelPath}`);
    this.logger.log(
      `GPU layers: ${this.gpuLayers}, context: ${this.contextSize}, temperature: ${this.temperature}`,
    );
  }

  async onModuleInit(): Promise<void> {
    // Chargement dynamique obligatoire : node-llama-cpp est ESM pur avec
    // top-level await → incompatible avec require() de CommonJS/NestJS.
    try {
      this.llamaCpp = (await import('node-llama-cpp')) as LlamaCppModule;
      this.llama = await this.llamaCpp.getLlama();
    } catch (err) {
      this.logger.error('Failed to initialize llama.cpp backend', err);
      return;
    }

    await this.loadLlmModel();
    await this.loadEmbedModel();
  }

  private async loadLlmModel(): Promise<void> {
    if (!fs.existsSync(this.llmModelPath)) {
      this.logger.warn(
        `LLM model not found at ${this.llmModelPath}. ` +
          'Download a GGUF file and set LLAMA_CPP_LLM_MODEL_PATH. ' +
          'Suggestion: https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF (Q4_K_M)',
      );
      return;
    }

    try {
      this.logger.log('Loading LLM model…');
      this.llmModel = await this.llama!.loadModel({
        modelPath: this.llmModelPath,
        gpuLayers: this.gpuLayers,
      });
      this.llmContext = await this.llmModel.createContext({
        contextSize: this.contextSize,
        sequences: 4, // pool de séquences pour les appels concurrents
      });
      this.llmReady = true;
      this.logger.log('LLM model loaded successfully');
    } catch (err) {
      this.logger.error(
        `Failed to load LLM model from ${this.llmModelPath}`,
        err,
      );
      this.logger.warn(
        'Make sure the file is a valid GGUF format. ' +
          'If GPU layers cause OOM, set LLAMA_CPP_GPU_LAYERS=0 for CPU-only.',
      );
    }
  }

  private async loadEmbedModel(): Promise<void> {
    if (!fs.existsSync(this.embedModelPath)) {
      this.logger.warn(
        `Embedding model not found at ${this.embedModelPath}. ` +
          'Download a GGUF embedding model and set LLAMA_CPP_EMBED_MODEL_PATH. ' +
          'Suggestion: https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf',
      );
      return;
    }

    try {
      this.logger.log('Loading embedding model…');
      this.embedModel = await this.llama!.loadModel({
        modelPath: this.embedModelPath,
        gpuLayers: this.gpuLayers,
      });
      this.embedContext = await this.embedModel.createEmbeddingContext();
      this.embedReady = true;
      this.logger.log('Embedding model loaded successfully');
    } catch (err) {
      this.logger.error(
        `Failed to load embedding model from ${this.embedModelPath}`,
        err,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Releasing llama.cpp resources…');
    try {
      await this.embedContext?.dispose();
      await this.embedModel?.dispose();
      await this.llmContext?.dispose();
      await this.llmModel?.dispose();
    } catch (err) {
      this.logger.error('Error during cleanup', err);
    }
  }

  // ─── Interface publique (compatible OllamaService) ───────────────────────

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.embedReady || !this.embedContext) {
      throw new Error(
        'Embedding model not available. Check LLAMA_CPP_EMBED_MODEL_PATH.',
      );
    }

    this.logger.debug(`Embedding ${texts.length} text(s)`);
    const results: number[][] = [];

    for (const text of texts) {
      const embedding = await this.embedContext.getEmbeddingFor(text);
      results.push(Array.from(embedding.vector));
    }

    return results;
  }

  async generate(prompt: string, system?: string): Promise<string> {
    if (!this.llmReady || !this.llmContext || !this.llamaCpp) {
      throw new Error(
        'LLM model not available. Check LLAMA_CPP_LLM_MODEL_PATH.',
      );
    }

    const fullPrompt = system ? `${system}\n\n${prompt}` : prompt;
    this.logger.debug(`generate() — prompt length: ${fullPrompt.length} chars`);

    const sequence = this.llmContext.getSequence();
    const completion = new this.llamaCpp.LlamaCompletion({
      contextSequence: sequence,
    });
    const start = Date.now();

    try {
      const result = await completion.generateCompletion(fullPrompt, {
        temperature: this.temperature,
      });
      this.logger.debug(`generate() — ${Date.now() - start}ms`);
      return result;
    } finally {
      await completion.dispose();
      sequence.dispose();
    }
  }

  async *generateStream(
    prompt: string,
    system?: string,
  ): AsyncGenerator<string> {
    if (!this.llmReady || !this.llmContext || !this.llamaCpp) {
      throw new Error(
        'LLM model not available. Check LLAMA_CPP_LLM_MODEL_PATH.',
      );
    }

    const fullPrompt = system ? `${system}\n\n${prompt}` : prompt;
    this.logger.debug(
      `generateStream() — prompt length: ${fullPrompt.length} chars`,
    );

    const sequence = this.llmContext.getSequence();
    const completion = new this.llamaCpp.LlamaCompletion({
      contextSequence: sequence,
    });
    const start = Date.now();
    let tokenCount = 0;

    try {
      let resolveNext: ((value: IteratorResult<string>) => void) | null = null;
      let isDone = false;
      const queue: string[] = [];

      const completionPromise = completion.generateCompletion(fullPrompt, {
        temperature: this.temperature,
        onToken: (tokens: Token[]) => {
          const text = this.llmContext!.model.detokenize(tokens);
          if (text) {
            tokenCount++;
            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = null;
              resolve({ value: text, done: false });
            } else {
              queue.push(text);
            }
          }
        },
      });

      completionPromise
        .then(() => {
          isDone = true;
          if (resolveNext) resolveNext({ value: '', done: true });
        })
        .catch((err: unknown) => {
          isDone = true;
          if (resolveNext) resolveNext({ value: '', done: true });
          this.logger.error('generateStream error', err);
        });

      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else if (isDone) {
          break;
        } else {
          const token = await new Promise<IteratorResult<string>>((resolve) => {
            resolveNext = resolve;
          });
          if (token.done) break;
          yield token.value;
        }
      }

      this.logger.debug(
        `generateStream() — ${tokenCount} tokens in ${Date.now() - start}ms`,
      );
    } finally {
      await completion.dispose();
      sequence.dispose();
    }
  }

  async generateWith(
    model: 'small' | 'medium' | 'large',
    prompt: string,
    system?: string,
  ): Promise<string> {
    this.logger.debug(
      `generateWith(${model}) — delegating to single loaded model`,
    );
    return this.generate(prompt, system);
  }

  async *generateStreamWith(
    model: 'small' | 'medium' | 'large',
    prompt: string,
    system?: string,
  ): AsyncGenerator<string> {
    this.logger.debug(
      `generateStreamWith(${model}) — delegating to single loaded model`,
    );
    yield* this.generateStream(prompt, system);
  }
}
