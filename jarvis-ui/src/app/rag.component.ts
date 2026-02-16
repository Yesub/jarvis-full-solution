import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { JsonPipe } from '@angular/common';
import { finalize } from 'rxjs/operators';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ApiService } from './api.service';
import { SpeechService } from './speech.service';
import { IngestResponse } from './models/rag.models';

@Component({
  selector: 'app-rag',
  standalone: true,
  imports: [
    FormsModule,
    JsonPipe,
    MatButtonModule,
    MatCardModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  templateUrl: './rag.component.html',
  styleUrl: './rag.component.css',
})
export class RagComponent {
  private readonly api = inject(ApiService);
  private readonly speech = inject(SpeechService);
  private readonly snackBar = inject(MatSnackBar);

  readonly busy = signal(false);
  readonly selectedFile = signal<File | null>(null);
  readonly ingestResult = signal<IngestResponse | null>(null);
  readonly questionRag = signal('Expliquez le processus métier X...');
  readonly topK = signal(5);
  readonly prompt = signal('Bonjour, peux-tu répondre sans contexte ?');

  readonly activeMode = signal<'rag' | 'llm' | null>(null);
  readonly streamingText = signal('');
  readonly ragSources = signal<string[]>([]);

  readonly recordingFor = signal<'rag' | 'llm' | null>(null);
  readonly transcribing = signal(false);

  onFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
  }

  doIngest(): void {
    const file = this.selectedFile();
    if (!file) return;
    this.busy.set(true);
    this.api
      .ingest(file)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (res) => this.ingestResult.set(res),
        error: () =>
          this.snackBar.open("Erreur lors de l'ingestion du fichier.", 'Fermer', {
            duration: 5000,
          }),
      });
  }

  doAskRag(): void {
    this.busy.set(true);
    this.activeMode.set('rag');
    this.streamingText.set('');
    this.ragSources.set([]);

    this.api
      .askRagStream(this.questionRag(), this.topK())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (event) => {
          if (event._event === 'metadata') {
            this.ragSources.set(event.sources ?? []);
          }
          if (event.token) {
            this.streamingText.update((t) => t + event.token);
          }
        },
        error: () =>
          this.snackBar.open('Erreur lors de la requête RAG.', 'Fermer', { duration: 5000 }),
      });
  }

  doAskLlm(): void {
    this.busy.set(true);
    this.activeMode.set('llm');
    this.streamingText.set('');

    this.api
      .askLlmStream(this.prompt())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (event) => {
          if (event.token) {
            this.streamingText.update((t) => t + event.token);
          }
        },
        error: () =>
          this.snackBar.open('Erreur lors de la requête LLM.', 'Fermer', { duration: 5000 }),
      });
  }

  async toggleMic(target: 'rag' | 'llm'): Promise<void> {
    if (this.recordingFor() === target) {
      // Arrêter l'enregistrement et transcrire
      this.recordingFor.set(null);
      this.transcribing.set(true);
      try {
        const blob = await this.speech.stop();
        this.api
          .transcribe(blob)
          .pipe(finalize(() => this.transcribing.set(false)))
          .subscribe({
            next: (res) => {
              if (target === 'rag') this.questionRag.set(res.text);
              else this.prompt.set(res.text);
            },
            error: () =>
              this.snackBar.open('Erreur lors de la transcription.', 'Fermer', {
                duration: 5000,
              }),
          });
      } catch {
        this.transcribing.set(false);
        this.snackBar.open('Erreur lors de la capture audio.', 'Fermer', { duration: 5000 });
      }
    } else {
      // Démarrer l'enregistrement
      try {
        await this.speech.start();
        this.recordingFor.set(target);
      } catch {
        this.snackBar.open(
          "Accès au microphone refusé. Veuillez autoriser l'accès dans votre navigateur.",
          'Fermer',
          { duration: 6000 },
        );
      }
    }
  }
}
