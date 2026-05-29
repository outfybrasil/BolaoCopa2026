// =====================================================================
//  STATE & INITIALIZATION — BOLÃO COPA DO MUNDO 2026
// =====================================================================

let supabaseClient = null;
let supabaseUrl = '';
let supabaseKey = '';
let currentUser = null;
let isRegisterMode = false;
let isCloudSyncing = false;
let previouslyLocked = new Set();

// Wrapper seguro para LocalStorage (evita quebras sob restrições corporativas ou protocolo file://)
const safeStorage = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn(`[SafeStorage] Erro ao ler chave "${key}":`, e);
      return null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn(`[SafeStorage] Erro ao salvar chave "${key}":`, e);
    }
  },
  removeItem(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn(`[SafeStorage] Erro ao remover chave "${key}":`, e);
    }
  }
};


let groupSelections = {};   // {A:{first:teamObj, second:teamObj}, ...}
let bracketWinners = {};    // {matchId: teamObj}
let thirdPlaceAssigned = {}; // {R32_7: teamObj, ...}
let apiKey = DEFAULT_API_KEY || '';
let realResults = {};       // Da API ou manual
let scorePredictions = {};  // Placar palp pelo usuário: {matchKey:{home,away}}
let lastApiFetch = 0;

const LS_KEY = 'bolao2026_state';

// =====================================================================
//  IMAGENS E BANDEIRAS COM FALLBACK SEGURO
// =====================================================================
function getTeamFlagHtml(team) {
  if (!team) return '';
  if (team.code) {
    // FlagCDN com fallback onerror para emoji de texto nativo offline
    return `<img src="https://flagcdn.com/w40/${team.code}.png" class="country-flag-img" alt="${team.name}" onerror="this.outerHTML='${team.flag || '⬜'}'">`;
  }
  return team.flag || '⬜';
}

function parseEmoji(el) {
  // Twemoji removido para evitar CORS no Edge e bloqueios no TJPR.
  // FlagCDN já realiza renderização HTML rica com imagens retangulares nativas.
}

// =====================================================================
//  LOCAL STORAGE
// =====================================================================
function saveState() {
  try {
    const data = {
      name: document.getElementById('participantName').value,
      groups: {},
      bracket: {},
      apiKey,
      realResults,
      savedAt: Date.now()
    };
    for (const [g, sel] of Object.entries(groupSelections)) {
      data.groups[g] = {
        firstName: sel.first?.name || null,
        secondName: sel.second?.name || null
      };
    }
    for (const [id, team] of Object.entries(bracketWinners)) {
      data.bracket[id] = { name: team.name, flag: team.flag, code: team.code };
    }
    data.scorePredictions = scorePredictions;
    safeStorage.setItem(LS_KEY, JSON.stringify(data));
    syncPredictionsToCloud(); // Salva na nuvem se autenticado
  } catch(e) { console.warn('Erro ao salvar localmente:', e); }
}

function loadState() {
  try {
    const raw = safeStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.name) document.getElementById('participantName').value = data.name;
    if (data.apiKey) apiKey = data.apiKey;
    if (data.realResults) realResults = data.realResults;
    
    // Reconstrói as seleções dos grupos
    if (data.groups) {
      for (const [g, sel] of Object.entries(data.groups)) {
        if (!GROUPS[g]) continue;
        groupSelections[g] = {};
        if (sel && sel.firstName) {
          groupSelections[g].first = GROUPS[g].find(t => t.name === sel.firstName) || null;
        }
        if (sel && sel.secondName) {
          groupSelections[g].second = GROUPS[g].find(t => t.name === sel.secondName) || null;
        }
      }
    }
    // Reconstrói os vencedores do mata-mata
    if (data.bracket) {
      for (const [id, team] of Object.entries(data.bracket)) {
        bracketWinners[id] = team;
      }
    }
    if (data.scorePredictions) {
      scorePredictions = data.scorePredictions;
    }
    showToast('Palpites locais carregados.', 'success');
  } catch(e) { console.warn('Erro ao carregar localmente:', e); }
}

// =====================================================================
//  CONTROLE DE BLOQUEIOS E FUSO HORÁRIO
// =====================================================================
function isGroupLocked(group) {
  const lockTime = GROUP_LOCK_TIMES[group];
  if (!lockTime) return false;
  return Date.now() >= (new Date(lockTime).getTime() - LOCK_OFFSET_MS);
}

function isKnockoutLocked(matchId) {
  const lockTime = KNOCKOUT_LOCK_TIMES[matchId];
  if (!lockTime) return false;
  return Date.now() >= (new Date(lockTime).getTime() - LOCK_OFFSET_MS);
}

function isMatchdayLocked(mdKey) {
  const lockTime = MATCHDAY_LOCK_TIMES[mdKey];
  if (!lockTime) return false;
  return Date.now() >= (new Date(lockTime).getTime() - LOCK_OFFSET_MS);
}

