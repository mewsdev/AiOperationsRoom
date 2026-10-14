'use strict';

/* AI Operations Room — escritório pixel art (Lote 5, aprovado em 05/10/2026).

   Motor da visualização do escritório pixel.

   O que muda em relação ao Escritório vetorial:
   - Cada sala de projeto é um andar inteiro com três áreas e passagens entre
     elas: estações de trabalho, café e sala de estar.
   - Lugar é AMBIENTAÇÃO, não estado. Toda pessoa visível circula entre as
     áreas; trabalhar na mesa é uma atividade possível, não a posição de quem
     está "trabalhando". O estado verdadeiro está sempre no personagem — o
     marcador sobre a cabeça e a borda da placa têm a cor do estado — e no
     detalhe ao clicar. Para a cena não contradizer o estado: só quem está
     trabalhando ou delegando digita e acende o monitor; a escolha da
     próxima área pesa o estado (quem trabalha vai mais à mesa).
   - Sem porta: quem aparece surge discretamente num lugar; quem encerra vai
     para a convivência (café ou sala de estar) e fica até 12 h depois do
     último evento gravado; ao vencer, some devagar onde estiver. Quem decide
     o prazo é definido pela API. Na órfã, o prazo conta de quando a morte foi
     percebida.
   - Órfã vai para a convivência e para ali, com o balão "!".

   Nada de ação específica ("lendo arquivo", "pedindo permissão"): os seis
   hooks não entregam isso (docs/AGENTES_HOOKS.md). Digitar = trabalhando
   ou delegando, e só.

   Arte original, desenhada em código. Nenhum sprite vem do Pixel Agents nem
   de pacote de terceiros (lá o código é MIT, mas móveis e pisos não têm
   licença declarada: issue #355 do repositório deles). Cada sprite é um
   mapa de caracteres que vira um <path> por cor (crispEdges): escala sem
   borrar, sem canvas, sem arquivo. Pele, cabelo e roupa entram por variável
   CSS, então um símbolo serve para todas as pessoas.

   Duas camadas:
   - `logica`: sprites, planta da sala, vagas, grade de circulação, rota
     (A* em 4 direções), escolha de área por estado. Sem DOM; tests/js cobre.
   - o resto: DOM, quadros, caminhada por rAF, diferença por id (sem
     redesenho, sem flicker), laço pai → filha, rota do tipo. */

