import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./rag.component').then((m) => m.RagComponent),
  },
];
