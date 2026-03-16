import { Injectable, Logger } from '@nestjs/common';
import { LlamaCppService } from '../llama-cpp/llama-cpp.service';
import { KnowledgeGraphService } from './knowledge-graph.service';
import type { EntityResponse, KnowledgeEntity } from './knowledge.types';

function str(value: unknown, fallback = '?'): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${value}`;
  return fallback;
}

// Patterns déclenchant une recherche de relations (qui, avec qui, où, quand...)
const RELATION_QUESTION_PATTERNS =
  /(avec qui|qui travaille|qui habite|o[uù] habite|o[uù] travaille|qui est li[eé]|quelles? relations?|quels? liens?|conna[iî]t|associ[eé]|sur quel|sur quels|quels? projets?|quelles? activit[eé]s?|quelles? technolog|utilise|poss[eè]de|travaille sur|appartient|responsable|impliq)/i;

type QueryIntent = {
  entityName: string | null;
  relationType: string | null;
  queryType: 'relations' | 'search' | 'general';
};

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly graph: KnowledgeGraphService,
    private readonly llama: LlamaCppService,
  ) {}

  async getEntity(name: string): Promise<EntityResponse> {
    if (!this.graph.isReady) {
      return { found: false };
    }

    // Try exact match first
    let result = await this.graph.findEntity(name);

    // Fallback: partial text search
    if (!result) {
      const candidates = await this.graph.searchEntities(name);
      if (candidates.length > 0) {
        result = await this.graph.findEntity(candidates[0].name);
      }
    }

    if (!result) {
      return { found: false };
    }

    const relatedNames = [
      ...new Set(
        result.relations.map((r) =>
          r.direction === 'outgoing' ? r.to : r.from,
        ),
      ),
    ];

    return {
      found: true,
      entity: result.entity,
      relations: result.relations.map((r) => ({
        direction: r.direction,
        type: r.type,
        otherEntity: r.direction === 'outgoing' ? r.to : r.from,
        ...(r.context ? { context: r.context } : {}),
      })),
      relatedEntities: relatedNames,
    };
  }

  async searchEntities(partial: string): Promise<KnowledgeEntity[]> {
    if (!this.graph.isReady) return [];
    return this.graph.searchEntities(partial);
  }

  async queryNaturalLanguage(
    question: string,
  ): Promise<{ answer: string; cypher?: string }> {
    if (!this.graph.isReady) {
      return {
        answer:
          'Le graphe de connaissance est actuellement indisponible. Vérifiez que Neo4j est démarré.',
      };
    }

    // 1. Fetch real schema from Neo4j
    const schema = await this.graph.getGraphSchema();

    // 2. Extract intent via regex (deterministic)
    const intent = this.extractIntentByRegex(question, schema.relationTypes);
    this.logger.debug(`Intent extrait: ${JSON.stringify(intent)}`);

    // 3. Build safe Cypher from template
    const { cypher, params } = this.buildCypher(intent);
    this.logger.debug(
      `Cypher généré: ${cypher} | params: ${JSON.stringify(params)}`,
    );

    // 4. Execute query
    let rows: unknown[];
    try {
      rows = await this.graph.runReadQuery(cypher, params);
    } catch (err) {
      this.logger.warn(`Exécution Cypher échouée: ${err}`);
      return {
        answer: "Erreur lors de l'exécution de la requête dans le graphe.",
        cypher,
      };
    }

    if (rows.length === 0) {
      return {
        answer:
          'Aucune information trouvée dans le graphe pour cette question.',
        cypher,
      };
    }

    // 5. Generate French prose answer
    // Simplify rows to plain sentences to reduce LLM confusion
    const facts = this.rowsToFacts(rows);
    const answerPrompt = `Tu es un assistant. Réponds en français en une phrase complète en utilisant uniquement les faits suivants.\n\nFaits:\n${facts}\n\nQuestion: ${question}\n\nRéponse en français:`;

    try {
      const answer = await this.llama.generate(answerPrompt);
      return { answer, cypher };
    } catch (err) {
      this.logger.warn(`Génération réponse française échouée: ${err}`);
      return { answer: `Données brutes: ${facts}`, cypher };
    }
  }

  private extractIntentByRegex(
    question: string,
    relationTypes: string[],
  ): QueryIntent {
    const q = question.toLowerCase();

    // Detect relation type from known schema types
    const matchedRelation =
      relationTypes.find((rt) => q.includes(rt.toLowerCase())) ?? null;

    // Detect entity name: capitalised word(s) after known trigger words,
    // or last proper noun (word starting with uppercase in original question)
    const entityName = this.extractEntityName(question, relationTypes);

    // Classify query type
    const isRelationQuestion = RELATION_QUESTION_PATTERNS.test(question);
    const queryType: QueryIntent['queryType'] =
      isRelationQuestion || matchedRelation
        ? 'relations'
        : entityName
          ? 'search'
          : 'general';

    return { entityName, relationType: matchedRelation, queryType };
  }

  private rowsToFacts(rows: unknown[]): string {
    const facts = new Set<string>();

    for (const row of rows) {
      const r = row as Record<string, unknown>;

      // relations + general queryType: subject/relation/object or from/relation/to
      const subject = r['subject'] ?? r['from'];
      const relation = r['relation'];
      const object = r['object'] ?? r['to'];
      if (subject && relation && object) {
        facts.add(`${str(subject)} ${str(relation)} ${str(object)}`);
        continue;
      }

      // search queryType: name/relation/relatedEntity
      if (r['name'] && r['relation'] && r['relatedEntity']) {
        facts.add(
          `${str(r['name'])} ${str(r['relation'])} ${str(r['relatedEntity'])}`,
        );
      }
    }

    return [...facts].join('\n');
  }

  private extractEntityName(
    question: string,
    relationTypes: string[],
  ): string | null {
    // Strip known relation type words to avoid matching them as entity names
    let cleaned = question;
    for (const rt of relationTypes) {
      cleaned = cleaned.replace(new RegExp(rt, 'gi'), '');
    }

    // Find capitalised words (proper nouns) — skip first word of sentence
    const words = cleaned.split(/\s+/);
    const properNouns = words
      .slice(1) // skip first word (often a verb/question word)
      .filter((w) => /^[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜÇ][a-zàâäéèêëîïôùûüç]{1,}$/.test(w));

    return properNouns[0] ?? null;
  }

  private buildCypher(intent: QueryIntent): {
    cypher: string;
    params: Record<string, unknown>;
  } {
    if (intent.queryType === 'relations' && intent.entityName) {
      if (intent.relationType) {
        return {
          cypher: `MATCH (e:Entity { name: $name })-[r:RELATION]->(other:Entity)
