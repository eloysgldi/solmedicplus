import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
export const CAMINHO_DB = process.env.SM_DB || join(raiz, 'data', 'solmedic.db');

mkdirSync(dirname(CAMINHO_DB), { recursive: true });

export const db = new DatabaseSync(CAMINHO_DB);
db.exec(readFileSync(join(raiz, 'server', 'schema.sql'), 'utf8'));

/**
 * Migrações leves: colunas que nasceram depois do schema original.
 * CREATE TABLE IF NOT EXISTS não adiciona coluna em tabela que já existe.
 */
function colunaFaltando(tabela, coluna) {
  return !db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
}
// preço "de" — o riscado da vitrine. Sem isso não existe oferta, só preço.
if (colunaFaltando('inventory', 'preco_de_centavos')) {
  db.exec('ALTER TABLE inventory ADD COLUMN preco_de_centavos INTEGER');
}
if (colunaFaltando('products', 'forma')) {
  // silhueta da embalagem: caixa, frasco, tubo, pacote
  db.exec("ALTER TABLE products ADD COLUMN forma TEXT DEFAULT 'caixa'");
}
if (colunaFaltando('products', 'cor')) {
  db.exec("ALTER TABLE products ADD COLUMN cor TEXT");
}

// ---- conformidade da receita (RDC 44/2009, 471/2021, 812/2023, 1.000/2025) ----
const COLUNAS_NOVAS = [
  // quanto tempo a receita vale, por classe: antimicrobiano são 10 dias
  ['products', 'dias_validade_receita', 'INTEGER'],
  // GLP-1 entrou na lista de retenção obrigatória em 2025
  ['products', 'glp1', 'INTEGER NOT NULL DEFAULT 0'],

  // de onde veio a receita — foto de papel e prescrição eletrônica assinada
  // são coisas juridicamente diferentes
  ['prescriptions', 'origem', "TEXT NOT NULL DEFAULT 'papel'"],
  ['prescriptions', 'plataforma', 'TEXT'],
  ['prescriptions', 'codigo_validacao', 'TEXT'],
  ['prescriptions', 'tipo_assinatura', 'TEXT'],
  ['prescriptions', 'assinatura_validada', 'INTEGER NOT NULL DEFAULT 0'],
  ['prescriptions', 'numero_sncr', 'TEXT'],
  ['prescriptions', 'exige_retencao', 'INTEGER NOT NULL DEFAULT 0'],
  ['prescriptions', 'retida_em', 'TEXT'],
  ['prescriptions', 'retida_por', 'TEXT'],
  ['prescriptions', 'retida_via', 'TEXT'],
  // a loja que vai ler a receita quando ela chega solta, fora de um pedido
  ['prescriptions', 'pharmacy_id', 'TEXT'],

  // uma receita retida é consumida inteira; só uso contínuo tem saldo
  ['prescription_items', 'consumo', "TEXT NOT NULL DEFAULT 'saldo'"],

  ['orders', 'exige_coleta_receita', 'INTEGER NOT NULL DEFAULT 0'],
  ['orders', 'receita_retida', 'INTEGER NOT NULL DEFAULT 0'],
  ['deliveries', 'coletar_receita', 'INTEGER NOT NULL DEFAULT 0'],
  ['deliveries', 'receita_coletada_em', 'TEXT'],

  // posição na prateleira: a lista de separação sai na ordem do corredor,
  // não na ordem em que o cliente jogou no carrinho
  ['inventory', 'posicao', 'TEXT'],
  // o domínio da loja precisa constar na AFE dela
  ['pharmacies', 'dominio_afe', 'TEXT'],
];
for (const [tabela, coluna, tipo] of COLUNAS_NOVAS) {
  const tem = db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
  if (!tem) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
}

