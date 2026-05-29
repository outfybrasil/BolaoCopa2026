// =====================================================================
//  DATA & CONSTANTS — BOLÃO COPA DO MUNDO 2026
// =====================================================================

// Configurações Padrão do Supabase (Conectadas ao seu projeto real)
const SUPABASE_URL_DEFAULT = 'https://gjztdxpulzqeahbqnxqf.supabase.co';
const SUPABASE_ANON_KEY_DEFAULT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqenRkeHB1bHpxZWFoYnFueHFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5ODc3NDAsImV4cCI6MjA5NTU2Mzc0MH0.FbXWp8YMpvDmdOaVWiUbXcnlFt0OhthWghF_YCC4hvA';

// Chave padrão da API football-data.org (já configurada)
const DEFAULT_API_KEY = '4978542601fd48d69a3d9db90d3ef518';

// Lista oficial dos grupos e seleções mapeadas com bandeiras e siglas ISO
const GROUPS = {
  A:[{name:'México',flag:'🇲🇽',code:'mx'},{name:'África do Sul',flag:'🇿🇦',code:'za'},{name:'Coreia do Sul',flag:'🇰🇷',code:'kr'},{name:'Tchéquia',flag:'🇨🇿',code:'cz'}],
  B:[{name:'Canadá',flag:'🇨🇦',code:'ca'},{name:'Bósnia e Herz.',flag:'🇧🇦',code:'ba'},{name:'Catar',flag:'🇶🇦',code:'qa'},{name:'Suíça',flag:'🇨🇭',code:'ch'}],
  C:[{name:'Brasil',flag:'🇧🇷',code:'br'},{name:'Marrocos',flag:'🇲🇦',code:'ma'},{name:'Haiti',flag:'🇭🇹',code:'ht'},{name:'Escócia',flag:'🏴󠁧󠁢󠁳󠁣󠁴󠁿',code:'gb-sct'}],
  D:[{name:'EUA',flag:'🇺🇸',code:'us'},{name:'Paraguai',flag:'🇵🇾',code:'py'},{name:'Austrália',flag:'🇦🇺',code:'au'},{name:'Turquia',flag:'🇹🇷',code:'tr'}],
  E:[{name:'Alemanha',flag:'🇩🇪',code:'de'},{name:'Curaçao',flag:'🇨🇼',code:'cw'},{name:'Costa do Marfim',flag:'🇨🇮',code:'ci'},{name:'Equador',flag:'🇪🇨',code:'ec'}],
  F:[{name:'Holanda',flag:'🇳🇱',code:'nl'},{name:'Japão',flag:'🇯🇵',code:'jp'},{name:'Suécia',flag:'🇸🇪',code:'se'},{name:'Tunísia',flag:'🇹🇳',code:'tn'}],
  G:[{name:'Bélgica',flag:'🇧🇪',code:'be'},{name:'Egito',flag:'🇪🇬',code:'eg'},{name:'Irã',flag:'🇮🇷',code:'ir'},{name:'Nova Zelândia',flag:'🇳🇿',code:'nz'}],
  H:[{name:'Espanha',flag:'🇪🇸',code:'es'},{name:'Cabo Verde',flag:'🇨🇻',code:'cv'},{name:'Arábia Saudita',flag:'🇸🇦',code:'sa'},{name:'Uruguai',flag:'🇺🇾',code:'uy'}],
  I:[{name:'França',flag:'🇫🇷',code:'fr'},{name:'Senegal',flag:'🇸🇳',code:'sn'},{name:'Iraque',flag:'🇮🇶',code:'iq'},{name:'Noruega',flag:'🇳🇴',code:'no'}],
  J:[{name:'Argentina',flag:'🇦🇷',code:'ar'},{name:'Argélia',flag:'🇩🇿',code:'dz'},{name:'Áustria',flag:'🇦🇹',code:'at'},{name:'Jordânia',flag:'🇯🇴',code:'jo'}],
  K:[{name:'Portugal',flag:'🇵🇹',code:'pt'},{name:'RD Congo',flag:'🇨🇩',code:'cd'},{name:'Uzbequistão',flag:'🇺🇿',code:'uz'},{name:'Colômbia',flag:'🇨🇴',code:'co'}],
  L:[{name:'Inglaterra',flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿',code:'gb-eng'},{name:'Croácia',flag:'🇭🇷',code:'hr'},{name:'Gana',flag:'🇬🇭',code:'gh'},{name:'Panamá',flag:'🇵🇦',code:'pa'}]
};

// FIFA Ranking (Pontuação média projetada para 2026 para auto-fill e desempates)
const FIFA_RANK = {
  'França':1877,'Espanha':1876,'Argentina':1875,'Inglaterra':1826,
  'Portugal':1764,'Brasil':1761,'Holanda':1758,'Marrocos':1756,
  'Bélgica':1735,'Alemanha':1730,'Colômbia':1710,'Uruguai':1700,
  'Croácia':1695,'Japão':1690,'Senegal':1680,'EUA':1675,
  'México':1670,'Suíça':1665,'Turquia':1660,'Áustria':1650,
  'Equador':1640,'Irã':1635,'Austrália':1625,'Coreia do Sul':1620,
  'Egito':1610,'Tunísia':1600,'Argélia':1595,'Escócia':1585,
  'Costa do Marfim':1580,'Suécia':1570,'Noruega':1565,
  'Paraguai':1555,'Tchéquia':1550,'Panamá':1540,
  'Arábia Saudita':1535,'África do Sul':1520,'Canadá':1515,
  'RD Congo':1500,'Bósnia e Herz.':1490,'Gana':1480,
  'Nova Zelândia':1460,'Iraque':1450,'Uzbequistão':1440,
  'Haiti':1400,'Cabo Verde':1390,'Jordânia':1380,
  'Curaçao':1360,'Catar':1350
};

// Horário do PRIMEIRO jogo de cada grupo (UTC) para controle de travamento
const GROUP_LOCK_TIMES = {
  A:'2026-06-11T19:00:00Z', B:'2026-06-12T19:00:00Z',
  C:'2026-06-13T22:00:00Z', D:'2026-06-13T01:00:00Z',
  E:'2026-06-14T17:00:00Z', F:'2026-06-14T20:00:00Z',
  G:'2026-06-15T17:00:00Z', H:'2026-06-15T20:00:00Z',
  I:'2026-06-16T20:00:00Z', J:'2026-06-16T22:00:00Z',
  K:'2026-06-17T17:00:00Z', L:'2026-06-17T20:00:00Z'
};

// Datas e horários estimados dos jogos do mata-mata (UTC)
const KNOCKOUT_LOCK_TIMES = {
  R32_1:'2026-06-28T17:00:00Z', R32_2:'2026-06-28T20:00:00Z',
  R32_3:'2026-06-28T23:00:00Z', R32_4:'2026-06-29T01:00:00Z',
  R32_5:'2026-06-29T17:00:00Z', R32_6:'2026-06-29T20:00:00Z',
  R32_7:'2026-06-29T23:00:00Z', R32_8:'2026-06-30T01:00:00Z',
  R32_9:'2026-06-30T17:00:00Z', R32_10:'2026-06-30T20:00:00Z',
  R32_11:'2026-06-30T23:00:00Z',R32_12:'2026-07-01T01:00:00Z',
  R32_13:'2026-07-01T17:00:00Z',R32_14:'2026-07-01T20:00:00Z',
  R32_15:'2026-07-01T23:00:00Z',R32_16:'2026-07-02T01:00:00Z',
  R16_1:'2026-07-03T17:00:00Z', R16_2:'2026-07-03T20:00:00Z',
  R16_3:'2026-07-04T17:00:00Z', R16_4:'2026-07-04T20:00:00Z',
  R16_5:'2026-07-05T17:00:00Z', R16_6:'2026-07-05T20:00:00Z',
  R16_7:'2026-07-06T17:00:00Z', R16_8:'2026-07-06T20:00:00Z',
  QF_1:'2026-07-09T17:00:00Z',  QF_2:'2026-07-09T21:00:00Z',
  QF_3:'2026-07-10T17:00:00Z',  QF_4:'2026-07-10T21:00:00Z',
  SF_1:'2026-07-13T21:00:00Z',  SF_2:'2026-07-14T21:00:00Z',
  FINAL:'2026-07-19T19:00:00Z'
};

const LOCK_OFFSET_MS = 30 * 60 * 1000; // Bloqueio de palpites 30 minutos antes do jogo

// Horários de trava por rodada (primeiro jogo de cada rodada na fase de grupos)
const MATCHDAY_LOCK_TIMES = {
  group_md1: '2026-06-11T19:00:00Z',  // Rodada 1 — 1os jogos de todos os grupos
  group_md2: '2026-06-15T17:00:00Z',  // Rodada 2 — 2os jogos
  group_md3: '2026-06-19T17:00:00Z',  // Rodada 3 — 3os jogos
};

const MATCHDAY_LABELS = {
  group_md1: '🥇 Rodada 1 (Jogos 1 e 2 de cada grupo)',
  group_md2: '🥈 Rodada 2 (Jogos 3 e 4 de cada grupo)',
  group_md3: '🥉 Rodada 3 (Jogos 5 e 6 de cada grupo)',
};

// Estrutura: pra cada rodada, quais índices de confronto dentro de cada grupo
const MATCHDAY_MATCHUP_INDICES = {
  group_md1: [0, 1],
  group_md2: [2, 3],
  group_md3: [4, 5],
};

// Estrutura de confrontos da Fase eliminatória de 16-avos de final (R32)
const R32_STRUCTURE = [
  // LADO ESQUERDO
  {id:'R32_1', label:'J1',  home:'1A', away:'2B'},
  {id:'R32_2', label:'J2',  home:'1C', away:'2D'},
  {id:'R32_3', label:'J3',  home:'1E', away:'2F'},
  {id:'R32_4', label:'J4',  home:'1G', away:'2H'},
  {id:'R32_5', label:'J5',  home:'1I', away:'2J'},
  {id:'R32_6', label:'J6',  home:'1K', away:'2L'},
  {id:'R32_7', label:'J7',  home:'1B', away:'3RD'},
  {id:'R32_8', label:'J8',  home:'1D', away:'3RD'},
  // LADO DIREITO
  {id:'R32_9', label:'J9',  home:'1F', away:'3RD'},
  {id:'R32_10',label:'J10', home:'1H', away:'3RD'},
  {id:'R32_11',label:'J11', home:'1J', away:'2I'},
  {id:'R32_12',label:'J12', home:'1L', away:'2K'},
  {id:'R32_13',label:'J13', home:'2A', away:'3RD'},
  {id:'R32_14',label:'J14', home:'2C', away:'3RD'},
  {id:'R32_15',label:'J15', home:'2E', away:'3RD'},
  {id:'R32_16',label:'J16', home:'2G', away:'3RD'},
];

// IDs das chaves do mata-mata que recebem os 8 melhores 3ºs colocados
const THIRD_PLACE_SLOTS = ['R32_7','R32_8','R32_9','R32_10','R32_13','R32_14','R32_15','R32_16'];

// Normalização: nomes em inglês que a football-data.org retorna → nosso padrão
const FOOTBALL_DATA_NAME_MAP = {
  'Korea Republic':'South Korea','South Korea':'South Korea',
  'Czech Republic':'Czech Republic','Czechia':'Czech Republic',
  'United States':'USA','USA':'USA',
  'Côte d\'Ivoire':'Ivory Coast','Ivory Coast':'Ivory Coast',
  'Congo DR':'DR Congo','DR Congo':'DR Congo',
  'Bosnia and Herzegovina':'Bosnia And Herzegovina',
  'Netherlands':'Netherlands','Holland':'Netherlands',
  'Cape Verde Islands':'Cape Verde','Cape Verde':'Cape Verde',
  'Saudi Arabia':'Saudi Arabia',
  'England':'England','Scotland':'Scotland',
  'IR Iran':'Iran','Iran':'Iran',
};

// Mapeamento PT -> EN dos nomes de países para sincronização de placares com a API-Football
const TEAM_API_MAP = {
  'México':'Mexico','África do Sul':'South Africa','Coreia do Sul':'South Korea',
  'Tchéquia':'Czech Republic','Canadá':'Canada','Bósnia e Herz.':'Bosnia And Herzegovina',
  'Catar':'Qatar','Suíça':'Switzerland','Brasil':'Brazil','Marrocos':'Morocco',
  'Haiti':'Haiti','Escócia':'Scotland','EUA':'USA','Paraguai':'Paraguay',
  'Austrália':'Australia','Turquia':'Turkey','Alemanha':'Germany','Curaçao':'Curacao',
  'Costa do Marfim':'Ivory Coast','Equador':'Ecuador','Holanda':'Netherlands',
  'Japão':'Japan','Suécia':'Sweden','Tunísia':'Tunisia','Bélgica':'Belgium',
  'Egito':'Egypt','Irã':'Iran','Nova Zelândia':'New Zealand','Espanha':'Spain',
  'Cabo Verde':'Cape Verde','Arábia Saudita':'Saudi Arabia','Uruguai':'Uruguay',
  'França':'France','Senegal':'Senegal','Iraque':'Iraq','Noruega':'Norway',
  'Argentina':'Argentina','Argélia':'Algeria','Áustria':'Austria','Jordânia':'Jordan',
  'Portugal':'Portugal','RD Congo':'DR Congo','Uzbequistão':'Uzbekistan',
  'Colômbia':'Colombia','Inglaterra':'England','Croácia':'Croatia',
  'Gana':'Ghana','Panamá':'Panama'
};
