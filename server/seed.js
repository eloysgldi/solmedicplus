import { db, um, roda, id, agora, CAMINHO_DB } from './db.js';
import { hashSenha } from './auth.js';
import * as comercio from './comercio.js';
import * as estoqueLote from './estoque.js';
import * as armarioCasa from './armario.js';

// os testes mexem no estoque, criam pedidos e disparam recall: rodar a
// suíte duas vezes seguidas sem limpar acusaria falha que não existe
const silencioso = process.argv.includes('--silencioso');
const conta = (t, ...a) => { if (!silencioso) console.log(t, ...a); };

if (process.argv.includes('--reset')) {
  // Lê as tabelas do próprio banco em vez de manter uma lista à mão:
  // toda tabela nova quebrava o reset, e a lista sempre atrasava.
  const tabelas = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();
  db.exec('PRAGMA foreign_keys = OFF');
  for (const { name } of tabelas) {
    if (name === 'configuracoes') continue;   // chaves VAPID e interruptores ficam
    db.exec(`DELETE FROM ${name}`);
  }
  db.exec('PRAGMA foreign_keys = ON');
  conta(`base limpa (${tabelas.length} tabelas)`);
}

const user = (nome, email, senha, extra = {}) => {
  const j = um('SELECT * FROM users WHERE email = ?', email);
  if (j) return j.id;
  const uid = id();
  roda(`INSERT INTO users (id,nome,email,telefone,senha_hash,papel_global,socio,criado_em)
        VALUES (?,?,?,?,?,?,?,?)`,
    uid, nome, email, extra.telefone ?? null, hashSenha(senha),
    extra.papel_global ?? 'cliente', extra.socio ? 1 : 0, agora());
  return uid;
};

// ---------- pessoas ----------
const admin     = user('Admin Solmedic+', 'admin@solmedic.app', 'admin123', { papel_global: 'admin' });
const cliente   = user('Jhony R.', 'cliente@exemplo.com', 'cliente123', { socio: 1, telefone: '85 99999-0001' });
const gerente   = user('Marcos Aurélio', 'gerente@solmedic.com.br', 'loja123');
const farmaceut = user('Helena Sousa', 'farmaceutica@solmedic.com.br', 'crf123');
const motoboy   = user('Edilson S.', 'entregador@solmedic.com.br', 'moto123');

