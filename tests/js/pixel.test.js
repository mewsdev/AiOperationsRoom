'use strict';

/* Testes da lógica pura do escritório pixel (frontend/pixel.js).
   Rodar: node --test tests/js/pixel.test.js
   Não testa DOM nem animação: testa que os sprites são bem formados, que a
   planta tem lugar para todos sem placas encostando, que toda vaga é
   alcançável andando, e que a escolha de área respeita o estado. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const px = require(path.join(__dirname, '..', '..', 'frontend', 'pixel.js'));

const LARGURA = 968; // largura útil da sala na cena (1000 - 2 margens)
const ALFABETO = new Set(['.', ...Object.keys(px.COR_FIXA), ...Object.keys(px.CLASSE_VAR)]);
const PLACA = 99 / px.P; // largura máxima da placa (PLACA_MAX em pixel.js), em pixels de arte

/* ------------------------------------------------------------ sprites */

test('toda pose, quadro, penteado e fone tem 20 linhas de 12 pixels e só letras conhecidas', () => {
  Object.keys(px.POSES).forEach((pose) => {
    px.ESTILOS.forEach((estilo) => {
      [false, true].forEach((principal) => {
        [0, 1].forEach((q) => {
          const mapa = px.mapaPessoa(pose, q, estilo, principal);
          assert.equal(mapa.length, px.SH, `${pose}/${estilo}`);
          mapa.forEach((linha, r) => {
            assert.equal(linha.length, px.SW, `${pose}/${estilo}/${q} linha ${r}`);
            linha.split('').forEach((ch) => assert.ok(ALFABETO.has(ch), `${pose}: letra ${ch}`));
          });
        });
      });
    });
  });
});

test('fone só no principal, e só por cima do desenho (nunca pinta o vazio)', () => {
  const temFone = (m) => m.join('').includes('H');
  assert.ok(temFone(px.mapaPessoa('pe-frente', 0, 'curto', true)));
  assert.ok(!temFone(px.mapaPessoa('pe-frente', 0, 'curto', false)));
  px.ESTILOS.forEach((estilo) => {
    const sem = px.mapaPessoa('pe-lado', 0, estilo, false);
    const com = px.mapaPessoa('pe-lado', 0, estilo, true);
    sem.forEach((linha, r) => linha.split('').forEach((ch, c) => {
      if (ch === '.') assert.equal(com[r][c], '.', `${estilo} ${r},${c}`);
    }));
  });
});

test('quadro 2 de quem está de frente pisca; quem anda troca as pernas', () => {
  const a = px.mapaPessoa('pe-frente', 0, 'curto', false).join('');
  const b = px.mapaPessoa('pe-frente', 1, 'curto', false).join('');
  assert.ok(a.includes('E') && !b.includes('E'));
  assert.notDeepEqual(px.mapaPessoa('andar-frente', 0, 'curto', false), px.mapaPessoa('andar-frente', 1, 'curto', false));
});

test('a mesma execução tem sempre a mesma aparência', () => {
  const e = { id: 7, session_id: 'abc', agent_id: 'x1', tipo_agente: 'Explore' };
  assert.deepEqual(px.aparencia(e), px.aparencia({ ...e }));
  assert.equal(px.aparencia({ ...e, tipo_agente: 'principal' }).principal, true);
});

test('compilar gera um path por cor; cor de pessoa vem por variável CSS', () => {
  const camadas = px.compilar(['.OO.', 'OTTO']);
  const o = camadas.find((c) => c.ch === 'O');
  const t = camadas.find((c) => c.ch === 'T');
  assert.equal(o.d, 'M1 0h2v1h-2zM0 1h1v1h-1zM3 1h1v1h-1z');
  assert.equal(t.classe, 'pp-camisa');
  assert.equal(t.cor, null);
});

/* ------------------------------------------------------------- planta */

const CENARIOS = [
  { ativos: 0, total: 0 },
  { ativos: 3, total: 9 }, // o pico real medido em 05/10/2026
  { ativos: 7, total: 12 },
  { ativos: 2, total: 25 }, // dia cheio de subagentes encerrados
];