WHERE r.type = $relType
RETURN e.name AS subject, r.type AS relation, other.name AS object
UNION ALL
MATCH (other:Entity)-[r:RELATION]->(e:Entity { name: $name })
WHERE r.type = $relType
RETURN other.name AS subject, r.type AS relation, e.name AS object
LIMIT 20`,
          params: { name: intent.entityName, relType: intent.relationType },
        };
      }
      return {
        cypher: `MATCH (e:Entity { name: $name })-[r:RELATION]->(other:Entity)
RETURN e.name AS subject, r.type AS relation, other.name AS object
UNION ALL
MATCH (other:Entity)-[r:RELATION]->(e:Entity { name: $name })
RETURN other.name AS subject, r.type AS relation, e.name AS object
LIMIT 20`,
        params: { name: intent.entityName },
      };
    }

    if (intent.queryType === 'search' && intent.entityName) {
      return {
        cypher: `MATCH (e:Entity)
WHERE toLower(e.name) CONTAINS toLower($name)
OPTIONAL MATCH (e)-[r:RELATION]->(other:Entity)
RETURN e.name AS name, e.type AS type, r.type AS relation, other.name AS relatedEntity
LIMIT 20`,
        params: { name: intent.entityName },
      };
    }

    // general: return full graph sample
    return {
      cypher: `MATCH (a:Entity)-[r:RELATION]->(b:Entity)
RETURN a.name AS from, r.type AS relation, b.name AS to
LIMIT 20`,
      params: {},
    };
  }
}
