import { Injectable, Logger } from '@nestjs/common';
import * as chrono from 'chrono-node';
import type {
  RecurrencePattern,
  TemporalDirection,
  TemporalInterval,
  TemporalResult,
} from './temporal.types';

@Injectable()
export class TemporalService {
  private readonly logger = new Logger(TemporalService.name);

  /**
   * Extrait la première expression temporelle en français d'un texte.
   * @param text          Le texte à analyser (ex: "Rappelle-moi ce soir à 20h")
   * @param referenceDate Date de référence pour la résolution relative (défaut: maintenant)
   * @returns TemporalResult ou null si aucune expression trouvée
   */
  parse(text: string, referenceDate?: Date): TemporalResult | null {
    const ref = referenceDate ?? new Date();
    const results = chrono.fr.parse(text, ref, { forwardDate: true });

    if (results.length === 0) {
      this.logger.debug(`Aucune expression temporelle trouvée dans: "${text}"`);
      return null;
    }

    const first = results[0];
    this.logger.debug(
      `Expression temporelle trouvée: "${first.text}" → ${first.start.date().toISOString()}`,
    );

    return {
      expression: first.text,
      resolvedDate: first.start.date().toISOString(),
    };
  }

  /**
   * Extrait toutes les expressions temporelles en français d'un texte.
   * @param text          Le texte à analyser
   * @param referenceDate Date de référence pour la résolution relative (défaut: maintenant)
   * @returns Tableau de TemporalResult (vide si aucune expression trouvée)
   */
  parseAll(text: string, referenceDate?: Date): TemporalResult[] {
    const ref = referenceDate ?? new Date();
    const results = chrono.fr.parse(text, ref, { forwardDate: true });

    this.logger.debug(
      `${results.length} expression(s) temporelle(s) trouvée(s) dans: "${text}"`,
    );

    return results.map((r) => ({
      expression: r.text,
      resolvedDate: r.start.date().toISOString(),
    }));
  }

  /**
   * Extrait un intervalle de dates depuis un texte français.
   * Ex: "la semaine dernière", "entre lundi et mercredi"
   * Pour une date unique, l'intervalle couvre la journée entière (00:00 → 23:59:59.999).
   */
  parseInterval(text: string, referenceDate?: Date): TemporalInterval | null {
    const ref = referenceDate ?? new Date();
    const results = chrono.fr.parse(text, ref, { forwardDate: false });

    if (results.length === 0) {
      this.logger.debug(`Aucun intervalle temporel trouvé dans: "${text}"`);
      return null;
    }

    const result = results[0];

    if (result.end) {
      this.logger.debug(
        `Intervalle trouvé: "${result.text}" → ${result.start.date().toISOString()} / ${result.end.date().toISOString()}`,
      );
      return {
        expression: result.text,
        start: result.start.date().toISOString(),
        end: result.end.date().toISOString(),
      };
    }

    // Date unique → journée complète
    const startDate = result.start.date();
    const endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);

    this.logger.debug(
      `Intervalle (journée) trouvé: "${result.text}" → ${startDate.toISOString()} / ${endDate.toISOString()}`,
    );

    return {
      expression: result.text,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    };
  }

  /**
   * Détecte les patterns de récurrence dans un texte français.
   * Ex: "tous les mardis" → { frequency: 'weekly', dayOfWeek: 2 }
   *     "chaque jour"     → { frequency: 'daily' }
   */
  detectRecurrence(text: string): RecurrencePattern | null {
    const lower = text.toLowerCase();

    const weeklyPatterns: Record<string, number> = {
      lundi: 1,
      mardi: 2,
      mercredi: 3,
      jeudi: 4,
      vendredi: 5,
      samedi: 6,
      dimanche: 0,
    };

    const weeklyMatch = lower.match(
      /(?:tous\s+les|chaque)\s+(lundis?|mardis?|mercredis?|jeudis?|vendredis?|samedis?|dimanches?)/,
    );
    if (weeklyMatch) {
      const dayName = weeklyMatch[1].replace(/s$/, '');
      this.logger.debug(
        `Récurrence hebdomadaire détectée: "${weeklyMatch[0]}"`,
      );
      return {
        expression: weeklyMatch[0],
        frequency: 'weekly',
        dayOfWeek: weeklyPatterns[dayName],
      };
    }

    if (/(?:tous\s+les\s+jours|chaque\s+jour|quotidien)/.test(lower)) {
      this.logger.debug('Récurrence quotidienne détectée');
      return { expression: 'tous les jours', frequency: 'daily' };
    }

    if (/(?:tous\s+les\s+mois|chaque\s+mois|mensuel)/.test(lower)) {
      this.logger.debug('Récurrence mensuelle détectée');
      return { expression: 'tous les mois', frequency: 'monthly' };
    }

    return null;
  }

  /**
   * Détermine si le texte exprime une intention passée ou future.
   * Ex: "qu'ai-je fait hier" → 'past'
   *     "qu'est-ce que j'ai prévu demain" → 'future'
   */
  detectDirection(text: string): TemporalDirection {
    const lower = text.toLowerCase();

    const pastIndicators = [
      /qu['']?(?:est-ce qui|ai-je)\s+(?:fait|eu|vu|dit)/,
      /(?:hier|avant-hier|la\s+semaine\s+derni[eè]re|le\s+mois\s+dernier)/,
      /(?:s['']est\s+pass[eé]|a\s+eu\s+lieu|avai[ts])/,
    ];

    const futureIndicators = [
      /(?:demain|apr[eè]s-demain|la\s+semaine\s+prochaine|le\s+mois\s+prochain)/,
      /(?:pr[eé]vu|planifi[eé]|vais|dois|faut)/,
      /(?:qu['']?(?:est-ce que|ai-je)\s+(?:pr[eé]vu|dois))/,
    ];

    for (const pattern of pastIndicators) {
      if (pattern.test(lower)) {
        this.logger.debug(`Direction passée détectée dans: "${text}"`);
        return 'past';
      }
    }

    for (const pattern of futureIndicators) {
      if (pattern.test(lower)) {
        this.logger.debug(`Direction future détectée dans: "${text}"`);
        return 'future';
      }
    }

    return 'unknown';
  }
}
