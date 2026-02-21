import { Injectable, Logger } from '@nestjs/common';
import { OllamaService } from '../../ollama/ollama.service';
import { CLASSIFICATION_SYSTEM_PROMPT } from './classification-prompt';
import { ExtractedEntities, IntentResult, IntentType } from './intent.types';

@Injectable()
export class IntentEngine {
  private readonly logger = new Logger(IntentEngine.name);

  // Regex patterns mirroring wake-listener/command_classifier.py exactly
  private static readonly ADD_PATTERNS: RegExp[] = [
    /^ajoute(?:\s+(?:que|qu'|une\s+information|une\s+info|le\s+fait\s+que))?\s+/i,
    /^mémorise(?:\s+(?:que|qu'|le\s+fait\s+que))?\s+/i,
    /^retiens(?:\s+(?:que|qu'|le\s+fait\s+que))?\s+/i,
    /^note(?:\s+(?:que|qu'|le\s+fait\s+que))?\s+/i,
    /^souviens[-\s]toi(?:\s+(?:que|qu'))?\s+/i,
    /^n'?oublie\s+pas(?:\s+(?:que|qu'))?\s+/i,
    /^enregistre(?:\s+(?:que|qu'|le\s+fait\s+que))?\s+/i,
  ];

  private static readonly QUERY_PATTERNS: RegExp[] = [
    /\bqu['']?est[-\s]ce\s+que\b/i,
    /\bqu['']?est[-\s]ce\s+qu['']/i,
    /\brappelle[-\s]moi\b/i,
    /\bdis[-\s]moi\b/i,
    /\bqu['']?ai[-\s]je\b/i,
    /\bqu['']?avais[-\s]je\b/i,
    /\bqu['']?avons[-\s]nous\b/i,
    /\bqu['']?est[-\s]il\b/i,
    /\bquand\s+(?:est|ai|avais|se|a|dois)\b/i,
    /\bà\s+quelle\s+heure\b/i,
    /\bquel(?:le)?\s+(?:est|était|heure|jour|date)\b/i,
    /\bai[-\s]je\s+(?:prévu|quelque\s+chose|un\s+rendez)\b/i,
    /\bj['']?ai[-\s](?:prévu|quelque)\b/i,
  ];

  constructor(private readonly ollama: OllamaService) {}

  /**
   * Classify a French voice command. Attempts LLM classification first,
   * falls back to regex on any failure.
   */
  async classify(text: string): Promise<IntentResult> {
    const normalized = text.trim();
    if (!normalized) {
      return this.unknownResult(normalized, 1.0, 'regex');
    }

    try {
      const result = await this.classifyWithLLM(normalized);
      this.logger.debug(
        `LLM classified "${normalized.slice(0, 60)}" → ${result.intent} (${result.confidence})`,
      );
      return result;
    } catch (error) {
      this.logger.warn(
        `LLM classification failed, falling back to regex: ${(error as Error).message}`,
      );
      return this.classifyWithRegex(normalized);
    }
  }

  /**
   * Calls qwen3:4b and parses the JSON response.
   * Throws on any failure (network error, parse failure, invalid result).
   */
  async classifyWithLLM(text: string): Promise<IntentResult> {
    const prompt = `Texte à classifier:\n${text}`;
    const raw = await this.ollama.generateWith(
      'small',
      prompt,
      CLASSIFICATION_SYSTEM_PROMPT,
    );
    const json = this.extractJSON(raw);
    return this.validateIntentResult(json, text);
  }

  /**
   * Pure regex fallback — synchronous, always succeeds.
   * Mirrors command_classifier.py logic exactly.
   */
  classifyWithRegex(text: string): IntentResult {
    const normalized = text.trim();

    for (const pattern of IntentEngine.ADD_PATTERNS) {
      const match = pattern.exec(normalized);
      if (match) {
        const content = normalized.slice(match[0].length).trim();
        if (content) {
          return {
            intent: IntentType.ADD,
            confidence: 1.0,
            content,
            entities: {},
            source: 'regex',
          };
        }
      }
    }

    for (const pattern of IntentEngine.QUERY_PATTERNS) {
      if (pattern.test(normalized)) {
        return {
          intent: IntentType.QUERY,
          confidence: 1.0,
          content: normalized,
          entities: {},
          source: 'regex',
        };
      }
    }

    return this.unknownResult(normalized, 1.0, 'regex');
  }

  /**
   * Strips LLM formatting artifacts and extracts the JSON object.
   *
   * Handles:
   * - <think>…</think> blocks (qwen3 chain-of-thought)
   * - ```json … ``` fenced code blocks
   * - ``` … ``` fenced code blocks without language tag
   * - Leading/trailing prose around the JSON
   *
   * Throws SyntaxError if no valid JSON object can be extracted.
   */
  extractJSON(response: string): Record<string, unknown> {
    let cleaned = response;

    // Step 1: Remove <think>…</think> blocks (qwen3 reasoning traces)
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // Step 2: Extract content from fenced code blocks if present
    const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
    if (fencedMatch) {
      cleaned = fencedMatch[1];
    }

    // Step 3: Extract the first JSON object span using indexOf/lastIndexOf
    // lastIndexOf for '}' handles nested objects without over-matching
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1);
    }

    cleaned = cleaned.trim();

    try {
      return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      this.logger.error(`JSON parse failed. Raw response:\n${response}`);
      throw new SyntaxError(
        `Intent LLM response is not valid JSON: ${cleaned.slice(0, 200)}`,
      );
    }
  }

  /**
   * Validates and normalizes parsed JSON into a typed IntentResult.
   * Applies safe fallbacks for all fields — never throws.
   */
  validateIntentResult(
    json: Record<string, unknown>,
    originalText: string,
  ): IntentResult {
    const rawIntent =
      typeof json['intent'] === 'string' ? json['intent'].toUpperCase() : '';
    const intent: IntentType =
      rawIntent === 'ADD'
        ? IntentType.ADD
        : rawIntent === 'QUERY'
          ? IntentType.QUERY
          : IntentType.UNKNOWN;

    const rawConf = json['confidence'];
    const confidence: number =
      typeof rawConf === 'number' && rawConf >= 0 && rawConf <= 1
        ? rawConf
        : 0.5;

    const rawContent = json['content'];
    const content: string =
      typeof rawContent === 'string' && rawContent.trim().length > 0
        ? rawContent.trim()
        : originalText;

    const rawDate = json['dateExpression'];
    const entities: ExtractedEntities =
      typeof rawDate === 'string' && rawDate.trim().length > 0
        ? { dateExpression: rawDate.trim() }
        : {};

    return { intent, confidence, content, entities, source: 'llm' };
  }

  private unknownResult(
    text: string,
    confidence: number,
    source: 'llm' | 'regex',
  ): IntentResult {
    return {
      intent: IntentType.UNKNOWN,
      confidence,
      content: text,
      entities: {},
      source,
    };
  }
}