test('a planta tem lugar para todos, com folga na convivência', () => {
  CENARIOS.forEach((c) => {
    const plano = px.planejarSala(c, LARGURA);
    const mesas = plano.vagas.filter((v) => v.zona === 'mesa').length;
    const convivencia = plano.vagas.filter((v) => v.zona !== 'mesa').length;
    assert.ok(mesas >= c.ativos + 1, `mesas ${mesas} para ${c.ativos} ativos`);
    assert.ok(convivencia >= c.total + 2, `convivência ${convivencia} para ${c.total}`);
    assert.equal(new Set(plano.vagas.map((v) => v.id)).size, plano.vagas.length);
  });
});

test('placas, losangos e tempos de duas vagas nunca se encostam', () => {
  CENARIOS.forEach((c) => {
    const plano = px.planejarSala(c, LARGURA);
    plano.vagas.forEach((a, i) => plano.vagas.slice(i + 1).forEach((b) => {
      // lado a lado: placas não se tocam; na mesma coluna: o balão da órfã
      // (32 px acima dos pés) fica abaixo do tempo de cima (11 px abaixo)
      if (Math.abs(a.x - b.x) < PLACA) assert.ok(Math.abs(a.y - b.y) >= 43, `${a.id} e ${b.id} empilhados`);
    }));
  });
});

test('toda vaga cabe na sala e fica abaixo da parede do fundo', () => {
  CENARIOS.forEach((c) => {
    const plano = px.planejarSala(c, LARGURA);
    plano.vagas.forEach((v) => {
      assert.ok(v.x - PLACA / 2 >= 0 && v.x + PLACA / 2 <= plano.W, `${v.id} x`);
      assert.ok(v.y - px.SH >= 32 - 10 && v.y + 12 <= plano.H, `${v.id} y=${v.y} H=${plano.H}`);
    });
  });
});

test('de qualquer vaga se chega a qualquer outra andando, pelas passagens', () => {
  CENARIOS.forEach((c) => {
    const plano = px.planejarSala(c, LARGURA);
    const grade = px.criarGrade(plano);
    const origem = plano.vagas[0].acesso;
    plano.vagas.forEach((v) => {
      const caminho = px.rota(grade, origem, v.acesso);
      assert.ok(caminho && caminho.length, `sem rota até ${v.id} (${JSON.stringify(c)})`);
    });
  });
});

test('a rota só tem trechos retos (horizontais ou verticais) e não atravessa móvel', () => {
  const plano = px.planejarSala({ ativos: 3, total: 9 }, LARGURA);
  const grade = px.criarGrade(plano);
  const de = plano.vagas.find((v) => v.id === 'mesa-0').acesso;
  const para = plano.vagas.find((v) => v.id === 'estar-4').acesso;
  const caminho = px.rota(grade, de, para);
  for (let i = 1; i < caminho.length; i += 1) {
    const a = caminho[i - 1];
    const b = caminho[i];
    assert.ok(a.x === b.x || a.y === b.y, 'trecho diagonal');
    const passos = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / 2;
    for (let k = 0; k <= passos; k += 1) {
      const x = a.x + ((b.x - a.x) * k) / (passos || 1);
      const y = a.y + ((b.y - a.y) * k) / (passos || 1);
      const i2 = Math.floor(y / 2) * grade.cw + Math.floor(x / 2);
      assert.equal(grade.livre[i2], 1, `célula ocupada em ${x},${y}`);
    }
  }
});

/* --------------------------------------------------- estado e lugar */

test('encerrada e órfã nunca vão para a mesa; ativas podem ir a qualquer área', () => {
  for (let s = 0; s < 1; s += 0.01) {
    assert.notEqual(px.sortearZona('concluida', s), 'mesa');
    assert.notEqual(px.sortearZona('orfa', s), 'mesa');
  }
  ['trabalhando', 'delegando', 'aguardando'].forEach((status) => {
    const zonas = new Set();
    for (let s = 0.001; s < 1; s += 0.01) zonas.add(px.sortearZona(status, s));
    assert.deepEqual([...zonas].sort(), ['cafe', 'estar', 'mesa'], status);
  });
});