// prescriptions nasceu exigindo arquivo_url; prescrição eletrônica não tem
// papel nenhum. SQLite não remove NOT NULL, então a tabela é reconstruída
// preservando as colunas que já existem.
const sqlRx = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='prescriptions'").get()?.sql ?? '';
if (/arquivo_url\s+TEXT\s+NOT NULL/i.test(sqlRx)) {
  const cols = db.prepare('PRAGMA table_info(prescriptions)').all();
  const def = cols.map((c) => {
    const nn = c.name === 'arquivo_url' ? '' : (c.notnull ? ' NOT NULL' : '');
    const dflt = c.dflt_value != null ? ` DEFAULT ${c.dflt_value}` : '';
    const pk = c.pk ? ' PRIMARY KEY' : '';
    return `  ${c.name} ${c.type || 'TEXT'}${pk}${nn}${dflt}`;
  }).join(', ');
  const nomes = cols.map((c) => c.name).join(',');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`
    CREATE TABLE prescriptions_nova (
${def},
      CHECK (status IN ('pendente','validada','recusada','vencida'))
    );
    INSERT INTO prescriptions_nova (${nomes}) SELECT ${nomes} FROM prescriptions;
    DROP TABLE prescriptions;
    ALTER TABLE prescriptions_nova RENAME TO prescriptions;
  `);
  db.exec('PRAGMA foreign_keys = ON');
}

// pharmacy_docs nasceu com um CHECK fechado de tipos; norma nova traz
// documento novo, e SQLite não altera CHECK — então a tabela é reconstruída.
const sqlDocs = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='pharmacy_docs'").get()?.sql ?? '';
if (sqlDocs.includes('CHECK (tipo IN')) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`
    CREATE TABLE pharmacy_docs_novo (
      id TEXT PRIMARY KEY,
      pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id),
      tipo TEXT NOT NULL,
      numero TEXT, validade TEXT, arquivo_url TEXT,
      status TEXT NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente','aprovado','recusado','vencido')),
      motivo TEXT, revisado_por TEXT REFERENCES users(id), revisado_em TEXT,
      criado_em TEXT NOT NULL
    );
    INSERT INTO pharmacy_docs_novo SELECT id,pharmacy_id,tipo,numero,validade,arquivo_url,
      status,motivo,revisado_por,revisado_em,criado_em FROM pharmacy_docs;
    DROP TABLE pharmacy_docs;
    ALTER TABLE pharmacy_docs_novo RENAME TO pharmacy_docs;
  `);
  db.exec('PRAGMA foreign_keys = ON');
}

// ============================================================
// O ARMÁRIO
//
// A gente já registra lote e validade de cada caixa na separação — isso
// nasceu para rastreabilidade de recall e acabou virando outra coisa:
// a gente sabe o que tem na casa da pessoa.
//
// Daí saem três coisas que ninguém no varejo farmacêutico brasileiro faz
// no nível do consumidor:
//   · avisar que o remédio dela vence mês que vem
//   · não vender de novo o que ela ainda tem
//   · e, quando a Anvisa recolhe um lote, avisar EXATAMENTE quem levou
//     aquele lote — não um comunicado genérico no site
// ============================================================
db.exec(`
CREATE TABLE IF NOT EXISTS armario (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  ean           TEXT NOT NULL REFERENCES products(ean),
  nome          TEXT NOT NULL,
  qtd_inicial   INTEGER NOT NULL DEFAULT 1,
  qtd_atual     INTEGER NOT NULL DEFAULT 1,
  lote          TEXT,
  validade      TEXT,
  order_id      TEXT REFERENCES orders(id),
  recebido_em   TEXT NOT NULL,
  encerrado_em  TEXT,
  motivo        TEXT CHECK (motivo IN ('acabou','vencido','recolhido','descartado')),
  -- marca de que o aviso de validade já saiu: ninguém merece o mesmo
  -- alerta todo dia até o remédio vencer
  avisado_em    TEXT,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_armario_user ON armario(user_id, encerrado_em);
CREATE INDEX IF NOT EXISTS idx_armario_lote ON armario(ean, lote);

CREATE TABLE IF NOT EXISTS recalls (
  id          TEXT PRIMARY KEY,
  ean         TEXT NOT NULL REFERENCES products(ean),
  lote        TEXT,                -- nulo = todos os lotes do produto
  motivo      TEXT NOT NULL,
  origem      TEXT NOT NULL DEFAULT 'anvisa'
              CHECK (origem IN ('anvisa','fabricante','interno')),
  referencia  TEXT,
  gravidade   TEXT NOT NULL DEFAULT 'alta' CHECK (gravidade IN ('alta','media')),
  criado_por  TEXT REFERENCES users(id),
  atingidos   INTEGER NOT NULL DEFAULT 0,
  criado_em   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recall_ean ON recalls(ean, lote);
`);

