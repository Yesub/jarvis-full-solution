export enum IntentType {
  ADD = 'ADD',
  QUERY = 'QUERY',
  UNKNOWN = 'UNKNOWN',
}

export interface ExtractedEntities {
  /** Raw temporal expression found in the text, e.g. "ce soir à 20h" */
  dateExpression?: string;
}

export interface IntentResult {
  /** Resolved intent category */
  intent: IntentType;
  /** Confidence score 0.0–1.0 */
  confidence: number;
  /** Cleaned text — prefix stripped for ADD, full text for QUERY/UNKNOWN */
  content: string;
  /** Named entities extracted during classification */
  entities: ExtractedEntities;
  /** Classification path taken */
  source: 'llm' | 'regex';
}