const endereco = id();
if (!um('SELECT id FROM addresses WHERE user_id = ?', cliente)) {
  roda(`INSERT INTO addresses (id,user_id,apelido,logradouro,numero,bairro,cidade,uf,cep,padrao)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
    endereco, cliente, 'Casa', 'Rua das Laranjeiras', '214', 'Jardim Primavera',
    'Fortaleza', 'CE', '60000-000', 1);
}
const enderecoId = um('SELECT id FROM addresses WHERE user_id = ?', cliente).id;

// ---------- catálogo mestre ----------
const P = [
  // ean, nome, principio, dosagem, apresentacao, fabricante, tarja, receita, retem, ctrl, generico, refEan, pmc
  ['7896004704128','Losartana Potássica 50 mg','Losartana potássica','50 mg','30 comprimidos revestidos','EMS','vermelha',1,0,0,1,'7891058010157',1590,'pressao'],
  ['7891058010157','Cozaar 50 mg','Losartana potássica','50 mg','30 comprimidos','Organon','vermelha',1,0,0,0,null,7890,'pressao'],
  ['7896112179245','Dipirona Sódica 500 mg','Dipirona sódica','500 mg','20 comprimidos','EMS','livre',0,0,0,1,'7891058001377',1403,'dor'],
  ['7891058001377','Novalgina 500 mg','Dipirona sódica','500 mg','20 comprimidos','Sanofi','livre',0,0,0,0,null,2610,'dor'],
  ['7896004701127','Ibuprofeno 400 mg','Ibuprofeno','400 mg','20 comprimidos','Medley','livre',0,0,0,1,null,1720,'dor'],
  ['7896422504713','Paracetamol 750 mg','Paracetamol','750 mg','20 comprimidos','Neo Química','livre',0,0,0,1,null,1490,'dor'],
  ['7891058012199','Dorflex','Dipirona + orfenadrina + cafeína','300 mg','36 comprimidos','Sanofi','vermelha',1,0,0,0,null,2480,'dor'],
  ['7896241400234','Amoxicilina 500 mg','Amoxicilina','500 mg','21 cápsulas','EMS','vermelha',1,1,0,1,null,3890,'antibiotico'],
  ['7896006210016','Clonazepam 2 mg','Clonazepam','2 mg','30 comprimidos','Roche','preta',1,1,1,0,null,2290,'controlado'],
  ['7898422746612','Protetor facial FPS 60','Dióxido de titânio','FPS 60','60 g','Mantecorp','livre',0,0,0,0,null,null,'dermo'],
  ['7896007545018','Fralda Confort Sec P','—','P','42 unidades','P&G','livre',0,0,0,0,null,null,'bebe'],
  ['7896112100034','Soro fisiológico 0,9%','Cloreto de sódio','0,9%','500 mL','Fresenius','livre',0,0,0,0,null,null,'higiene'],
  ['7896094206489','Vitamina D 2.000 UI','Colecalciferol','2.000 UI','60 cápsulas','Marjan','livre',0,0,0,0,null,null,'vitaminas'],
  ['7891317146016','Insulina NPH 100 UI/mL','Insulina humana','100 UI/mL','frasco 10 mL','Novo Nordisk','vermelha',1,0,0,0,null,5990,'refrigerado'],
  ['7898636190097','Neutrogena FPS 60','Avobenzona','FPS 60','60 g','Johnson','livre',0,0,0,0,null,null,'dermo'],
  ['7898040273067','Ozempic 1 mg','Semaglutida','1 mg/dose','caneta 3 mL','Novo Nordisk','vermelha',1,1,0,0,null,119900,'refrigerado'],
  ['7891058002374','Vick VapoRub 50 g','Cânfora + mentol','—','pote 50 g','P&G','livre',0,0,0,0,null,null,'gripe'],
  ['7896714210018','Dramin B6 50 mg','Dimenidrinato','50 mg','20 comprimidos','Takeda','livre',0,0,0,0,null,null,'dor'],
  ['7891317009083','Sal de fruta Eno','Bicarbonato + ácido cítrico','—','30 envelopes','GSK','livre',0,0,0,0,null,null,'higiene'],
  ['7891142199058','Vitamina C 1 g efervescente','Ácido ascórbico','1 g','10 comprimidos','Redoxon','livre',0,0,0,0,null,null,'vitaminas'],
  ['7896004406916','Polivitamínico A-Z','Multivitamínico','—','60 comprimidos','Centrum','livre',0,0,0,0,null,null,'vitaminas'],
  ['7891010244828','Ômega 3 1.000 mg','Óleo de peixe','1.000 mg','120 cápsulas','Sundown','livre',0,0,0,0,null,null,'vitaminas'],
  ['7891010023331','Bepantol Derma 30 g','Dexpantenol','—','bisnaga 30 g','Bayer','livre',0,0,0,0,null,null,'dermo'],
  ['7896094900103','Hipoglós 45 g','Óxido de zinco','—','bisnaga 45 g','Hypera','livre',0,0,0,0,null,null,'bebe'],
  ['7898040271032','Lenço umedecido 96 un','—','—','pacote 96 un','Huggies','livre',0,0,0,0,null,null,'bebe'],
  ['7891010601058','Curativo Band-Aid 40 un','—','—','caixa 40 un','J&J','livre',0,0,0,0,null,null,'higiene'],
  ['7896018701007','Álcool 70% 1 L','Etanol','70%','frasco 1 L','Itajá','livre',0,0,0,0,null,null,'higiene'],
  ['7896422509848','Água oxigenada 10 vol','Peróxido de hidrogênio','10 vol','frasco 100 mL','Rioquímica','livre',0,0,0,0,null,null,'higiene'],
  ['7898927111109','Termômetro digital','—','—','1 unidade','G-Tech','livre',0,0,0,0,null,null,'higiene'],
  ['7896112179009','Soro nasal 0,9% spray','Cloreto de sódio','0,9%','frasco 50 mL','Neosoro','livre',0,0,0,0,null,null,'gripe'],
  ['7891317142605','Creme dental Sensitive','Nitrato de potássio','—','bisnaga 90 g','Sensodyne','livre',0,0,0,0,null,null,'higiene'],
  ['7896512900105','Hidratante corporal 400 mL','Ureia 10%','10%','frasco 400 mL','Nivea','livre',0,0,0,0,null,null,'dermo'],
];
// duas passadas: o genérico aponta pra referência, que pode vir depois na lista
for (const [ean,nome,pa,dose,apres,fab,tarja,rx,retem,ctrl,gen,,pmc,cat] of P) {
  roda(`INSERT OR REPLACE INTO products (ean,nome,principio_ativo,dosagem,apresentacao,fabricante,
          categoria,tarja,requer_receita,retem_receita,controlado_344,generico,
          pmc_centavos,refrigerado,ativo)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    ean, nome, pa, dose, apres, fab, cat, tarja, rx, retem, ctrl, gen, pmc,
    cat === 'refrigerado' ? 1 : 0);
}
for (const [ean,,,,,,,,,,,ref] of P) {
  if (ref) roda('UPDATE products SET referencia_ean = ? WHERE ean = ?', ref, ean);
}
conta('produtos:', P.length);