// armário de banco antigo não tem a marca do aviso de validade
if (!db.prepare('PRAGMA table_info(armario)').all().some((c) => c.name === 'avisado_em')) {
  db.exec('ALTER TABLE armario ADD COLUMN avisado_em TEXT');
}

// ============================================================
// ESTOQUE POR LOTE
//
// inventory.estoque é o saldo agregado — é o que a vitrine lê e o que a
// reserva trava. Aqui embaixo fica a verdade: de qual lote veio cada
// caixa, com que validade e por quanto foi comprada.
//
// Com isso a separação para de pedir lote digitado na mão: o sistema
// escolhe o lote que vence primeiro (FEFO) e o balconista só confirma.
// ============================================================
db.exec(`
CREATE TABLE IF NOT EXISTS estoque_lotes (
  id           TEXT PRIMARY KEY,
  pharmacy_id  TEXT NOT NULL REFERENCES pharmacies(id),
  ean          TEXT NOT NULL REFERENCES products(ean),
  lote         TEXT NOT NULL,
  validade     TEXT,
  qtd          INTEGER NOT NULL DEFAULT 0,
  qtd_inicial  INTEGER NOT NULL DEFAULT 0,
  custo_centavos INTEGER,
  fornecedor   TEXT,
  nota_fiscal  TEXT,
  bloqueado    INTEGER NOT NULL DEFAULT 0,   -- recall trava o lote sem apagar
  entrada_em   TEXT NOT NULL,
  criado_por   TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_lote_loja ON estoque_lotes(pharmacy_id, ean, validade);

CREATE TABLE IF NOT EXISTS estoque_mov (
  id           TEXT PRIMARY KEY,
  pharmacy_id  TEXT NOT NULL REFERENCES pharmacies(id),
  ean          TEXT NOT NULL REFERENCES products(ean),
  lote_id      TEXT REFERENCES estoque_lotes(id),
  tipo         TEXT NOT NULL CHECK (tipo IN
               ('entrada','venda','devolucao','ajuste','perda','recall','reserva')),
  qtd          INTEGER NOT NULL,            -- assinado: entra positivo, sai negativo
  saldo_depois INTEGER NOT NULL,
  custo_centavos INTEGER,
  motivo       TEXT,
  order_id     TEXT REFERENCES orders(id),
  user_id      TEXT REFERENCES users(id),
  criado_em    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mov_loja ON estoque_mov(pharmacy_id, ean, criado_em);
`);

// ============================================================
// CRM
//
// A ficha do cliente não é uma tabela: ela é calculada em cima dos
// pedidos, do armário e das receitas que já existem. O que precisa de
// tabela é o que a equipe escreve — o que ninguém consegue deduzir.
// ============================================================
db.exec(`
CREATE TABLE IF NOT EXISTS cliente_notas (
  id          TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  texto       TEXT NOT NULL,
  autor_id    TEXT REFERENCES users(id),
  fixada      INTEGER NOT NULL DEFAULT 0,   -- aparece no card do pedido
  criado_em   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nota_cliente ON cliente_notas(pharmacy_id, user_id);

CREATE TABLE IF NOT EXISTS cliente_marcas (
  pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  marca       TEXT NOT NULL,
  criado_em   TEXT NOT NULL,
  PRIMARY KEY (pharmacy_id, user_id, marca)
);

CREATE TABLE IF NOT EXISTS campanhas (
  id          TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id),
  segmento    TEXT NOT NULL,
  titulo      TEXT NOT NULL,
  corpo       TEXT NOT NULL,
  url         TEXT,
  alcance     INTEGER NOT NULL DEFAULT 0,
  criado_por  TEXT REFERENCES users(id),
  criado_em   TEXT NOT NULL
);
`);