function getCountdown(isoTime) {
  const diff = new Date(isoTime).getTime() - LOCK_OFFSET_MS - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (h > 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  return `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
}

function formatDateBR(isoTime) {
  const d = new Date(isoTime);
  return d.toLocaleDateString('pt-BR', { timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit' })
    + ' ' + d.toLocaleTimeString('pt-BR', { timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' });
}

// =====================================================================
//  LÓGICA AUTOMÁTICA DE 3ºs COLOCADOS (REGRA OFICIAL FIFA)
// =====================================================================
function computeThirdPlace() {
  thirdPlaceAssigned = {};
  const thirds = [];
  for (const [g, teams] of Object.entries(GROUPS)) {
    const sel = groupSelections[g];
    if (!sel || !sel.first || !sel.second) continue;
    
    // Seleções restantes que não foram colocadas em 1º e 2º
    const remaining = teams.filter(t => t.name !== sel.first.name && t.name !== sel.second.name);
    
    // Organiza por melhor ranking FIFA das seleções restantes
    remaining.sort((a,b) => (FIFA_RANK[b.name]||0) - (FIFA_RANK[a.name]||0));
    if (remaining[0]) {
      thirds.push({ ...remaining[0], group: g, rank: FIFA_RANK[remaining[0].name] || 0 });
    }
  }
  
  // Ordena os terceiros de todos os grupos pelo Ranking FIFA (melhores primeiro)
  thirds.sort((a,b) => b.rank - a.rank);
  
  // Define os 8 melhores para ocupar os slots reservados no chaveamento
  const top8 = thirds.slice(0, 8);
  THIRD_PLACE_SLOTS.forEach((slotId, i) => {
    thirdPlaceAssigned[slotId] = top8[i] || null;
  });
}

// =====================================================================
//  RESOLUÇÃO DE TIMES PARA O CHAVEAMENTO
// =====================================================================
function getTeamBySlot(slot) {
  if (slot === '3RD') return null; // Resolvido via computeThirdPlace()
  const pos = slot[0]; // '1' ou '2'
  const grp = slot.substring(1);
  const sel = groupSelections[grp];
  if (!sel) return null;
  if (pos === '1') return sel.first || null;
  if (pos === '2') return sel.second || null;
  return null;
}

function getR32Team(match, slotKey) {
  const slot = match[slotKey];
  if (slot === '3RD') {
    return thirdPlaceAssigned[match.id] || { name:'3º Classificado', flag:'❓' };
  }
  const team = getTeamBySlot(slot);
  if (team) return team;
  return { name: slot, flag:'⬜' };
}

// =====================================================================
//  RENDERIZAÇÃO: FASE DE GRUPOS
// =====================================================================
// =====================================================================
//  CÁLCULO DINÂMICO DA CLASSIFICAÇÃO DOS GRUPOS (DADOS REAIS DA COPA)
// =====================================================================
function computeRealGroupStandings(groupLetter) {
  const teams = GROUPS[groupLetter];
  if (!teams) return {};

  const stats = {};
  teams.forEach(team => {
    stats[team.name] = {
      name: team.name,
      pts: 0,
      j: 0,
      v: 0,
      e: 0,
      d: 0,
      gp: 0,
      gc: 0,
      sg: 0
    };
  });

  // Confrontos do grupo (sistema round-robin de 6 jogos por grupo)
  const pairings = [
    [0, 1], [2, 3], // Rodada 1
    [0, 2], [1, 3], // Rodada 2
    [0, 3], [1, 2]  // Rodada 3
  ];

  pairings.forEach(pair => {
    const tA = teams[pair[0]];
    const tB = teams[pair[1]];
    if (!tA || !tB) return;

    const apiHome = TEAM_API_MAP[tA.name] || tA.name;
    const apiAway = TEAM_API_MAP[tB.name] || tB.name;
    const rKey = `${apiHome}_vs_${apiAway}`;
    const rKeyAlt = `${apiAway}_vs_${apiHome}`;
    const result = realResults[rKey] || realResults[rKeyAlt];

    if (result) {
      // Verifica se o resultado tem gols preenchidos e o status do jogo iniciou ou terminou
      const hasGoals = result.homeGoals !== null && result.homeGoals !== undefined &&
                       result.awayGoals !== null && result.awayGoals !== undefined;
      const started = ['1H', '2H', 'HT', 'FT', 'AET', 'PEN', 'LIVE'].includes(result.status);
      
      if (hasGoals && started) {
        const gHome = parseInt(result.homeGoals, 10);
        const gAway = parseInt(result.awayGoals, 10);
        if (!isNaN(gHome) && !isNaN(gAway)) {
          // Determina a correlação do placar com tA e tB
          let gA, gB;
          if (result.home === apiHome) {
            gA = gHome;
            gB = gAway;
          } else {
            gA = gAway;
            gB = gHome;
          }

          stats[tA.name].j++;
          stats[tB.name].j++;
          stats[tA.name].gp += gA;
          stats[tB.name].gp += gB;
          stats[tA.name].gc += gB;
          stats[tB.name].gc += gA;

          if (gA > gB) {
            stats[tA.name].pts += 3;
            stats[tA.name].v++;
            stats[tB.name].d++;
          } else if (gA < gB) {
            stats[tB.name].pts += 3;
            stats[tB.name].v++;
            stats[tA.name].d++;
          } else {
            stats[tA.name].pts += 1;
            stats[tB.name].pts += 1;
            stats[tA.name].e++;
            stats[tB.name].e++;
          }
        }
      }
    }
  });

  // Calcula o saldo de gols de cada equipe
  teams.forEach(team => {
    stats[team.name].sg = stats[team.name].gp - stats[team.name].gc;
  });

  return stats;
}

// =====================================================================
//  RENDERIZAÇÃO: FASE DE GRUPOS
// =====================================================================
function renderGroups() {
  const grid = document.getElementById('groupsGrid');
  if (!grid) return;
  previouslyLocked = new Set();
  grid.innerHTML = '';
  
  for (const [letter, teams] of Object.entries(GROUPS)) {
    const locked = isGroupLocked(letter);
    const lockTime = GROUP_LOCK_TIMES[letter];
    const countdown = !locked ? getCountdown(lockTime) : null;

    const card = document.createElement('div');
    card.className = 'group-card' + (locked ? ' locked' : '');

    // Cabeçalho do Card de Grupo
    const cdText = (!locked && countdown && !countdown.includes('d')) ? `⏱ ${countdown}` : '';
    card.innerHTML = `<div class="group-header">GRUPO ${letter}${locked ? '<span class="lock-icon">🔒</span>' : ''}<span id="countdown-${letter}" class="countdown">${cdText}</span></div>`;

    // Tabela de classificação esportiva do grupo
    const table = document.createElement('table');
    table.className = 'group-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width: 32px;">Pos</th>
          <th style="text-align: left; padding-left: 8px;">Seleção</th>
          <th>P</th>
          <th>J</th>
          <th>V</th>
          <th>E</th>
          <th>D</th>
          <th>GP</th>
          <th>GC</th>
          <th>SG</th>
        </tr>
      </thead>
    `;
    
    const tbody = document.createElement('tbody');
    
    // Calcula as estatísticas em tempo real
    const realStats = computeRealGroupStandings(letter);
    const sel = groupSelections[letter] || {};
    
    // Ordena as seleções de acordo com a classificação real da Copa
    // Critérios: 1. Pontos reais -> 2. Saldo de Gols real -> 3. Gols Pró real -> 4. Ranking FIFA (coerência inicial consistente)
    const orderedTeams = [...teams].sort((a, b) => {
      const statsA = realStats[a.name];
      const statsB = realStats[b.name];
      
      if (statsB.pts !== statsA.pts) {
        return statsB.pts - statsA.pts;
      }
      if (statsB.sg !== statsA.sg) {
        return statsB.sg - statsA.sg;
      }
      if (statsB.gp !== statsA.gp) {
        return statsB.gp - statsA.gp;
      }
      return (FIFA_RANK[b.name] || 0) - (FIFA_RANK[a.name] || 0);
    });

    // Renderiza cada linha da tabela
    orderedTeams.forEach((team, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'group-row-team';
      
      const isFirst = sel.first && sel.first.name === team.name;
      const isSecond = sel.second && sel.second.name === team.name;
      
      if (isFirst) tr.classList.add('first');
      else if (isSecond) tr.classList.add('second');
      
      const stats = realStats[team.name] || { pts:0, j:0, v:0, e:0, d:0, gp:0, gc:0, sg:0 };
      const sg = stats.sg;
      
      tr.innerHTML = `
        <td style="font-weight: 800; color: ${isFirst ? 'var(--gold)' : (isSecond ? '#5da1ff' : 'var(--silver)')};">${idx + 1}</td>
        <td style="text-align: left; padding-left: 8px; font-weight: 600; display: flex; align-items: center; gap: 6px; border: none; height: 38px;">
          <span class="flag">${getTeamFlagHtml(team)}</span>
          <span class="team-name" style="color: ${isFirst || isSecond ? '#ffffff' : '#e2fcd2'}">${team.name}</span>
          ${isFirst ? '<span style="font-size: 1.15em; margin-left: 4px;" title="Seu palpite de 1º colocado">🥇</span>' : ''}
          ${isSecond ? '<span style="font-size: 1.15em; margin-left: 4px;" title="Seu palpite de 2º colocado">🥈</span>' : ''}
        </td>
        <td style="font-weight: 850; color: var(--gold);">${stats.pts}</td>
        <td>${stats.j}</td>
        <td>${stats.v}</td>
        <td>${stats.e}</td>
        <td>${stats.d}</td>
        <td>${stats.gp}</td>
        <td>${stats.gc}</td>
        <td style="font-weight: 800; color: ${sg > 0 ? 'var(--live-green)' : (sg < 0 ? 'var(--red)' : 'var(--silver)')};">${sg > 0 ? '+' + sg : sg}</td>
      `;
      
      if (!locked) {
        const origIdx = GROUPS[letter].findIndex(t => t.name === team.name);
        tr.addEventListener('click', () => toggleGroupTeam(letter, origIdx));
      }
      tbody.appendChild(tr);
    });
    
    table.appendChild(tbody);
    card.appendChild(table);
    grid.appendChild(card);
  }
}

function toggleGroupTeam(group, idx) {
  if (isGroupLocked(group)) return;
  const team = GROUPS[group][idx];
  if (!groupSelections[group]) groupSelections[group] = {};
  const sel = groupSelections[group];

  if (sel.first && sel.first.name === team.name) {
    sel.first = sel.second || null;
    sel.second = null;
  } else if (sel.second && sel.second.name === team.name) {
    sel.second = null;
  } else if (!sel.first) {
    sel.first = team;
  } else if (!sel.second) {
    sel.second = team;
  } else {
    if (!confirm(`O 2º lugar do Grupo ${group} já está ocupado por ${sel.second.name}. Deseja substituir por ${team.name}?`)) return;
    sel.second = team;
  }

  computeThirdPlace();
  renderGroups();
  renderBracket();
  renderSummary();
  saveState();
  showToast('Palpites locais salvos.', 'info');
}

// =====================================================================
//  RENDERIZAÇÃO: CHAVEAMENTO MATA-MATA (BRACKET)
// =====================================================================
function renderBracket() {
  computeThirdPlace();
  const view = document.getElementById('bracketView');
  if (!view) return;

  const leftR32 = R32_STRUCTURE.slice(0, 8);
  const rightR32 = R32_STRUCTURE.slice(8, 16);

  const leftR16 = [
    {id:'R16_1', label:'O1', sources:['R32_1','R32_2']},
    {id:'R16_2', label:'O2', sources:['R32_3','R32_4']},
    {id:'R16_3', label:'O3', sources:['R32_5','R32_6']},
    {id:'R16_4', label:'O4', sources:['R32_7','R32_8']},
  ];
  const rightR16 = [
    {id:'R16_5', label:'O5', sources:['R32_9','R32_10']},
    {id:'R16_6', label:'O6', sources:['R32_11','R32_12']},
    {id:'R16_7', label:'O7', sources:['R32_13','R32_14']},
    {id:'R16_8', label:'O8', sources:['R32_15','R32_16']},
  ];
  const leftQF = [
    {id:'QF_1', label:'Q1', sources:['R16_1','R16_2']},
    {id:'QF_2', label:'Q2', sources:['R16_3','R16_4']},
  ];
  const rightQF = [
    {id:'QF_3', label:'Q3', sources:['R16_5','R16_6']},
    {id:'QF_4', label:'Q4', sources:['R16_7','R16_8']},
  ];
  const leftSF = [{id:'SF_1', label:'SF1', sources:['QF_1','QF_2']}];
  const rightSF = [{id:'SF_2', label:'SF2', sources:['QF_3','QF_4']}];
  const final = [{id:'FINAL', label:'FINAL', sources:['SF_1','SF_2']}];

  function renderMatchBox(match, isR32) {
    let team1, team2;
    if (isR32) {
      team1 = getR32Team(match, 'home');
      team2 = getR32Team(match, 'away');
    } else {
      team1 = bracketWinners[match.sources[0]] || null;
      team2 = bracketWinners[match.sources[1]] || null;
    }
    const winner = bracketWinners[match.id];
    const locked = isKnockoutLocked(match.id);
    const s1c = (winner && team1 && winner.name === team1.name) ? 'winner' : (team1 ? '' : 'empty');
    const s2c = (winner && team2 && winner.name === team2.name) ? 'winner' : (team2 ? '' : 'empty');
    const lockClass = locked ? ' locked-match' : '';
    
    return `<div class="match-box${lockClass}" data-match="${match.id}">
      <div class="match-slot ${s1c}" onclick="pickWinner('${match.id}',0,${isR32})">
        <span class="slot-flag">${team1 ? getTeamFlagHtml(team1) : ''}</span>
        <span>${team1 ? team1.name : 'A definir'}</span>
      </div>
      <div class="match-slot ${s2c}" onclick="pickWinner('${match.id}',1,${isR32})">
        <span class="slot-flag">${team2 ? getTeamFlagHtml(team2) : ''}</span>
        <span>${team2 ? team2.name : 'A definir'}</span>
      </div>
    </div>`;
  }

  function renderRound(matches, title, isR32) {
    let html = `<div class="round"><div class="round-title">${title}</div>`;
    matches.forEach(m => { html += renderMatchBox(m, isR32); });
    html += '</div>';
    return html;
  }

  const champion = bracketWinners['FINAL'];
  let html = '';

  // LADO ESQUERDO DO GRÁFICO
  html += renderRound(leftR32, '16-AVOS (ESQ)', true);
  html += renderRound(leftR16, 'OITAVAS', false);
  html += renderRound(leftQF, 'QUARTAS', false);
  html += renderRound(leftSF, 'SEMIFINAL', false);

  // PALCO CENTRAL DO CAMPEÃO
  html += `<div class="final-col">
    <div class="trophy-box">
      <div class="trophy-emoji">🏆</div>
      <div class="champion-label">Campeão do Mundo</div>
      <div class="champion-name">${champion ? getTeamFlagHtml(champion) + ' ' + champion.name : '???'}</div>
    </div>
    <div style="margin-top:18px;">
      ${renderMatchBox(final[0], false)}
    </div>
  </div>`;

  // LADO DIREITO DO GRÁFICO
  html += renderRound(rightSF, 'SEMIFINAL', false);
  html += renderRound(rightQF, 'QUARTAS', false);
  html += renderRound(rightR16, 'OITAVAS', false);
  html += renderRound(rightR32, '16-AVOS (DIR)', true);

  view.innerHTML = html;
}