// GLP-1 passou a exigir retenção de receita (RDC 1.000/2025)
for (const ean of ['7898040273067']) roda('UPDATE products SET glp1 = 1 WHERE ean = ?', ean);
// antimicrobiano e GLP-1: receita vale 10 dias. Controlado: 30.
roda("UPDATE products SET dias_validade_receita = 10 WHERE retem_receita = 1 OR glp1 = 1");
roda("UPDATE products SET dias_validade_receita = 30 WHERE controlado_344 = 1");

// silhueta e cor da embalagem — é o que dá cara de prateleira no app
const VISUAL = {
  '7896004704128': ['caixa','#1F6FB2'], '7891058010157': ['caixa','#0F3E7A'],
  '7896112179245': ['caixa','#2E7CC4'], '7891058001377': ['caixa','#C8102E'],
  '7896004701127': ['caixa','#B0407A'], '7896422504713': ['caixa','#E0602B'],
  '7891058012199': ['caixa','#7A5AA8'], '7896241400234': ['caixa','#1E8E6A'],
  '7896006210016': ['caixa','#3A3A3A'], '7898422746612': ['tubo','#E8A33D'],
  '7896007545018': ['pacote','#4FA8C7'], '7896112100034': ['frasco','#2FA3C7'],
  '7896094206489': ['frasco','#E9A020'], '7891317146016': ['frasco','#C0392B'],
  '7898636190097': ['tubo','#2D6EA8'], '7898040273067': ['frasco','#0B4DA2'],
  '7891058002374': ['frasco','#0E7A4E'], '7896714210018': ['caixa','#1D6FA8'],
  '7891317009083': ['caixa','#2FA3C7'], '7891142199058': ['caixa','#E9781F'],
  '7896004406916': ['frasco','#C23A2B'], '7891010244828': ['frasco','#E0A020'],
  '7891010023331': ['tubo','#0B4DA2'], '7896094900103': ['tubo','#4FA8C7'],
  '7898040271032': ['pacote','#5AA8D8'], '7891010601058': ['caixa','#C8102E'],
  '7896018701007': ['frasco','#2E7CC4'], '7896422509848': ['frasco','#3E8B6E'],
  '7898927111109': ['caixa','#3A5F8A'], '7896112179009': ['frasco','#2FA3C7'],
  '7891317142605': ['tubo','#0E6FB2'], '7896512900105': ['frasco','#1B4FA8'],
};
for (const [ean, [forma, cor]] of Object.entries(VISUAL)) {
  roda('UPDATE products SET forma = ?, cor = ? WHERE ean = ?', forma, cor, ean);
}

