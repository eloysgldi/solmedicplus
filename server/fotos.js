import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { um, roda } from './db.js';
import { Erro } from './http.js';

/**
 * ============================================================
 * FOTO DE PRODUTO
 *
 * Foto de medicamento é do fabricante. Então o sistema não inventa nem
 * sai puxando imagem de lugar nenhum: ele guarda a foto que a loja tem
 * o direito de usar — a que o balconista tirou da caixa, ou a que o
 * fornecedor mandou no kit de mídia.
 *
 * O arquivo vai para data/fotos/<ean>.<ext> e o caminho entra em
 * products.imagem_url. Quem não tem foto continua com o desenho vetorial
 * do app: o catálogo nunca fica com buraco.
 * ============================================================
 */

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
export const PASTA = join(raiz, 'data', 'fotos');
const LIMITE = 3 * 1024 * 1024;   // 3 MB por foto

/** Assinatura do arquivo, não a extensão do nome: nome mente, byte não. */
function tipoReal(buf) {
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg';
  if (buf.length > 8 && buf.toString('hex', 0, 8) === '89504e470d0a1a0a') return '.png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF'
      && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

function bytes(dados) {
  const limpo = String(dados ?? '').replace(/^data:[^,]*,/, '');
  try { return Buffer.from(limpo, 'base64'); }
  catch { throw new Erro(422, 'IMAGEM_INVALIDA', 'Não consegui ler essa imagem'); }
}

/** Guarda a foto de um EAN. Aceita base64, data URL ou um endereço pronto. */
export async function salva(ean, { dados, url } = {}) {
  const p = um('SELECT * FROM products WHERE ean = ?', ean);
  if (!p) throw new Erro(404, 'PRODUTO_INEXISTENTE', `EAN ${ean} não existe no catálogo`);

  // loja que já hospeda as próprias fotos só aponta para elas
  if (url && !dados) {
    if (!/^https?:\/\/|^\//.test(url)) {
      throw new Erro(422, 'URL_INVALIDA', 'Endereço de imagem inválido');
    }
    roda('UPDATE products SET imagem_url = ? WHERE ean = ?', url, ean);
    return { ean, imagem_url: url };
  }

  const buf = bytes(dados);
  if (!buf.length) throw new Erro(422, 'IMAGEM_VAZIA', 'Chegou uma imagem vazia');
  if (buf.length > LIMITE) {
    throw new Erro(413, 'IMAGEM_GRANDE',
      `${(buf.length / 1048576).toFixed(1)} MB é grande demais. O limite é 3 MB.`);
  }
  const ext = tipoReal(buf);
  if (!ext) throw new Erro(422, 'FORMATO_NAO_SUPORTADO', 'Só entra JPG, PNG ou WebP');

  await mkdir(PASTA, { recursive: true });
  // um EAN, um arquivo: trocar a foto sobrescreve em vez de acumular lixo
  for (const outra of ['.jpg', '.png', '.webp'].filter((e) => e !== ext)) {
    await unlink(join(PASTA, ean + outra)).catch(() => {});
  }
  await writeFile(join(PASTA, ean + ext), buf);
  const caminho = `/fotos/${ean}${ext}`;
  roda('UPDATE products SET imagem_url = ? WHERE ean = ?', caminho, ean);
  return { ean, imagem_url: caminho, bytes: buf.length };
}

export async function apaga(ean) {
  for (const e of ['.jpg', '.png', '.webp']) await unlink(join(PASTA, ean + e)).catch(() => {});
  roda('UPDATE products SET imagem_url = NULL WHERE ean = ?', ean);
  return { ean, imagem_url: null };
}

/**
 * Importa uma pasta inteira de uma vez: cada arquivo nomeado pelo EAN
 * (7891142199058.jpg) vira a foto daquele produto.
 *
 *   node server/fotos.js "C:\fotos-da-loja"
 *
 * É assim que 300 fotos entram em dez segundos, sem ninguém clicar 300 vezes.
 */
export async function importaPasta(pasta) {
  const arquivos = await readdir(pasta);
  const feitos = [], ignorados = [];
  for (const nome of arquivos) {
    const ean = basename(nome, extname(nome)).replace(/\D/g, '');
    if (!/^\d{8,14}$/.test(ean)) { ignorados.push({ nome, por: 'nome não é um EAN' }); continue; }
    if (!um('SELECT ean FROM products WHERE ean = ?', ean)) {
      ignorados.push({ nome, por: 'EAN fora do catálogo' }); continue;
    }
    try {
      const buf = await readFile(join(pasta, nome));
      const r = await salva(ean, { dados: buf.toString('base64') });
      feitos.push({ ean, arquivo: nome, url: r.imagem_url });
    } catch (e) { ignorados.push({ nome, por: e.message }); }
  }
  return { feitos, ignorados };
}

// rodado direto pela linha de comando
if (process.argv[1] && basename(process.argv[1]) === 'fotos.js') {
  const pasta = process.argv[2];
  if (!pasta) {
    console.log('\n  uso:  node server/fotos.js <pasta com as fotos>\n'
      + '  cada arquivo precisa se chamar como o EAN: 7891142199058.jpg\n');
  } else {
    const r = await importaPasta(pasta);
    console.log(`\n  ${r.feitos.length} foto(s) aplicada(s)`);
    for (const f of r.feitos) console.log(`   ✓ ${f.ean}  ${f.arquivo}`);
    for (const i of r.ignorados) console.log(`   · ${i.nome} — ${i.por}`);
    console.log('');
  }
}