function pickWinner(matchId, slotIdx, isR32) {
  if (isKnockoutLocked(matchId)) return;
  let team;
  const match = R32_STRUCTURE.find(m => m.id === matchId);

  if (isR32 && match) {
    team = slotIdx === 0 ? getR32Team(match, 'home') : getR32Team(match, 'away');
  } else {
    const allM = getAllMatches();
    const mDef = allM.find(m => m.id === matchId);
    if (!mDef || !mDef.sources) return;
    team = bracketWinners[mDef.sources[slotIdx]];
  }

  if (!team || team.name === 'A definir' || team.name === '3º Classificado') return;

  if (bracketWinners[matchId] && bracketWinners[matchId].name === team.name) {
    clearDownstream(matchId);
    delete bracketWinners[matchId];
  } else {
    if (bracketWinners[matchId]) clearDownstream(matchId);
    bracketWinners[matchId] = team;
  }

  renderBracket();
  renderSummary();
  saveState();
  showToast('Palpites locais salvos.', 'info');
}

function getAllMatches() {
  return [
    ...R32_STRUCTURE,
    {id:'R16_1', sources:['R32_1','R32_2']},
    {id:'R16_2', sources:['R32_3','R32_4']},
    {id:'R16_3', sources:['R32_5','R32_6']},
    {id:'R16_4', sources:['R32_7','R32_8']},
    {id:'R16_5', sources:['R32_9','R32_10']},
    {id:'R16_6', sources:['R32_11','R32_12']},
    {id:'R16_7', sources:['R32_13','R32_14']},
    {id:'R16_8', sources:['R32_15','R32_16']},
    {id:'QF_1', sources:['R16_1','R16_2']},
    {id:'QF_2', sources:['R16_3','R16_4']},
    {id:'QF_3', sources:['R16_5','R16_6']},
    {id:'QF_4', sources:['R16_7','R16_8']},
    {id:'SF_1', sources:['QF_1','QF_2']},
    {id:'SF_2', sources:['QF_3','QF_4']},
    {id:'FINAL', sources:['SF_1','SF_2']},
  ];
}

function clearDownstream(matchId) {
  getAllMatches().forEach(m => {
    if (m.sources && m.sources.includes(matchId)) {
      if (bracketWinners[m.id]) {
        clearDownstream(m.id);
        delete bracketWinners[m.id];
      }
    }
  });
}



// =====================================================================
//  INTEGRAÇÃO REAL-TIME: API-FOOTBALL
// =====================================================================
function normalizeTeamName(name) {
  return FOOTBALL_DATA_NAME_MAP[name] || name;
}

// ===== Configuração do proxy da API =====
// Em desenvolvimento (node server.js), usa /api/...
// Em produção (Netlify), usa a Function diretamente
function getApiBase() {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return ''; // server.js faz proxy em /api/
  }
  // Em produção, retorna a base da Function
  return '/.netlify/functions/proxy?path=';
}

// ===== Fetch via proxy =====
async function fetchFootballData(url) {
  const apiPath = url.replace('https://api.football-data.org', '');
  const base = getApiBase();

  if (base) {
    const proxyUrl = `${base}v4${apiPath}`;
    const res = await fetch(proxyUrl);
    return res;
  }

  const res = await fetch(`/api${apiPath}`);
  return res;
}

async function fetchResults() {
  if (!apiKey) {
    showToast('Configure uma chave de API nas Configurações ⚙️', 'error');
    return;
  }
  if (Date.now() - lastApiFetch < 300000) {
    showToast('Aguarde 5 minutos entre atualizações.', 'info');
    return;
  }

  const btn = document.getElementById('btnRefreshResults');
  setBtnLoading(btn, true);

  let success = false;

  // 1º tentativa: football-data.org (API gratuita, 10 req/min, 1000 req/mês)
  try {
    const res = await fetchFootballData('https://api.football-data.org/v4/competitions/WC/matches');

    if (res.status === 429) {
      showToast('Limite da API football-data.org atingido. Tente novamente mais tarde.', 'warning');
      setBtnLoading(btn, false);
      return;
    }

    if (res.ok) {
      const data = await res.json();
      if (data.matches && data.matches.length > 0) {
        lastApiFetch = Date.now();
        updateFromFootballData(data.matches);
        showToast(`✅ ${data.matches.length} jogos atualizados via football-data.org!`, 'success');
        success = true;
      } else {
        showToast('Nenhum jogo encontrado na football-data.org para 2026.', 'info');
        success = true;
      }
    }
  } catch(e) {
    console.warn('football-data.org indisponível:', e.message);
    showToast('⚠️ football-data.org: erro de conexão.', 'warning');
  }

  if (success) { setBtnLoading(btn, false); return; }

  // 2º tentativa: API-Football (fallback)
  try {
    const res = await fetch('https://v3.football.api-sports.io/fixtures?league=1&season=2026', {
      headers: { 'x-apisports-key': apiKey }
    });
    if (res.status === 429) {
      showToast('Limite da API-Football atingido.', 'warning');
      setBtnLoading(btn, false);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.response && data.response.length > 0) {
      lastApiFetch = Date.now();
      updateFromAPI(data.response);
      showToast(`✅ ${data.response.length} jogos atualizados via API-Football!`, 'success');
      success = true;
    }
  } catch(e) {
    console.warn('API-Football indisponível:', e.message);
  }

  if (!success) {
    showToast('Nenhuma API respondeu. Verifique sua chave ou tente mais tarde.', 'error');
  }

  setBtnLoading(btn, false);
}

function updateFromFootballData(matches) {
  matches.forEach(m => {
    const rawHome = m.homeTeam?.name || '';
    const rawAway = m.awayTeam?.name || '';
    if (!rawHome || !rawAway) return;

    const homeTeam = normalizeTeamName(rawHome);
    const awayTeam = normalizeTeamName(rawAway);

    const statusMap = { 'SCHEDULED':'NS', 'TIMED':'NS', 'LIVE':'LIVE', 'IN_PLAY':'LIVE', 'PAUSED':'LIVE', 'FINISHED':'FT', 'AWARDED':'FT', 'SUSPENDED':'LIVE', 'POSTPONED':'NS', 'CANCELLED':'NS' };
    const status = statusMap[m.status] || 'NS';

    // football-data.org retorna score.fullTime.home/away apenas quando FINISHED
    // Durante o jogo, usa score.current ou score.live
    const homeGoals = m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? null;
    const awayGoals = m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? null;
    const elapsed = m.minute;

    const key = `${homeTeam}_vs_${awayTeam}`;
    realResults[key] = {
      home: homeTeam,
      away: awayTeam,
      homeGoals,
      awayGoals,
      status,
      date: m.utcDate,
      elapsed: elapsed || undefined
    };
  });
  saveState();
}

function updateFromAPI(fixtures) {
  fixtures.forEach(f => {
    const status = f.fixture?.status?.short || 'NS';
    const homeGoals = f.goals?.home;
    const awayGoals = f.goals?.away;
    const homeTeam = f.teams?.home?.name;
    const awayTeam = f.teams?.away?.name;
    const fixtureDate = f.fixture?.date;
    if (homeTeam && awayTeam) {
      const key = `${homeTeam}_vs_${awayTeam}`;
      realResults[key] = {
        home: homeTeam, away: awayTeam,
        homeGoals, awayGoals,
        status, date: fixtureDate,
        elapsed: f.fixture?.status?.elapsed
      };
    }
  });
  saveState();
  renderResults();
}