// O farmacêutico no chat. É a única coisa nesta plataforma que um
// marketplace não consegue copiar: eles não empregam farmacêutico.
db.exec(`
CREATE TABLE IF NOT EXISTS conversas (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id),
  assunto     TEXT,
  status      TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','respondida','fechada')),
  order_id    TEXT REFERENCES orders(id),
  criado_em   TEXT NOT NULL,
  mexido_em   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversa_loja ON conversas(pharmacy_id, status, mexido_em);
CREATE INDEX IF NOT EXISTS idx_conversa_user ON conversas(user_id, mexido_em);

CREATE TABLE IF NOT EXISTS mensagens (
  id          TEXT PRIMARY KEY,
  conversa_id TEXT NOT NULL REFERENCES conversas(id),
  autor_tipo  TEXT NOT NULL CHECK (autor_tipo IN ('cliente','farmaceutico','sistema')),
  autor_id    TEXT REFERENCES users(id),
  autor_nome  TEXT,
  crf         TEXT,
  texto       TEXT NOT NULL,
  lida_em     TEXT,
  criado_em   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conversa ON mensagens(conversa_id, criado_em);
`);

// Inscrições de push e o histórico do que foi avisado. O histórico serve
// para o sininho dentro do app e para provar o que a gente comunicou.
db.exec(`
CREATE TABLE IF NOT EXISTS push_inscricoes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  aparelho   TEXT,
  criado_em  TEXT NOT NULL,
  usado_em   TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_inscricoes(user_id);

CREATE TABLE IF NOT EXISTS notificacoes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  tipo       TEXT NOT NULL,
  titulo     TEXT NOT NULL,
  corpo      TEXT,
  url        TEXT,
  order_id   TEXT,
  lida_em    TEXT,
  criado_em  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notificacoes(user_id, criado_em);
`);

// Preferência de privacidade: mostrar ou não o nome do remédio na tela
// bloqueada. Padrão é NÃO — a notificação não pode entregar a doença de
// ninguém para quem estiver olhando o celular.
if (!db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === 'push_detalhado')) {
  db.exec('ALTER TABLE users ADD COLUMN push_detalhado INTEGER NOT NULL DEFAULT 0');
}

// Chaves de operação que mudam sem deploy: ligar receita no dia em que a
// licença sair não pode depender de subir o servidor de novo.
db.exec(`
CREATE TABLE IF NOT EXISTS configuracoes (
  chave      TEXT PRIMARY KEY,
  valor      TEXT NOT NULL,
  alterado_por TEXT,
  alterado_em  TEXT
);
`);

// O fecho do ciclo. Sem avaliação a plataforma não sabe qual farmácia
// está queimando o cliente dela — e ruptura resolvida no grito não aparece
// em nenhum outro número.
db.exec(`
CREATE TABLE IF NOT EXISTS avaliacoes (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL UNIQUE REFERENCES orders(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  pharmacy_id   TEXT NOT NULL REFERENCES pharmacies(id),
  courier_id    TEXT REFERENCES couriers(id),
  nota          INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
  nota_entrega  INTEGER CHECK (nota_entrega BETWEEN 1 AND 5),
  marcas        TEXT,                -- json: o que foi bem ou mal, em palavra curta
  comentario    TEXT,
  gorjeta_centavos INTEGER NOT NULL DEFAULT 0,
  criado_em     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aval_loja ON avaliacoes(pharmacy_id, criado_em);
`);

// A prova da retenção. Sem esta linha, a dispensação não aconteceu —
// é o que a vigilância pede quando aparece.
db.exec(`
CREATE TABLE IF NOT EXISTS prescription_retentions (
  id                 TEXT PRIMARY KEY,
  prescription_id    TEXT NOT NULL REFERENCES prescriptions(id),
  order_id           TEXT REFERENCES orders(id),
  pharmacy_id        TEXT NOT NULL REFERENCES pharmacies(id),
  farmaceutico_id    TEXT NOT NULL REFERENCES users(id),
  crf                TEXT NOT NULL,
  via                TEXT NOT NULL CHECK (via IN ('fisica','digital')),
  recebida_em        TEXT NOT NULL,
  registro_numero    TEXT,
  quantidade_dispensada INTEGER,
  lote               TEXT,
  validade_lote      TEXT,
  arquivo_url        TEXT,
  observacao         TEXT,
  criado_em          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ret_receita ON prescription_retentions(prescription_id);
CREATE INDEX IF NOT EXISTS idx_ret_pedido  ON prescription_retentions(order_id);
-- o mesmo código de receita eletrônica não pode ser aceito duas vezes
CREATE UNIQUE INDEX IF NOT EXISTS idx_codigo_validacao
  ON prescriptions(plataforma, codigo_validacao)
  WHERE codigo_validacao IS NOT NULL;
`);

