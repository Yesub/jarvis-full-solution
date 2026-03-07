import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./rag.component').then((m) => m.RagComponent),
  },
  {
    path: 'agent',
    loadComponent: () => import('./agent/agent.component').then((m) => m.AgentComponent),
  },
];
