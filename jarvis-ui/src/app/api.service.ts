import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';
import { IngestResponse, LlmResponse, RagResponse, SttResponse } from './models/rag.models';

export interface StreamEvent {
  _event?: string;
  token?: string;
  done?: boolean;
  error?: string;
  sources?: string[];
  topK?: number;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  ingest(file: File): Observable<IngestResponse> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<IngestResponse>(`${this.baseUrl}/rag/ingest`, fd);
  }

  askRag(question: string, topK = 5): Observable<RagResponse> {
    return this.http.post<RagResponse>(`${this.baseUrl}/rag/ask`, { question, topK });
  }

  askLlm(prompt: string): Observable<LlmResponse> {
    return this.http.post<LlmResponse>(`${this.baseUrl}/llm/ask`, { prompt });
  }

  askLlmStream(prompt: string): Observable<StreamEvent> {
    return this.streamPost('/llm/ask/stream', { prompt });
  }

  askRagStream(question: string, topK = 5): Observable<StreamEvent> {
    return this.streamPost('/rag/ask/stream', { question, topK });
  }

  transcribe(audioBlob: Blob): Observable<SttResponse> {
    const fd = new FormData();
    fd.append('audio', audioBlob, 'recording.webm');
    return this.http.post<SttResponse>(`${this.baseUrl}/stt/transcribe`, fd);
  }

  private streamPost(path: string, body: unknown): Observable<StreamEvent> {
    return new Observable<StreamEvent>((subscriber) => {
      const abort = new AbortController();

      fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            subscriber.error(new Error(`HTTP ${response.status}`));
            return;
          }

          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let currentEvent = 'message';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop()!;

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                const data = JSON.parse(line.slice(6)) as StreamEvent;
                subscriber.next({ ...data, _event: currentEvent });
                currentEvent = 'message';
              }
            }
          }

          subscriber.complete();
        })
        .catch((err: Error) => {
          if (err.name !== 'AbortError') subscriber.error(err);
        });

      return () => abort.abort();
    });
  }
}