// =====================================================================
//  RENDERIZAÇÃO: RESULTADOS DA COPA E CALENDÁRIO
// =====================================================================
function renderResults() {
  const view = document.getElementById('resultsView');
  if (!view) return;

  let html = `<div class="results-header">
    <h3>📺 Jogos da Copa do Mundo 2026</h3>
    <p>Seu palpite × Placar real · 🔴 Ao vivo</p>
  </div>`;

  // ===== INSTRUÇÕES =====
    html += `<div class="matchday-legend">
    <span class="legend-item"><span class="live-dot"></span> Ao Vivo</span>
    <span class="legend-item"><span class="status-dot-finished"></span> Encerrado</span>
    <span class="legend-item"><span class="status-dot-scheduled"></span> Futuro</span>
    <span class="legend-item">🕐 Horário de Brasília</span>
  </div>`;

  // ===== HELP =====
  html += `<div class="no-api-msg" style="margin-bottom:18px;">
    <p style="font-size:.82em;">
      📝 Os campos <strong>"Real"</strong> são para digitar o placar verdadeiro.<br>
      ⏰ O status <strong>Ao Vivo / Encerrado</strong> alterna Automaticamente conforme o horário do jogo.<br>
      🕐 Os horários exibidos são de <strong>Brasília (UTC-3)</strong>.
    </p>
  </div>`;

  // ====================================================================
  //  FASE DE GRUPOS — organizada por Rodada
  // ====================================================================
  for (const [mdKey, matchupIndices] of Object.entries(MATCHDAY_MATCHUP_INDICES)) {
    const mdLocked = isMatchdayLocked(mdKey);
    const mdLabel = MATCHDAY_LABELS[mdKey] || mdKey;
    const mdLockTime = MATCHDAY_LOCK_TIMES[mdKey];
    const mdCountdown = !mdLocked ? getCountdown(mdLockTime) : null;
    const mdStatus = mdLocked ? '🔒 Travado' : (mdCountdown ? `⏱ ${mdCountdown}` : '⚪ Aberto');

    html += `<div class="matchday-card">
      <div class="matchday-header">
        <span class="matchday-title">${mdLabel}</span>
        <span class="matchday-status">${mdStatus}</span>
      </div>`;

    for (const [letter, teams] of Object.entries(GROUPS)) {
      matchupIndices.forEach(i => {
        const matchups = [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
        const pair = matchups[i];
        const t1 = teams[pair[0]];
        const t2 = teams[pair[1]];

        const matchKey = `${letter}_m${i}`;
        const prediction = scorePredictions[matchKey] || {};
        const pHome = prediction.home !== undefined ? prediction.home : '';
        const pAway = prediction.away !== undefined ? prediction.away : '';

        const apiHome = TEAM_API_MAP[t1.name] || t1.name;
        const apiAway = TEAM_API_MAP[t2.name] || t2.name;
        const rKey = `${apiHome}_vs_${apiAway}`;
        const rKeyAlt = `${apiAway}_vs_${apiHome}`;
        const result = realResults[rKey] || realResults[rKeyAlt];

        const predDisabled = mdLocked ? 'disabled' : '';

        // Horário agendado
        const startMs = getMatchStartTimeMs(matchKey);
        const timeLabel = startMs ? formatMatchTime(startMs) : '';
        const now = Date.now();
        const isFuture = startMs && now < startMs;
        const autoLive = startMs && now >= startMs && now < startMs + 2 * 3600000;
        const autoFinished = startMs && now >= startMs + 2 * 3600000;

        // Real score / live state
        const rHome = (result && result.homeGoals !== undefined && result.homeGoals !== null) ? result.homeGoals : '';
        const rAway = (result && result.awayGoals !== undefined && result.awayGoals !== null) ? result.awayGoals : '';
        const rElapsed = (result && result.elapsed) ? result.elapsed : '';
        const isLive = (result && (result.status === 'LIVE' || result.status === '1H' || result.status === '2H' || result.status === 'HT')) || (autoLive && (!result || !result.status));
        const isFinished = (result && (result.status === 'FT' || result.status === 'AET' || result.status === 'PEN')) || (autoFinished && (!result || !result.status));
        const liveClass = (isLive || autoLive) ? ' live' : '';

        html += `<div class="result-card${liveClass}" data-real-key="${rKey}">
          <div class="result-group-badge">Grupo ${letter}</div>
          <div class="result-time">🕐 ${timeLabel}</div>
          <div class="result-teams">
            <span>${getTeamFlagHtml(t1)} ${t1.name}</span>
            <span class="result-vs">vs</span>
            <span>${getTeamFlagHtml(t2)} ${t2.name}</span>
          </div>

          <div class="result-col-pred">
            <div class="result-col-label">Seu palpite</div>
            <div class="result-score">
              <input type="number" min="0" max="20" class="score-input pred-input" data-match-key="${matchKey}" data-side="home" value="${pHome}" ${predDisabled}>
              <span class="score-x">×</span>
              <input type="number" min="0" max="20" class="score-input pred-input" data-match-key="${matchKey}" data-side="away" value="${pAway}" ${predDisabled}>
            </div>
          </div>

          <div class="result-col-real">
            <div class="result-col-label">Placar Real</div>
            <div class="result-score">
              <input type="number" min="0" max="99" class="score-input real-input" data-real-key="${rKey}" data-side="home" value="${rHome}">
              <span class="score-x">×</span>
              <input type="number" min="0" max="99" class="score-input real-input" data-real-key="${rKey}" data-side="away" value="${rAway}">
            </div>
            ${isLive ? `<div class="real-live-row"><span class="live-dot-small"></span> <input type="number" min="0" max="180" class="elapsed-input" data-real-key="${rKey}" value="${rElapsed}" placeholder="min">'</div>` : ''}
          </div>

          <div class="result-col-status">
            ${isFuture ? `<span class="result-status status-scheduled">${timeLabel}</span>` : ''}
            ${isLive ? `<span class="live-dot"></span><span class="result-status status-live">Ao Vivo</span>` : ''}
            ${isFinished ? `<span class="status-dot-finished"></span><span class="result-status status-finished">Encerrado</span>` : ''}
          </div>
        </div>`;
      });
    }
    html += '</div>';
  }

  // ====================================================================
  //  FASE MATA-MATA
  // ====================================================================
  computeThirdPlace();
  const allMatches = getAllMatches();
  if (allMatches.length > 0) {
    const roundTitles = {
      'R32_1':'16-avos','R32_2':'16-avos','R32_3':'16-avos','R32_4':'16-avos',
      'R32_5':'16-avos','R32_6':'16-avos','R32_7':'16-avos','R32_8':'16-avos',
      'R32_9':'16-avos','R32_10':'16-avos','R32_11':'16-avos','R32_12':'16-avos',
      'R32_13':'16-avos','R32_14':'16-avos','R32_15':'16-avos','R32_16':'16-avos',
      'R16_1':'Oitavas','R16_2':'Oitavas','R16_3':'Oitavas','R16_4':'Oitavas',
      'R16_5':'Oitavas','R16_6':'Oitavas','R16_7':'Oitavas','R16_8':'Oitavas',
      'QF_1':'Quartas','QF_2':'Quartas','QF_3':'Quartas','QF_4':'Quartas',
      'SF_1':'Semifinal','SF_2':'Semifinal',
      'FINAL':'Final'
    };

    // Agrupa por fase
    const koGroups = {};
    allMatches.forEach(m => {
      const label = roundTitles[m.id] || 'Mata-mata';
      if (!koGroups[label]) koGroups[label] = [];
      koGroups[label].push(m);
    });

    for (const [phaseLabel, phaseMatches] of Object.entries(koGroups)) {
      html += `<div class="matchday-card">
        <div class="matchday-header"><span class="matchday-title">🏆 ${phaseLabel}</span></div>`;

      phaseMatches.forEach(m => {
        const koLocked = isKnockoutLocked(m.id);
        const isR32 = m.id.startsWith('R32_');

        let team1, team2;
        if (isR32) {
          team1 = getR32Team(m, 'home');
          team2 = getR32Team(m, 'away');
        } else {
          team1 = bracketWinners[m.sources[0]] || null;
          team2 = bracketWinners[m.sources[1]] || null;
        }

        const t1Name = team1 ? team1.name : 'A definir';
        const t2Name = team2 ? team2.name : 'A definir';
        const matchKey = `ko_${m.id}`;
        const prediction = scorePredictions[matchKey] || {};
        const pHome = prediction.home !== undefined ? prediction.home : '';
        const pAway = prediction.away !== undefined ? prediction.away : '';

        const apiHome = team1 ? (TEAM_API_MAP[team1.name] || team1.name) : '';
        const apiAway = team2 ? (TEAM_API_MAP[team2.name] || team2.name) : '';

        // Horário agendado (só exibe se os times forem conhecidos)
        const koStartMs = getMatchStartTimeMs(matchKey);
        const koTimeLabel = koStartMs ? formatMatchTime(koStartMs) : '';
        const koNow = Date.now();
        const koIsFuture = koStartMs && koNow < koStartMs;
        const koAutoLive = koStartMs && koNow >= koStartMs && koNow < koStartMs + 2 * 3600000;
        const koAutoFinished = koStartMs && koNow >= koStartMs + 2 * 3600000;

        let rHome = '', rAway = '', rElapsed = '';
        let isLive = koAutoLive, isFinished = koAutoFinished;
        let rKey = '';
        if (apiHome && apiAway) {
          rKey = `${apiHome}_vs_${apiAway}`;
          const rKeyAlt = `${apiAway}_vs_${apiHome}`;
          const result = realResults[rKey] || realResults[rKeyAlt];
          if (result) {
            rHome = (result.homeGoals !== undefined && result.homeGoals !== null) ? result.homeGoals : '';
            rAway = (result.awayGoals !== undefined && result.awayGoals !== null) ? result.awayGoals : '';
            rElapsed = result.elapsed || '';
            isLive = (result.status === 'LIVE' || result.status === '1H' || result.status === '2H' || result.status === 'HT') || koAutoLive;
            isFinished = (result.status === 'FT' || result.status === 'AET' || result.status === 'PEN') || koAutoFinished;
          }
        }

        const predDisabled = koLocked ? 'disabled' : '';
        const liveClass = isLive ? ' live' : '';

        html += `<div class="result-card${liveClass}" data-real-key="${rKey}">
          <div class="result-group-badge">${phaseLabel}</div>
          ${apiHome && apiAway && koTimeLabel ? `<div class="result-time">🕐 ${koTimeLabel}</div>` : ''}
          <div class="result-teams">
            <span>${team1 ? getTeamFlagHtml(team1) : ''} ${t1Name}</span>
            <span class="result-vs">vs</span>
            <span>${team2 ? getTeamFlagHtml(team2) : ''} ${t2Name}</span>
          </div>

          <div class="result-col-pred">
            <div class="result-col-label">Seu palpite</div>
            <div class="result-score">
              <input type="number" min="0" max="20" class="score-input pred-input" data-match-key="${matchKey}" data-side="home" value="${pHome}" ${predDisabled}>
              <span class="score-x">×</span>
              <input type="number" min="0" max="20" class="score-input pred-input" data-match-key="${matchKey}" data-side="away" value="${pAway}" ${predDisabled}>
            </div>
          </div>

          <div class="result-col-real">
            <div class="result-col-label">Placar Real</div>
            <div class="result-score">
              <input type="number" min="0" max="99" class="score-input real-input" data-real-key="${rKey}" data-side="home" value="${rHome}">
              <span class="score-x">×</span>
              <input type="number" min="0" max="99" class="score-input real-input" data-real-key="${rKey}" data-side="away" value="${rAway}">
            </div>
            ${isLive ? `<div class="real-live-row"><span class="live-dot-small"></span> <input type="number" min="0" max="180" class="elapsed-input" data-real-key="${rKey}" value="${rElapsed}" placeholder="min">'</div>` : ''}
          </div>

          <div class="result-col-status">
            ${koIsFuture && koTimeLabel ? `<span class="result-status status-scheduled">${koTimeLabel}</span>` : ''}
            ${isLive ? `<span class="live-dot"></span><span class="result-status status-live">Ao Vivo</span>` : ''}
            ${isFinished ? `<span class="status-dot-finished"></span><span class="result-status status-finished">Encerrado</span>` : ''}
          </div>
        </div>`;
      });
      html += '</div>';
    }
  }

  if (apiKey) {
    html += `<div style="text-align:center;margin:20px 0;">
      <button class="btn btn-blue" id="btnRefreshResults" onclick="fetchResults()">🔄 Atualizar Resultados</button>
      <p style="font-size:.78em;color:#888;margin-top:8px;">Última atualização: ${lastApiFetch ? new Date(lastApiFetch).toLocaleTimeString('pt-BR') : 'nunca'}</p>
    </div>`;
  }

  view.innerHTML = html;
}

// ===== HANDLER: Palpite do usuário =====
function onScoreInput(e) {
  const input = e.target;
  if (!input.classList.contains('pred-input')) return;

  const matchKey = input.dataset.matchKey;
  const side = input.dataset.side;
  const val = input.value === '' ? undefined : parseInt(input.value, 10);

  if (!scorePredictions[matchKey]) scorePredictions[matchKey] = {};

  if (val === undefined || isNaN(val)) {
    delete scorePredictions[matchKey][side];
  } else {
    scorePredictions[matchKey][side] = val;
  }

  if (Object.keys(scorePredictions[matchKey]).length === 0) {
    delete scorePredictions[matchKey];
  }

  saveState();
}

// ===== HANDLER: Placar real (manual) + minutos decorridos =====
function onRealScoreInput(e) {
  const input = e.target;
  if (!input.classList.contains('real-input') && !input.classList.contains('elapsed-input')) return;
  const rKey = input.dataset.realKey;
  if (!rKey) return;
  if (!realResults[rKey]) realResults[rKey] = {};

  if (input.classList.contains('elapsed-input')) {
    const val = input.value === '' ? null : parseInt(input.value, 10);
    if (val === null || isNaN(val)) {
      delete realResults[rKey].elapsed;
    } else {
      realResults[rKey].elapsed = val;
    }
  } else {
    const side = input.dataset.side;
    const val = input.value === '' ? null : parseInt(input.value, 10);
    if (val === null || isNaN(val)) {
      delete realResults[rKey][side === 'home' ? 'homeGoals' : 'awayGoals'];
    } else {
      realResults[rKey][side === 'home' ? 'homeGoals' : 'awayGoals'] = val;
    }
  }
  if (Object.keys(realResults[rKey]).length === 0) delete realResults[rKey];
  saveState();
}

// ===== Horário agendado de cada jogo =====
function getMatchStartTimeMs(matchKey) {
  // Mata-mata: ko_R32_1, ko_R16_2, ko_QF_1, etc.
  if (matchKey.startsWith('ko_')) {
    const koId = matchKey.slice(3);
    const t = KNOCKOUT_LOCK_TIMES[koId];
    return t ? new Date(t).getTime() : null;
  }
  // Grupos: A_m0 … L_m5
  const m = matchKey.match(/^([A-L])_m(\d)$/);
  if (!m) return null;
  const letter = m[1];
  const idx = parseInt(m[2], 10);
  const t = GROUP_LOCK_TIMES[letter];
  if (!t) return null;
  const base = new Date(t).getTime();
  const dayAdd = idx < 2 ? 0 : idx < 4 ? 4 : 8;
  const hourAdd = idx % 2 === 0 ? 0 : 3;
  return base + dayAdd * 86400000 + hourAdd * 3600000;
}

function formatMatchTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const opts = { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
  return d.toLocaleString('pt-BR', opts);
}

// ===== Reseta status manuais para que o sistema automático assuma =====
function resetManualStatuses() {
  let changed = false;
  for (const rKey of Object.keys(realResults)) {
    const result = realResults[rKey];
    if (result && result.status) {
      delete result.status;
      delete result.elapsed;
      if (Object.keys(result).length === 0) {
        delete realResults[rKey];
      }
      changed = true;
    }
  }
  if (changed) {
    saveState();
    renderResults();
  }
}

// ===== Atualização automática de status LIVE / FT baseada no relógio =====
function autoUpdateMatchStatus() {
  const now = Date.now();
  let changed = false;
  for (const rKey of Object.keys(realResults)) {
    // Mapeia rKey de volta para matchKey
    let matchKey = null;
    for (const [letter, teams] of Object.entries(GROUPS)) {
      for (let i = 0; i < 6; i++) {
        const pair = [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]][i];
        const t1 = teams[pair[0]];
        const t2 = teams[pair[1]];
        const apiHome = TEAM_API_MAP[t1.name] || t1.name;
        const apiAway = TEAM_API_MAP[t2.name] || t2.name;
        if (`${apiHome}_vs_${apiAway}` === rKey || `${apiAway}_vs_${apiHome}` === rKey) {
          matchKey = `${letter}_m${i}`;
          break;
        }
      }
      if (matchKey) break;
    }
    // Se não achou nos grupos, tenta mata-mata
    if (!matchKey && rKey.includes('_vs_')) {
      const [h, a] = rKey.split('_vs_');
      const allMatches = getAllMatches();
      if (allMatches.length) {
        for (const m of allMatches) {
          let t1, t2;
          const isR32 = m.id.startsWith('R32_');
          if (isR32) {
            t1 = getR32Team(m, 'home');
            t2 = getR32Team(m, 'away');
          } else {
            t1 = bracketWinners[m.sources[0]] || null;
            t2 = bracketWinners[m.sources[1]] || null;
          }
          const aH = t1 ? (TEAM_API_MAP[t1.name] || t1.name) : '';
          const aA = t2 ? (TEAM_API_MAP[t2.name] || t2.name) : '';
          if ((aH === h && aA === a) || (aH === a && aA === h)) {
            matchKey = `ko_${m.id}`;
            break;
          }
        }
      }
    }
    const startMs = matchKey ? getMatchStartTimeMs(matchKey) : null;
    if (!startMs) continue;
    const result = realResults[rKey];
    // Só auto-atualiza se o status não foi definido manualmente
    if (!result.status || result.status === 'NS' || result.status === 'SCHEDULED') {
      if (now >= startMs) {
        result.status = 'LIVE';
        if (result.elapsed === undefined || result.elapsed === null) result.elapsed = 0;
        changed = true;
      }
    }
    if (result.status === 'LIVE' || result.status === '1H' || result.status === '2H' || result.status === 'HT') {
      if (now >= startMs + 2 * 3600000) {
        result.status = 'FT';
        result.elapsed = null;
        changed = true;
      }
    }
  }
  if (changed) {
    saveState();
    // Re-renderiza se aba de resultados estiver visível
    const resultsSection = document.getElementById('results');
    if (resultsSection && resultsSection.classList.contains('active')) {
      renderResults();
    }
  }
}

async function testApiConnection() {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key) {
    showToast('Digite uma chave de API primeiro.', 'error');
    return;
  }
  const btn = document.getElementById('btnTestApi');
  setBtnLoading(btn, true);

  let res;
  const base = getApiBase();

  try {
    if (base) {
      res = await fetch(`${base}v4/competitions/WC/matches?limit=1`);
    } else {
      res = await fetch('/api/v4/competitions/WC/matches?limit=1');
    }
    if (!res.ok) throw new Error('Proxy retornou erro ' + res.status);
  } catch(e) {
    // Se falhou, mostra mensagem clara
    let msg;
    if (location.hostname === 'localhost') {
      msg = '❌ Rode node server.js no terminal';
    } else {
      msg = '❌ Configure um proxy externo em getApiBase() no app.js';
    }
    showToast(msg, 'error');
    setBtnLoading(btn, false);
    return;
  }

  try {
    if (res.ok) {
      showToast('✅ football-data.org conectada! Chave válida.', 'success');
    } else if (res.status === 429) {
      showToast('⚠️ Chave válida, mas limite de requisições atingido.', 'warning');
    } else if (res.status === 403) {
      showToast('❌ Chave inválida ou sem acesso à football-data.org.', 'error');
    } else {
      showToast(`❌ Erro HTTP ${res.status}.`, 'error');
    }
  } catch(e) {
    showToast('❌ Não foi possível conectar à football-data.org.', 'error');
  } finally {
    setBtnLoading(btn, false);
  }
}

// =====================================================================
//  RENDERIZAÇÃO: RESULTADOS DA COPA E CALENDÁRIO
// =====================================================================
//  RENDERIZAÇÃO: RESUMO DOS PALPITES (SUMMARY)
// =====================================================================
function renderSummary() {
  const view = document.getElementById('summaryView');
  if (!view) return;
  
  const name = document.getElementById('participantName').value || '(não informado)';
  const champion = bracketWinners['FINAL'];

  let groupsHtml = '';
  for (const [letter] of Object.entries(GROUPS)) {
    const sel = groupSelections[letter] || {};
    const locked = isGroupLocked(letter);
    const lockIcon = locked ? ' 🔒' : '';
    groupsHtml += `<div class="summary-row">
      <span class="label">Grupo ${letter}${lockIcon}</span>
      <span class="value">
        🥇 ${sel.first ? getTeamFlagHtml(sel.first) + ' ' + sel.first.name : '—'} &nbsp;
        🥈 ${sel.second ? getTeamFlagHtml(sel.second) + ' ' + sel.second.name : '—'}
      </span>
    </div>`;
  }

  const sf1 = bracketWinners['SF_1'];
  const sf2 = bracketWinners['SF_2'];

  let thirdHtml = '';
  const assignedThirds = Object.values(thirdPlaceAssigned).filter(Boolean);
  if (assignedThirds.length > 0) {
    thirdHtml = `<div class="summary-card">
      <h3>🥉 3ºs Colocados Classificados (Top 8)</h3>`;
    assignedThirds.forEach((t, i) => {
      thirdHtml += `<div class="summary-row">
        <span class="label">${i+1}º melhor 3º</span>
        <span class="value">${getTeamFlagHtml(t)} ${t.name} (Grupo ${t.group})</span>
      </div>`;
    });
    thirdHtml += '</div>';
  }

  view.innerHTML = `
    <div class="summary-card">
      <h3>👤 Participante</h3>
      <div class="summary-row">
        <span class="label">Nome</span>
        <span class="value">${name}</span>
      </div>
    </div>
    <div class="summary-card">
      <h3>📋 Classificação dos Grupos</h3>
      ${groupsHtml}
    </div>
    ${thirdHtml}
    <div class="summary-card">
      <h3>🏆 Palpites do Mata-Mata</h3>
      <div class="summary-row">
        <span class="label">Semifinalista 1</span>
        <span class="value">${bracketWinners['QF_1'] ? getTeamFlagHtml(bracketWinners['QF_1'])+' '+bracketWinners['QF_1'].name : '—'}</span>
      </div>
      <div class="summary-row">
        <span class="label">Semifinalista 2</span>
        <span class="value">${bracketWinners['QF_2'] ? getTeamFlagHtml(bracketWinners['QF_2'])+' '+bracketWinners['QF_2'].name : '—'}</span>
      </div>
      <div class="summary-row">
        <span class="label">Semifinalista 3</span>
        <span class="value">${bracketWinners['QF_3'] ? getTeamFlagHtml(bracketWinners['QF_3'])+' '+bracketWinners['QF_3'].name : '—'}</span>
      </div>
      <div class="summary-row">
        <span class="label">Semifinalista 4</span>
        <span class="value">${bracketWinners['QF_4'] ? getTeamFlagHtml(bracketWinners['QF_4'])+' '+bracketWinners['QF_4'].name : '—'}</span>
      </div>
      <div class="summary-row">
        <span class="label">Finalista (Esquerda)</span>
        <span class="value">${sf1 ? getTeamFlagHtml(sf1)+' '+sf1.name : '—'}</span>
      </div>
      <div class="summary-row">
        <span class="label">Finalista (Direita)</span>
        <span class="value">${sf2 ? getTeamFlagHtml(sf2)+' '+sf2.name : '—'}</span>
      </div>
      <div class="summary-row" style="border-top:2px solid var(--gold);padding-top:12px;margin-top:8px;">
        <span class="label" style="font-size:1.1em;color:var(--gold);">🏆 CAMPEÃO</span>
        <span class="value" style="font-size:1.2em;color:var(--gold);">${champion ? getTeamFlagHtml(champion)+' '+champion.name : '—'}</span>
      </div>
    </div>`;
}

// =====================================================================
//  GERENCIAMENTO DA INTERFACE E CONTROLES
// =====================================================================
function showSection(id, tab) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  
  const targetSec = document.getElementById(id);
  if (targetSec) targetSec.classList.add('active');
  if (tab) tab.classList.add('active');
  
  if (id === 'groups') renderGroups();
  if (id === 'summary') renderSummary();
  if (id === 'bracket') renderBracket();
  if (id === 'results') { renderResults(); fetchResults(); }
  if (id === 'ranking') renderRanking();
}

function showToast(message, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = message;
  t.className = `toast show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 2500);
}

function setBtnLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Aguarde...';
  } else {
    btn.innerHTML = btn.dataset.originalHtml || btn.innerHTML;
    btn.disabled = false;
  }
}


function openSettings() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;
  document.getElementById('apiKeyInput').value = apiKey;
  document.getElementById('supabaseUrlInput').value = safeStorage.getItem('supabase_url') || '';
  document.getElementById('supabaseKeyInput').value = safeStorage.getItem('supabase_key') || '';
  modal.classList.add('show');
}

function closeSettings() {
  const modal = document.getElementById('settingsModal');
  if (modal) modal.classList.remove('show');
}

function saveSettings() {
  apiKey = document.getElementById('apiKeyInput').value.trim();
  
  const sUrl = document.getElementById('supabaseUrlInput').value.trim();
  const sKey = document.getElementById('supabaseKeyInput').value.trim();
  safeStorage.setItem('supabase_url', sUrl);
  safeStorage.setItem('supabase_key', sKey);
  
  saveState();
  initSupabase(); // Recarrega o cliente do Supabase

  // Se tem chave de API, já busca resultados
  if (apiKey) {
    lastApiFetch = 0; // Reseta o timer para forçar busca imediata
    setTimeout(fetchResults, 500);
  }

  closeSettings();
  showToast('⚙️ Configurações salvas!', 'success');
}

// Funções para exportar e importar palpites em formato JSON
function exportPredictions() {
  try {
    const data = {
      name: document.getElementById('participantName').value,
      groups: {},
      bracket: {},
      scorePredictions,
      savedAt: Date.now()
    };
    for (const [g, sel] of Object.entries(groupSelections)) {
      data.groups[g] = {
        firstName: sel.first?.name || null,
        secondName: sel.second?.name || null
      };
    }
    for (const [id, team] of Object.entries(bracketWinners)) {
      data.bracket[id] = team ? { name: team.name, flag: team.flag, code: team.code } : null;
    }
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bolao_copa_2026_${data.name || 'palpites'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Palpites exportados com sucesso!', 'success');
  } catch(e) {
    console.error('Erro ao exportar:', e);
    showToast('Erro ao exportar palpites.', 'error');
  }
}

function triggerImportPredictions() {
  document.getElementById('importFileInput').click();
}

function importPredictions(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (data.name) document.getElementById('participantName').value = data.name;
      
      // Carrega grupos
      if (data.groups) {
        for (const [g, sel] of Object.entries(data.groups)) {
          if (!GROUPS[g]) continue;
          groupSelections[g] = {};
          if (sel.firstName) {
            groupSelections[g].first = GROUPS[g].find(t => t.name === sel.firstName) || null;
          }
          if (sel.secondName) {
            groupSelections[g].second = GROUPS[g].find(t => t.name === sel.secondName) || null;
          }
        }
      }
      
      // Carrega chaveamento
      if (data.bracket) {
        for (const [id, team] of Object.entries(data.bracket)) {
          if (team) {
            bracketWinners[id] = team;
          } else {
            delete bracketWinners[id];
          }
        }
      }

      // Carrega palpites de placar
      if (data.scorePredictions) {
        scorePredictions = data.scorePredictions;
      }
      
      computeThirdPlace();
      renderGroups();
      renderBracket();
      renderSummary();
      saveState();
      
      showToast('Palpites importados com sucesso!', 'success');
      closeSettings();
    } catch(err) {
      console.error('Erro ao importar:', err);
      showToast('Formato de arquivo inválido.', 'error');
    }
  };
  reader.readAsText(file);
}

