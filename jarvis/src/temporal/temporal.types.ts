export type TemporalResult = {
  /** Texte original correspondant à l'expression temporelle ("ce soir à 20h") */
  expression: string;
  /** Date résolue en ISO 8601 UTC ("2026-02-16T20:00:00.000Z") */
  resolvedDate: string;
};
