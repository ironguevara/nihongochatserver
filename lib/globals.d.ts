/**
 * Declarações mínimas de ambiente usadas pelas funções da Vercel.
 * Mantém o projeto sem dependências e permite usar process.env
 * com o TypeScript embutido da plataforma.
 */
declare const process: {
  env: Record<string, string | undefined>;
};