// =====================================================================
//  INTEGRAÇÃO SUPABASE CLOUD DATABASE & SEGURANÇA
// =====================================================================
let initSupabaseRetries = 0;
function initSupabase() {
  const localUrl = safeStorage.getItem('supabase_url') || '';
  const localKey = safeStorage.getItem('supabase_key') || '';
  
  supabaseUrl = localUrl || SUPABASE_URL_DEFAULT;
  supabaseKey = localKey || SUPABASE_ANON_KEY_DEFAULT;
  
  const isValid = supabaseUrl && supabaseUrl !== 'SUA_SUPABASE_URL_AQUI' && supabaseKey && supabaseKey !== 'SUA_SUPABASE_ANON_KEY_AQUI';
  
  const tabRanking = document.getElementById('tabRanking');
  const authBtn = document.getElementById('authBtn');
  
  // Exibição padrão sem alterar display inline-flex/flex nativos dos estilos

  
  if (isValid) {
    try {
      if (window.supabase) {
        supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
        setupSupabaseAuthListener();
      } else if (initSupabaseRetries < 10) {
        initSupabaseRetries++;
        setTimeout(initSupabase, 300); // Tenta novamente em 300ms caso a CDN atrase
      } else {
        console.warn('A CDN do Supabase demorou demais para responder.');
      }
    } catch(e) {
      console.warn('Erro ao inicializar cliente Supabase:', e);
      supabaseClient = null;
    }
  } else {
    supabaseClient = null;
  }
}

