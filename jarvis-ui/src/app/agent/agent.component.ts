import { Component, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';

import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ApiService } from '../api.service';
import { SpeechService } from '../speech.service';
import { AgentMessage, AgentResponse } from '../models/agent.models';

@Component({
  selector: 'app-agent',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  templateUrl: './agent.component.html',
  styleUrl: './agent.component.css',
})
export class AgentComponent {
  @ViewChild('messagesArea') private messagesArea!: ElementRef<HTMLDivElement>;

  private readonly api = inject(ApiService);
  private readonly speech = inject(SpeechService);
  private readonly snackBar = inject(MatSnackBar);

  readonly sessionId = signal<string | null>(null);
  readonly messages = signal<AgentMessage[]>([]);
  readonly inputText = signal('');
  readonly busy = signal(false);
  readonly streamingContent = signal('');
  readonly streamingIntent = signal<string | null>(null);
  readonly streamingConfidence = signal<number | null>(null);
  readonly recordingActive = signal(false);
  readonly transcribing = signal(false);

  send(): void {
    const text = this.inputText().trim();
    if (!text || this.busy()) return;

    this.inputText.set('');
    this.messages.update((msgs) => [
      ...msgs,
      { role: 'user', content: text, timestamp: new Date() },
    ]);
    this.scrollToBottom();

    this.busy.set(true);
    this.streamingContent.set('');
    this.streamingIntent.set(null);
    this.streamingConfidence.set(null);

    let pendingMeta: Partial<AgentResponse> = {};

    this.api
      .processAgentStream({ sessionId: this.sessionId() ?? undefined, text, source: 'ui' })
      .pipe(finalize(() => this.finishStreaming(pendingMeta)))
      .subscribe({
        next: (event) => {
          if (event._event === 'metadata') {
            if (event.sessionId) this.sessionId.set(event.sessionId);
            pendingMeta = {
              intent: event.intent,
              confidence: event.confidence,
              sources: event.sources as AgentResponse['sources'],
            };
            this.streamingIntent.set(pendingMeta.intent ?? null);
            this.streamingConfidence.set(pendingMeta.confidence ?? null);
          }
          if (event.token) {
            this.streamingContent.update((c) => c + event.token);
            this.scrollToBottom();
          }
        },
        error: () => {
          this.busy.set(false);
          this.streamingContent.set('');
          this.fallbackProcess(text, pendingMeta);
        },
      });
  }

  private finishStreaming(meta: Partial<AgentResponse>): void {
    const content = this.streamingContent();
    if (content) {
      this.messages.update((msgs) => [
        ...msgs,
        {
          role: 'assistant',
          content,
          timestamp: new Date(),
          intent: meta.intent,
          confidence: meta.confidence,
          sources: meta.sources,
        },
      ]);
    }
    this.streamingContent.set('');
    this.streamingIntent.set(null);
    this.streamingConfidence.set(null);
    this.busy.set(false);
    this.scrollToBottom();
  }

  private fallbackProcess(text: string, meta: Partial<AgentResponse>): void {
    this.busy.set(true);
    this.api
      .processAgent({ sessionId: this.sessionId() ?? undefined, text, source: 'ui' })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (res) => {
          if (res.sessionId) this.sessionId.set(res.sessionId);
          this.messages.update((msgs) => [
            ...msgs,
            {
              role: 'assistant',
              content: res.answer,
              timestamp: new Date(),
              intent: res.intent,
              confidence: res.confidence,
              sources: res.sources,
            },
          ]);
          this.scrollToBottom();
        },
        error: () =>
          this.snackBar.open("Erreur lors de la communication avec l'agent.", 'Fermer', {
            duration: 5000,
          }),
      });
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  async toggleMic(): Promise<void> {
    if (this.recordingActive()) {
      this.recordingActive.set(false);
      this.transcribing.set(true);
      try {
        const blob = await this.speech.stop();
        this.api
          .transcribe(blob)
          .pipe(finalize(() => this.transcribing.set(false)))
          .subscribe({
            next: (res) => this.inputText.set(res.text),
            error: () =>
              this.snackBar.open('Erreur lors de la transcription.', 'Fermer', { duration: 5000 }),
          });
      } catch {
        this.transcribing.set(false);
        this.snackBar.open('Erreur lors de la capture audio.', 'Fermer', { duration: 5000 });
      }
    } else {
      try {
        await this.speech.start();
        this.recordingActive.set(true);
      } catch {
        this.snackBar.open(
          "Accès au microphone refusé. Veuillez autoriser l'accès dans votre navigateur.",
          'Fermer',
          { duration: 6000 },
        );
      }
    }
  }

  confidenceColor(confidence: number): string {
    if (confidence >= 0.8) return 'high';
    if (confidence >= 0.5) return 'medium';
    return 'low';
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.messagesArea?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }
}
