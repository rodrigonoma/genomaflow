export const environment = {
  production: true,
  apiUrl: '/api',
  mobile: false,
  // Desligada: o Chime perdeu a credencial no cleanup da AWS (08/2026).
  // O backend também recusa (503 VIDEO_CONSULTATION_DISABLED) — esconder aqui
  // é só para o médico não clicar num botão que não funciona.
  videoConsultation: false
};
