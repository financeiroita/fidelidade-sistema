// Carrega o arquivo .env da pasta atual, se existir. Importado em primeiro lugar pelo servidor e
// pelos comandos (src/jobs, prisma/seed), para não depender do carregamento automático do Prisma
// (que só acontece se o .env existia quando o cliente foi gerado). Variáveis já definidas no
// sistema têm prioridade sobre as do arquivo.
try {
  process.loadEnvFile?.();
} catch {
  // Sem .env: segue com as variáveis do sistema (o servidor avisa o que estiver faltando).
}
