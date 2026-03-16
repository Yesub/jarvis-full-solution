import { Injectable, Logger } from '@nestjs/common';
import { LlamaCppService } from '../llama-cpp/llama-cpp.service';
import {
  type ExtractionResult,
  type EntityType,
  VALID_ENTITY_TYPES,
} from './knowledge.types';

const ENTITY_EXTRACTION_SYSTEM_PROMPT = `Tu es un module d'extraction d'entités et de relations pour un graphe de connaissance personnel.

Ta mission : analyser un texte en français et retourner UNIQUEMENT un objet JSON valide.

## Types d'entités disponibles
- PERSON : personne physique (prénom, nom, surnom)
- PLACE : lieu géographique (ville, adresse, pièce de la maison)
- OBJECT : objet physique ou numérique (appareil, document, clé)
- EVENT : événement ponctuel ou récurrent (réunion, rendez-vous, fête)
- DATE : date ou période temporelle explicite (lundi, demain, 15 mars)
- ORGANIZATION : entreprise, association, groupe
- CONCEPT : idée abstraite, projet, sujet de discussion
- UNKNOWN : ne correspond à aucun type ci-dessus

## Format de sortie obligatoire

{
  "entities": [
    { "name": "Nom exact", "type": "TYPE" }
  ],
  "relations": [
    { "from": "Entité A", "relation": "VERBE_EN_MAJUSCULES", "to": "Entité B", "context": "fragment de phrase" }
  ]
}

## Règles strictes

1. Réponds UNIQUEMENT avec le JSON. Aucun texte avant ou après.
2. "name" : normalise la casse (première lettre majuscule pour les noms propres).
3. "relation" : verbe court en MAJUSCULES avec underscores (ex. TRAVAILLE_AVEC, HABITE_A, A_PREVU, POSSEDE, EST_ASSOCIE_A).
4. N'invente pas d'entités absentes du texte. Si le texte est trop court ou ambigu, retourne { "entities": [], "relations": [] }.
5. Maximum 10 entités et 10 relations par texte.
6. Les "from" et "to" des relations doivent correspondre exactement aux "name" d'entités listées dans "entities".
7. Ignore les pronoms (je, il, elle) — ne les liste pas comme entités PERSON sauf s'ils ont un référent clair dans le texte.`;

@Injectable()
export class EntityExtractorService {
  private readonly logger = new Logger(EntityExtractorService.name);

  constructor(private readonly llama: LlamaCppService) {}

  async extract(text: string, memoryId: string): Promise<ExtractionResult> {
    const prompt = `Texte à analyser:\n${text}`;

    let raw: string;
    try {
      raw = await this.llama.generateWith(
        'small',
        prompt,
        ENTITY_EXTRACTION_SYSTEM_PROMPT,
      );
    } catch (err) {
      this.logger.warn(
        `LLM indisponible pour extraction entités (memoryId=${memoryId}): ${err}`,
      );
      return { entities: [], relations: [] };
    }

    try {
      const json = this.extractJSON(raw);
      return this.validateExtractionResult(json);
    } catch (err) {
      this.logger.warn(
        `Extraction entités JSON invalide (memoryId=${memoryId}): ${err}`,
      );
      return { entities: [], relations: [] };
    }
  }

  private extractJSON(response: string): Record<string, unknown> {
    let cleaned = response;

    // Step 1: Remove <think>…</think> blocks
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // Step 2: Extract content from fenced code blocks if present
    const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
    if (fencedMatch) {
      cleaned = fencedMatch[1];
    }

    // Step 3: Extract the first JSON object span using indexOf/lastIndexOf
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1);
    }

    cleaned = cleaned.trim();

    try {
      return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      this.logger.error(`JSON parse échoué. Réponse brute:\n${response}`);
      throw new SyntaxError(
        `Réponse LLM extraction non JSON valide: ${cleaned.slice(0, 200)}`,
      );
    }
  }

  private validateExtractionResult(
    json: Record<string, unknown>,
  ): ExtractionResult {
    const rawEntities = Array.isArray(json['entities']) ? json['entities'] : [];

    const entities: ExtractionResult['entities'] = [];
    const validNames = new Set<string>();

    for (const e of rawEntities as unknown[]) {
      if (
        typeof e !== 'object' ||
        e === null ||
        typeof (e as Record<string, unknown>)['name'] !== 'string' ||
        !(e as Record<string, unknown>)['name']
      ) {
        continue;
      }
      const name = ((e as Record<string, unknown>)['name'] as string).trim();
      const rawType = (e as Record<string, unknown>)['type'];
      const type = (
        typeof rawType === 'string' ? rawType.toUpperCase() : ''
      ) as EntityType;
      if (!name) continue;

      const validType: EntityType = VALID_ENTITY_TYPES.has(type)
        ? type
        : 'UNKNOWN';
      entities.push({ name, type: validType });
      validNames.add(name);
    }

    const rawRelations = Array.isArray(json['relations'])
      ? json['relations']
      : [];
    const relations: ExtractionResult['relations'] = [];

    for (const r of rawRelations as unknown[]) {
      if (typeof r !== 'object' || r === null) continue;
      const rel = r as Record<string, unknown>;
      const from = typeof rel['from'] === 'string' ? rel['from'].trim() : '';
      const relation =
        typeof rel['relation'] === 'string' ? rel['relation'].trim() : '';
      const to = typeof rel['to'] === 'string' ? rel['to'].trim() : '';

      if (!from || !relation || !to) continue;
      // Only keep relations where both endpoints exist in validated entities
      if (!validNames.has(from) || !validNames.has(to)) continue;

      const context =
        typeof rel['context'] === 'string' ? rel['context'].trim() : undefined;
      relations.push({ from, relation, to, ...(context ? { context } : {}) });
    }

    return { entities, relations };
  }
}
