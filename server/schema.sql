-- ============================================================
-- SOLMEDIC+ — modelo de dados
-- Dinheiro SEMPRE em centavos (INTEGER). Nunca float.
-- Datas em ISO-8601 UTC (TEXT).
-- ============================================================
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- pessoas e acesso ----------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  telefone      TEXT,
  cpf           TEXT,                 -- em produção: guardar hash + últimos 3
  senha_hash    TEXT NOT NULL,
  papel_global  TEXT NOT NULL DEFAULT 'cliente'
                CHECK (papel_global IN ('cliente','admin')),
  socio         INTEGER NOT NULL DEFAULT 0,   -- clube Solmedic+
  criado_em     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  criado_em  TEXT NOT NULL,
  expira_em  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS addresses (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  apelido     TEXT,
  logradouro  TEXT NOT NULL,
  numero      TEXT,
  complemento TEXT,
  bairro      TEXT NOT NULL,
  cidade      TEXT NOT NULL,
  uf          TEXT NOT NULL,
  cep         TEXT,
  lat         REAL,
  lng         REAL,
  padrao      INTEGER NOT NULL DEFAULT 0
);

-- ---------- o comércio ----------
CREATE TABLE IF NOT EXISTS pharmacies (
  id             TEXT PRIMARY KEY,
  razao_social   TEXT NOT NULL,
  nome_fantasia  TEXT NOT NULL,
  cnpj           TEXT UNIQUE NOT NULL,
  telefone       TEXT,
  email          TEXT,
  logradouro     TEXT, numero TEXT, bairro TEXT, cidade TEXT, uf TEXT, cep TEXT,
  lat            REAL, lng REAL,
  raio_entrega_m INTEGER NOT NULL DEFAULT 6000,
  frete_centavos INTEGER NOT NULL DEFAULT 590,
  frete_gratis_acima_centavos INTEGER NOT NULL DEFAULT 5000,
  comissao_pct   REAL NOT NULL DEFAULT 11.0,
  aceita_receita INTEGER NOT NULL DEFAULT 1,
  entregador_proprio INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'rascunho'
                 CHECK (status IN ('rascunho','em_analise','ativa','suspensa','recusada')),
  motivo_status  TEXT,
  criado_em      TEXT NOT NULL,
  aprovado_em    TEXT
);

-- documentos obrigatórios: é o escudo jurídico da plataforma
CREATE TABLE IF NOT EXISTS pharmacy_docs (
  id            TEXT PRIMARY KEY,
  pharmacy_id   TEXT NOT NULL REFERENCES pharmacies(id),
  -- a lista de tipos vive em server/comercio.js (DOCS_OBRIGATORIOS): documento
  -- novo aparece por norma nova, e CHECK em SQLite não se altera depois
  tipo          TEXT NOT NULL,
  numero        TEXT,
  validade      TEXT,
  arquivo_url   TEXT,
  status        TEXT NOT NULL DEFAULT 'pendente'
                CHECK (status IN ('pendente','aprovado','recusado','vencido')),
  motivo        TEXT,
  revisado_por  TEXT REFERENCES users(id),
  revisado_em   TEXT,
  criado_em     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pharmacy_hours (
  pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id),
  dia_semana  INTEGER NOT NULL,   -- 0=domingo
  abre        TEXT,               -- '08:00'
  fecha       TEXT,               -- '23:00'
  is_24h      INTEGER NOT NULL DEFAULT 0,
  fechado     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pharmacy_id, dia_semana)
);

-- quem opera a loja; o farmacêutico é identificado pelo CRF
CREATE TABLE IF NOT EXISTS pharmacy_users (
  id          TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  papel       TEXT NOT NULL CHECK (papel IN ('gerente','operador','farmaceutico')),
  crf         TEXT,               -- obrigatório quando papel='farmaceutico'
  crf_uf      TEXT,
  responsavel_tecnico INTEGER NOT NULL DEFAULT 0,
  ativo       INTEGER NOT NULL DEFAULT 1,
  criado_em   TEXT NOT NULL,
  UNIQUE (pharmacy_id, user_id)
);

