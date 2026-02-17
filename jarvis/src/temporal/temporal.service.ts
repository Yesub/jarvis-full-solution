import { Injectable, Logger } from '@nestjs/common';
import * as chrono from 'chrono-node';
import type { TemporalResult } from './temporal.types';

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
}
