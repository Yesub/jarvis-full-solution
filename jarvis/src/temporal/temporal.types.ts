export type TemporalResult = {
  /** Texte original correspondant à l'expression temporelle ("ce soir à 20h") */
  expression: string;
  /** Date résolue en ISO 8601 UTC ("2026-02-16T20:00:00.000Z") */
  resolvedDate: string;
};

export type TemporalInterval = {
  /** Texte original correspondant à l'intervalle ("la semaine dernière") */
  expression: string;
  /** Début de l'intervalle en ISO 8601 UTC */
  start: string;
  /** Fin de l'intervalle en ISO 8601 UTC */
  end: string;
};

export type RecurrencePattern = {
  /** Texte original correspondant à la récurrence ("tous les mardis") */
  expression: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Jour de la semaine (0=Dimanche, 1=Lundi, …, 6=Samedi) */
  dayOfWeek?: number;
  dayOfMonth?: number;
  /** Heure au format HH:mm */
  time?: string;
};

export type TemporalDirection = 'past' | 'future' | 'present' | 'unknown';