-- ---------- catálogo mestre (da plataforma) ----------
-- O produto é único no país; o PREÇO é por loja. Essa separação é o
-- coração do marketplace de farmácia.
CREATE TABLE IF NOT EXISTS products (
  ean             TEXT PRIMARY KEY,
  nome            TEXT NOT NULL,
  principio_ativo TEXT,
  dosagem         TEXT,
  apresentacao    TEXT,
  fabricante      TEXT,
  categoria       TEXT,
  tarja           TEXT NOT NULL DEFAULT 'livre'
                  CHECK (tarja IN ('livre','vermelha','preta')),
  requer_receita  INTEGER NOT NULL DEFAULT 0,
  retem_receita   INTEGER NOT NULL DEFAULT 0,  -- antibiótico: fica na loja
  controlado_344  INTEGER NOT NULL DEFAULT 0,  -- Portaria 344: fora da plataforma
  refrigerado     INTEGER NOT NULL DEFAULT 0,  -- cadeia fria
  generico        INTEGER NOT NULL DEFAULT 0,
  referencia_ean  TEXT REFERENCES products(ean), -- genérico aponta pra marca
  registro_ms     TEXT,
  pmc_centavos    INTEGER,                     -- teto CMED por UF
  imagem_url      TEXT,
  ativo           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_products_ativo ON products(principio_ativo);
CREATE INDEX IF NOT EXISTS idx_products_ref   ON products(referencia_ean);

-- preço e estoque por loja
CREATE TABLE IF NOT EXISTS inventory (
  pharmacy_id        TEXT NOT NULL REFERENCES pharmacies(id),
  ean                TEXT NOT NULL REFERENCES products(ean),
  preco_centavos     INTEGER NOT NULL,
  preco_socio_centavos INTEGER,
  estoque            INTEGER NOT NULL DEFAULT 0,
  estoque_reservado  INTEGER NOT NULL DEFAULT 0,
  ativo              INTEGER NOT NULL DEFAULT 1,
  atualizado_em      TEXT NOT NULL,
  PRIMARY KEY (pharmacy_id, ean)
);
CREATE INDEX IF NOT EXISTS idx_inv_ean ON inventory(ean, ativo);

-- ---------- receitas ----------
CREATE TABLE IF NOT EXISTS prescriptions (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  arquivo_url      TEXT,          -- nulo quando a receita é eletrônica: não há papel
  prescritor_nome  TEXT,
  prescritor_crm   TEXT,
  prescritor_uf    TEXT,
  emitida_em       TEXT,
  valida_ate       TEXT,
  uso_continuo     INTEGER NOT NULL DEFAULT 0,
  retida           INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','validada','recusada','vencida')),
  validada_por     TEXT REFERENCES users(id),   -- o farmacêutico
  validada_crf     TEXT,
  validada_em      TEXT,
  motivo_recusa    TEXT,
  criado_em        TEXT NOT NULL
);

-- o saldo: 3 caixas prescritas, 1 retirada, 2 restantes
CREATE TABLE IF NOT EXISTS prescription_items (
  id              TEXT PRIMARY KEY,
  prescription_id TEXT NOT NULL REFERENCES prescriptions(id),
  ean             TEXT REFERENCES products(ean),
  principio_ativo TEXT,
  dosagem         TEXT,
  posologia       TEXT,
  qtd_prescrita   INTEGER NOT NULL,
  qtd_usada       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prescription_uses (
  id                   TEXT PRIMARY KEY,
  prescription_item_id TEXT NOT NULL REFERENCES prescription_items(id),
  order_id             TEXT NOT NULL,
  qtd                  INTEGER NOT NULL,
  criado_em            TEXT NOT NULL
);

-- ---------- pedidos ----------
-- Estados. A transição válida vive em server/state.js, não no banco,
-- mas o CHECK impede lixo entrar.
CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  codigo            TEXT UNIQUE NOT NULL,      -- CV-4472
  user_id           TEXT NOT NULL REFERENCES users(id),
  pharmacy_id       TEXT NOT NULL REFERENCES pharmacies(id),
  address_id        TEXT NOT NULL REFERENCES addresses(id),
  status            TEXT NOT NULL
                    CHECK (status IN ('criado','aguardando_loja','aguardando_receita',
                                      'em_separacao','aguardando_cliente','pronto',
                                      'em_rota','entregue','cancelado')),
  motivo_cancelamento TEXT,
  subtotal_centavos INTEGER NOT NULL DEFAULT 0,
  frete_centavos    INTEGER NOT NULL DEFAULT 0,
  desconto_centavos INTEGER NOT NULL DEFAULT 0,
  total_centavos    INTEGER NOT NULL DEFAULT 0,
  comissao_pct      REAL NOT NULL DEFAULT 11.0,
  comissao_centavos INTEGER NOT NULL DEFAULT 0,
  tem_receita       INTEGER NOT NULL DEFAULT 0,
  prazo_aceite_em   TEXT,                      -- 90 segundos pra loja aceitar
  criado_em         TEXT NOT NULL,
  aceito_em         TEXT, separado_em TEXT, despachado_em TEXT, entregue_em TEXT,
  cancelado_em      TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_loja ON orders(pharmacy_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, criado_em);

CREATE TABLE IF NOT EXISTS order_items (
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL REFERENCES orders(id),
  ean              TEXT NOT NULL REFERENCES products(ean),
  -- snapshot: o card do pedido não pode mudar se o catálogo mudar depois
  nome_snapshot    TEXT NOT NULL,
  dosagem_snapshot TEXT,
  qtd              INTEGER NOT NULL,
  preco_unit_centavos  INTEGER NOT NULL,
  preco_total_centavos INTEGER NOT NULL,
  requer_receita   INTEGER NOT NULL DEFAULT 0,
  prescription_item_id TEXT REFERENCES prescription_items(id),
  status           TEXT NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','confirmado','indisponivel','substituido','removido')),
  lote             TEXT,
  validade         TEXT,
  substituido_por_ean TEXT REFERENCES products(ean)
);

-- trilha de auditoria: quem mudou o quê, quando. Não é log, é prova.
CREATE TABLE IF NOT EXISTS order_events (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id),
  de_status   TEXT,
  para_status TEXT,
  ator_tipo   TEXT NOT NULL CHECK (ator_tipo IN ('cliente','loja','farmaceutico','entregador','sistema','admin')),
  ator_id     TEXT,
  ator_nome   TEXT,
  detalhe     TEXT,
  criado_em   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id, criado_em);

-- contraproposta: ofereça no lugar, não cancele
CREATE TABLE IF NOT EXISTS substitution_offers (
  id             TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL REFERENCES orders(id),
  order_item_id  TEXT NOT NULL REFERENCES order_items(id),
  ean_oferecido  TEXT NOT NULL REFERENCES products(ean),
  nome_oferecido TEXT NOT NULL,
  preco_centavos INTEGER NOT NULL,
  diferenca_centavos INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pendente'
                 CHECK (status IN ('pendente','aceito','recusado','expirado')),
  criado_em      TEXT NOT NULL,
  respondido_em  TEXT
);

-- ---------- pagamento: autoriza agora, captura depois ----------
CREATE TABLE IF NOT EXISTS payments (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT NOT NULL REFERENCES orders(id),
  provedor           TEXT NOT NULL DEFAULT 'mock',
  metodo             TEXT NOT NULL CHECK (metodo IN ('cartao','pix','dinheiro')),
  cartao_final       TEXT,
  status             TEXT NOT NULL
                     CHECK (status IN ('autorizado','capturado','estornado','falhou','expirado')),
  valor_autorizado_centavos INTEGER NOT NULL,
  valor_capturado_centavos  INTEGER NOT NULL DEFAULT 0,
  external_id        TEXT,
  autorizado_em      TEXT, capturado_em TEXT, estornado_em TEXT,
  motivo             TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_order ON payments(order_id);

-- ---------- entrega ----------
CREATE TABLE IF NOT EXISTS couriers (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  pharmacy_id TEXT REFERENCES pharmacies(id),   -- NULL = frota da plataforma
  nome        TEXT NOT NULL,
  telefone    TEXT,
  veiculo     TEXT NOT NULL DEFAULT 'moto',
  placa       TEXT,
  caixa_termica INTEGER NOT NULL DEFAULT 0,
  ativo       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS deliveries (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id),
  courier_id   TEXT REFERENCES couriers(id),
  status       TEXT NOT NULL DEFAULT 'aguardando'
               CHECK (status IN ('aguardando','atribuida','retirada','entregue','falhou')),
  exige_maos   INTEGER NOT NULL DEFAULT 0,     -- item com receita: em mãos
  exige_termica INTEGER NOT NULL DEFAULT 0,
  recebido_por TEXT,
  doc_recebedor TEXT,
  foto_url     TEXT,
  lat REAL, lng REAL,
  atribuida_em TEXT, retirada_em TEXT, entregue_em TEXT,
  falha_motivo TEXT
);

-- ---------- financeiro ----------
CREATE TABLE IF NOT EXISTS payouts (
  id            TEXT PRIMARY KEY,
  pharmacy_id   TEXT NOT NULL REFERENCES pharmacies(id),
  periodo_inicio TEXT NOT NULL,
  periodo_fim   TEXT NOT NULL,
  bruto_centavos    INTEGER NOT NULL DEFAULT 0,
  comissao_centavos INTEGER NOT NULL DEFAULT 0,
  frete_centavos    INTEGER NOT NULL DEFAULT 0,
  liquido_centavos  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'aberto'
                CHECK (status IN ('aberto','fechado','pago')),
  pago_em       TEXT,
  criado_em     TEXT NOT NULL
);

-- ---------- LGPD: dado de saúde é sensível ----------
-- Todo acesso a receita é registrado. Não é opcional.
CREATE TABLE IF NOT EXISTS access_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id),
  recurso    TEXT NOT NULL,     -- 'prescription'
  recurso_id TEXT NOT NULL,
  acao       TEXT NOT NULL,     -- 'leitura','aprovacao','recusa'
  ip         TEXT,
  criado_em  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_acesso ON access_log(recurso, recurso_id, criado_em);