function setupSupabaseAuthListener() {
  if (!supabaseClient) return;
  
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    const nameInput = document.getElementById('participantName');
    const headerUserStatus = document.getElementById('headerUserStatus');
    
    if (session && session.user) {
      currentUser = session.user;
      
      let username = currentUser.email;
      try {
        const { data, error } = await supabaseClient
          .from('profiles')
          .select('username')
          .eq('id', currentUser.id)
          .single();
        if (data && data.username) {
          username = data.username;
        }
      } catch(err) {
        console.warn('Erro ao ler perfil do Supabase:', err);
      }
      
      // Atualiza o Card de Status no Cabeçalho para Conectado
      if (headerUserStatus) {
        headerUserStatus.innerHTML = `
          <div class="user-status-card" style="border-color: var(--live-green);">
            <div class="status-indicator-row">
              <span class="status-dot online"></span>
              <span class="status-label" style="color:var(--live-green); font-weight: 700;">Conectado</span>
            </div>
            <div class="status-name-row">
              <span class="name-display">${username}</span>
            </div>
            <div class="status-actions">
              <button class="btn btn-red btn-sm" onclick="handleLogout()">Sair</button>
            </div>
          </div>
        `;
      }
      
      if (nameInput) {
        nameInput.value = username;
        nameInput.disabled = true;
      }
      
      await downloadPredictionsFromCloud();
    } else {
      currentUser = null;
      
      // Atualiza o Card de Status no Cabeçalho para Visitante
      if (headerUserStatus) {
        headerUserStatus.innerHTML = `
          <div class="user-status-card">
            <div class="status-indicator-row">
              <span class="status-dot offline"></span>
              <span class="status-label">Visitante</span>
            </div>
            <div class="status-name-row">
              <span class="name-display" style="font-size:0.75em; color:var(--text-secondary); font-weight: 500;">Crie uma conta para salvar seus palpites.</span>
            </div>
            <div class="status-actions">
              <button class="btn btn-gold btn-sm" onclick="openAuthModal()">Entrar</button>
            </div>
          </div>
        `;
      }
      
      if (nameInput) {
        nameInput.disabled = false;
      }
    }
    
    const rankingTab = document.getElementById('ranking');
    if (rankingTab && rankingTab.classList.contains('active')) {
      renderRanking();
    }
  });
}