// ---------- farmácias ----------
function farmacia({ cnpj, razao, fantasia, bairro, gerenteId, comissao = 11 }) {
  let f = um('SELECT * FROM pharmacies WHERE cnpj = ?', cnpj);
  if (!f) {
    const r = comercio.cadastra({
      cnpj, razao_social: razao, nome_fantasia: fantasia, bairro,
      cidade: 'Fortaleza', uf: 'CE', telefone: '85 3000-0000',
      logradouro: 'Av. Central', numero: '1200',
    });
    f = um('SELECT * FROM pharmacies WHERE id = ?', r.id);
    roda('UPDATE pharmacies SET comissao_pct = ? WHERE id = ?', comissao, f.id);
  }
  if (gerenteId && !um('SELECT id FROM pharmacy_users WHERE pharmacy_id=? AND user_id=?', f.id, gerenteId)) {
    roda(`INSERT INTO pharmacy_users (id,pharmacy_id,user_id,papel,ativo,criado_em)
          VALUES (?,?,?,?,?,?)`, id(), f.id, gerenteId, 'gerente', 1, agora());
  }
  return f.id;
}

// Uma farmácia só: a nossa. O modelo continua aguentando várias — o painel
// e o cadastro dependem disso — mas a operação é loja própria.
const matriz = farmacia({ cnpj: '09441233000106', razao: 'Solmedic Comércio de Medicamentos LTDA',
  fantasia: 'Solmedic+ Matriz', bairro: 'Centro', gerenteId: gerente });

// farmacêutica responsável técnica + entregador
if (!um('SELECT id FROM pharmacy_users WHERE pharmacy_id=? AND user_id=?', matriz, farmaceut)) {
  roda(`INSERT INTO pharmacy_users (id,pharmacy_id,user_id,papel,crf,crf_uf,responsavel_tecnico,ativo,criado_em)
        VALUES (?,?,?,?,?,?,?,?,?)`,
    id(), matriz, farmaceut, 'farmaceutico', '9214', 'CE', 1, 1, agora());
}
if (!um('SELECT id FROM couriers WHERE user_id = ?', motoboy)) {
  roda(`INSERT INTO couriers (id,user_id,pharmacy_id,nome,telefone,veiculo,placa,caixa_termica,ativo)
        VALUES (?,?,?,?,?,?,?,?,?)`,
    id(), motoboy, matriz, 'Edilson S.', '85 98888-0002', 'moto', 'PHK-2J14', 1, 1);
}

// documentos + aprovação
for (const loja of [matriz]) {
  for (const tipo of comercio.DOCS_OBRIGATORIOS) {
    if (!um('SELECT id FROM pharmacy_docs WHERE pharmacy_id=? AND tipo=?', loja, tipo)) {
      comercio.anexaDoc(loja, { tipo, numero: 'DOC-' + tipo.slice(0, 4).toUpperCase(),
        validade: '2027-12-31', arquivo_url: `/docs/${loja}/${tipo}.pdf`,
        dominio: tipo === 'aditivo_afe_dominio' ? 'solmedic.com.br' : undefined });
    }
  }
}
for (const loja of [matriz]) {
  const f = um('SELECT status FROM pharmacies WHERE id = ?', loja);
  if (f.status === 'rascunho') { comercio.submete(loja); comercio.decide(loja, true, null, admin); }
}

