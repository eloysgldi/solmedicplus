/**
 * Entrada de produção.
 *
 * Em hospedagem gratuita o disco é efêmero: o processo sobe com o banco
 * vazio depois de cada deploy. Então o boot semeia antes de abrir a porta
 * — caso contrário o primeiro visitante encontra um catálogo em branco e
 * conclui, com razão, que o produto não existe.
 *
 * Com SM_SEED=0 o boot não toca em nada: é o modo para quando os dados
 * passarem a ser de verdade.
 */
// as credenciais vivem no .env, que não vai para o repositório. Em
// produção quem preenche é o painel do Render, e aí o arquivo nem existe.
try { process.loadEnvFile(); } catch { /* sem .env: o ambiente já mandou */ }

const { um } = await import('./db.js');

const semear = process.env.SM_SEED !== '0';
const vazio = !um('SELECT ean FROM products LIMIT 1');

if (semear && vazio) {
  console.log('  base vazia — semeando antes de abrir a porta');
  await import('./seed.js');
}

await import('./server.js');