test('quem trabalha vai mais à mesa do que quem aguarda', () => {
  assert.ok(px.PESOS.trabalhando.mesa > px.PESOS.aguardando.mesa);
  assert.ok(px.PESOS.delegando.mesa > px.PESOS.aguardando.mesa);
});

test('foco=mesa (vitrine): quem trabalha ou delega só sorteia mesa; os demais não mudam', () => {
  const zonasDe = (status) => {
    const zonas = new Set();
    for (let s = 0.001; s < 1; s += 0.01) zonas.add(px.sortearZona(status, s));
    return [...zonas].sort();
  };
  px.definirFocoMesa(true);
  try {
    assert.deepEqual(zonasDe('trabalhando'), ['mesa']);
    assert.deepEqual(zonasDe('delegando'), ['mesa']);
    assert.deepEqual(zonasDe('aguardando'), ['cafe', 'estar', 'mesa']);
    assert.deepEqual(zonasDe('concluida'), ['cafe', 'estar']);
    assert.deepEqual(zonasDe('orfa'), ['cafe', 'estar']);
  } finally {
    px.definirFocoMesa(false);
  }
  assert.deepEqual(zonasDe('trabalhando'), ['cafe', 'estar', 'mesa']); // desligado de novo: comportamento normal
});

test('escolherVaga nunca devolve vaga ocupada nem a vaga atual', () => {
  const plano = px.planejarSala({ ativos: 3, total: 9 }, LARGURA);
  const ocupadas = new Set(plano.vagas.filter((v) => v.zona === 'estar').map((v) => v.id));
  for (let s = 0; s < 1; s += 0.05) {
    const v = px.escolherVaga(plano, 'concluida', ocupadas, s, 'balcao-0');
    assert.ok(v && !ocupadas.has(v.id) && v.id !== 'balcao-0' && v.zona === 'cafe');
  }
  const cheias = new Set(plano.vagas.filter((v) => v.zona !== 'mesa').map((v) => v.id));
  assert.equal(px.escolherVaga(plano, 'orfa', cheias, 0.5, null), null); // sem lugar: fica onde está
});

test('prepararSalas: só salas com gente, ordem por nome, Sem projeto por último', () => {
  const salas = px.prepararSalas({
    salas: [
      { chave: 'cx', nome: 'Sem projeto', projeto_id: null, execucoes: [{ id: 1, status: 'concluida' }] },
      { chave: 'p2', nome: 'Zeta', projeto_id: 2, execucoes: [{ id: 2, status: 'trabalhando' }] },
      { chave: 'p1', nome: 'Alfa', projeto_id: 1, execucoes: [] },
      { chave: 'p3', nome: 'Beta', projeto_id: 3, execucoes: [{ id: 3, status: 'concluida' }] },
    ],
  });
  assert.deepEqual(salas.map((s) => s.chave), ['p3', 'p2', 'cx']);
  assert.equal(salas[0].ativos, 0); // encerrada não conta como ativa
});

test('nove execuções ativas dimensionam a sala com mesas suficientes', () => {
  const execucoes = Array.from({ length: 9 }, (_, id) => ({ id, status: 'trabalhando' }));
  const [sala] = px.prepararSalas({ salas: [{ chave: 'p1', nome: 'Projeto', projeto_id: 1, ativos: 9, execucoes }] });
  const plano = px.planejarSala({ ativos: sala.ativos, total: sala.execucoes.length }, LARGURA);
  assert.ok(plano.vagas.filter((vaga) => vaga.zona === 'mesa').length >= 9);
});

test('advisor tem família, crachá e rótulo próprios', () => {
  assert.equal(px.familiaDe('advisor'), 'advisor');
  assert.equal(px.rotulo('advisor'), 'Advisor');
  assert.equal(px.familiaDe('advisor-de-codigo'), 'outro');
});
