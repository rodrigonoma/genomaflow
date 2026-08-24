export const environment = {
  production: true,
  apiUrl: 'https://app.genomaflow.com.br/api',
  mobile: true,
  // Mesmo motivo do environment.prod.ts. Atenção: o APK já instalado carrega
  // o bundle antigo e continua mostrando o botão até um novo build — por isso
  // a trava de verdade está no backend.
  videoConsultation: false
};