// ---------- estoque e preço por loja ----------
const precos = [
  // ean, preço, preço do plano, estoque  (as duas últimas colunas ficaram do
  // tempo em que havia uma segunda loja; o seed ignora)
  ['7896004704128', 1240,  1054, 18,  1290, 12],
  ['7891058010157', 6890,  6201,  4,  6990,  6],
  ['7896112179245',  890,   749, 60,   920, 40],
  ['7891058001377', 2460,  2214, 15,  2390, 20],
  ['7896004701127', 1130,   960, 25,  1180, 18],
  ['7896422504713',  920,   828, 40,   950, 30],
  ['7891058012199', 2250,  2025, 10,  2290,  8],
  ['7896241400234', 3450,  3105, 12,  3590, 10],
  ['7898422746612', 4193,  3774,  0,  4490,  6],   // zerado de propósito: força a contraproposta
  ['7896007545018', 4490,  4041, 30,  4590, 22],
  ['7896112100034',  690,   621, 50,   720, 45],
  ['7896094206489', 3850,  3465, 20,  3990, 16],
  ['7891317146016', 5990,  5391,  5,  5890,  3],
  ['7898636190097', 4590,  4131,  9,  4690,  7],
  ['7898040273067', 98900, 89010, 3],
  ['7891058002374', 2490, 2241, 24],
  ['7896714210018', 1890, 1701, 30],
  ['7891317009083', 1750, 1575, 40],
  ['7891142199058', 2290, 2061, 35],
  ['7896004406916', 6890, 6201, 18],
  ['7891010244828', 7490, 6741, 12],
  ['7891010023331', 3690, 3321, 22],
  ['7896094900103', 2190, 1971, 26],
  ['7898040271032', 1990, 1791, 44],
  ['7891010601058', 1690, 1521, 50],
  ['7896018701007',  990,  891, 60],
  ['7896422509848',  590,  531, 55],
  ['7898927111109', 3490, 3141,  9],
  ['7896112179009',  890,  801, 48],
  ['7891317142605', 1890, 1701, 33],
  ['7896512900105', 2790, 2511, 21],
];
// posição na prateleira: corredor-prateleira, como a loja fala
const CORREDOR = { dor: 'A1', gripe: 'A2', pressao: 'A3', antibiotico: 'A4', controlado: 'CF',
  dermo: 'B1', vitaminas: 'B2', bebe: 'C1', higiene: 'C2', refrigerado: 'GE' };
let naPrateleira = {};
for (const [ean, preco, socio, estoque] of precos) {
  const p = um('SELECT categoria FROM products WHERE ean = ?', ean);
  const corredor = CORREDOR[p?.categoria] ?? 'D1';
  naPrateleira[corredor] = (naPrateleira[corredor] ?? 0) + 1;
  comercio.defineItem(matriz, { ean, preco_centavos: preco, preco_socio_centavos: socio,
    estoque, posicao: `${corredor}-${String(naPrateleira[corredor]).padStart(2, '0')}` });
}


/**
 * Lotes de verdade na prateleira.
 *
 * O estoque agregado já existia; isto aqui é a camada física — de qual
 * nota veio, por quanto foi comprado, quando vence. Sem isso a tela de
 * estoque seria uma planilha de saldo, e não controle.
 *
 * O custo sai de uma margem plausível por categoria, e a validade varia
 * de propósito: alguns lotes entram vencendo, para o painel ter o que
 * mostrar em "vence antes de vender".
 */
const FORNECEDORES = ['Distribuidora Panarello', 'Servimed', 'Profarma', 'SP Distribuidora'];
const dataEm = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
let seqNota = 48210;

