import { Injectable } from '@nestjs/common';

@Injectable()
export class MemoryScoringService {
  private readonly DECAY_RATE = 0.05;
  private readonly EMOTION_KEYWORDS = [
    'important',
    'urgent',
    'critique',
    'attention',
    'crucial',
    'prioritaire',
    'essentiel',
    'inquiet',
    'stresse',
  ];

  computeImportance(text: string, eventDate?: string): number {
    // At creation time: recency=1.0, access=0.0
    return this.formula(1.0, 0.0, this.emotionScore(text), this.futureScore(eventDate));
  }

  recomputeImportance(
    addedAt: string,
    accessCount: number,
    text: string,
    eventDate?: string,
  ): number {
    const daysSince = (Date.now() - new Date(addedAt).getTime()) / 86_400_000;
    const recency = Math.exp(-this.DECAY_RATE * daysSince);
    const access = Math.min(1.0, accessCount / 10);
    return this.formula(recency, access, this.emotionScore(text), this.futureScore(eventDate));
  }

  private formula(r: number, a: number, e: number, f: number): number {
    return 0.3 * r + 0.3 * a + 0.2 * e + 0.2 * f;
  }

  private emotionScore(text: string): number {
    const lower = text.toLowerCase();
    return this.EMOTION_KEYWORDS.some((kw) => lower.includes(kw)) ? 1.0 : 0.3;
  }

  private futureScore(eventDate?: string): number {
    if (!eventDate) return 0.3;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const event = new Date(eventDate);
    const eventDay = new Date(event.getFullYear(), event.getMonth(), event.getDate());
    if (eventDay > today) return 1.0;
    if (eventDay.getTime() === today.getTime()) return 0.5;
    return 0.1;
  }
}