function openAuthModal() {
  if (currentUser) {
    handleLogout();
    return;
  }
  const modal = document.getElementById('authModal');
  if (modal) {
    modal.classList.add('show');
    toggleAuthMode(false);
  }
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.remove('show');
}

function toggleAuthMode(register) {
  isRegisterMode = register;
  const title = document.getElementById('authModalTitle');
  const userGroup = document.getElementById('usernameGroup');
  const submitBtn = document.getElementById('authSubmitBtn');
  const switchText = document.getElementById('authSwitchText');
  
  if (!title || !userGroup || !submitBtn || !switchText) return;
  
  if (isRegisterMode) {
    title.innerHTML = 'Criar Nova Conta';
    userGroup.style.display = 'block';
    submitBtn.innerHTML = 'Cadastrar';
    switchText.innerHTML = 'Já tem uma conta? <a href="#" onclick="toggleAuthMode(false); event.preventDefault();" style="color:var(--gold); text-decoration:none; font-weight:600;">Faça login aqui</a>';
  } else {
    title.innerHTML = 'Entrar no Bolão';
    userGroup.style.display = 'none';
    submitBtn.innerHTML = 'Entrar';
    switchText.innerHTML = 'Não possui conta? <a href="#" onclick="toggleAuthMode(true); event.preventDefault();" style="color:var(--gold); text-decoration:none; font-weight:600;">Cadastre-se agora</a>';
  }
}

async function handleAuthSubmit() {
  if (!supabaseClient) {
    showToast('O servidor do banco de dados está desconectado. Verifique sua conexão com a internet.', 'error');
    return;
  }
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const username = document.getElementById('authUsername').value.trim();
  
  if (!email || !password) {
    showToast('E-mail e senha são obrigatórios.', 'error');
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showToast('Formato de e-mail inválido.', 'error');
    return;
  }
  
  const submitBtn = document.getElementById('authSubmitBtn');
  setBtnLoading(submitBtn, true);
  
  if (isRegisterMode) {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { username }
      }
    });
    
    setBtnLoading(submitBtn, false);
    if (error) {
      showToast(`Erro: ${error.message}`, 'error');
    } else {
      showToast('Conta criada com sucesso!', 'success');
      closeAuthModal();
    }
  } else {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });
    
    setBtnLoading(submitBtn, false);
    if (error) {
      showToast(`Erro: ${error.message}`, 'error');
    } else {
      showToast('Login realizado com sucesso.', 'success');
      closeAuthModal();
    }
  }
}

async function handleLogout() {
  if (!supabaseClient) return;
  if (!confirm('Deseja realmente sair da sua conta?')) return;
  
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    showToast(`Erro: ${error.message}`, 'error');
  } else {
    showToast('Sessão encerrada com sucesso.', 'info');
  }
}

async function handleGoogleLogin() {
  if (!supabaseClient) return;
  closeAuthModal();
  showToast('Redirecionando para o Google...', 'info');
  
  const { data, error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  });
  
  if (error) {
    showToast(`Erro ao conectar com o Google: ${error.message}`, 'error');
  }
}

let uploadDebounceTimer = null;
function syncPredictionsToCloud() {
  if (!supabaseClient || !currentUser) return;
  
  isCloudSyncing = true;
  clearTimeout(uploadDebounceTimer);
  
  uploadDebounceTimer = setTimeout(async () => {
    const groupPreds = {};
    for (const [g, sel] of Object.entries(groupSelections)) {
      groupPreds[g] = {
        firstName: sel.first?.name || null,
        secondName: sel.second?.name || null
      };
    }
    
    const bracketPreds = {};
    for (const [id, team] of Object.entries(bracketWinners)) {
      bracketPreds[id] = team.name;
    }
    
    try {
      const { error } = await supabaseClient
        .from('predictions')
        .upsert({
          user_id: currentUser.id,
          group_predictions: groupPreds,
          bracket_predictions: bracketPreds,
          score_predictions: scorePredictions,
          updated_at: new Date().toISOString()
        });
        
      if (error) throw error;
      isCloudSyncing = false;
      showToast('Palpites sincronizados com o servidor.', 'success');
    } catch(err) {
      console.warn('Erro na sincronização em nuvem:', err);
      isCloudSyncing = false;
    }
  }, 1500);
}

async function syncPredictionsToCloudImmediately() {
  if (!supabaseClient || !currentUser) return;
  
  clearTimeout(uploadDebounceTimer);
  isCloudSyncing = true;
  
  const groupPreds = {};
  for (const [g, sel] of Object.entries(groupSelections)) {
    groupPreds[g] = {
      firstName: sel.first?.name || null,
      secondName: sel.second?.name || null
    };
  }
  
  const bracketPreds = {};
  for (const [id, team] of Object.entries(bracketWinners)) {
    bracketPreds[id] = team.name;
  }
  
  try {
    const { error } = await supabaseClient
      .from('predictions')
      .upsert({
        user_id: currentUser.id,
        group_predictions: groupPreds,
        bracket_predictions: bracketPreds,
        score_predictions: scorePredictions,
        updated_at: new Date().toISOString()
      });
      
    if (error) throw error;
    isCloudSyncing = false;
    showToast('Palpites oficiais enviados com sucesso!', 'success');
    renderRanking(); // Recarrega ranking geral de forma dinâmica
  } catch(err) {
    console.warn('Erro ao salvar palpites de forma oficial:', err);
    isCloudSyncing = false;
    showToast('Erro de rede ao sincronizar palpites oficiais. Tente novamente.', 'error');
  } finally {
    setBtnLoading(document.getElementById('btnSavePredictions'), false);
  }
}