if (!um('SELECT id FROM estoque_lotes LIMIT 1')) {
  let n = 0;
  for (const [ean, preco, , estoque] of precos) {
    if (!estoque) continue;
    n++;
    // margem típica de varejo farmacêutico: entre 26% e 38% sobre o custo
    const custo = Math.round(preco / (1 + (0.26 + (n % 5) * 0.03)));
    // um em cada seis produtos chega perto do vencimento — é o que acontece
    const perto = n % 6 === 0;
    const partido = estoque > 12 && n % 3 === 0;
    const lotes = partido
      ? [[Math.floor(estoque * 0.4), perto ? 38 : 210], [estoque - Math.floor(estoque * 0.4), 620]]
      : [[estoque, perto ? 52 : 430]];

    lotes.forEach(([qtd, dias], k) => {
      estoqueLote.entrada(matriz, {
        ean, lote: `L${String(2600 + n * 7 + k).padStart(4, '0')}${String.fromCharCode(65 + (n % 6))}`,
        validade: dataEm(dias), qtd,
        custo_centavos: custo,
        fornecedor: FORNECEDORES[n % FORNECEDORES.length],
        nota_fiscal: String(seqNota++),
      }, gerente);
    });
    // a entrada somou em cima do saldo que o defineItem já tinha posto:
    // aqui o saldo agregado volta a ser exatamente o que está nos lotes
    roda('UPDATE inventory SET estoque = ? WHERE pharmacy_id = ? AND ean = ?', estoque, matriz, ean);
    roda(`UPDATE estoque_mov SET saldo_depois = ? WHERE pharmacy_id = ? AND ean = ?
           AND id = (SELECT id FROM estoque_mov WHERE pharmacy_id = ? AND ean = ?
                     ORDER BY criado_em DESC LIMIT 1)`, estoque, matriz, ean, matriz, ean);
  }
  conta(`lotes de estoque: ${um('SELECT COUNT(*) AS n FROM estoque_lotes').n}`);
}


/**
 * ---------- a carteira ----------
 *
 * Um CRM com um cliente só não mostra nada. Aqui entram pessoas com
 * histórias diferentes de propósito — a que volta todo mês, a que sumiu
 * no meio do tratamento, a que comprou uma vez e nunca mais — porque é
 * disso que a tela de clientes trata.
 *
 * Os pedidos são gravados direto, com data no passado: a API sempre
 * carimba "agora", e sem passado não existe ritmo de recompra.
 */
const CARTEIRA = [
  // nome, telefone, sócio, bairro, [dias atrás de cada compra], itens
  ['Marta Albuquerque', '85 98801-1121', 1, 'Centro', [96, 66, 35, 6],
    ['7896004704128', '7896094206489']],
  ['Raimundo Nonato',   '85 98802-4417', 0, 'Vila Nova', [120, 88, 57, 27],
    ['7896112179245', '7891317009083']],
  ['Cleide Vasconcelos','85 98803-7782', 1, 'Jardim Primavera', [140, 108, 74],
    ['7896004704128']],
  ['Joana Bezerra',     '85 98804-2093', 0, 'Bela Vista', [61, 32],
    ['7891142199058', '7891010023331']],
  ['Antônio Vieira',    '85 98805-6610', 0, 'Alto da Serra', [12],
    ['7896422504713']],
  ['Socorro Lima',      '85 98806-3345', 1, 'Centro', [210, 178],
    ['7891058001377']],
  ['Iracema Duarte',    '85 98807-9902', 0, 'Vila Nova', [44, 21, 9],
    ['7896112100034', '7896007545018']],
  ['Gilberto Paiva',    '85 98808-5518', 0, 'Jardim Primavera', [330],
    ['7896714210018']],
];