/** Todo id do sistema nasce aqui. */
export const id = () => randomUUID();

/** Agora, sempre em ISO-8601 UTC. */
export const agora = () => new Date().toISOString();

/** Soma segundos a um instante ISO. */
export const maisSegundos = (s, base = Date.now()) =>
  new Date(base + s * 1000).toISOString();

/** Helpers finos em cima do driver — sem ORM, sem mágica. */
export const um = (sql, ...p) => db.prepare(sql).get(...p) ?? null;
export const todos = (sql, ...p) => db.prepare(sql).all(...p);
export const roda = (sql, ...p) => db.prepare(sql).run(...p);

/** Transação: ou tudo, ou nada. Pagamento e estoque dependem disso. */
/**
 * Transação reentrante.
 *
 * A primeira abre BEGIN; as de dentro viram SAVEPOINT. Sem isso, uma
 * função transacional que chama outra função transacional estoura com
 * "cannot start a transaction within a transaction" — e o pior é que
 * estoura só quando os dois caminhos se encontram, que é tarde.
 */
let profundidade = 0;
export function transacao(fn) {
  const nivel = profundidade++;
  const ponto = `sp${nivel}`;
  db.exec(nivel === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${ponto}`);
  try {
    const r = fn();
    db.exec(nivel === 0 ? 'COMMIT' : `RELEASE ${ponto}`);
    return r;
  } catch (e) {
    db.exec(nivel === 0 ? 'ROLLBACK' : `ROLLBACK TO ${ponto}`);
    if (nivel > 0) db.exec(`RELEASE ${ponto}`);
    throw e;
  } finally {
    profundidade = nivel;
  }
}

/** Centavos -> "R$ 12,40". Só para log e e-mail; a API devolve centavos. */
export const brl = (c) =>
  'R$ ' + (c / 100).toFixed(2).replace('.', ',');

// ============================================================
// O ENTREGADOR
//
// Quem cadastra o piloto, define o veículo e decide se a corrida é
// rastreável é a loja — não o entregador. Rastreamento é dado de
// localização de uma pessoa: quem assume essa responsabilidade é o
// estabelecimento, que responde pelo vínculo.
// ============================================================
db.exec(`
CREATE TABLE IF NOT EXISTS entregador_posicoes (
  id          TEXT PRIMARY KEY,
  courier_id  TEXT NOT NULL REFERENCES couriers(id),
  order_id    TEXT REFERENCES orders(id),
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  precisao_m  REAL,
  velocidade  REAL,
  rumo        REAL,
  bateria     INTEGER,
  criado_em   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pos_courier ON entregador_posicoes(courier_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_pos_order ON entregador_posicoes(order_id, criado_em);
`);

// O catálogo nasceu como lista fechada da plataforma. Agora a loja
// cadastra produto por completo, então ele ganhou o que faltava para
// existir sozinho: a descrição que o cliente lê e quem o criou.
for (const [tabela, coluna, tipo] of [
  ['products', 'descricao', 'TEXT'],
  ['products', 'marca', 'TEXT'],
  ['products', 'criado_por', 'TEXT'],
  ['products', 'criado_em', 'TEXT'],
]) {
  const tem = db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
  if (!tem) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
}

// colunas que nasceram com o app do entregador
for (const [tabela, coluna, tipo] of [
  // a loja liga e desliga o rastreamento por entregador
  ['couriers', 'rastreavel', 'INTEGER NOT NULL DEFAULT 1'],
  ['couriers', 'em_turno', 'INTEGER NOT NULL DEFAULT 0'],
  ['couriers', 'ultima_lat', 'REAL'],
  ['couriers', 'ultima_lng', 'REAL'],
  ['couriers', 'ultima_em', 'TEXT'],
  ['couriers', 'criado_em', 'TEXT'],
  ['couriers', 'cnh', 'TEXT'],
  ['couriers', 'observacao', 'TEXT'],
]) {
  const tem = db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
  if (!tem) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
}
