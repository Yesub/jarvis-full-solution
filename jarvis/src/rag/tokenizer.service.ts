import { Injectable } from '@nestjs/common';

@Injectable()
export class TokenizerService {
  private readonly STOP_WORDS = new Set([
    'le',
    'la',
    'les',
    'un',
    'une',
    'des',
    'de',
    'du',
    'et',
    'en',
    'est',
    'que',
    'qui',
    'dans',
    'pour',
    'pas',
    'sur',
    'ce',
    'il',
    'elle',
    'je',
    'tu',
    'nous',
    'vous',
    'ils',
    'elles',
    'au',
    'aux',
    'par',
    'ou',
    'mais',
    'donc',
    'car',
    'si',
    'ne',
    'se',
    'me',
    'te',
    'lui',
    'son',
    'sa',
    'ses',
    'mon',
    'ma',
    'mes',
    'ton',
    'ta',
    'tes',
    'notre',
    'votre',
    'leur',
    'leurs',
    'plus',
    'tres',
    'bien',
    'aussi',
    'quand',
    'comme',
    'avec',
    'sans',
    'sous',
    'entre',
    'apres',
    'avant',
    'lors',
    'depuis',
    'jusqu',
    'dont',
    'cet',
    'cette',
    'ces',
    'tout',
    'tous',
    'toute',
    'toutes',
    'on',
    'y',
    'en',
  ]);

  /**
   * Tokenise un texte français en sparse vector BM25.
   * indices = hash 16-bit du token, values = TF normalisée (0–1).
   * IDF est délégué à Qdrant via modifier: "idf".
   */
  tokenize(text: string): { indices: number[]; values: number[] } {
    const tokens = this.extractTokens(text);
    const tf = new Map<number, number>();

    for (const token of tokens) {
      const idx = this.hashToken(token);
      tf.set(idx, (tf.get(idx) ?? 0) + 1);
    }

    if (tf.size === 0) return { indices: [], values: [] };

    const maxFreq = Math.max(...tf.values());
    const entries = [...tf.entries()].sort((a, b) => a[0] - b[0]);

    return {
      indices: entries.map(([idx]) => idx),
      values: entries.map(([, freq]) => freq / maxFreq),
    };
  }

  private extractTokens(text: string): string[] {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !this.STOP_WORDS.has(w));
  }

  private hashToken(token: string): number {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash * 31 + token.charCodeAt(i)) & 0xffff;
    }
    return hash;
  }
}
