# Solmedic+

**Farmácia própria com entrega** — back end, painel da loja e app do cliente.
Não é marketplace: a loja é uma, a nossa. O modelo de dados continua aguentando
várias (o painel e o cadastro dependem disso), mas a operação é loja única.

O nome carrega o produto: **o "+" é a cruz da farmácia e é a marca do clube**.
Um símbolo fazendo dois trabalhos, e é por isso que a haste vertical da marca
é uma cápsula, não uma barra — para a cruz não ser a cruz genérica de
qualquer app de saúde.
Sem dependência nenhuma: Node 22+ já traz `node:sqlite` e `node:http`.
Não roda `npm install`, não precisa de conta em nuvem, não precisa de internet.

```bash
npm run seed     # base com catálogo, lotes de estoque e uma carteira de clientes
npm run dev      # sobe o servidor em http://localhost:4173
npm test         # 287 verificações — limpa a base e roda as sete suítes
```

| onde | o quê |
|---|---|
| `http://localhost:4173` | app do cliente |
| `http://localhost:4173/painel.html` | painel da loja: operação, CRM, estoque e configuração |
| `http://localhost:4173/pitch.html` | a apresentação antiga (ainda em verde) |

> **A marca** é o arquivo em `web/logo.png` — o PNG original, sem redesenho.
> O app o recorta na exibição (o arquivo tem margem transparente: o ícone ocupa
> 1012 de 1254 px) para encostar nas bordas da caixa. Trocar a marca é trocar
> esse arquivo. Sem ele, entra o vetor de reserva em `web/marca.js`.
> Antes de publicar, gere versões de 192 e 512 px: 795 KB é pesado para um ícone.
>
> **Push precisa de navegador de verdade.** O painel embutido do editor bloqueia
> o registro de service worker *e* nega a permissão de notificação
> automaticamente. Abra `localhost:4173` no Chrome. O canal interno (toast,
> sininho e lista) funciona em qualquer lugar — é por SSE, não depende de push.

Contas criadas pelo seed:

```
cliente        cliente@exemplo.com            cliente123   (sócio do clube)
gerente        gerente@solmedic.com.br        loja123
farmacêutica   farmaceutica@solmedic.com.br   crf123       CRF-CE 9214
entregador     entregador@solmedic.com.br     moto123
admin          admin@solmedic.app             admin123
```

O seed já traz **lotes de estoque com validade e custo** e uma **carteira de
oito clientes** com histórias diferentes de propósito — a que volta todo mês,
a que sumiu no meio do tratamento, a que comprou uma vez e nunca mais. Sem
isso, CRM e estoque seriam telas vazias.

`node test/demo.mjs` enche a fila com pedidos em estados diferentes, para a
tela de operação ter conteúdo de verdade.

---

## Subir no ar, sem pagar nada

**Render, plano gratuito.** É o caminho mais curto: não tem build, não tem
`npm install`, o `render.yaml` já está pronto.

```bash
git init && git add -A && git commit -m "Solmedic+"
gh repo create solmedic --private --source=. --push
```

Depois, em render.com → **New → Blueprint** → aponte para o repositório.
Ele lê o `render.yaml` e sobe sozinho.

**Duas coisas que você precisa saber antes, e que ninguém conta:**

1. **O disco do plano gratuito é efêmero.** A cada deploy — e a cada vez que
   o serviço acorda depois de hibernar — o `data/solmedic.db` volta do zero.
   Por isso o `server/boot.js` semeia a base antes de abrir a porta: o
   visitante nunca cai num catálogo vazio. Para demonstrar, isso é perfeito.
   Para vender de verdade, é o dia de pagar um disco persistente (US$ 1/mês
   por GB, e aí `SM_SEED=0`) ou trocar o SQLite por Postgres.

2. **O serviço hiberna depois de 15 minutos parado.** A primeira visita
   depois disso espera uns 50 segundos. Avise quem for testar, ou abra o
   link cinco minutos antes de mostrar para alguém.

Alternativas gratuitas, se um dia o Render incomodar: **Fly.io** dá 3 GB de
volume persistente no plano gratuito (resolve o item 1, mas exige Dockerfile),
e **Railway** acabou com o plano gratuito.

Variáveis de ambiente que importam:

| variável | para quê |
|---|---|
| `SM_SEED` | `1` semeia a base quando ela está vazia; `0` quando os dados forem de verdade |
| `SM_RECEITA` | `1` liga tarja vermelha e preta. Só com licença sanitária em dia |
| `SM_VAPID_PUB` / `SM_VAPID_PRIV_PEM` | `npm run vapid` gera. Sem eles, cada deploy derruba as inscrições de notificação |
| `SM_PIX` | chave PIX da farmácia. Vazio usa o CNPJ |
| `PORT` | o Render preenche sozinho |

> **Push só funciona em HTTPS.** Localhost é exceção do navegador; em
> produção, o certificado do Render já resolve isso de graça.

---
## PIX de verdade: ligar a Versell

Os arquivos que a Versell mandou são **certificados mTLS**, não uma chave
de API: `QRCODES-MTLS` recebe (cash in) e `ACCOUNTS` paga (cash out). Quem
chama a API prova quem é pelo certificado. É o desenho da **API Pix do
Banco Central**, que todo PSP implementa igual — `PUT /v2/cob/{txid}` cria
a cobrança, `GET /v2/cob/{txid}` consulta, e um webhook avisa quando cai.

O adaptador está em `server/psp.js`. **Nada fica no repositório**: o
certificado entra por variável de ambiente, em base64.

```bash
# gere o base64 do .pfx de cash in (QRCODES-MTLS)
base64 -w0 BASSPAGO_41.pfx > pfx.txt
```

| variável | valor |
|---|---|
| `SM_PSP_BASE` | a URL base que a Versell te deu (ex.: `https://api.versell.com.br/pix/`) |
| `SM_PSP_PFX_B64` | o conteúdo de `pfx.txt` |
| `SM_PSP_PFX_SENHA` | a senha do `.pfx`, se houver |
| `SM_PSP_CLIENT_ID` | o client_id que a Versell mostra no painel |
| `SM_PSP_CLIENT_SECRET` | o client_secret do mesmo painel |
| `SM_PSP_TOKEN_PATH` | caminho do OAuth, se não for `/oauth/token` |
| `SM_PSP_SCOPE` | escopos, se forem diferentes de `cob.write cob.read pix.read` |
| `SM_PSP_WEBHOOK_SEGREDO` | qualquer frase; o webhook recusa quem não mandar ela no header |
| `SM_PIX` | a chave PIX da farmácia (sem isso, cai no CNPJ) |

O webhook que você cadastra na Versell é:

```
https://SEU-APP.onrender.com/api/webhooks/pix
```

**O que muda quando liga.** Sem `SM_PSP_BASE`, o app monta o BR Code
sozinho (EMV + CRC16): o QR é válido, cai na sua chave e tem o valor
certo, mas ninguém confirma o pagamento — alguém precisa apertar
*"já paguei"*. Com a Versell ligada, a cobrança nasce no banco com o
`txid` igual ao código do pedido (o extrato bate com o painel sem
planilha), o webhook confirma sozinho, e o *"já paguei"* passa a
**perguntar ao banco em vez de acreditar no cliente**.

Duas travas que já estão de pé, testadas:

- **pagamento parcial não fecha pedido** — mandar R$ 1,00 numa cobrança de
  R$ 47,12 é registrado e ignorado;
- **provedor fora do ar não derruba a venda** — se a chamada falhar, o app
  cai no BR Code da casa e a compra continua.

> Falta um dado que só você tem: **a URL base**. Os certificados e o
> client_id não dizem para onde apontar. Com o endereço em
> `SM_PSP_BASE`, o resto já está escrito.

### Manter o Render acordado

