export const environment = {
  production: false,
  apiUrl: '/api',
  mobile: false,
  // Consulta por vídeo: depende do AWS Chime, cuja credencial foi perdida no
  // cleanup da AWS (08/2026). Em dev fica ligada para o fluxo continuar
  // exercitável; produção e mobile desligam. Ver apps/api/src/routes/video.js.
  videoConsultation: true
};