if (!um("SELECT id FROM users WHERE email = 'marta@exemplo.com'")) {
  let seqPedido = 4501;
  const isoAtras = (d) => new Date(Date.now() - d * 864e5).toISOString();

  for (const [nome, tel, socio, bairro, quando, itens] of CARTEIRA) {
    const email = nome.split(' ')[0].toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') + '@exemplo.com';
    const uid = user(nome, email, 'cliente123', { socio, telefone: tel });
    const aid = id();
    roda(`INSERT INTO addresses (id,user_id,apelido,logradouro,numero,bairro,cidade,uf,cep,padrao)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
      aid, uid, 'Casa', 'Rua das Acácias', String(100 + seqPedido % 400), bairro,
      'Fortaleza', 'CE', '60000-000', 1);

    for (const dias of quando) {
      const oid = id();
      const linhas = itens.map((ean) => {
        const p = um(`SELECT p.nome, p.dosagem, i.preco_centavos, i.preco_socio_centavos
                        FROM products p JOIN inventory i ON i.ean = p.ean
                       WHERE p.ean = ? AND i.pharmacy_id = ?`, ean, matriz);
        const preco = socio ? (p.preco_socio_centavos ?? p.preco_centavos) : p.preco_centavos;
        return { ean, ...p, preco };
      });
      const subtotal = linhas.reduce((s, l) => s + l.preco, 0);
      const frete = subtotal >= 5000 ? 0 : 590;
      const total = subtotal + frete;
      roda(`INSERT INTO orders (id,codigo,user_id,pharmacy_id,address_id,status,
              subtotal_centavos,frete_centavos,total_centavos,comissao_pct,comissao_centavos,
              criado_em,aceito_em,separado_em,despachado_em,entregue_em)
            VALUES (?,?,?,?,?,'entregue',?,?,?,?,?,?,?,?,?,?)`,
        oid, `CV-${seqPedido++}`, uid, matriz, aid, subtotal, frete, total, 11,
        Math.round(total * 0.11), isoAtras(dias), isoAtras(dias), isoAtras(dias),
        isoAtras(dias), isoAtras(dias));
      for (const l of linhas) {
        roda(`INSERT INTO order_items (id,order_id,ean,nome_snapshot,dosagem_snapshot,qtd,
                preco_unit_centavos,preco_total_centavos,status,lote,validade)
              VALUES (?,?,?,?,?,1,?,?,'confirmado',?,?)`,
          id(), oid, l.ean, l.nome, l.dosagem ?? null, l.preco, l.preco,
          um('SELECT lote FROM estoque_lotes WHERE ean=? LIMIT 1', l.ean)?.lote ?? null,
          um('SELECT validade FROM estoque_lotes WHERE ean=? LIMIT 1', l.ean)?.validade ?? null);
      }
      // a última compra de cada um fica no armário: é o que a loja consulta
      if (dias === quando[quando.length - 1]) armarioCasa.guardaEntrega(oid);
    }
  }
  conta(`carteira: ${CARTEIRA.length} clientes com histórico`);
}

// ---------- uma receita já validada, com saldo ----------
if (!um('SELECT id FROM prescriptions WHERE user_id = ?', cliente)) {
  const rid = id();
  roda(`INSERT INTO prescriptions (id,user_id,arquivo_url,prescritor_nome,prescritor_crm,prescritor_uf,
          emitida_em,valida_ate,uso_continuo,status,validada_por,validada_crf,validada_em,criado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    rid, cliente, '/receitas/exemplo.jpg', 'MARINA ALVES', '18432', 'CE',
    '2026-09-02', '2027-03-02', 1, 'validada', farmaceut, '9214-CE', agora(), agora());
  roda("UPDATE prescriptions SET origem='papel', exige_retencao=0 WHERE id=?", rid);
  roda(`INSERT INTO prescription_items (id,prescription_id,ean,principio_ativo,dosagem,posologia,qtd_prescrita,qtd_usada)
        VALUES (?,?,?,?,?,?,?,?)`,
    id(), rid, '7896004704128', 'Losartana potássica', '50 mg', '1 comprimido ao dia', 3, 0);
}

// preço "de" — só nos itens que estão em oferta de verdade
const OFERTAS = {
  '7896112179245': 1360,  // dipirona
  '7898422746612': 5990,  // protetor
  '7896004701127': 1620,  // ibuprofeno
  '7896094206489': 4990,  // vitamina D
  '7896004704128': 1590,  // losartana
  '7891142199058': 2990,  // vitamina C
  '7891010023331': 4590,  // bepantol
  '7896004406916': 8490,  // polivitamínico
  '7896512900105': 3490,  // hidratante
};
for (const [ean, de] of Object.entries(OFERTAS)) {
  roda('UPDATE inventory SET preco_de_centavos = ? WHERE ean = ?', de, ean);
}

conta(`
  base pronta em ${CAMINHO_DB}

  cliente       cliente@exemplo.com            cliente123   (plano ativo)
  gerente       gerente@solmedic.com.br        loja123
  farmacêutica  farmaceutica@solmedic.com.br   crf123       CRF-CE 9214
  entregador    entregador@solmedic.com.br     moto123
  admin         admin@solmedic.app             admin123

  Solmedic+ Matriz    ${matriz}
`);