O plano gratuito hiberna com 15 minutos de silêncio. Em
[cron-job.org](https://cron-job.org) (gratuito), crie um job:

```
URL       https://SEU-APP.onrender.com/api/ping
Intervalo a cada 10 minutos
```

A rota `/api/ping` existe só para isso: responde `{ ok: true }` sem
encostar no banco. Não acorda de graça para sempre — o Render conta
horas de execução — mas resolve o "primeiro acesso demora 50 segundos"
no horário em que você estiver mostrando o app.

---
## As quatro regras que o código não deixa quebrar

**1. Autoriza, não cobra.** O cartão é autorizado quando o pedido é criado
(`pagamento.autoriza`) e só capturado quando a loja termina a separação
(`pedidos.marcaPronto`). Entre os dois, o farmacêutico precisa ter liberado.
Se o pedido morre no caminho, a autorização é estornada e o cliente nunca vê
cobrança no extrato.

**2. Quem libera receita tem CRF.** `exigeFarmaceutico()` recusa qualquer um
sem CRF ativo vinculado àquela loja — inclusive o gerente. O nome e o CRF de
quem liberou ficam gravados na receita e na linha do tempo do pedido.

**3. Controlado não entra.** Produto com `controlado_344 = 1` é recusado no
orçamento, no catálogo da loja e no envio de receita. Portaria 344 exige
receita física retida; isso não cabe em delivery.

**4. Nada muda de estado fora da máquina.** `state.js` é a única porta.
Toda transição valida quem pode fazer o quê, carimba a data e grava em
`order_events` — que é trilha de auditoria, não log.

```
criado → aguardando_loja → aguardando_receita → em_separacao → pronto → em_rota → entregue
                       └──────────────────────┘                 ↑
                      (só se houver receita pendente)      captura o cartão aqui
```

---

## O armário: o diferencial

Toda farmácia com delivery registra lote e validade na separação — é exigência
de rastreabilidade. Ninguém faz nada com isso. A gente devolve esse dado para
quem comprou.

Quando o entregador fecha a entrega, `armario.guardaEntrega()` copia cada item
conferido — nome, lote, validade, pedido — para o **armário do cliente**. A
partir daí a plataforma sabe o que tem dentro da casa da pessoa, e isso destrava
três coisas:

**1. Recall que chega em quem levou.** Hoje um recolhimento da Anvisa é um
comunicado no site da agência e um cartaz atrás do balcão. Quem levou a caixa
nunca fica sabendo. Aqui o farmacêutico abre *Ruptura e recall* no painel,
digita o EAN, o lote e o motivo, e o sistema faz três coisas numa transação:
marca cada caixa daquele lote como `recolhido`, tira o produto da vitrine, e
**notifica pelo nome cada cliente que levou aquele lote** — "Recolhimento de
lote — pare de usar", com o toque levando direto para o armário. A tela do
painel devolve a lista de quem foi avisado; não é um número, são pessoas.

**2. Aviso de validade.** `POST /api/admin/vencimentos` varre os armários e
avisa quem tem remédio vencendo em até 45 dias. A marca `armario.avisado_em`
garante que o alerta sai **uma vez por caixa** — ninguém merece o mesmo aviso
todo dia até o remédio vencer. (Em produção isto vira tarefa agendada.)

**3. "Você já tem isso em casa."** O orçamento do carrinho devolve `ja_tem`
com o que a pessoa ainda tem, com quantidade e validade. Vender de novo o que
ela tem é ganhar hoje e perder a confiança amanhã.

A privacidade é regra, não configuração: o corpo da notificação é genérico
("Um produto que você recebeu foi recolhido") porque ela acende na tela de
bloqueio na frente de qualquer um. O nome do medicamento só entra se o cliente
ligar `push_detalhado` na conta.

| arquivo | papel |
|---|---|
| `server/armario.js` | guarda, consulta, ajusta, recolhe, varre validade |
| `web/app.js` → `telaArmario()` | "precisa de ação" / "vencendo" / "em casa" |
| `web/painel.html` → `blocoRecall()` | onde o farmacêutico dispara o recolhimento |
| `test/armario.mjs` | 40 verificações, do lote na separação ao aviso no celular |
| `test/gestao.mjs` | 65 verificações: entrada de nota, FEFO, kardex, CRM, campanha, foto |
| `test/cliente-novo.mjs` | 26 verificações: conta criada do zero, endereço, compra, e a loja entregando |

O item recolhido **continua visível** no armário por 30 dias mesmo depois de
encerrado — a notificação manda a pessoa para lá, então a caixa precisa estar
lá quando ela chega. Sai quando ela toca em "já devolvi".

---
## O modelo

35 tabelas: `server/schema.sql` mais as migrações em `server/db.js`. **Dinheiro sempre em centavos (INTEGER)** —
nunca float, nunca `REAL`.

- **Pessoas** — `users`, `sessions`, `addresses`. Um mesmo CPF pode ser cliente
  numa loja e farmacêutico responsável em outra: o papel vive em `pharmacy_users`,
  não no usuário.
- **Comércio** — `pharmacies`, `pharmacy_docs` (alvará, AFE, CRF, contrato social,
  cartão CNPJ, conta bancária), `pharmacy_hours`, `pharmacy_users`.
  A loja nasce em `rascunho` e só vende depois que o admin aprova.
- **Catálogo** — `products` é da plataforma e é único no país; `inventory` guarda
  **preço e estoque por loja**. Essa separação é o coração do marketplace de
  farmácia: o cliente compara o mesmo EAN entre lojas.
- **Receitas** — `prescriptions` + `prescription_items` (o saldo: 3 caixas
  prescritas, 1 retirada, 2 restantes) + `prescription_uses`.
- **Pedidos** — `orders`, `order_items` (com snapshot do nome e da dosagem, para
  o histórico não mudar quando o catálogo mudar), `order_events`,
  `substitution_offers` (a contraproposta).
- **Dinheiro e entrega** — `payments`, `couriers`, `deliveries`, `payouts`.
- **LGPD** — `access_log` registra toda leitura de receita. Dado de saúde é dado
  sensível; saber quem abriu qual receita não é opcional.

---

## A API

Tudo em `/api`. Token no cabeçalho `Authorization: Bearer <token>`.

**Cliente**
```
POST /api/auth/registrar | /login          GET /api/auth/eu
GET  /api/catalogo/busca?q=dipirona        GET /api/catalogo/:ean
GET  /api/farmacias                        GET|POST /api/enderecos
POST /api/carrinho/orcamento               → já devolve dividido em "sai agora" e "aguarda farmacêutico"
POST /api/pedidos                          GET /api/pedidos | /:id
GET  /api/pedidos/:id/stream               → SSE, a tela anda sozinha
POST /api/pedidos/:id/ofertas/:ofertaId    → aceita ou recusa a contraproposta
POST /api/pedidos/:id/cancelar
POST /api/receitas                         GET /api/receitas | /:id
GET  /api/armario                          PUT /api/armario/:id   (quantidade, "acabou", "já devolvi")
```

**Loja**
```
POST /api/comercio/cadastro                → autocadastro, nasce em rascunho
GET  /api/comercio/:pid                    POST /api/comercio/:pid/docs | /equipe | /submeter
GET|POST /api/comercio/:pid/catalogo       POST /api/comercio/:pid/catalogo/importar   (CSV)
GET  /api/comercio/:pid/pedidos            GET /api/comercio/:pid/stream               (SSE)
POST /api/comercio/:pid/pedidos/:oid/aceitar | /recusar | /pronto | /despachar
POST /api/comercio/:pid/pedidos/:oid/itens/:itemId/indisponivel | /substituir
GET  /api/comercio/:pid/indicadores        GET|POST /api/comercio/:pid/repasses
GET  /api/comercio/:pid/ruptura            GET|POST /api/comercio/:pid/recalls
GET  /api/comercio/:pid/visao              → a tela de abertura: dia, série, alertas
PUT  /api/comercio/:pid                    PUT /api/comercio/:pid/horarios | /area
POST /api/comercio/:pid/catalogo/:ean/foto DELETE a mesma rota remove a foto
```

**Estoque**
```
GET  /api/comercio/:pid/estoque?q=&filtro= GET /api/comercio/:pid/estoque/resumo
GET  /api/comercio/:pid/estoque/vencendo   GET /api/comercio/:pid/estoque/abc
GET  /api/comercio/:pid/estoque/conferencia  → saldo × soma dos lotes
GET  /api/comercio/:pid/estoque/movimentos   → o kardex da loja inteira
GET  /api/comercio/:pid/estoque/:ean/lotes | /kardex
POST /api/comercio/:pid/estoque/entrada    → recebimento de nota, com lote e validade
POST /api/comercio/:pid/estoque/contagem   → contagem de prateleira (exige motivo)
POST /api/comercio/:pid/estoque/perda      → quebra, vencido, avaria
```

**CRM**
```
GET  /api/comercio/:pid/clientes?q=&segmento=&ordem=
GET  /api/comercio/:pid/clientes/segmentos   GET /api/comercio/:pid/clientes/recompras
GET  /api/comercio/:pid/clientes/:uid        → a ficha inteira, com o armário
POST /api/comercio/:pid/clientes/:uid/notas  DELETE /api/comercio/:pid/clientes/notas/:nid
POST /api/comercio/:pid/clientes/:uid/marcas
GET|POST /api/comercio/:pid/campanhas        → aviso para um segmento inteiro
```

**Farmacêutico** (exige CRF)
```
GET  /api/comercio/:pid/receitas
POST /api/comercio/:pid/receitas/:rid/liberar | /recusar
```

**Entregador**
```
GET  /api/entregador/tarefas
POST /api/entregador/entregas/:oid/retirar | /entregar
```

**Admin da plataforma**
```
GET  /api/admin/farmacias?status=em_analise
POST /api/admin/farmacias/:pid/decidir
GET  /api/admin/indicadores
POST /api/admin/vencimentos                → varre os armários e avisa quem tem remédio vencendo
```

---

## O painel: tudo da farmácia numa tela só

A navegação é em três blocos, porque são três ritmos diferentes:
**operação** muda a cada minuto, **gestão** se olha uma vez por dia,
**a casa** se mexe uma vez por mês.

### Visão geral
Abre o painel. Dinheiro do dia, a série de 14 dias, e — antes de qualquer
gráfico — a faixa do que precisa de mão agora: pedido esperando aceite,
receita na fila, produto zerado, lote vencendo, cliente que passou da hora
de voltar. Cada alerta é um botão que leva direto para a tela do problema.

### Clientes — o CRM
A ficha do cliente **não é uma tabela nova**: é uma leitura dos pedidos, do
armário e das receitas que já existem. Cadastro paralelo envelhece e mente;
pedido entregue não mente.

A segmentação é RFM sem enfeite — quando comprou, quantas vezes, quanto
gastou — com um corte que só faz sentido em farmácia: **o intervalo próprio
de cada pessoa**. Quem compra losartana todo mês e sumiu há 45 dias não é
uma oportunidade de venda, é um tratamento possivelmente interrompido. Por
isso a lista "passaram da hora de voltar" mede o atraso contra o ritmo de
cada um, e não contra uma régua fixa de 30 dias.

Os cinco baldes: `novo`, `regular`, `fiel`, `em_risco`, `perdido`.

A ficha abre com **o armário** (o que a pessoa tem em casa agora, com lote e
validade — o campo que nenhum CRM de varejo tem) e com **as notas da equipe**.
Nota fixada aparece no card do pedido, na hora da separação: "interfone
quebrado, ligar no celular" vale mais que qualquer relatório.

O que a equipe escreve tem tabela própria (`cliente_notas`, `cliente_marcas`),
porque é a única coisa que ninguém consegue deduzir dos dados.

**Campanha por segmento** dispara notificação para um balde inteiro. É uma
arma apontada para a base, então tem trava: título e corpo obrigatórios,
confirmação com o alcance na frente, registro permanente de quem disparou, e
a regra de sempre — **nome de medicamento não entra no corpo**, porque a
notificação acende na tela de bloqueio na frente de qualquer um.

### Estoque — duas camadas, de propósito

| camada | o que é |
|---|---|
| `inventory.estoque` | saldo agregado: é o que a vitrine lê e o que a reserva trava |
| `estoque_lotes` | a verdade física: qual caixa, que validade, que custo, de qual nota |
| `estoque_mov` | o kardex: toda entrada e saída, com motivo e nome de quem fez |

**Nada mexe no saldo sem passar pelo kardex.** Não existe "sumiu": existe
movimento com motivo. Contagem de prateleira que difere do sistema exige
motivo escrito — é exatamente assim que sumiço vira "ajuste" nos sistemas
que não exigem.

**FEFO na separação.** O lote que vence primeiro sai primeiro, e o sistema
escolhe sozinho: o balconista não digita lote nenhum, e mesmo assim o cliente
recebe rastreabilidade. Se ele bipou um lote, o bipado manda. É isso que faz
o [recall](#o-armário-o-diferencial) funcionar de verdade — sem lote na
saída, o recolhimento vira comunicado genérico de novo.

A tela responde três perguntas, nesta ordem, porque é nesta ordem que o
dinheiro some: **o que vai faltar** (venda perdida), **o que vai vencer**
(prejuízo puro, já foi pago) e **o que está parado** (capital dormindo).
Mais a **curva ABC** por faturamento de 90 dias — a lista do que nunca pode
faltar — e a aba **Divergências**, que compara o saldo agregado com a soma
dos lotes. Se as duas contas não batem, alguém mexeu na prateleira sem
registrar.

### A loja
Nome, endereço, telefone, frete, frete grátis, raio, **bairros atendidos** e
horário por dia da semana deixaram de ser constante no código e viraram
campo. O que muda aqui aparece no app do cliente na hora. CNPJ e razão
social não entram: quem muda isso é a Receita, não uma tela.

---
## Foto de produto

Foto de medicamento é do fabricante. O sistema não inventa imagem nem sai
puxando de lugar nenhum: ele guarda **a foto que a loja tem o direito de
usar** — a que o balconista tirou da caixa, ou a que o fornecedor mandou no
kit de mídia.

Três caminhos, todos levando ao mesmo lugar:

```bash
# uma pasta inteira de uma vez: cada arquivo nomeado com o EAN
node server/fotos.js "C:/fotos-da-loja"
```

- no **Catálogo**, clicando na miniatura de qualquer linha;
- na **ficha do produto** dentro de Estoque, onde a foto fica grande;
- pela pasta, com o comando acima — 300 fotos entram em dez segundos.

O arquivo vai para `data/fotos/<ean>.<jpg|png|webp>` e o caminho entra em
`products.imagem_url`. A validação é **pelos bytes, não pela extensão**:
o arquivo precisa começar com a assinatura de JPEG, PNG ou WebP, e o limite
é 3 MB. Quem já hospeda as próprias fotos manda `{ url }` em vez de `{ dados }`.

Produto sem foto continua com o desenho vetorial de `web/pkg.js` — **o
catálogo nunca fica com buraco**, e foto quebrada cai de volta no desenho
sozinha. O aviso no topo do Catálogo conta quantos produtos ainda estão no
desenho.

---
## A operação de hoje: só venda livre

O catálogo entrega **apenas medicamento que não exige receita**. A máquina de
receita — validação pelo farmacêutico, retenção com prova, saldo, SNCR — continua
inteira e testada; ela só está **desligada por uma chave**, não apagada. Apagar
seria jogar fora a conformidade toda para reescrever no dia em que a licença
permitir aviar receita.

```bash
# liga sem reiniciar nada, como admin
curl -X PUT localhost:4173/api/admin/config   -H 'Authorization: Bearer <token-admin>' -H 'Content-Type: application/json'   -d '{"receita_habilitada": true}'
```

Com a chave desligada, o item com tarja some da busca, some do produto aberto
direto por EAN, é recusado no orçamento, e a aba **Receitas** nem aparece na
barra. `npm run test:otc` cobra isso: 17 verificações.

---

## A doca

As três coisas que brigavam pelo rodapé — abas, pedido em andamento e carrinho —
viraram **um objeto só que cresce**. O fundo da tela deixou de ser moldura e
passou a ser informação.

- Um fio de progresso na borda de cima mostra onde o pedido está, sempre
- A tira contextual abre quando há pedido a caminho (ganha) ou carrinho com item
- As abas trocam de ícone de linha para cheio, com mola
- A pílula estica no caminho entre uma aba e outra, em vez de teletransportar
- No rastreio a doca sai de cena: mapa é tela cheia

---

## O app do cliente

`web/index.html` é uma casca; tudo vive em `web/app.js` (telas + roteador),
`web/app.css` (tema) e `web/pkg.js` (as silhuetas de embalagem).
Sem framework, sem build — o navegador carrega o módulo e roda.

**Como a tela se move.** Só existe um `.tela` visível por vez, dentro de `#palco`.
Navegar para dentro empurra a nova pela direita e desloca a antiga; voltar faz o
inverso; trocar de aba faz um fade. A barra de baixo e a sacola não participam da
transição — ficam paradas, como em app nativo. Tudo na mesma curva,
`cubic-bezier(.32,.72,0,1)`, e tudo desligado por `prefers-reduced-motion`.

**O rastreio ao vivo** é a tela que define o app. O mapa é desenhado em vetor
(`web/mapa.js`), não é tile de mapa de verdade: roda offline, não manda o
endereço de ninguém para servidor nenhum e fica mais limpo na tela pequena. A
moto anda pela rota com `getPointAtLength`, a rota se preenche conforme o
pedido avança, e a folha de baixo tem três pontos de parada — espiar o mapa,
ler o pedido, ou tudo. Nessa tela a barra de abas some: rastreio é modo
dedicado, como no Uber.

**O ciclo fecha na avaliação.** Pedido entregue e não avaliado abre a folha
inteira com as estrelas. Nota até 3 exige motivo — reclamação sem causa não
conserta farmácia nenhuma. As marcas viram contagem em
`GET /api/comercio/:pid/reputacao`.

**Detalhes que fazem parecer app, não site**
- A pílula verde da barra de baixo desliza entre as abas em vez de pular.
- Ao adicionar um item, a embalagem voa até a sacola e o contador quica.
- A sacola flutuante aparece por baixo quando o carrinho tem algo.
- Uma barra compacta com busca desce quando você rola a home.
- Confirmação destrutiva abre folha de baixo, não `confirm()` do navegador.
- Aviso em torrada acima da barra; vibração curta nos toques que valem.
- A linha do tempo do pedido preenche sozinha até a etapa atual.
- Esqueleto com brilho enquanto carrega, e entrada escalonada dos cartões.

**A embalagem é desenhada, não fotografada.** `pkg.js` monta quatro silhuetas —
caixa, frasco, tubo e pacote — com face frontal, lateral em gradiente e tampa,
coloridas pelo campo `cor` do produto, com a tarja vermelha reproduzida quando o
item exige receita. É muleta até existir foto de catálogo, mas é muleta que segura
a grade inteira de pé.

**O que já fala com a API**: login, home (`/api/inicio`, uma chamada só), busca por
nome/princípio ativo/categoria, página de produto com genérico equivalente,
carrinho com orçamento dividido, fechamento de pedido, acompanhamento por SSE,
contraproposta, cancelamento, lista de receitas e envio de foto.

---

## O que ainda não existe

- **Pagamento de verdade.** `server/pagamento.js` é um adaptador mock. Trocar por
  Pagar.me, Stripe ou Mercado Pago é reescrever quatro funções — o resto do
  sistema não sabe quem processa.
- **Upload em produção.** `POST /api/upload` guarda em `data/uploads` e serve de
  volta em `/uploads/...`. Resolve o desenvolvimento inteiro; em produção troca por
  S3, R2 ou Supabase Storage — muda só essa rota.
- **Leitura da receita pelo farmacêutico.** Hoje a foto sobe sem medicamento nem
  dose: quem preenche deveria ser o farmacêutico na hora de validar, e o painel
  ainda não tem esse formulário.
- **Senha em produção.** `scrypt` está certo, mas falta política de senha,
  recuperação e 2FA para as contas de loja.
- **CPF em claro.** O campo existe; em produção guarde o hash e os últimos três
  dígitos, não o número.
- **Um processo só.** O SSE vive em memória. Com mais de uma instância, trocar
  por Redis pub/sub.
- **Geolocalização.** `raio_entrega_m` está no schema mas ninguém calcula
  distância ainda: a busca por farmácia é por bairro.
- **App do entregador.** Os endpoints existem; a tela não.
- **Assinatura.** O modelo de dados já aguenta (o saldo de receita é a régua),
  mas o plano não foi lançado de propósito: cesta automática de medicamento
  tarjado esbarra na exigência de receita com saldo por dispensação e na
  vedação de induzir consumo. O caminho é lembrete de recompra primeiro, e
  converter só quem já repetiu.

---

## Conformidade da receita

Isto não é detalhe de fluxo: é o que define o que a plataforma pode vender.
As regras vivem num arquivo só, `server/receituario.js`. Muda a norma, muda
esse arquivo.

**Três classes, não duas**

| Classe | Exemplo | Venda remota | Retenção |
|---|---|---|---|
| `livre` | soro, fralda | sim | não |
| `branca_simples` | losartana | sim | não |
| `branca_retida` | amoxicilina, GLP-1 | sim | **obrigatória** |
| `notificacao` | clonazepam (Portaria 344) | **vedada** | n/a |

A RDC 44/2009, art. 52 §2º (redação da RDC 812/2023) veda a **comercialização**
remota de controlado. A *entrega* de uma venda presencial é permitida — o que
não cabe num marketplace. Por isso o item é barrado no orçamento, no catálogo
da loja e no envio de receita, com a norma citada na mensagem de erro.

**Como a retenção acontece de verdade**

*Papel*: o pedido nasce com `exige_coleta_receita`, a entrega carrega
`coletar_receita`, e o entregador **não conclui** sem recolher a via. A receita
só fica retida quando o farmacêutico registra, na loja, com número de registro,
quantidade, lote e validade — que é o que a orientação do CFF manda anotar no
verso e arquivar. Até lá o pedido aparece em "vias a arquivar" no painel.

*Eletrônica*: foto de receita **não é** prescrição eletrônica. Assinatura
qualificada (ICP-Brasil) para Notificação, qualificada ou avançada para as
sujeitas a retenção. Com ela, a baixa é digital e acontece no ato da liberação,
e o mesmo código de validação não entra duas vezes — índice único no banco.

**Outras travas que o teste cobra**

- Antimicrobiano vence em 10 dias; receita fora do prazo não é liberada
- Receita retida é consumida inteira: não sobra saldo para um segundo pedido
- Receita sem medicamento preenchido não pode ser liberada — o farmacêutico lê
  o papel e preenche antes
- Gerente sem CRF não libera, não preenche e não retém
- Preço acima do PMC da CMED é recusado no catálogo
- O domínio da plataforma tem que constar na AFE da farmácia: é documento
  obrigatório no cadastro

```bash
npm run test:receita     # 49 verificações só disso
```

---

## Experiência: o que existe hoje

**App instalável (PWA).** `manifest.json` + `sw.js`: ícone na tela inicial, abre
em tela cheia sem barra de navegador, e a casca funciona offline. A API **nunca**
vem do cache — preço, estoque e status de pedido errados são piores que tela
vazia.

**Notificação nos dois lados, com uma regra de privacidade no meio.**
Push de farmácia aparece na tela bloqueada. "Sua Losartana saiu para entrega"
conta a doença do seu cliente para quem passar perto do celular dele. Por isso:

> ❌ "Sua Losartana 50mg saiu para entrega"
> ✅ "Pedido CV-4472 saiu para entrega · Edilson está a caminho"

O nome do remédio só aparece para quem ligou a chave em Conta (`users.push_detalhado`,
desligada por padrão). Para a loja é o contrário: bairro, itens, valor e o
cronômetro, com som insistente.

Web Push é implementado à mão em `server/push.js` — VAPID (JWT ES256) e
`aes128gcm` (RFC 8291), sem biblioteca. O payload é cifrado com a chave derivada
do ECDH com o navegador: nem o Google lê o conteúdo.

Uma das mensagens vale o projeto inteiro: **"Conferindo lote e validade de cada
caixa"**. Nenhum app de delivery pode dizer isso.

**O farmacêutico no chat.** `server/conversas.js`. É a única coisa aqui que um
marketplace não copia: eles não empregam farmacêutico. Toda resposta sai assinada
com nome e CRF, gerente sem CRF recebe 403, e a conversa abre com a ressalva —
orientação não é consulta.

**Conferência de rótulo.** `server/interacoes.js` olha o carrinho contra ele mesmo
e contra o que a pessoa recebeu nos últimos 7 dias: mesmo princípio ativo duas
vezes, ou par que não combina. **Avisa, nunca bloqueia**, e oferece levar a dúvida
ao farmacêutico com um toque.

**PIX.** O BR Code é montado à mão (TLV + CRC16) em `server/pix.js`. Detalhe que
importa: no cartão a gente autoriza e captura depois; **em PIX não existe reserva**,
o dinheiro entra na hora. Então pedido com receita só gera o código depois que o
farmacêutico libera — receber e ter que devolver é péssimo para quem espera remédio.

**Busca por sintoma.** "dor de cabeça", "azia", "corte". É como as pessoas pensam.
A fronteira é dura: **navegação, não recomendação** — a resposta carrega, sempre,
que aquilo é uma prateleira e quem orienta é o farmacêutico.

**Operação da casa.** A lista de separação sai na **ordem do corredor**
(`inventory.posicao`), não na ordem em que o cliente montou o carrinho — separar
fora de ordem faz o balconista andar a loja duas vezes. E a previsão de ruptura
projeta pelo ritmo de 14 dias: *"acabou"* é o aviso que chega tarde, *"zera em
2 dias"* dá tempo de comprar.

```bash
npm test     # 261 verificações
```

## O que ficou de fora

- **Agendamento** ("chegar amanhã às 8h")
- **Agrupar entregas** no mesmo bairro numa corrida só
- **App do entregador** — os endpoints existem, a tela não
- **Perfis da família** — combinado deixar de lado
- **Varredura de validade agendada** — hoje é um `POST /api/admin/vencimentos`
  manual; em produção vira tarefa de madrugada

---

## Notificação: as três camadas

Push não é uma coisa só — são três caminhos, e cada um cobre um buraco do outro.

| camada | funciona quando | depende de |
|---|---|---|
| **Canal interno** (SSE) | app aberto | nada — sempre funciona |
| **Aviso do sistema** (`new Notification`) | app aberto, mesmo em segundo plano | permissão |
| **Web Push** (VAPID + aes128gcm) | app fechado | permissão + service worker |

`ligaAvisos()` cai de degrau em degrau: sem service worker, ainda liga o aviso do
sistema; sem permissão, ainda entrega pelo canal interno. **Em nenhum cenário o
aviso simplesmente some** — e a tela de Conta diz em qual camada você está.

Em Conta há um botão **Testar um aviso** que dispara um de verdade pelo caminho
completo, para não precisar fazer um pedido só para ver se funciona.
