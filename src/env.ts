// Carrega o arquivo .env da pasta atual, se existir. Importado em primeiro lugar pelo servidor e
// pelos comandos (src/jobs, prisma/seed), para não depender do carregamento automático do Prisma
// (que só acontece se o .env existia quando o cliente foi gerado). Variáveis já definidas no
// sistema têm prioridade sobre as do arquivo.
if (typeof process.loadEnvFile !== 'function') {
  console.error('Node antigo demais: use o Node 20.12 ou mais novo (o .env não seria lido).');
  process.exit(1);
}
try {
  process.loadEnvFile();
} catch {
  // Sem .env: segue com as variáveis do sistema (o servidor avisa o que estiver faltando).
}
