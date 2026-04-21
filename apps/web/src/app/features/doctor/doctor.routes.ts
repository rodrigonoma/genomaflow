import { Routes } from '@angular/router';

export const DOCTOR_ROUTES: Routes = [
  {
    path: 'patients',
    loadComponent: () =>
      import('./patients/patient-list.component').then(m => m.PatientListComponent)
  },
  {
    path: 'patients/:id',
    loadComponent: () =>
      import('./patients/patient-detail.component').then(m => m.PatientDetailComponent)
  },
  {
    path: 'patients/:id/exams',
    loadComponent: () =>
      import('./exams/exam-upload.component').then(m => m.ExamUploadComponent)
  },
  {
    path: 'review-queue',
    loadComponent: () =>
      import('./review-queue/review-queue.component').then(m => m.ReviewQueueComponent)
  },
  {
    path: 'results/:examId',
    loadComponent: () =>
      import('./results/result-panel.component').then(m => m.ResultPanelComponent)
  },
  { path: '', redirectTo: 'patients', pathMatch: 'full' }
];