function btnSavePredictionsClick() {
  if (!supabaseClient) {
    showToast('O servidor de banco de dados não está conectado. Verifique sua internet.', 'error');
    return;
  }
  if (!currentUser) {
    showToast('Para enviar seus palpites e participar do ranking geral, você precisa criar uma conta.', 'error');
    setTimeout(() => {
      openAuthModal();
      // Alterna automaticamente para o modo de cadastro para ajudar
      toggleAuthMode(true);
    }, 1200);
    return;
  }
  
  setBtnLoading(document.getElementById('btnSavePredictions'), true);
  syncPredictionsToCloudImmediately();
}

async function downloadPredictionsFromCloud() {
  if (!supabaseClient || !currentUser) return;
  
  try {
    const { data, error } = await supabaseClient
      .from('predictions')
      .select('group_predictions, bracket_predictions, score_predictions')
      .eq('user_id', currentUser.id)
      .single();
      
    if (error) {
      syncPredictionsToCloud(); // Salva estado atual caso não haja palpites
      return;
    }
    
    if (data) {
      let imported = false;
      
      if (data.group_predictions && Object.keys(data.group_predictions).length > 0) {
        groupSelections = {};
        for (const [g, sel] of Object.entries(data.group_predictions)) {
          if (!GROUPS[g]) continue;
          groupSelections[g] = {};
          if (sel && sel.firstName) {
            groupSelections[g].first = GROUPS[g].find(t => t.name === sel.firstName) || null;
          }
          if (sel && sel.secondName) {
            groupSelections[g].second = GROUPS[g].find(t => t.name === sel.secondName) || null;
          }
        }
        imported = true;
      }
      
      if (data.bracket_predictions && Object.keys(data.bracket_predictions).length > 0) {
        bracketWinners = {};
        for (const [id, teamName] of Object.entries(data.bracket_predictions)) {
          let foundTeam = null;
          for (const teams of Object.values(GROUPS)) {
            const t = teams.find(x => x.name === teamName);
            if (t) { foundTeam = t; break; }
          }
          if (foundTeam) {
            bracketWinners[id] = foundTeam;
          }
        }
        imported = true;
      }

      if (data.score_predictions) {
        scorePredictions = data.score_predictions;
        imported = true;
      }
      
      if (imported) {
        computeThirdPlace();
        renderGroups();
        renderBracket();
        renderSummary();
        
        // Sincroniza localmente
        const localData = {
          name: document.getElementById('participantName').value,
          groups: {},
          bracket: {},
          scorePredictions,
          apiKey,
          realResults,
          savedAt: Date.now()
        };
        for (const [g, sel] of Object.entries(groupSelections)) {
          localData.groups[g] = {
            firstName: sel.first?.name || null,
            secondName: sel.second?.name || null
          };
        }
        for (const [id, team] of Object.entries(bracketWinners)) {
          localData.bracket[id] = { name: team.name, flag: team.flag, code: team.code };
        }
        safeStorage.setItem(LS_KEY, JSON.stringify(localData));
        
        showToast('Palpites sincronizados com o servidor.', 'success');
      }
    }
  } catch(err) {
    console.warn('Erro ao baixar palpites da nuvem:', err);
  }
}

async function renderRanking() {
  const tableBody = document.getElementById('rankingTableBody');
  const updateText = document.getElementById('rankingUpdateText');
  if (!tableBody) return;
  
  if (!supabaseClient) {
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--red);font-weight:600;">O Supabase não está conectado. Configure sua URL e Anon Key nas Configurações ⚙️ ou verifique sua conexão com a internet!</td></tr>`;
    if (updateText) updateText.innerHTML = 'Sem conexão';
    return;
  }
  
  tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:#888;">Carregando classificação...</td></tr>`;
  
  try {
    const { data, error } = await supabaseClient
      .from('leaderboard')
      .select('*');
      
    if (error) throw error;
    
    tableBody.innerHTML = '';
    if (updateText) updateText.innerHTML = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')}`;
    
    if (!data || data.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:#888;">Nenhum participante registrado ainda.</td></tr>`;
      return;
    }
    
    data.forEach(row => {
      const tr = document.createElement('tr');
      if (currentUser && row.user_id === currentUser.id) {
        tr.className = 'my-rank';
      }
      
      let posHtml = row.rank_position;
      if (row.rank_position === 1 && row.guessed_champion) {
        posHtml = `<span class="podium-badge" style="background:var(--gold);color:#000;">🥇</span>`;
      } else if (row.rank_position === 2 && row.guessed_champion) {
        posHtml = `<span class="podium-badge" style="background:#b0bec5;color:#000;">🥈</span>`;
      } else if (row.rank_position === 3 && row.guessed_champion) {
        posHtml = `<span class="podium-badge" style="background:#b08d57;color:#000;">🥉</span>`;
      } else {
        posHtml = `<span style="font-weight:600;margin-left:6px;">${row.rank_position}º</span>`;
      }
      
      const champChosen = row.chosen_champion || '—';
      const isChampCorrect = row.guessed_champion ? '✅ Sim' : '❌ Não';
      const isChampCorrectStyle = row.guessed_champion ? 'color:var(--live-green);font-weight:700;' : 'color:var(--red);';
      
      tr.innerHTML = `
        <td style="padding:14px 10px;">${posHtml}</td>
        <td style="padding:14px 10px;font-weight:600;">${row.username} ${currentUser && row.user_id === currentUser.id ? ' (Você)' : ''}</td>
        <td style="padding:14px 10px;text-align:center;font-weight:700;color:var(--gold);">${row.total_points}</td>
        <td style="padding:14px 10px;text-align:center;color:var(--text-secondary);font-weight:500;">${champChosen}</td>
        <td style="padding:14px 10px;text-align:center;${isChampCorrectStyle}">${isChampCorrect}</td>
      `;
      
      tableBody.appendChild(tr);
    });
    
  } catch(err) {
    console.warn('Erro ao carregar leaderboard:', err);
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--red);">Erro ao carregar dados do servidor. Certifique-se de configurar a View 'leaderboard' no Supabase!</td></tr>`;
    if (updateText) updateText.innerHTML = 'Erro de conexão';
  }
}

function resetAll() {
  if (!confirm('Tem certeza que deseja limpar todos os palpites?\nIsso também apagará os dados salvos.')) return;
  groupSelections = {};
  bracketWinners = {};
  thirdPlaceAssigned = {};
  realResults = {};
  scorePredictions = {};
  document.getElementById('participantName').value = '';
  safeStorage.removeItem(LS_KEY);
  renderGroups();
  renderBracket();
  renderSummary();
  showToast('Todos os palpites foram limpos.', 'info');
}

// Countdown timer update (a cada 5 segundos)
function updateCountdowns() {
  const groupsSection = document.getElementById('groups');
  if (!groupsSection || !groupsSection.classList.contains('active')) return;

  let needsFullRender = false;

  for (const letter of Object.keys(GROUPS)) {
    const nowLocked = isGroupLocked(letter);
    const wasLocked = previouslyLocked.has(letter);

    if (nowLocked && !wasLocked) {
      needsFullRender = true;
      previouslyLocked.add(letter);
    } else if (!nowLocked) {
      previouslyLocked.delete(letter);
    }

    // Atualiza o texto do cronômetro em tempo real sem rerenderizar tudo
    const el = document.getElementById(`countdown-${letter}`);
    if (el) {
      const lockTime = GROUP_LOCK_TIMES[letter];
      const cd = getCountdown(lockTime);
      if (nowLocked) {
        el.textContent = '';
      } else if (cd && !cd.includes('d')) {
        el.textContent = `⏱ ${cd}`;
      } else {
        el.textContent = '';
      }
    }
  }

  if (needsFullRender) {
    renderGroups();
  }
}

// =====================================================================
//  INICIALIZAÇÃO DO APLICATIVO (DOM LOADED & RESILIENTE)
// =====================================================================
function initApp() {
  // Limpa qualquer Service Worker de outros projetos que esteja ativo
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(reg => {
        reg.unregister();
        console.log('Service Worker desregistrado:', reg.scope);
      });
    });
    // Força recarga se havia SW ativo
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    }
  }

  loadState();
  initSupabase(); // Inicializa conexões com o banco e ouve sessões
  computeThirdPlace();
  renderGroups();
  renderBracket();
  renderSummary();

  // Escuta alterações de nome para salvamento
  const nameInput = document.getElementById('participantName');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      renderSummary();
      saveState();
    });
  }

  // Delegação de eventos na aba Results
  const resultsView = document.getElementById('resultsView');
  if (resultsView) {
    resultsView.addEventListener('input', (e) => {
      onScoreInput(e);
      onRealScoreInput(e);
    });
  }

  // Atualização periódica dos contadores (a cada 5s)
  setInterval(updateCountdowns, 5000);

  // Busca inicial da API caso haja chave configurada
  if (apiKey) {
    setTimeout(fetchResults, 2000);
  }

  // Atualização de resultados periódica a cada 5 minutos
  setInterval(() => {
    if (apiKey) fetchResults();
  }, 300000);

  // Auto-atualização de status LIVE/FT a cada 30 segundos
  setInterval(autoUpdateMatchStatus, 30000);
  autoUpdateMatchStatus(); // Já executa uma vez na inicialização

  // Remove qualquer status manual e limpa os que já encerraram
  resetManualStatuses();
}

// Inicialização com tolerância de thread e prevenção de race condition no parser do browser
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(initApp, 10);
} else {
  document.addEventListener('DOMContentLoaded', initApp);
}