(function (raiz) {
  const P = 3; // unidades do viewBox por pixel de arte
  const SW = 12; // sprite: largura
  const SH = 20; // sprite: altura (âncora = pés, embaixo e no centro)
  const ATIVOS = ['trabalhando', 'aguardando', 'delegando'];
  const CONVIVENCIA = ['cafe', 'estar'];

  /* ---------------------------------------------------------- pessoas */

  // O contorno · S/s pele · R/r cabelo · E olho · T/t camisa · P calça ·
  // B sapato · H/h fone (só o Claude principal)
  const CABECAS = {
    frente: {
      curto: [
        '............', '...OOOOOO...', '..ORRRRRRO..', '.ORRRRRRRRO.', '.ORRRRRRRRO.',
        '.ORSSSSSSRO.', '.OSSESSESSO.', '.OSSSSSSSSO.', '..OSSSSSSO..', '...OOssOO...',
      ],
      longo: [
        '............', '...OOOOOO...', '..ORRRRRRO..', '.ORRRRRRRRO.', '.ORRRRRRRRO.',
        '.ORSSSSSSRO.', '.ORSESSESRO.', '.ORSSSSSSRO.', '.ORRSSSSRRO.', '..ORRssRRO..',
      ],
      coque: [
        '....OOOO....', '...ORrrRO...', '..ORRRRRRO..', '.ORRRRRRRRO.', '.ORRRRRRRRO.',
        '.ORSSSSSSRO.', '.OSSESSESSO.', '.OSSSSSSSSO.', '..OSSSSSSO..', '...OOssOO...',
      ],
      cacheado: [
        '...OOOOOO...', '..ORRrRRRO..', '.ORRRRRrRRO.', 'ORrRRRRRRrRO', 'ORRRRRRRRRRO',
        'ORRSSSSSSRRO', '.OSSESSESSO.', '.OSSSSSSSSO.', '..OSSSSSSO..', '...OOssOO...',
      ],
    },
    costas: {
      curto: [
        '............', '...OOOOOO...', '..ORRRRRRO..', '.ORRRRRRRRO.', '.ORRRRRRRRO.',
        '.ORRRRRRRRO.', '.ORRRrrRRRO.', '.OSRRRRRRSO.', '..ORRRRRRO..', '...OOssOO...',
      ],
      longo: [
        '............', '...OOOOOO...', '..ORRRRRRO..', '.ORRRRRRRRO.', '.ORRRRRRRRO.',
        '.ORRRRRRRRO.', '.ORRRrrRRRO.', '.ORRRRRRRRO.', '.ORRRRRRRRO.', '..ORRrrRRO..',
      ],
      coque: [
        '....OOOO....', '...ORrrRO...', '..ORRRRRRO..', '.ORRRRRRRRO.', '.ORRRRRRRRO.',
        '.ORRRRRRRRO.', '.ORRRrrRRRO.', '.OSRRRRRRSO.', '..ORRRRRRO..', '...OOssOO...',
      ],
      cacheado: [
        '...OOOOOO...', '..ORRrRRRO..', '.ORRRRRrRRO.', 'ORrRRRRRRrRO', 'ORRRRRRRRRRO',
        'ORRRRrRRRRRO', '.ORRRRRRrRO.', '.OSRRRRRRSO.', '..ORRRRRRO..', '...OOssOO...',
      ],
    },
    lado: {
      curto: [
        '............', '...OOOOOO...', '..ORRRRRRO..', '.ORRRRRRRRO.', '.ORRRRRRRRO.',
        '.ORRRRSSSSO.', '.ORRRSSSESO.', '.ORRSSSSSSO.', '..ORSSSSSO..', '....OssO....',
      ],
      longo: [
        '............', '...OOOOOO...', '..ORRRRRRO..', '.ORRRRRRRRO.', '.ORRRRRRRRO.',
        '.ORRRRSSSSO.', '.ORRRSSSESO.', '.ORRRSSSSSO.', '.ORRRSSSSO..', '.ORRROssO...',
      ],
      coque: [
        '....OOOO....', '...ORrrRO...', '..ORRRRRRO..', '.ORRRRRRRRO.', '.ORRRRRRRRO.',
        '.ORRRRSSSSO.', '.ORRRSSSESO.', '.ORRSSSSSSO.', '..ORSSSSSO..', '....OssO....',
      ],
      cacheado: [
        '...OOOOOO...', '..ORRrRRRO..', '.ORRRRRrRRO.', 'ORrRRRRRRRRO', 'ORRRRRRRRRRO',
        'ORRRRRSSSSO.', '.ORRRSSSESO.', '.ORRSSSSSSO.', '..ORSSSSSO..', '....OssO....',
      ],
    },
  };

  const PERNAS_PE = ['..OPPOOPPO..', '..OBBOOBBO..', '...OO..OO...'];
  const PERNAS_A = ['..OPPOOBBO..', '..OBBO.OO...', '...OO.......'];
  const PERNAS_B = ['..OBBOOPPO..', '...OO.OBBO..', '.......OO...'];
  const troncoFrente = ['..OTTTTTTO..', '.OTTTTTTTTO.', '.OTtTTTTtTO.', '.OSOTTTTOSO.', '..OOTTTTOO..', '..OPPPPPPO..', '..OPPOOPPO..'];
  const troncoCostas = ['..OTTTTTTO..', '.OTTTTTTTTO.', '.OTTTTTTTTO.', '.OSOTTTTOSO.', '..OOTTTTOO..', '..OPPPPPPO..', '..OPPOOPPO..'];
  const ladoPe = [
    '...OTTTTO...', '...OTTTTO...', '...OTtTTO...', '...OTTSTO...', '...OTTTTO...',
    '...OPPPPO...', '...OPPPPO...', '...OPPPPO...', '...OBBBBBO..', '....OOOOO...',
  ];
  const ladoPasso = [
    '...OTTTTO...', '...OTTTTO...', '...OTtTTO...', '...OTTTSO...', '...OTTTTO...',
    '...OPPPPO...', '..OPPOOPPO..', '.OPPO..OPPO.', '.OBBO..OBBBO', '..OO....OOO.',
  ];
  const sentadoCostas = (maos) => [
    '..OTTTTTTO..', '.OTTTTTTTTO.', maos[0], maos[1], '..OTTTTTTO..',
    '..OPPPPPPO..', '...OOOOOO...', '............', '............', '............',
  ];
  const sentadoFrente = [
    '..OTTTTTTO..', '.OTTTTTTTTO.', '.OTtTTTTtTO.', '.OSOTTTTOSO.', '..OPPPPPPO..',
    '..OPPPPPPO..', '..OPPOOPPO..', '..OBBOOBBO..', '...OO..OO...', '............',
  ];

  /* pose -> vista da cabeça, corpo de cada quadro, e se o quadro 2 pisca */
  const POSES = {
    'pe-frente': { vista: 'frente', corpos: [[...troncoFrente, ...PERNAS_PE], [...troncoFrente, ...PERNAS_PE]], piscar: true },
    'andar-frente': { vista: 'frente', corpos: [[...troncoFrente, ...PERNAS_A], [...troncoFrente, ...PERNAS_B]] },
    'pe-costas': { vista: 'costas', corpos: [[...troncoCostas, ...PERNAS_PE], [...troncoCostas, ...PERNAS_PE]] },
    'andar-costas': { vista: 'costas', corpos: [[...troncoCostas, ...PERNAS_A], [...troncoCostas, ...PERNAS_B]] },
    'pe-lado': { vista: 'lado', corpos: [ladoPe, ladoPe] },
    'andar-lado': { vista: 'lado', corpos: [ladoPasso, ladoPe] },
    digitar: {
      vista: 'costas',
      corpos: [sentadoCostas(['OSTTTTTTTTO.', '.OTTTTTTTTSO']), sentadoCostas(['.OTTTTTTTTSO', 'OSTTTTTTTTO.'])],
    },
    'sentado-costas': { vista: 'costas', corpos: [sentadoCostas(['.OTTTTTTTTO.', '.OSTTTTTTSO.']), sentadoCostas(['.OTTTTTTTTO.', '.OSTTTTTTSO.'])] },
    'sentado-frente': { vista: 'frente', corpos: [sentadoFrente, sentadoFrente], piscar: true },
  };
  const ESTILOS = ['curto', 'longo', 'coque', 'cacheado'];

  // fone do principal: [linha, coluna, letra], só onde já há desenho
  const FONE = {
    frente: [[2, 3, 'H'], [2, 4, 'H'], [2, 5, 'H'], [2, 6, 'H'], [2, 7, 'H'], [2, 8, 'H'], [5, 1, 'H'], [6, 1, 'h'], [5, 10, 'H'], [6, 10, 'h']],
    costas: [[2, 3, 'H'], [2, 4, 'H'], [2, 5, 'H'], [2, 6, 'H'], [2, 7, 'H'], [2, 8, 'H'], [5, 1, 'H'], [6, 1, 'h'], [5, 10, 'H'], [6, 10, 'h']],
    lado: [[2, 3, 'H'], [2, 4, 'H'], [2, 5, 'H'], [2, 6, 'H'], [2, 7, 'H'], [2, 8, 'H'], [5, 4, 'H'], [5, 5, 'H'], [6, 4, 'h'], [6, 5, 'h']],
  };

  function mapaPessoa(pose, quadro, estilo, principal) {
    const def = POSES[pose];
    let cabeca = CABECAS[def.vista][estilo];
    if (def.piscar && quadro === 1) cabeca = cabeca.map((l) => l.replace(/E/g, 's'));
    let linhas = [...cabeca, ...def.corpos[quadro]];
    if (principal) {
      linhas = linhas.map((l) => l.split(''));
      FONE[def.vista].forEach(([r, c, ch]) => {
        if (linhas[r][c] !== '.') linhas[r][c] = ch;
      });
      linhas = linhas.map((l) => l.join(''));
    }
    return linhas;
  }

  const COR_FIXA = { O: '#1A1520', E: '#1A1520', B: '#15121A', H: '#9B5CFF', h: '#5B2BB0' };
  const CLASSE_VAR = { S: 'pp-pele', s: 'pp-pele-s', R: 'pp-cabelo', r: 'pp-cabelo-s', T: 'pp-camisa', t: 'pp-camisa-s', P: 'pp-calca' };

  // aparência: pele, cabelo, camisa e calça. Camisas em tons fechados e
  // longe de verde, azul, laranja e vermelho — essas cores são do estado.
  const PELES = [['#F2D3B3', '#D9B08F'], ['#E0B48C', '#C2946C'], ['#C68B5E', '#A66F45'], ['#8D5A3B', '#714629'], ['#5E3A25', '#4A2C1B']];
  const CABELOS = [['#2B1D14', '#1B120C'], ['#5A3A22', '#432A17'], ['#A0652E', '#7F4E22'], ['#D9A441', '#B5852D'], ['#24222C', '#141219'], ['#BDB8C9', '#9893A8'], ['#8B4FD9', '#6B36B5']];
  const CAMISAS = [['#4A5878', '#36415A'], ['#2F6F73', '#225558'], ['#7A3B5E', '#5E2C48'], ['#5B4690', '#45356E'], ['#7A5A34', '#5E4426'], ['#5A5A66', '#45454F'], ['#B9B2A2', '#958F80'], ['#3A3F58', '#2B2F43']];
  const CALCAS = ['#2A2733', '#33384A', '#3A2E28', '#26303A', '#4A4458'];

  function hash(texto) {
    let h = 2166136261;
    for (let i = 0; i < texto.length; i += 1) {
      h ^= texto.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* A mesma execução tem sempre a mesma cara (a chave é a sessão + o id do
     subagente); execuções diferentes do mesmo tipo são pessoas diferentes. */
  function aparencia(e) {
    const h = hash(`${e.session_id || ''}|${e.agent_id || ''}|${e.id}`);
    const pega = (lista, n) => lista[Math.floor(h / n) % lista.length];
    return {
      estilo: pega(ESTILOS, 1),
      pele: pega(PELES, 5),
      cabelo: pega(CABELOS, 31),
      camisa: pega(CAMISAS, 223),
      calca: pega(CALCAS, 2003),
      principal: e.tipo_agente === 'principal',
    };
  }

  /* Mapa de caracteres -> um path por cor, juntando corridas horizontais. */
  function compilar(linhas) {
    const porCor = new Map();
    linhas.forEach((linha, y) => {
      let x = 0;
      while (x < linha.length) {
        const ch = linha[x];
        if (ch === '.') {
          x += 1;
          continue;
        }
        let fim = x + 1;
        while (fim < linha.length && linha[fim] === ch) fim += 1;
        if (!porCor.has(ch)) porCor.set(ch, []);
        porCor.get(ch).push(`M${x} ${y}h${fim - x}v1h-${fim - x}z`);
        x = fim;
      }
    });
    return [...porCor.entries()].map(([ch, partes]) => ({
      ch,
      cor: COR_FIXA[ch] || null,
      classe: CLASSE_VAR[ch] || null,
      d: partes.join(''),
    }));
  }

  /* ----------------------------------------------------------- planta */

  /* Coordenadas em pixels de arte. A sala ocupa a largura toda da cena. */
  const X = {
    trabalho: [2, 130],
    div1: [130, 133],
    cafe: [133, 198],
    div2: [198, 201],
    estar: [201, 320],
  };
  const Y_PISO = 32;
  const MESAS_X = [22, 65, 108];
  const CAFE_X = [148, 182];
  const ESTAR_X = [231, 266, 301];
  const FOLGA = { x: 4, y: 2 }; // meia largura dos pés: a rota não raspa nos móveis

  /* Planta para `ativos` execuções ativas e `total` pessoas na sala. Cresce
     em linhas inteiras: mesa de 3 em 3, café de 2 em 2, sala de estar de 3
     em 3, sempre com folga de 2 lugares na convivência. Duas vagas na mesma
     coluna ficam a 43 px ou mais: o losango de quem está embaixo (30 px
     acima dos pés) não pode cobrir o tempo de quem está em cima (11 px
     abaixo dos pés). */
  function planejarSala(contagem, largura) {
    const W = Math.floor(largura / P);
    const ativos = contagem.ativos || 0;
    const total = Math.max(contagem.total || 0, ativos);
    const linhasMesa = Math.max(2, Math.ceil((ativos + 1) / 3));
    let linhasCafe = 1;
    let linhasEstar = 2;
    while (2 + 2 * linhasCafe + 3 * linhasEstar < total + 2) {
      if (linhasCafe < linhasEstar - 1) linhasCafe += 1;
      else linhasEstar += 1;
    }

    const vagas = [];
    const moveis = [];
    const obst = [];

    for (let r = 0; r < linhasMesa; r += 1) {
      MESAS_X.forEach((cx, i) => {
        const yT = 40 + r * 48;
        vagas.push({ id: `mesa-${r * 3 + i}`, zona: 'mesa', tipo: 'mesa', x: cx, y: yT + 22, acesso: { x: cx, y: yT + 31 } });
        moveis.push({ tipo: 'mesa', id: `mesa-${r * 3 + i}`, x: cx, y: yT });
        obst.push([cx - 14, yT - 1, 28, 11], [cx - 6, yT + 13, 13, 8]);
      });
    }

    CAFE_X.forEach((x, i) => vagas.push({ id: `balcao-${i}`, zona: 'cafe', tipo: 'balcao', x, y: 54, acesso: { x, y: 54 } }));
    obst.push([136, Y_PISO, 60, 13]);
    for (let r = 0; r < linhasCafe; r += 1) {
      const yt = 75 + r * 43;
      CAFE_X.forEach((x, i) => {
        vagas.push({ id: `banqueta-${r * 2 + i}`, zona: 'cafe', tipo: 'banqueta', x, y: yt + 22, acesso: { x, y: yt + 29 } });
        moveis.push({ tipo: 'mesinha', x, y: yt });
        obst.push([x - 7, yt, 15, 9], [x - 4, yt + 16, 9, 6]);
      });
    }

    for (let r = 0; r < linhasEstar; r += 1) {
      const ya = 60 + r * 43;
      moveis.push({ tipo: r % 2 === 0 ? 'sofa' : 'poltronas', y: ya });
      obst.push([214, ya - 21, 104, 19]);
      ESTAR_X.forEach((x, i) => {
        vagas.push({ id: `estar-${r * 3 + i}`, zona: 'estar', tipo: 'sofa', x, y: ya, acesso: { x, y: ya + 9 } });
      });
    }

    const fimTrabalho = 40 + (linhasMesa - 1) * 48 + 40;
    const fimCafe = 75 + (linhasCafe - 1) * 43 + 38;
    const fimEstar = 60 + (linhasEstar - 1) * 43 + 22;
    const H = Math.max(fimTrabalho, fimCafe, fimEstar) + 3;

    // paredes: fundo, laterais, de baixo e as duas divisórias com passagens
    const passagens = [[46, 70], [H - 27, H - 5]];
    obst.push([0, 0, W, Y_PISO], [0, 0, 2, H], [W - 2, 0, 2, H], [0, H - 3, W, 3]);
    [X.div1, X.div2].forEach(([x0, x1]) => {
      let y = Y_PISO;
      passagens.forEach(([p0, p1]) => {
        obst.push([x0, y, x1 - x0, p0 - y]);
        y = p1;
      });
      obst.push([x0, y, x1 - x0, H - y]);
    });
    obst.push([4, H - 15, 8, 11]); // planta no canto do trabalho

    return {
      W, H, largura: W * P, altura: H * P, linhasMesa, linhasCafe, linhasEstar,
      assinatura: `${W}:${linhasMesa}:${linhasCafe}:${linhasEstar}`,
      vagas, moveis, obstaculos: obst, passagens,
    };
  }

  /* --------------------------------------------------------- circulação */

  const CEL = 2; // célula da grade, em pixels de arte

  function criarGrade(plano) {
    const cw = Math.ceil(plano.W / CEL);
    const ch = Math.ceil(plano.H / CEL);
    const livre = new Uint8Array(cw * ch).fill(1);
    plano.obstaculos.forEach(([x, y, w, h]) => {
      const x0 = Math.max(0, Math.floor((x - FOLGA.x) / CEL));
      const x1 = Math.min(cw - 1, Math.floor((x + w + FOLGA.x - 0.01) / CEL));
      const y0 = Math.max(0, Math.floor((y - FOLGA.y) / CEL));
      const y1 = Math.min(ch - 1, Math.floor((y + h + FOLGA.y - 0.01) / CEL));
      for (let cy = y0; cy <= y1; cy += 1) for (let cx = x0; cx <= x1; cx += 1) livre[cy * cw + cx] = 0;
    });
    return { cw, ch, livre };
  }

  const celula = (grade, p) => ({
    cx: Math.min(grade.cw - 1, Math.max(0, Math.floor(p.x / CEL))),
    cy: Math.min(grade.ch - 1, Math.max(0, Math.floor(p.y / CEL))),
  });

  /* célula livre mais perto (quem está sentado parte de dentro do móvel) */
  function livreMaisPerto(grade, c) {
    if (grade.livre[c.cy * grade.cw + c.cx]) return c;
    for (let raio = 1; raio < 20; raio += 1) {
      for (let dy = -raio; dy <= raio; dy += 1) {
        for (let dx = -raio; dx <= raio; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== raio) continue;
          const cx = c.cx + dx;
          const cy = c.cy + dy;
          if (cx >= 0 && cy >= 0 && cx < grade.cw && cy < grade.ch && grade.livre[cy * grade.cw + cx]) return { cx, cy };
        }
      }
    }
    return null;
  }

  /* A* em 4 direções. Devolve os cantos do caminho em pixels de arte (sem
     os pontos intermediários de cada reta), ou null se não há passagem. */
  function rota(grade, de, para) {
    const a = livreMaisPerto(grade, celula(grade, de));
    const b = livreMaisPerto(grade, celula(grade, para));
    if (!a || !b) return null;
    const { cw, ch, livre } = grade;
    const n = cw * ch;
    const g = new Float64Array(n).fill(Infinity);
    const veio = new Int32Array(n).fill(-1);
    const fechado = new Uint8Array(n);
    const ini = a.cy * cw + a.cx;
    const fim = b.cy * cw + b.cx;
    const h = (i) => Math.abs((i % cw) - b.cx) + Math.abs(Math.floor(i / cw) - b.cy);
    const heap = [];
    const empurra = (i, f) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const pai = (k - 1) >> 1;
        if (heap[pai][0] <= heap[k][0]) break;
        [heap[pai], heap[k]] = [heap[k], heap[pai]];
        k = pai;
      }
    };
    const tira = () => {
      const topo = heap[0];
      const ultimo = heap.pop();
      if (heap.length) {
        heap[0] = ultimo;
        let k = 0;
        for (;;) {
          const e = 2 * k + 1;
          const d = e + 1;
          let m = k;
          if (e < heap.length && heap[e][0] < heap[m][0]) m = e;
          if (d < heap.length && heap[d][0] < heap[m][0]) m = d;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return topo;
    };
    g[ini] = 0;
    empurra(ini, h(ini));
    while (heap.length) {
      const [, i] = tira();
      if (fechado[i]) continue;
      if (i === fim) break;
      fechado[i] = 1;
      const x = i % cw;
      const y = Math.floor(i / cw);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) return;
        const j = ny * cw + nx;
        if (!livre[j] || fechado[j]) return;
        // curva custa um pouco: rotas com poucos cantos, como gente anda
        const curva = veio[i] !== -1 && (veio[i] % cw !== x ? dy !== 0 : dx !== 0) ? 0.4 : 0;
        const custo = g[i] + 1 + curva;
        if (custo < g[j]) {
          g[j] = custo;
          veio[j] = i;
          empurra(j, custo + h(j));
        }
      });
    }
    if (ini !== fim && veio[fim] === -1) return null;
    const celulas = [];
    for (let i = fim; i !== -1; i = veio[i]) {
      celulas.push(i);
      if (i === ini) break;
    }
    celulas.reverse();
    const pontos = celulas.map((i) => ({ x: (i % cw) * CEL + CEL / 2, y: Math.floor(i / cw) * CEL + CEL / 2 }));
    const cantos = [];
    pontos.forEach((p, k) => {
      const ant = pontos[k - 1];
      const prox = pontos[k + 1];
      if (!ant || !prox || (ant.x === p.x) !== (p.x === prox.x)) cantos.push(p);
    });
    return cantos;
  }

  /* Peso de cada área por estado. Lugar é ambientação, mas a cena não pode
     desmentir o estado: quem trabalha vai mais à mesa; quem encerrou ou
     ficou órfão nunca volta a ela. */
  const PESOS = {
    trabalhando: { mesa: 0.7, cafe: 0.15, estar: 0.15 },
    delegando: { mesa: 0.65, cafe: 0.15, estar: 0.2 },
    aguardando: { mesa: 0.3, cafe: 0.3, estar: 0.4 },
    concluida: { cafe: 0.4, estar: 0.6 },
    orfa: { cafe: 0.3, estar: 0.7 },
  };
  /* Vitrine, opt-in com `foco=mesa` na URL (a cena showcase, para gravar
     vídeo): quem trabalha ou delega só escolhe mesa, para o quadro nunca
     mostrar "delegando" sentado no sofá. Fora disso nada muda: o uso normal
     segue com PESOS acima, em que lugar é ambientação. Só vale para quem
     trabalha ou delega; aguardando, encerrada e órfã circulam como sempre. */
  const PESOS_MESA = { trabalhando: { mesa: 1 }, delegando: { mesa: 1 } };
  let focoMesa = false;
  const pesosDe = (status) => (focoMesa && PESOS_MESA[status]) || PESOS[status] || PESOS.aguardando;

  function sortearZona(status, sorteio) {
    const pesos = pesosDe(status);
    let s = sorteio * Object.values(pesos).reduce((a, b) => a + b, 0);
    for (const [zona, peso] of Object.entries(pesos)) {
      s -= peso;
      if (s <= 0) return zona;
    }
    return Object.keys(pesos).pop();
  }

  /* Uma vaga livre para o status: tenta a área sorteada, depois as outras
     permitidas, em ordem de peso. Nunca devolve a vaga atual. */
  function escolherVaga(plano, status, ocupadas, sorteio, atual) {
    const pesos = pesosDe(status);
    const primeira = sortearZona(status, sorteio);
    const ordem = [primeira, ...Object.keys(pesos).filter((z) => z !== primeira).sort((a, b) => pesos[b] - pesos[a])];
    for (const zona of ordem) {
      const livres = plano.vagas.filter((v) => v.zona === zona && !ocupadas.has(v.id) && v.id !== atual);
      if (livres.length) return livres[Math.floor(((sorteio * 7919) % 1) * livres.length)];
    }
    return null;
  }

  /* Do payload da API para a lista de salas da cena: só salas com alguém,
     ordem estável por nome, "Sem projeto" por último (mesma regra do
     Escritório vetorial). */
  function prepararSalas(dados) {
    const salas = (dados.salas || [])
      .filter((s) => (s.execucoes || []).length)
      .map((s) => ({
        chave: s.chave,
        nome: s.nome,
        projeto_id: s.projeto_id,
        cwd: s.cwd,
        execucoes: s.execucoes,
        ativos: Number.isInteger(s.ativos) ? s.ativos : s.execucoes.filter((e) => ATIVOS.includes(e.status)).length,
      }));
    salas.sort((a, b) => {
      if (!a.projeto_id !== !b.projeto_id) return a.projeto_id ? -1 : 1;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
    return salas;
  }

  /* -------------------------------------------------------- pintura */

  function criarPintor() {
    const camadas = [];
    return {
      r(x, y, w, h, cor) {
        if (w <= 0 || h <= 0) return;
        const ultima = camadas[camadas.length - 1];
        const camada = ultima && ultima.cor === cor ? ultima : { cor, partes: [] };
        if (camada !== ultima) camadas.push(camada);
        camada.partes.push(`M${x} ${y}h${w}v${h}h-${w}z`);
      },
      saida: () => camadas.map((c) => ({ cor: c.cor, d: c.partes.join('') })),
    };
  }

  const LIVROS = ['#7D36EC', '#E0409A', '#4F7BD9', '#2FA36B', '#D99A2B', '#A469FF', '#6B6B75', '#B347D0'];

  function pintarSala(plano) {
    const p = criarPintor();
    const r = p.r;
    const { W, H } = plano;

    // cabeçalho (o texto é vetor, por cima)
    r(0, 0, W, 16, '#111017');
    r(0, 15, W, 1, '#26232F');

    // pisos: tábuas no trabalho e na sala de estar, xadrez no café
    [X.trabalho, X.estar].forEach(([x0, x1]) => {
      r(x0, Y_PISO, x1 - x0, H - Y_PISO, '#262030');
      for (let y = Y_PISO + 5; y < H; y += 5) r(x0, y, x1 - x0, 1, '#201A28');
      for (let y = Y_PISO, k = 0; y < H; y += 5, k += 1) {
        for (let x = x0 + ((k * 13) % 31); x < x1; x += 31) r(x, y + 1, 1, 4, '#201A28');
      }
    });
    r(X.cafe[0], Y_PISO, X.cafe[1] - X.cafe[0], H - Y_PISO, '#26222F');
    for (let y = Y_PISO; y < H; y += 6) {
      for (let x = X.cafe[0] + (((y - Y_PISO) / 6) % 2) * 6; x < X.cafe[1]; x += 12) {
        r(x, y, Math.min(6, X.cafe[1] - x), Math.min(6, H - y), '#2E2939');
      }
    }
    // tapete da sala de estar
    r(204, Y_PISO + 4, W - 207, H - Y_PISO - 10, '#3A2D5C');
    r(205, Y_PISO + 5, W - 209, H - Y_PISO - 12, '#2A2142');
    for (let y = Y_PISO + 8; y < H - 8; y += 4) {
      for (let x = 208 + (y % 8 === 0 ? 2 : 0); x < W - 5; x += 4) r(x, y, 1, 1, '#33284F');
    }
    r(2, Y_PISO, W - 4, 1, '#0F0E14'); // sombra da parede no piso

    // parede do fundo, com neon roxo e rodapé
    r(0, 16, W, 1, '#3A3550');
    r(0, 17, W, 12, '#1F1C29');
    r(0, 29, W, 1, '#1A1823');
    r(0, 30, W, 1, '#7D36EC');
    r(0, 31, W, 1, '#100F15');

    // trabalho: quadro branco, estante, relógio
    r(9, 18, 40, 11, '#0D0C12');
    r(10, 19, 38, 9, '#E6E3F0');
    r(13, 21, 12, 1, '#7D36EC');
    r(13, 23, 18, 1, '#4F7BD9');
    r(13, 25, 9, 1, '#E0409A');
    r(34, 21, 8, 5, '#C9C3DA');
    r(10, 28, 38, 1, '#8F8A9E');
    [[20, 56], [26, 56]].forEach(([prateleira, x0]) => {
      let x = x0;
      let i = prateleira;
      while (x < x0 + 30) {
        const larg = 2 + (i % 2);
        const alt = 3 + ((i * 7) % 2);
        r(x, prateleira - alt, larg, alt, LIVROS[i % LIVROS.length]);
        x += larg + (i % 3 === 0 ? 1 : 0);
        i += 3;
      }
      r(x0 - 1, prateleira, 32, 1, '#4A4459');
    });
    r(104, 18, 5, 1, '#0D0C12');
    r(103, 19, 7, 5, '#0D0C12');
    r(104, 24, 5, 1, '#0D0C12');
    r(104, 19, 5, 5, '#E6E3F0');
    r(106, 20, 1, 3, '#0D0C12');
    r(107, 22, 1, 1, '#0D0C12');

    // café: armário alto, balcão com cafeteira, micro-ondas, geladeira
    r(136, 18, 46, 7, '#0D0C12');
    r(137, 18, 44, 6, '#3A3448');
    for (let x = 147; x < 181; x += 11) r(x, 18, 1, 6, '#2A2633');
    r(136, Y_PISO - 1, 47, 14, '#0D0C12');
    r(137, Y_PISO, 45, 8, '#4A4458');
    r(137, Y_PISO, 45, 1, '#5E576E');
    r(137, Y_PISO + 8, 45, 4, '#2E2A3B');
    r(141, 25, 9, 12, '#0D0C12');
    r(142, 26, 7, 10, '#3B3648');
    r(143, 28, 5, 2, '#D99A2B');
    r(144, 33, 3, 2, '#EAEAF0');
    r(156, 35, 2, 2, '#EAEAF0');
    r(159, 35, 2, 2, '#E0409A');
    r(166, 27, 14, 10, '#0D0C12');
    r(167, 28, 12, 8, '#2E2A3B');
    r(168, 29, 8, 6, '#14131A');
    r(177, 30, 1, 3, '#2FA36B');
    r(183, 21, 13, 25, '#0D0C12');
    r(184, 22, 11, 23, '#C9C6D6');
    r(184, 22, 11, 1, '#E6E3F0');
    r(184, 31, 11, 1, '#8F8A9E');
    r(193, 25, 1, 4, '#5A5A66');
    r(193, 34, 1, 5, '#5A5A66');

    // sala de estar: janela com a cidade à noite
    const wx = 222;
    r(wx - 1, 17, 82, 13, '#0D0C12');
    r(wx, 18, 80, 11, '#3A3448');
    ['#1D1440', '#26194F', '#31205E', '#40256A', '#552A72', '#6E2D74', '#7E3075', '#8E3576', '#9C3A78'].forEach((cor, i) => r(wx + 1, 19 + i, 78, 1, cor));
    r(wx + 60, 20, 3, 3, '#F3E9C6');
    const alturas = [4, 7, 3, 6, 8, 4, 6, 3, 5, 7, 4, 6, 3, 8, 5, 4, 6, 3, 7, 5, 4, 6, 8, 3, 5, 6];
    alturas.forEach((a, i) => r(wx + 1 + i * 3, 28 - a, 3, a, '#0E0B1A'));
    for (let i = 0; i < alturas.length; i += 1) {
      if (alturas[i] > 4 && i % 2 === 0) r(wx + 2 + i * 3, 28 - alturas[i] + 2, 1, 1, i % 4 === 0 ? '#F5C66B' : '#A469FF');
    }
    r(wx + 40, 19, 1, 9, '#3A3448');
    r(wx - 1, 29, 82, 1, '#4A4459');

    // divisórias com passagens
    [X.div1, X.div2].forEach(([x0, x1]) => {
      let y = Y_PISO;
      const trecho = (a, b) => {
        r(x0, a, x1 - x0, b - a, '#2E2A3B');
        r(x0, a, 1, b - a, '#3A3550');
        r(x0, b - 1, x1 - x0, 1, '#4A4459');
      };
      plano.passagens.forEach(([p0, p1]) => {
        trecho(y, p0);
        y = p1;
      });
      trecho(y, H - 3);
    });

    // paredes laterais e de baixo
    r(0, 16, 2, H - 16, '#2E2A3B');
    r(W - 2, 16, 2, H - 16, '#2E2A3B');
    r(0, H - 3, W, 3, '#2E2A3B');
    r(0, H - 3, W, 1, '#3A3550');

    // planta no canto do trabalho
    r(5, H - 9, 7, 5, '#0D0C12');
    r(6, H - 9, 5, 4, '#7A5434');
    r(5, H - 9, 7, 1, '#8F6640');
    r(3, H - 16, 11, 7, '#1F6B42');
    r(4, H - 18, 9, 7, '#2F8F5B');
    r(6, H - 20, 5, 4, '#3FAE6E');
    r(6, H - 15, 1, 2, '#5BC888');

    // móveis
    plano.moveis.forEach((m) => {
      if (m.tipo === 'mesa') {
        const { x: cx, y: yT } = m;
        r(cx - 14, yT - 1, 28, 11, '#0D0C12');
        r(cx - 13, yT, 26, 7, '#3B3648');
        r(cx - 13, yT, 26, 1, '#4D475D');
        r(cx - 13, yT + 7, 26, 2, '#2A2633');
        r(cx - 13, yT + 9, 2, 2, '#1E1B26');
        r(cx + 11, yT + 9, 2, 2, '#1E1B26');
        r(cx - 7, yT - 7, 15, 9, '#0D0C12');
        r(cx - 6, yT - 6, 13, 7, '#2E2A3B');
        r(cx - 5, yT - 5, 11, 5, '#14131A');
        r(cx - 1, yT + 1, 3, 1, '#2E2A3B');
        r(cx - 5, yT + 3, 10, 2, '#1E1B26');
        r(cx - 4, yT + 3, 8, 1, '#2E2A3B');
        r(cx + 7, yT + 3, 2, 2, '#2E2A3B');
        if ((cx + yT) % 3 === 0) {
          r(cx - 11, yT + 2, 2, 2, '#EAEAF0');
          r(cx - 11, yT + 2, 2, 1, '#D99A2B');
        } else {
          r(cx - 11, yT + 1, 3, 4, '#7D36EC');
          r(cx - 10, yT + 1, 1, 4, '#A469FF');
        }
        // cadeira: assento e encosto baixo, por trás de quem senta
        r(cx - 6, yT + 13, 13, 8, '#0D0C12');
        r(cx - 5, yT + 14, 11, 4, '#3A3448');
        r(cx - 5, yT + 14, 11, 1, '#4A4458');
        r(cx - 4, yT + 18, 9, 2, '#2C2838');
        r(cx - 1, yT + 20, 3, 1, '#1E1B26');
      } else if (m.tipo === 'mesinha') {
        const { x, y } = m;
        r(x - 7, y, 15, 8, '#0D0C12');
        r(x - 6, y + 1, 13, 5, '#4A4458');
        r(x - 6, y + 1, 13, 1, '#5E576E');
        r(x - 1, y + 7, 3, 3, '#2A2633');
        r(x - 3, y + 2, 2, 2, '#EAEAF0');
        r(x + 2, y + 2, 2, 2, '#EAEAF0');
        r(x + 2, y + 2, 2, 1, '#D99A2B');
        r(x - 4, y + 16, 9, 5, '#0D0C12');
        r(x - 3, y + 16, 7, 3, '#5A4788');
        r(x - 3, y + 16, 7, 1, '#6E5AA0');
        r(x - 1, y + 19, 3, 2, '#2A2633');
      } else {
        const ya = m.y;
        const sofa = m.tipo === 'sofa';
        r(213, ya - 22, 106, 21, '#0D0C12');
        if (sofa) {
          r(214, ya - 21, 104, 8, '#4C3B74');
          r(214, ya - 21, 104, 1, '#6A55A0');
          r(214, ya - 13, 104, 9, '#3B2D5C');
          ESTAR_X.forEach((x) => {
            r(x - 15, ya - 12, 30, 7, '#5A4788');
            r(x - 15, ya - 12, 30, 1, '#6E5AA0');
          });
          r(214, ya - 4, 104, 2, '#2E2346');
        } else {
          r(213, ya - 22, 106, 21, '#2A2142');
          ESTAR_X.forEach((x) => {
            r(x - 13, ya - 22, 26, 21, '#0D0C12');
            r(x - 12, ya - 21, 24, 7, '#7A3B5E');
            r(x - 12, ya - 21, 24, 1, '#9A5279');
            r(x - 12, ya - 14, 3, 11, '#7A3B5E');
            r(x + 9, ya - 14, 3, 11, '#7A3B5E');
            r(x - 9, ya - 13, 18, 8, '#5E2C48');
            r(x - 9, ya - 13, 18, 1, '#8A4A6D');
            r(x - 12, ya - 3, 24, 2, '#3F1E31');
          });
        }
      }
    });

    return p.saida();
  }

  const logica = {
    P, SW, SH, POSES, ESTILOS, CABECAS, COR_FIXA, CLASSE_VAR, PESOS, X,
    mapaPessoa, aparencia, compilar, planejarSala, criarGrade, rota, sortearZona, escolherVaga,
    prepararSalas, pintarSala, hash,
    definirFocoMesa: (ligado) => { focoMesa = Boolean(ligado); },
  };

  /* ---------------------------------------------------------------- DOM */

  const NS = 'http://www.w3.org/2000/svg';
  const CENA = { largura: 1000, margem: 16 };
  const VELOCIDADE = 26; // pixels de arte por segundo
  const PERMANENCIA = { mesa: [24000, 55000], cafe: [9000, 20000], estar: [14000, 36000] };
  const PLACA_MAX = 99; // unidades: duas placas vizinhas nunca se encostam
  const ROTULOS = { principal: 'Claude principal', advisor: 'Advisor', desconhecido: 'agente desconhecido' };
  const rotulo = (tipo) => ROTULOS[tipo] || tipo || '?';
  const esc = (v) =>
    String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const reduzido = () => raiz.matchMedia && raiz.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FAMILIAS = [
    ['principal', /^principal$/i], ['advisor', /^advisor$/i], ['pesquisa', /^(explore|pesquisador|general-purpose|claude-code-guide)/i],
    ['plano', /^plan$/i], ['revisao', /^(revisor|code-review|simplify)/i],
    ['qa', /^(verificador|diagnostico|security)/i], ['dados', /^analista/i],
    ['conhecimento', /^(curador|radar|entrega)/i],
  ];
  const familiaDe = (tipo) => (FAMILIAS.find(([, pattern]) => pattern.test(String(tipo || ''))) || ['outro'])[0];
  const GLIFOS = {
    principal: '<path class="glifo cheio" d="M0 -4.2 L1.3 -1.3 L4.2 0 L1.3 1.3 L0 4.2 L-1.3 1.3 L-4.2 0 L-1.3 -1.3 Z"/>',
    advisor: '<path class="glifo" d="M-2.2 2.6 Q-4 0.8 -4 -1 A4 4 0 0 1 4 -1 Q4 0.8 2.2 2.6 Z M-1.6 4.4 H1.6"/>',
    pesquisa: '<circle class="glifo" cx="-1.2" cy="-1.2" r="2.7"/><path class="glifo" d="M0.8 0.8 L4 4"/>',
    plano: '<path class="glifo" d="M-4 -3 H4 M-4 0 H2 M-4 3 H3"/>',
    revisao: '<path class="glifo" d="M-4 0.2 L-1.2 3 L4 -3"/>',
    qa: '<path class="glifo" d="M0 -4.4 L3.8 -2.8 V0.4 Q3.8 3.2 0 4.6 Q-3.8 3.2 -3.8 0.4 V-2.8 Z"/>',
    dados: '<path class="glifo" d="M-3.5 4 V0 M0 4 V-4 M3.5 4 V-1.5"/>',
    conhecimento: '<path class="glifo" d="M-4 -3.5 H-0.3 V3.8 H-4 Z M0.3 -3.5 H4 V3.8 H0.3 Z"/>',
  };
  const glifoDe = (tipo) => GLIFOS[familiaDe(tipo)] || `<text class="glifo-letra" y="3.4" text-anchor="middle">${esc(tipo === 'principal' ? 'C' : String(tipo || '?').slice(0, 1).toUpperCase())}</text>`;
  Object.assign(logica, { familiaDe, rotulo });

  function svgEl(nome, atributos, classe) {
    const el = document.createElementNS(NS, nome);
    Object.entries(atributos || {}).forEach(([k, v]) => el.setAttribute(k, v));
    if (classe) el.setAttribute('class', classe);
    return el;
  }

  let svg = null;
  let defs = null;
  let camadaSalas = null;
  let camadaLinks = null;
  let camadaRota = null;
  let obterHistorico = () => ({});
  let trajetoLigado = () => false;
  const salas = new Map();
  const entidades = new Map();
  const links = new Map();
  const simbolos = new Set();
  let raf = null;
  let janelaRaf = null;
  let ultimoQuadro = 0;
  let timerAgenda = null;
  let janelaAgenda = null;

  function montar(container, dados, opcoes) {
    destruir();
    obterHistorico = (opcoes && opcoes.historico) || (() => ({}));
    trajetoLigado = (opcoes && opcoes.trajeto) || (() => false);
    svg = svgEl('svg', { class: 'cena escritorio pixel', viewBox: `0 0 ${CENA.largura} 200`, preserveAspectRatio: 'xMidYMin meet', role: 'img', 'aria-label': 'Escritório dos agentes' });
    defs = svgEl('defs');
    svg.appendChild(defs);
    camadaSalas = svgEl('g', {}, 'camada-salas');
    camadaRota = svgEl('g', {}, 'camada-rota');
    camadaLinks = svgEl('g', {}, 'camada-links');
    svg.appendChild(camadaSalas);
    svg.appendChild(camadaRota);
    svg.appendChild(camadaLinks);
    container.innerHTML = '';
    container.appendChild(svg);
    svg.addEventListener('mouseover', aoPassarMouse);
    svg.addEventListener('mouseout', aoSairMouse);
    ligarAgenda();
    focoMesa = Boolean(raiz.location && /[?&]foco=mesa(&|$)/.test(raiz.location.hash || ''));
    atualizar(dados);
  }

  function destruir() {
    desligarAgenda();
    cancelarQuadro();
    salas.clear();
    entidades.clear();
    links.clear();
    simbolos.clear();
    if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
    svg = null;
  }

  const montado = () => Boolean(svg && svg.isConnected);

  /* ----------------------------------------------------------- símbolos */

  function simbolo(estilo, principal, pose, quadro) {
    const id = `pp-${estilo}-${principal ? 1 : 0}-${pose}-${quadro}`;
    if (!simbolos.has(id)) {
      simbolos.add(id);
      const s = svgEl('symbol', { id, viewBox: `0 0 ${SW} ${SH}` });
      compilar(mapaPessoa(pose, quadro, estilo, principal)).forEach((c) => {
        const path = svgEl('path', { d: c.d });
        if (c.classe) path.setAttribute('class', c.classe);
        else path.setAttribute('fill', c.cor);
        s.appendChild(path);
      });
      defs.appendChild(s);
    }
    return `#${id}`;
  }

  /* ---------------------------------------------------------- atualizar */

  function atualizar(dados) {
    if (!montado()) return;
    const lista = prepararSalas(dados);
    const presentes = new Set(lista.map((s) => s.chave));
    let y = CENA.margem;

    lista.forEach((info) => {
      const plano = planejarSala({ ativos: info.ativos, total: info.execucoes.length }, CENA.largura - CENA.margem * 2);
      const pos = { x: CENA.margem + 1, y };
      let sala = salas.get(info.chave);
      if (!sala) {
        sala = criarSala(info, plano, pos);
        salas.set(info.chave, sala);
      } else {
        sala.dados = info;
        if (sala.plano.assinatura !== plano.assinatura) redesenharSala(sala, plano);
        if (sala.y !== pos.y) moverSala(sala, pos);
      }
      y += plano.altura + CENA.margem;
    });

    salas.forEach((sala, chave) => {
      if (presentes.has(chave)) return;
      entidades.forEach((ent, id) => {
        if (ent.sala === chave) entidades.delete(id);
      });
      sala.el.classList.add('sumindo');
      setTimeout(() => sala.el.remove(), 900);
      salas.delete(chave);
    });

    svg.setAttribute('viewBox', `0 0 ${CENA.largura} ${Math.max(200, y)}`);

    // pessoas: diferença por id. Quem está na tela e continua no payload só
    // muda de estado; quem é novo surge num lugar; quem saiu do payload (o
    // prazo de convivência venceu) some devagar onde estiver.
    const vistos = new Set();
    lista.forEach((info) => {
      info.execucoes.forEach((e) => {
        vistos.add(e.id);
        const ent = entidades.get(e.id);
        if (!ent) criarPessoa(e, info.chave);
        else if (!ent.sumindo) mudarEstado(ent, e);
      });
    });
    entidades.forEach((ent, id) => {
      if (!vistos.has(id) && !ent.sumindo) sumir(ent);
    });

    salas.forEach((sala) => {
      atualizarCabecalho(sala);
      atualizarMonitores(sala);
    });
    atualizarLinks();
  }

  /* --------------------------------------------------------------- salas */

  function criarSala(info, plano, pos) {
    const el = svgEl('g', { transform: `translate(${pos.x},${pos.y})` }, 'sala-escritorio pp-sala nascendo');
    const estatico = svgEl('g', {}, 'estatico');
    const gente = svgEl('g', {}, 'gente');
    el.appendChild(estatico);
    el.appendChild(gente);
    camadaSalas.appendChild(el);
    const sala = { chave: info.chave, el, estatico, gente, plano, grade: null, x: pos.x, y: pos.y, dados: info, telas: new Map() };
    redesenharSala(sala, plano);
    setTimeout(() => el.classList.remove('nascendo'), 40);
    return sala;
  }

  function redesenharSala(sala, plano) {
    sala.plano = plano;
    sala.grade = criarGrade(plano);
    const g = sala.estatico;
    g.innerHTML = '';
    const arte = svgEl('g', { transform: `scale(${P})` }, 'pp-arte');
    pintarSala(plano).forEach((c) => arte.appendChild(svgEl('path', { d: c.d, fill: c.cor })));
    g.appendChild(arte);

    g.appendChild(svgEl('rect', { x: 12, y: 15, width: 6, height: 6 }, 'led'));
    const titulo = svgEl('text', { x: 27, y: 22 }, 'sala-nome');
    titulo.setAttribute('data-papel', 'titulo');
    g.appendChild(titulo);
    const sub = svgEl('text', { x: 27, y: 37 }, 'sala-sub');
    sub.setAttribute('data-papel', 'sub');
    g.appendChild(sub);
    const resumo = svgEl('text', { x: plano.largura - 12, y: 22, 'text-anchor': 'end' }, 'sala-sub direita');
    resumo.setAttribute('data-papel', 'resumo');
    g.appendChild(resumo);
    [['Estações de trabalho', X.trabalho[0] + 16], ['Café', X.cafe[0] + 3], ['Sala de estar', X.estar[0] + 3]].forEach(([texto, x]) => {
      g.appendChild(svgEl('text', { x: x * P, y: plano.altura - 15 }, 'pp-area')).textContent = texto;
    });

    // telas dos monitores: vetor alinhado à grade, acende com quem digita
    sala.telas = new Map();
    plano.moveis.filter((m) => m.tipo === 'mesa').forEach((m) => {
      const tela = svgEl('g', { transform: `translate(${m.x * P},${m.y * P})` }, 'pp-tela');
      tela.appendChild(svgEl('rect', { x: -36, y: 0, width: 75, height: 21 }, 'pp-luz'));
      tela.appendChild(svgEl('rect', { x: -15, y: -15, width: 33, height: 15 }, 'pp-vidro'));
      tela.appendChild(svgEl('rect', { x: -12, y: -12, width: 15, height: 3 }, 'pp-linha l1'));
      tela.appendChild(svgEl('rect', { x: -12, y: -6, width: 21, height: 3 }, 'pp-linha l2'));
      g.appendChild(tela);
      sala.telas.set(m.id, tela);
    });
    g.appendChild(svgEl('rect', { x: 0.5, y: 0.5, width: plano.largura - 1, height: plano.altura - 1 }, 'parede pp-contorno'));

    // quem tinha vaga que não existe mais na planta nova procura outra
    entidades.forEach((ent) => {
      if (ent.sala === sala.chave && ent.vaga && !plano.vagas.some((v) => v.id === ent.vaga.id)) {
        ent.vaga = null;
        ent.proxima = 0;
      }
    });
    atualizarCabecalho(sala);
  }

  function moverSala(sala, pos) {
    // a sala de baixo desliza quando a de cima cresce; sem tween próprio,
    // em degraus de transição CSS
    sala.x = pos.x;
    sala.y = pos.y;
    sala.el.setAttribute('transform', `translate(${pos.x},${pos.y})`);
  }

  function atualizarCabecalho(sala) {
    const info = sala.dados;
    const titulo = sala.estatico.querySelector('[data-papel="titulo"]');
    if (!titulo) return;
    titulo.textContent = info.nome;
    const n = { trabalhando: 0, delegando: 0, aguardando: 0, concluida: 0, orfa: 0 };
    entidades.forEach((ent) => {
      if (ent.sala === sala.chave && !ent.sumindo && n[ent.status] !== undefined) n[ent.status] += 1;
    });
    const partes = [
      n.trabalhando && `${n.trabalhando} trabalhando`,
      n.delegando && `${n.delegando} delegando`,
      n.aguardando && `${n.aguardando} aguardando`,
      n.orfa && `${n.orfa} órfã(s)`,
      n.concluida && `${n.concluida} encerrada(s) · até 12 h`,
    ].filter(Boolean);
    sala.estatico.querySelector('[data-papel="resumo"]').textContent = partes.join(' · ') || 'sala vazia';
    const ativos = n.trabalhando + n.delegando + n.aguardando;
    sala.el.classList.toggle('ativa', n.trabalhando + n.delegando > 0);
    sala.el.classList.toggle('vazia', ativos === 0);
    sala.estatico.querySelector('[data-papel="sub"]').textContent =
      info.cwd || (ativos ? `${ativos} execução(ões) ativa(s)` : 'nenhuma execução ativa');
  }

  function atualizarMonitores(sala) {
    const digitando = new Set();
    entidades.forEach((ent) => {
      if (ent.sala === sala.chave && ent.vaga && ent.vaga.tipo === 'mesa' && !ent.rota && digita(ent)) digitando.add(ent.vaga.id);
    });
    sala.telas.forEach((tela, id) => tela.classList.toggle('ligada', digitando.has(id)));
  }

  /* ------------------------------------------------------------ pessoas */

  const digita = (ent) => ent.status === 'trabalhando' || ent.status === 'delegando';
  const sorteio = () => Math.random();
  const entre = ([a, b]) => a + Math.random() * (b - a);

  function tempoDe(e) {
    const formatar = (seg) => {
      const s = Math.max(0, Number(seg) || 0);
      if (s < 60) return `${s} s`;
      const m = Math.floor(s / 60);
      return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
    };
    if (e.status === 'concluida') return `encerrou há ${formatar(e.desde_segundos)}`;
    // o backend grava como último evento da órfã o instante em que a morte
    // foi percebida, não o último sinal real: dizer "sem sinal há" mentiria
    if (e.status === 'orfa') return `detectada há ${formatar(e.desde_segundos)}`;
    return formatar(e.duracao_segundos);
  }

  function ocupadas(chaveSala, exceto) {
    const set = new Set();
    entidades.forEach((ent) => {
      if (ent.sala === chaveSala && ent.vaga && ent !== exceto && !ent.sumindo) set.add(ent.vaga.id);
    });
    return set;
  }

  function criarPessoa(e, chaveSala) {
    const sala = salas.get(chaveSala);
    if (!sala) return;
    const ap = aparencia(e);
    const familia = familiaDe(e.tipo_agente);
    const el = svgEl('g', {
      'data-id': e.id,
      'data-acao': 'detalhe-execucao',
      tabindex: '0',
      role: 'button',
      style: `--pele:${ap.pele[0]};--pele-s:${ap.pele[1]};--cabelo:${ap.cabelo[0]};--cabelo-s:${ap.cabelo[1]};--camisa:${ap.camisa[0]};--camisa-s:${ap.camisa[1]};--calca:${ap.calca}`,
    }, `personagem avatar pessoa ${e.status} familia-${familia} surgindo`);
    el.appendChild(svgEl('rect', { x: -15, y: -3, width: 30, height: 4 }, 'pp-sombra'));
    const virar = svgEl('g', {}, 'virar');
    const q0 = svgEl('use', { x: -SW * P / 2, y: -SH * P, width: SW * P, height: SH * P }, 'pp-q0');
    const q1 = svgEl('use', { x: -SW * P / 2, y: -SH * P, width: SW * P, height: SH * P }, 'pp-q1');
    virar.appendChild(q0);
    virar.appendChild(q1);
    el.appendChild(virar);

    // marcador do estado sobre a cabeça: losango; vazio quando encerrada
    const marca = svgEl('g', { transform: 'translate(0,-78)' }, 'pp-marca');
    marca.appendChild(svgEl('path', { d: 'M0 -12 L12 0 L0 12 L-12 0 Z' }, 'pp-marca-borda'));
    marca.appendChild(svgEl('path', { d: 'M0 -7.5 L7.5 0 L0 7.5 L-7.5 0 Z' }, 'pp-marca-miolo'));
    el.appendChild(marca);
    const alerta = svgEl('g', { transform: 'translate(-9,-96)' }, 'pp-alerta');
    alerta.appendChild(svgEl('rect', { x: 0, y: 0, width: 18, height: 21 }, 'pp-balao-borda'));
    alerta.appendChild(svgEl('rect', { x: 3, y: 3, width: 12, height: 15 }, 'pp-balao'));
    alerta.appendChild(svgEl('rect', { x: 6, y: 21, width: 6, height: 3 }, 'pp-balao-borda'));
    alerta.appendChild(svgEl('rect', { x: 7.5, y: 5, width: 3, height: 7 }, 'pp-exclamacao'));
    alerta.appendChild(svgEl('rect', { x: 7.5, y: 13.5, width: 3, height: 3 }, 'pp-exclamacao'));
    el.appendChild(alerta);

    const placa = svgEl('g', { transform: 'translate(0,4)' }, 'pp-placa');
    placa.appendChild(svgEl('rect', { x: -40, y: 0, width: 80, height: 14 }, 'pp-placa-fundo'));
    const cracha = svgEl('g', { transform: 'translate(-31,7) scale(.78)' }, 'cracha');
    cracha.innerHTML = `<rect class="cracha-fundo" x="-6.5" y="-5.5" width="13" height="11" rx="2"/>${glifoDe(e.tipo_agente)}`;
    placa.appendChild(cracha);
    const nome = svgEl('text', { x: -24, y: 10.5 }, 'nome');
    nome.textContent = rotulo(e.tipo_agente);
    placa.appendChild(nome);
    el.appendChild(placa);
    el.appendChild(svgEl('text', { x: 0, y: 28, 'text-anchor': 'middle' }, 'tempo')).textContent = tempoDe(e);

    const ent = {
      id: e.id, sala: chaveSala, el, virar, q0, q1, ap,
      status: e.status, tipo: e.tipo_agente, pai: e.execucao_pai_id || null,
      x: 0, y: 0, vaga: null, rota: null, pose: null, dir: 'baixo', proxima: 0, sumindo: false,
    };
    el.setAttribute('aria-label', `${rotulo(e.tipo_agente)}: ${e.status}`);
    sala.gente.appendChild(el);
    ajustarPlaca(ent);

    // surge direto num lugar coerente com o estado, sem entrar por porta
    const vaga = escolherVaga(sala.plano, e.status, ocupadas(chaveSala, ent), sorteio(), null);
    if (vaga) {
      ent.vaga = vaga;
      ent.x = vaga.x;
      ent.y = vaga.y;
    } else {
      ent.x = 150;
      ent.y = sala.plano.H - 12;
    }
    ent.proxima = performance.now() + (e.status === 'orfa' ? Infinity : entre(permanencia(ent)));
    entidades.set(e.id, ent);
    posicionar(ent);
    atualizarPose(ent);
    ordenar(sala);
    setTimeout(() => el.classList.remove('surgindo'), 40);
  }

  /* Nome que não cabe é cortado com "…"; o tooltip e o detalhe têm o nome
     inteiro. Assim duas placas vizinhas nunca se sobrepõem. */
  function ajustarPlaca(ent) {
    const texto = ent.el.querySelector('.pp-placa .nome');
    if (!texto || !texto.getComputedTextLength) return;
    const inteiro = texto.textContent;
    let corte = inteiro.length;
    while (corte > 4 && texto.getComputedTextLength() + 24 > PLACA_MAX) {
      corte -= 1;
      texto.textContent = `${inteiro.slice(0, corte)}…`;
    }
    const largura = Math.ceil((texto.getComputedTextLength() + 24) / P) * P;
    const x0 = -Math.round(largura / 2 / P) * P;
    ent.el.querySelector('.pp-placa-fundo').setAttribute('x', x0);
    ent.el.querySelector('.pp-placa-fundo').setAttribute('width', largura);
    ent.el.querySelector('.pp-placa .cracha').setAttribute('transform', `translate(${x0 + 9},7) scale(.78)`);
    texto.setAttribute('x', x0 + 17);
  }

  function mudarEstado(ent, e) {
    const antes = ent.status;
    ent.status = e.status;
    ent.pai = e.execucao_pai_id || null;
    const classes = ['personagem', 'avatar', 'pessoa', e.status, `familia-${familiaDe(e.tipo_agente)}`];
    if (ent.rota) classes.push('andando');
    ent.el.setAttribute('class', classes.join(' '));
    ent.el.setAttribute('aria-label', `${rotulo(e.tipo_agente)}: ${e.status}`);
    ent.el.querySelector('.tempo').textContent = tempoDe(e);
    if (antes === e.status) return;
    // mudou de estado: decide logo para onde vai. Quem encerrou ou ficou
    // órfão sai da mesa para a convivência; os outros só reconsideram.
    const naConvivencia = ent.vaga && CONVIVENCIA.includes(ent.vaga.zona);
    if (e.status === 'orfa') {
      ent.proxima = naConvivencia ? Infinity : performance.now();
    } else if (e.status === 'concluida') {
      ent.proxima = naConvivencia ? performance.now() + entre(permanencia(ent)) : performance.now();
    } else {
      ent.proxima = Math.min(ent.proxima, performance.now() + entre([600, 2500]));
    }
    atualizarPose(ent);
  }

  function permanencia(ent) {
    const zona = ent.vaga ? ent.vaga.zona : 'estar';
    const base = PERMANENCIA[zona];
    return ent.status === 'concluida' ? [base[0] * 1.6, base[1] * 1.6] : base;
  }

  function sumir(ent) {
    ent.sumindo = true;
    ent.rota = null;
    ent.el.classList.add('sumindo');
    const link = links.get(ent.id);
    if (link) {
      link.remove();
      links.delete(ent.id);
    }
    setTimeout(() => {
      ent.el.remove();
      entidades.delete(ent.id);
      const sala = salas.get(ent.sala);
      if (sala) {
        atualizarCabecalho(sala);
        atualizarMonitores(sala);
      }
    }, 1400);
  }

  function posicionar(ent) {
    ent.el.setAttribute('transform', `translate(${Math.round(ent.x) * P},${Math.round(ent.y) * P})`);
  }

  /* Pose e quadro saem de onde a pessoa está e do estado. */
  function atualizarPose(ent) {
    let pose;
    let anim = '';
    if (ent.rota) {
      pose = ent.dir === 'cima' ? 'andar-costas' : ent.dir === 'baixo' ? 'andar-frente' : 'andar-lado';
      anim = 'anim-andar';
    } else if (ent.vaga && ent.vaga.tipo === 'mesa') {
      pose = digita(ent) ? 'digitar' : 'sentado-costas';
      anim = digita(ent) ? (ent.status === 'delegando' ? 'anim-digitar-lento' : 'anim-digitar') : '';
    } else if (ent.vaga && ent.vaga.tipo === 'banqueta') {
      pose = 'sentado-costas';
    } else if (ent.vaga && ent.vaga.tipo === 'balcao') {
      pose = 'pe-costas';
    } else if (ent.vaga && ent.vaga.tipo === 'sofa') {
      pose = 'sentado-frente';
      anim = 'anim-piscar';
    } else {
      pose = 'pe-frente';
      anim = 'anim-piscar';
    }
    if (ent.status === 'orfa' || ent.status === 'concluida') anim = anim === 'anim-andar' ? anim : '';
    const chave = `${pose}|${anim}|${ent.dir === 'esq' ? 1 : 0}`;
    if (ent.pose === chave) return;
    ent.pose = chave;
    ent.q0.setAttribute('href', simbolo(ent.ap.estilo, ent.ap.principal, pose, 0));
    ent.q1.setAttribute('href', simbolo(ent.ap.estilo, ent.ap.principal, pose, 1));
    ent.virar.setAttribute('transform', ent.rota && ent.dir === 'esq' ? 'scale(-1,1)' : '');
    ['anim-andar', 'anim-digitar', 'anim-digitar-lento', 'anim-piscar'].forEach((c) => ent.el.classList.toggle(c, c === anim));
    ent.el.classList.toggle('andando', Boolean(ent.rota));
  }

  /* Quem está mais embaixo fica na frente. Só reordena o necessário. */
  function ordenar(sala) {
    const lista = [];
    entidades.forEach((ent) => {
      if (ent.sala === sala.chave && ent.el.parentNode === sala.gente) lista.push(ent);
    });
    lista.sort((a, b) => a.y - b.y || a.id - b.id);
    let anterior = null;
    lista.forEach((ent) => {
      const esperado = anterior ? anterior.el.nextSibling : sala.gente.firstChild;
      if (esperado !== ent.el) sala.gente.insertBefore(ent.el, esperado);
      anterior = ent;
    });
  }

  /* ------------------------------------------------------------- agenda */

  /* A cada 0,7 s: quem já ficou o bastante no lugar escolhe outro e anda
     até lá. Com movimento reduzido, ninguém circula: só muda de lugar quando
     o estado obriga (encerrou, ficou órfão), e muda sem andar. */
  function agenda() {
    if (!montado() || svg.ownerDocument.hidden) return;
    const agora = performance.now();
    entidades.forEach((ent) => {
      if (ent.sumindo || ent.rota || agora < ent.proxima) return;
      const sala = salas.get(ent.sala);
      if (!sala) return;
      const naConvivencia = ent.vaga && CONVIVENCIA.includes(ent.vaga.zona);
      if (reduzido() && (naConvivencia || !['concluida', 'orfa'].includes(ent.status))) {
        ent.proxima = agora + 60000;
        return;
      }
      const vaga = escolherVaga(sala.plano, ent.status, ocupadas(ent.sala, ent), sorteio(), ent.vaga && ent.vaga.id);
      if (!vaga) {
        ent.proxima = agora + 5000;
        return;
      }
      irPara(ent, sala, vaga);
    });
  }

  function irPara(ent, sala, vaga) {
    ent.vaga = vaga;
    const de = { x: ent.x, y: ent.y };
    const caminho = rota(sala.grade, de, vaga.acesso) || [vaga.acesso];
    // sai do lugar direto para a célula livre mais perto, anda, e no fim
    // dá o passo curto do corredor até o assento
    const pontos = [...caminho, { x: vaga.x, y: vaga.y }];
    if (reduzido()) {
      ent.x = vaga.x;
      ent.y = vaga.y;
      chegou(ent, sala);
      return;
    }
    ent.rota = pontos;
    atualizarMonitores(sala);
    if (!raf) {
      ultimoQuadro = performance.now();
      pedirQuadro();
    }
  }

  function chegou(ent, sala) {
    ent.rota = null;
    ent.x = ent.vaga ? ent.vaga.x : ent.x;
    ent.y = ent.vaga ? ent.vaga.y : ent.y;
    ent.dir = 'baixo';
    posicionar(ent);
    ent.proxima = ent.status === 'orfa' ? Infinity : performance.now() + entre(permanencia(ent));
    atualizarPose(ent);
    ordenar(sala);
    atualizarMonitores(sala);
  }

  /* A cena pode estar numa janela picture-in-picture: quadros e agenda ficam
     com a janela que a mostra, que segue ativa com a aba principal oculta. */
  const janelaDaCena = () => (svg && svg.ownerDocument.defaultView) || raiz;

  function ligarAgenda() {
    janelaAgenda = janelaDaCena();
    timerAgenda = janelaAgenda.setInterval(agenda, 700);
  }

  function desligarAgenda() {
    try {
      if (timerAgenda) janelaAgenda.clearInterval(timerAgenda);
    } catch (erro) { /* janela já fechada */ }
    timerAgenda = null;
    janelaAgenda = null;
  }

  function pedirQuadro() {
    janelaRaf = janelaDaCena();
    raf = janelaRaf.requestAnimationFrame(tick);
  }

  function cancelarQuadro() {
    try {
      if (raf) janelaRaf.cancelAnimationFrame(raf);
    } catch (erro) { /* janela já fechada */ }
    raf = null;
    janelaRaf = null;
  }

  /* Depois de a cena mudar de janela: um quadro pendente na janela antiga
     nunca mais dispararia e o `if (!raf)` impediria pedir outro. */
  function reancorar() {
    if (!montado()) return;
    desligarAgenda();
    ligarAgenda();
    cancelarQuadro();
    ultimoQuadro = performance.now();
    pedirQuadro();
  }

  function tick() {
    // A origem de tempo do rAF muda entre janelas; performance.now() é a da cena.
    const agora = performance.now();
    const dt = Math.min(0.1, (agora - ultimoQuadro) / 1000);
    ultimoQuadro = agora;
    let alguem = false;
    entidades.forEach((ent) => {
      if (!ent.rota || ent.sumindo) return;
      alguem = true;
      let passo = VELOCIDADE * dt;
      while (passo > 0 && ent.rota && ent.rota.length) {
        const alvo = ent.rota[0];
        const dx = alvo.x - ent.x;
        const dy = alvo.y - ent.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.01) {
          const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'dir' : 'esq') : dy > 0 ? 'baixo' : 'cima';
          if (dir !== ent.dir) {
            ent.dir = dir;
            atualizarPose(ent);
          }
        }
        if (d <= passo) {
          ent.x = alvo.x;
          ent.y = alvo.y;
          passo -= d;
          ent.rota.shift();
        } else {
          ent.x += (dx / d) * passo;
          ent.y += (dy / d) * passo;
          passo = 0;
        }
      }
      posicionar(ent);
      if (ent.rota && !ent.rota.length) {
        const sala = salas.get(ent.sala);
        if (sala) chegou(ent, sala);
        else ent.rota = null;
      }
    });
    atualizarLinks();
    if (alguem) pedirQuadro();
    else raf = janelaRaf = null;
  }

  /* --------------------------------------------------------------- links */

  function atualizarLinks() {
    if (!camadaLinks) return;
    const vivos = new Set();
    entidades.forEach((ent) => {
      if (!ent.pai || ent.sumindo || !ATIVOS.includes(ent.status)) return;
      const pai = entidades.get(ent.pai);
      if (!pai || pai.sala !== ent.sala || pai.sumindo || !ATIVOS.includes(pai.status)) return;
      const sala = salas.get(ent.sala);
      if (!sala) return;
      vivos.add(ent.id);
      let grupo = links.get(ent.id);
      if (!grupo) {
        grupo = svgEl('g', {}, 'laco-grupo');
        grupo.appendChild(svgEl('path', {}, 'laco halo'));
        grupo.appendChild(svgEl('path', {}, 'laco ativo'));
        grupo.appendChild(svgEl('path', {}, 'laco pulso'));
        camadaLinks.appendChild(grupo);
        links.set(ent.id, grupo);
      }
      const ax = sala.x + Math.round(pai.x) * P;
      const ay = sala.y + Math.round(pai.y) * P - 66;
      const bx = sala.x + Math.round(ent.x) * P;
      const by = sala.y + Math.round(ent.y) * P - 66;
      const my = Math.min(ay, by) - 30;
      const d = `M${ax},${ay} Q${(ax + bx) / 2},${my} ${bx},${by}`;
      grupo.querySelectorAll('path').forEach((path) => path.setAttribute('d', d));
    });
    links.forEach((grupo, id) => {
      if (!vivos.has(id)) {
        grupo.remove();
        links.delete(id);
      }
    });
  }

  /* ---------------------------------------------------------------- rota */

  function aoPassarMouse(evento) {
    const alvo = evento.target.closest && evento.target.closest('.pessoa');
    if (!alvo || !trajetoLigado()) return;
    const ent = entidades.get(Number(alvo.getAttribute('data-id')));
    if (ent) mostrarRota(ent.tipo);
  }

  function aoSairMouse(evento) {
    const de = evento.target.closest && evento.target.closest('.pessoa');
    const para = evento.relatedTarget && evento.relatedTarget.closest && evento.relatedTarget.closest('.pessoa');
    if (de && de !== para) limparRota();
  }

  function mostrarRota(tipo) {
    limparRota();
    const chaveDe = (execucao) => execucao.projeto_id
      ? `p${execucao.projeto_id}`
      : `c${String(execucao.cwd || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()}`;
    const historico = ((obterHistorico() || {})[tipo] || []).slice().reverse();
    const chaves = [];
    historico.forEach((h) => {
      const chave = chaveDe(h);
      if (salas.has(chave) && chaves[chaves.length - 1] !== chave) chaves.push(chave);
    });
    chaves.forEach((chave) => salas.get(chave).el.classList.add('na-rota'));
    if (chaves.length < 2) return;
    const pontos = chaves.map((chave) => {
      const s = salas.get(chave);
      return `${s.x + s.plano.largura / 2},${s.y + 30}`;
    });
    camadaRota.appendChild(svgEl('polyline', { points: pontos.join(' '), fill: 'none' }, 'rota'));
    chaves.forEach((chave, i) => {
      const s = salas.get(chave);
      const marca = svgEl('g', { transform: `translate(${s.x + s.plano.largura / 2},${s.y + 30})` }, 'rota-marca');
      marca.appendChild(svgEl('circle', { r: 10 }));
      marca.appendChild(svgEl('text', { y: 3.5, 'text-anchor': 'middle' })).textContent = String(i + 1);
      camadaRota.appendChild(marca);
    });
  }

  function limparRota() {
    if (!camadaRota) return;
    camadaRota.innerHTML = '';
    salas.forEach((s) => s.el.classList.remove('na-rota'));
  }

  /* ------------------------------------------------------------ exportar */

  raiz.EscritorioPixel = { montar, atualizar, destruir, montado, reancorar, logica, _estado: { salas, entidades } };
  if (typeof module !== 'undefined' && module.exports) module.exports = logica;
})(typeof window !== 'undefined' ? window : globalThis);
