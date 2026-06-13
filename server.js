// ============================================================
//  ANURA FINTECH — server.js v2 (Premium Evolution)
//  Fixes: MongoDB retry connection, monthly profit calc,
//         public/ folder serving
// ============================================================
require('dotenv').config();
const express      = require('express');
const mongoose     = require('mongoose');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const path         = require('path');
const fs           = require('fs');

const app  = express();
const PORT = process.env.PORT || 3006;

app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(path.join(__dirname, 'public')));

const UPLOADS_DIR = path.join(__dirname, 'uploads', 'depositos');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const EMOLA_NUMERO_PLATAFORMA = '871631824'; // destino de depósitos (conta ANURA)
const EMOLA_METODO  = 'e-Mola';
const DEPOSITO_MINIMO = 200;
const CICLO_QUINZENAL_DIAS = 15;
const CICLO_MENSAL_DIAS = 30;
const TAXA_EMPRESTIMO_MENSAL = 3.5;

// ── MONGODB CONNECTION (com retry automático) ─────────────────
const MONGODB_URI = process.env.MONGODB_URI ||
  'mongodb+srv://carialavagnerrodrigues_db_user:V2008J1975r@cluster0.fwk50ay.mongodb.net/anura?retryWrites=true&w=majority&appName=Cluster0';

mongoose.set('bufferCommands', false);

const MONGO_OPTS = {
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS:          45000,
  connectTimeoutMS:         15000,
  maxPoolSize:              10,
  retryWrites:              true,
  family:                   4,
};

let dbConnecting = false;

function connectDB() {
  if (mongoose.connection.readyState === 1 || dbConnecting) return;
  dbConnecting = true;
  mongoose.connect(MONGODB_URI, MONGO_OPTS)
    .then(() => {
      dbConnecting = false;
      console.log('✅  MongoDB Atlas conectado com sucesso');
    })
    .catch(err => {
      dbConnecting = false;
      console.error('❌  MongoDB erro:', err.message);
      if (/whitelist|Could not connect to any servers|Server selection timed out/i.test(err.message)) {
        console.error('💡  Autorize o seu IP no MongoDB Atlas: Network Access → Add IP Address (ou 0.0.0.0/0 em dev)');
      }
      console.log('⏳  Tentando reconectar em 5 segundos…');
      setTimeout(connectDB, 5000);
    });
}

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️   MongoDB desconectado. A reconectar…');
  setTimeout(connectDB, 3000);
});

mongoose.connection.on('error', err => {
  console.error('❌  Erro de conexão MongoDB:', err.message);
});

connectDB();

function dbMiddleware(req, res, next) {
  if (mongoose.connection.readyState === 1) return next();
  return res.status(503).json({
    erro: 'Base de dados indisponível. Verifique a ligação ao MongoDB Atlas.',
    detalhe: 'No MongoDB Atlas, abra Network Access e autorize o seu IP actual (ou 0.0.0.0/0 para testes).'
  });
}

app.get('/api/health', (req, res) => {
  const states = ['desconectado', 'conectado', 'a conectar', 'a desconectar'];
  res.json({
    ok: mongoose.connection.readyState === 1,
    estado: states[mongoose.connection.readyState] || String(mongoose.connection.readyState)
  });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  return dbMiddleware(req, res, next);
});

// ── MODELS ────────────────────────────────────────────────────

const userSchema = new mongoose.Schema({
  nome:            { type: String, required: true, trim: true },
  email:           { type: String, required: true, unique: true, lowercase: true },
  telefone:        { type: String, required: true },
  passwordHash:    { type: String, required: true },
  role:            { type: String, enum: ['user','admin'], default: 'user' },
  kycAprovado:     { type: Boolean, default: false },
  saldoDisponivel: { type: Number, default: 0 },
  saldoInvestido:  { type: Number, default: 0 },
  lucroAcumulado:  { type: Number, default: 0 },
  creditScore:     { type: Number, default: 0 },
  nivel:           { type: String, enum: ['bronze','prata','ouro','diamante'], default: 'bronze' },
  foto:            { type: String, default: '' },
  criadoEm:        { type: Date, default: Date.now },
  // Comissionista
  isComissionista:    { type: Boolean, default: false },
  codigoComissionista:{ type: String, unique: true, sparse: true },
  biComissionista:    { type: String },
  ganhosTotaisComissoes: { type: Number, default: 0 },
  nivelParceiro:         { type: Number, default: 0 },
  depositosReferidos:    { type: Number, default: 0 },
  depositosNoNivelAtual: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

const transactionSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tipo:        { type: String, enum: ['deposito','levantamento','investimento','rendimento','credito','comissao','prestacao'], required: true },
  valor:       { type: Number, required: true },
  estado:      { type: String, enum: ['pendente','confirmado','rejeitado','a_caminho','depositado'], default: 'pendente' },
  referencia:  { type: String },
  descricao:   { type: String },
  metodoPagamento: { type: String, default: 'e-Mola' },
  comprovativoFicheiro: { type: String },
  motivoRejeicao: { type: String },
  codigoComissionista: { type: String },
  criadoEm:    { type: Date, default: Date.now },
  atualizadoEm:{ type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

const investmentSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plano:       { type: String, enum: ['starter','gold','elite'], required: true },
  valor:       { type: Number, required: true },
  apy:         { type: Number, required: true },  // taxa mensal (%)
  cicloRendimento: { type: String, enum: ['quinzenal','mensal'], default: 'quinzenal' },
  estado:      { type: String, enum: ['ativo','encerrado'], default: 'ativo' },
  lucroGerado: { type: Number, default: 0 },
  ultimoRendimentoEm: { type: Date },
  proximoRendimentoEm: { type: Date },
  alocadoEm:  { type: Date, default: Date.now },
  encerradoEm:{ type: Date },
  historico:   [{ data: Date, valor: Number, descricao: String }]
});
const Investment = mongoose.model('Investment', investmentSchema);

const loanSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  valor:           { type: Number, required: true },
  taxaMensal:      { type: Number, required: true },
  freqPagamento:   { type: String, enum: ['quinzenal','mensal'], default: 'mensal' },
  prazoMeses:      { type: Number, required: true },
  numeroPrestacoes:{ type: Number, required: true },
  valorPrestacao:  { type: Number, required: true },
  totalPagar:      { type: Number, required: true },
  saldoDevedor:    { type: Number, default: 0 },
  prestacoes: [{
    numero:    { type: Number },
    valor:     { type: Number },
    vencimento:{ type: Date },
    estado:    { type: String, enum: ['pendente','paga','atrasada'], default: 'pendente' },
    pagoEm:    { type: Date }
  }],
  estado:     { type: String, enum: ['pendente','aprovado','ativo','rejeitado','pago','concluido'], default: 'pendente' },
  criadoEm:  { type: Date, default: Date.now }
});
const Loan = mongoose.model('Loan', loanSchema);

const notificationSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  titulo:  { type: String, required: true },
  mensagem:{ type: String, required: true },
  tipo:    { type: String, enum: ['deposito','investimento','rendimento','comissao','emprestimo','nivel','levantamento','sistema','bonus','saldo'], default: 'sistema' },
  lida:    { type: Boolean, default: false },
  criadoEm:{ type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

const comissaoSchema = new mongoose.Schema({
  comissionistaId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  clienteId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  depositoId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', required: true },
  valorDeposito:   { type: Number, required: true },
  percentagem:     { type: Number, default: 3 },
  valorComissao:   { type: Number, required: true },
  criadoEm:        { type: Date, default: Date.now }
});
const Comissao = mongoose.model('Comissao', comissaoSchema);

// ── AUTH ──────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'anura_secret_2026_xK9pQ';

function authMiddleware(req, res, next) {
  const token = req.cookies?.token ||
    (req.headers.authorization?.startsWith('Bearer ') && req.headers.authorization.split(' ')[1]);
  if (!token) return res.status(401).json({ erro: 'Não autenticado.' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ erro: 'Token inválido ou expirado.' }); }
}
function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ erro: 'Acesso restrito.' });
    next();
  });
}
function gerarToken(user) {
  return jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

// ── HELPERS ───────────────────────────────────────────────────
// Taxa mensal (%) por plano — lucros quinzenais (15d) ou mensais (30d)
const APY_MAP = { starter: 8, gold: 16, elite: 24 };

function diasCicloInvestimento(ciclo) {
  return ciclo === 'mensal' ? CICLO_MENSAL_DIAS : CICLO_QUINZENAL_DIAS;
}

function taxaPorCiclo(apyMensal, ciclo) {
  return ciclo === 'mensal' ? apyMensal / 100 : (apyMensal / 100) / 2;
}

function calcLucroInvestimento(inv, ate = new Date()) {
  const ciclo = inv.cicloRendimento || 'quinzenal';
  const diasCiclo = diasCicloInvestimento(ciclo);
  const taxa = taxaPorCiclo(inv.apy, ciclo);
  const diasAtivos = Math.max(0, (ate - inv.alocadoEm) / 86400000);
  const ciclosCompletos = diasAtivos / diasCiclo;
  const lucroPorCiclo = inv.valor * taxa;
  return {
    diasAtivos: Math.floor(diasAtivos),
    lucroPorCiclo,
    lucroEstimado: inv.valor * taxa * ciclosCompletos,
    diasCiclo,
    ciclo
  };
}

function proximoCicloInvestimento(inv, agora = new Date()) {
  const ciclo = inv.cicloRendimento || 'quinzenal';
  const diasCiclo = diasCicloInvestimento(ciclo);
  const base = inv.proximoRendimentoEm || new Date(inv.alocadoEm.getTime() + diasCiclo * 86400000);
  let prox = new Date(base);
  while (prox <= agora) prox = new Date(prox.getTime() + diasCiclo * 86400000);
  const diasRestantes = Math.max(0, Math.ceil((prox - agora) / 86400000));
  const inicioCiclo = new Date(prox.getTime() - diasCiclo * 86400000);
  const progresso = Math.min(100, Math.max(0, ((agora - inicioCiclo) / (diasCiclo * 86400000)) * 100));
  return { proxCiclo: prox, diasRestantes, progressoCiclo: parseFloat(progresso.toFixed(1)), diasCiclo, ciclo };
}

function calcPrestacaoEmprestimo(valor, taxaMensal, prazoMeses, freqPagamento) {
  const n = freqPagamento === 'quinzenal' ? prazoMeses * 2 : prazoMeses;
  const r = freqPagamento === 'quinzenal' ? (taxaMensal / 100) / 2 : taxaMensal / 100;
  if (!n || n <= 0) return 0;
  if (r <= 0) return valor / n;
  return valor * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function gerarCronogramaEmprestimo(valor, taxaMensal, prazoMeses, freqPagamento, inicio = new Date()) {
  const n = freqPagamento === 'quinzenal' ? prazoMeses * 2 : prazoMeses;
  const dias = freqPagamento === 'quinzenal' ? CICLO_QUINZENAL_DIAS : CICLO_MENSAL_DIAS;
  const prestacao = calcPrestacaoEmprestimo(valor, taxaMensal, prazoMeses, freqPagamento);
  const prestacoes = [];
  for (let i = 1; i <= n; i++) {
    prestacoes.push({
      numero: i,
      valor: parseFloat(prestacao.toFixed(2)),
      vencimento: new Date(inicio.getTime() + i * dias * 86400000),
      estado: 'pendente'
    });
  }
  return {
    numeroPrestacoes: n,
    valorPrestacao: parseFloat(prestacao.toFixed(2)),
    totalPagar: parseFloat((prestacao * n).toFixed(2)),
    prestacoes
  };
}

function calcNivel(saldoTotal) {
  if (saldoTotal >= 100000) return 'diamante';
  if (saldoTotal >= 20000)  return 'ouro';
  if (saldoTotal >= 5000)   return 'prata';
  return 'bronze';
}

async function criarNotificacao(userId, titulo, mensagem, tipo) {
  try { await Notification.create({ userId, titulo, mensagem, tipo }); } catch {}
}

async function atualizarNivel(user) {
  const totalAtivos = user.saldoDisponivel + user.saldoInvestido;
  const novoNivel = calcNivel(totalAtivos);
  if (novoNivel !== user.nivel) {
    await User.findByIdAndUpdate(user._id, { nivel: novoNivel });
    await criarNotificacao(user._id, '🏆 Mudança de Nível!', `Parabéns! Atingiu o nível ${novoNivel.toUpperCase()}.`, 'nivel');
  }
}

// Metas por nível de parceiro: depósitos confirmados → prémio liberado (MT)
const METAS_PARCEIRO = [
  { depositos: 50,  premio: 5000 },
  { depositos: 100, premio: 5000 },
  { depositos: 100, premio: 5000 },
  { depositos: 100, premio: 7500 },
  { depositos: 150, premio: 10000 }
];

function getMetaParceiro(nivelIdx) {
  if (nivelIdx < METAS_PARCEIRO.length) return METAS_PARCEIRO[nivelIdx];
  const extra = nivelIdx - METAS_PARCEIRO.length;
  return { depositos: 100 + extra * 25, premio: 10000 + extra * 2500 };
}

async function processarRendimentos() {
  try {
    const invs = await Investment.find({ estado: 'ativo' });
    const agora = new Date();
    for (const inv of invs) {
      const ciclo = inv.cicloRendimento || 'quinzenal';
      const diasCiclo = diasCicloInvestimento(ciclo);
      const prox = inv.proximoRendimentoEm || new Date(inv.alocadoEm.getTime() + diasCiclo * 86400000);
      if (agora < prox) continue;

      const taxa = taxaPorCiclo(inv.apy, ciclo);
      const lucro = parseFloat((inv.valor * taxa).toFixed(2));
      if (lucro <= 0) continue;

      await User.findByIdAndUpdate(inv.userId, {
        $inc: { saldoDisponivel: lucro, lucroAcumulado: lucro }
      });
      const label = ciclo === 'mensal' ? 'mensal' : 'quinzenal';
      await Transaction.create({
        userId: inv.userId,
        tipo: 'rendimento',
        valor: lucro,
        estado: 'confirmado',
        descricao: `Rendimento ${label} — Plano ${inv.plano.toUpperCase()}`
      });
      const proximo = new Date(prox.getTime() + diasCiclo * 86400000);
      await Investment.findByIdAndUpdate(inv._id, {
        $inc: { lucroGerado: lucro },
        $set: { ultimoRendimentoEm: agora, proximoRendimentoEm: proximo },
        $push: { historico: { data: agora, valor: lucro, descricao: `Rendimento ${label} creditado` } }
      });
      await criarNotificacao(
        inv.userId,
        '✨ Rendimento Creditado',
        `MT ${lucro.toLocaleString('pt-MZ')} (${label}) do Plano ${inv.plano.toUpperCase()} adicionados ao saldo.`,
        'rendimento'
      );
      const userAt = await User.findById(inv.userId);
      if (userAt) await atualizarNivel(userAt);
    }
  } catch (err) {
    console.error('Erro ao processar rendimentos:', err.message);
  }
}

async function processarCobrancasEmprestimos() {
  try {
    const loans = await Loan.find({ estado: 'ativo', saldoDevedor: { $gt: 0 } });
    const agora = new Date();
    for (const loan of loans) {
      let alterado = false;
      for (const p of loan.prestacoes) {
        if (p.estado !== 'pendente' && p.estado !== 'atrasada') continue;
        if (new Date(p.vencimento) > agora) continue;

        const user = await User.findById(loan.userId);
        if (!user) continue;

        if (user.saldoDisponivel >= p.valor) {
          await User.findByIdAndUpdate(loan.userId, { $inc: { saldoDisponivel: -p.valor } });
          p.estado = 'paga';
          p.pagoEm = agora;
          loan.saldoDevedor = Math.max(0, parseFloat((loan.saldoDevedor - p.valor).toFixed(2)));
          alterado = true;
          await Transaction.create({
            userId: loan.userId,
            tipo: 'prestacao',
            valor: p.valor,
            estado: 'confirmado',
            descricao: `Prestação ${p.numero}/${loan.numeroPrestacoes} — empréstimo`
          });
          await criarNotificacao(
            loan.userId,
            '✅ Prestação Debitada',
            `MT ${p.valor.toLocaleString('pt-MZ')} debitados automaticamente do saldo (prestação ${p.numero}).`,
            'emprestimo'
          );
        } else if (p.estado === 'pendente') {
          p.estado = 'atrasada';
          alterado = true;
          await criarNotificacao(
            loan.userId,
            '⚠️ Prestação em Atraso',
            `Prestação ${p.numero} de MT ${p.valor.toLocaleString('pt-MZ')} venceu. Deposite fundos para débito automático.`,
            'emprestimo'
          );
        }
      }
      if (alterado) {
        if (loan.saldoDevedor <= 0) loan.estado = 'concluido';
        loan.markModified('prestacoes');
        await loan.save();
      }
    }
  } catch (err) {
    console.error('Erro ao processar cobranças:', err.message);
  }
}

function iniciarJobsFinanceiros() {
  setInterval(() => {
    if (mongoose.connection.readyState === 1) {
      processarRendimentos();
      processarCobrancasEmprestimos();
    }
  }, 60 * 60 * 1000);
  setTimeout(() => {
    if (mongoose.connection.readyState === 1) {
      processarRendimentos();
      processarCobrancasEmprestimos();
    }
  }, 15000);
}

async function gerarCodigoParceiro() {
  const parceiros = await User.find({
    isComissionista: true,
    codigoComissionista: { $regex: /^A\d+$/ }
  }).select('codigoComissionista');
  let maxNum = 1000;
  for (const p of parceiros) {
    const n = parseInt(String(p.codigoComissionista).slice(1), 10);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  }
  return `A${maxNum + 1}`;
}

function guardarComprovativo(userId, comprovativoBase64, nomeFicheiro) {
  const match = String(comprovativoBase64).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Formato de comprovativo inválido.');
  const mime = match[1];
  const allowed = ['image/jpeg','image/jpg','image/png','image/gif','image/webp','application/pdf'];
  if (!allowed.includes(mime)) throw new Error('Formato inválido. Use imagem (JPG, PNG) ou PDF.');
  const extMap = { 'image/jpeg':'.jpg','image/jpg':'.jpg','image/png':'.png','image/gif':'.gif','image/webp':'.webp','application/pdf':'.pdf' };
  const ext = extMap[mime] || path.extname(nomeFicheiro || '') || '.bin';
  const filename = `${userId}_${Date.now()}${ext}`;
  const filepath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(match[2], 'base64'));
  return `depositos/${filename}`;
}

async function liberarPremioParceiro(parceiroId, premio, nivelIdx) {
  await User.findByIdAndUpdate(parceiroId, {
    $inc: { saldoDisponivel: premio, ganhosTotaisComissoes: premio, nivelParceiro: 1 },
    $set: { depositosNoNivelAtual: 0 }
  });
  await Transaction.create({
    userId: parceiroId,
    tipo: 'comissao',
    valor: premio,
    estado: 'confirmado',
    descricao: `Prémio Parceiro Nível ${nivelIdx + 1} — MT ${premio.toLocaleString('pt-MZ')}`
  });
  const proxMeta = getMetaParceiro(nivelIdx + 1);
  await criarNotificacao(
    parceiroId,
    '🎉 Prémio de Parceiro Liberado!',
    `Nível ${nivelIdx + 1} concluído! MT ${premio.toLocaleString('pt-MZ')} creditados. Próxima meta: ${proxMeta.depositos} depósitos = MT ${proxMeta.premio.toLocaleString('pt-MZ')}.`,
    'comissao'
  );
}

async function processarComissaoDeposito(tx, user) {
  if (!tx.codigoComissionista) return;
  const parceiro = await User.findOne({ codigoComissionista: tx.codigoComissionista, isComissionista: true });
  if (!parceiro) return;

  const nivelIdx = parceiro.nivelParceiro || 0;
  const meta = getMetaParceiro(nivelIdx);
  const novoProgresso = (parceiro.depositosNoNivelAtual || 0) + 1;
  const faltam = Math.max(0, meta.depositos - novoProgresso);

  await Comissao.create({
    comissionistaId: parceiro._id,
    clienteId: user._id,
    depositoId: tx._id,
    valorDeposito: tx.valor,
    valorComissao: 0,
    percentagem: 0
  });

  await User.findByIdAndUpdate(parceiro._id, {
    $inc: { depositosReferidos: 1 },
    $set: { depositosNoNivelAtual: novoProgresso }
  });

  await criarNotificacao(
    parceiro._id,
    '📥 Depósito referenciado',
    `${user.nome} depositou MT ${tx.valor.toLocaleString('pt-MZ')}. Faltam ${faltam} depósitos para liberar MT ${meta.premio.toLocaleString('pt-MZ')}.`,
    'comissao'
  );

  if (novoProgresso >= meta.depositos) {
    await liberarPremioParceiro(parceiro._id, meta.premio, nivelIdx);
  }
}

async function aprovarDeposito(tx) {
  if (tx.estado !== 'pendente' || tx.tipo !== 'deposito') throw new Error('Depósito inválido para aprovação.');
  const user = await User.findById(tx.userId);
  if (!user) throw new Error('Utilizador não encontrado.');

  await User.findByIdAndUpdate(tx.userId, {
    $inc: { saldoDisponivel: tx.valor, creditScore: Math.floor(tx.valor / 100) }
  });
  await Transaction.findByIdAndUpdate(tx._id, {
    estado: 'confirmado',
    descricao: `Depósito confirmado automaticamente via ${EMOLA_METODO}`,
    atualizadoEm: new Date()
  });

  await criarNotificacao(tx.userId, '✅ Depósito Confirmado', `O seu depósito de MT ${tx.valor.toLocaleString('pt-MZ')} foi creditado automaticamente.`, 'deposito');
  await criarNotificacao(tx.userId, '💰 Saldo Atualizado', `MT ${tx.valor.toLocaleString('pt-MZ')} disponíveis na sua conta.`, 'saldo');

  const depositosConfirmados = await Transaction.countDocuments({ userId: tx.userId, tipo: 'deposito', estado: 'confirmado' });
  if (depositosConfirmados === 1) {
    await criarNotificacao(tx.userId, '🎁 Bónus Recebido', 'Parabéns pelo seu primeiro depósito! O seu Score de Crédito está ativo.', 'bonus');
  }

  await processarComissaoDeposito(tx, user);

  const userAtualizado = await User.findById(tx.userId);
  await atualizarNivel(userAtualizado);
  const userFinal = await User.findById(tx.userId);
  return userFinal;
}

// ── AUTH ROUTES ───────────────────────────────────────────────
app.post('/api/auth/registar', async (req, res) => {
  try {
    const { nome, email, telefone, password } = req.body;
    if (!nome || !email || !telefone || !password)
      return res.status(400).json({ erro: 'Todos os campos são obrigatórios.' });
    if (await User.findOne({ email })) return res.status(409).json({ erro: 'Email já registado.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ nome, email, telefone, passwordHash });
    const token = gerarToken(user);
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7*24*3600*1000 });
    res.status(201).json({ mensagem: 'Conta criada com sucesso.', token, user: { id: user._id, nome: user.nome, email: user.email, saldoDisponivel: 0, nivel: 'bronze' } });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !await bcrypt.compare(password, user.passwordHash))
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    const token = gerarToken(user);
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7*24*3600*1000 });
    res.json({ mensagem: 'Login bem-sucedido.', token, user: { id: user._id, nome: user.nome, email: user.email, role: user.role, saldoDisponivel: user.saldoDisponivel, saldoInvestido: user.saldoInvestido, lucroAcumulado: user.lucroAcumulado, creditScore: user.creditScore, kycAprovado: user.kycAprovado, nivel: user.nivel, isComissionista: user.isComissionista, codigoComissionista: user.codigoComissionista } });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/auth/logout', (req, res) => { res.clearCookie('token'); res.json({ mensagem: 'Sessão encerrada.' }); });

app.get('/api/auth/perfil', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    res.json(user);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.put('/api/auth/perfil', authMiddleware, async (req, res) => {
  try {
    const { nome, telefone } = req.body;
    const user = await User.findByIdAndUpdate(req.user.id, { nome, telefone }, { new: true }).select('-passwordHash');
    res.json({ mensagem: 'Perfil atualizado.', user });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── DEPÓSITOS (exclusivamente e-Mola) ─────────────────────────
app.get('/api/depositos/config', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('telefone');
    if (!user) return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    res.json({
      metodo: EMOLA_METODO,
      numeroPlataforma: EMOLA_NUMERO_PLATAFORMA,
      numeroConta: user.telefone,
      numeroDestino: user.telefone,
      minimo: DEPOSITO_MINIMO,
      instrucao: 'Transfira para o número da plataforma. A sua conta ANURA está associada ao telefone registado.'
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/levantamentos/config', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('telefone');
    if (!user) return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    res.json({
      metodo: EMOLA_METODO,
      numeroDestino: user.telefone,
      telefone: user.telefone
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/depositos/estatisticas', authMiddleware, async (req, res) => {
  try {
    const depositos = await Transaction.find({ userId: req.user.id, tipo: 'deposito' });
    const aprovados = depositos.filter(d => d.estado === 'confirmado');
    res.json({
      totalDepositado: aprovados.reduce((a, d) => a + d.valor, 0),
      depositosAprovados: aprovados.length,
      depositosPendentes: depositos.filter(d => d.estado === 'pendente').length,
      depositosRejeitados: depositos.filter(d => d.estado === 'rejeitado').length
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/depositos/meus', authMiddleware, async (req, res) => {
  try {
    const depositos = await Transaction.find({ userId: req.user.id, tipo: 'deposito' }).sort({ criadoEm: -1 }).limit(20);
    res.json(depositos);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/depositos/enviar-comprovativo', authMiddleware, async (req, res) => {
  try {
    const { valor, referencia, codigoParceiro, comprovativo, nomeFicheiro } = req.body;
    const montante = parseFloat(valor);
    if (!montante || montante < DEPOSITO_MINIMO)
      return res.status(400).json({ erro: `Depósito mínimo de ${DEPOSITO_MINIMO} MT obrigatório.` });
    if (!referencia || String(referencia).trim().length < 3)
      return res.status(400).json({ erro: 'Indique a referência da transação e-Mola.' });
    if (!comprovativo)
      return res.status(400).json({ erro: 'Anexe o comprovativo (captura, imagem ou PDF).' });

    const ficheiro = guardarComprovativo(req.user.id, comprovativo, nomeFicheiro);

    const tx = await Transaction.create({
      userId: req.user.id,
      tipo: 'deposito',
      valor: montante,
      estado: 'pendente',
      referencia: String(referencia).trim(),
      metodoPagamento: EMOLA_METODO,
      comprovativoFicheiro: ficheiro,
      descricao: 'Depósito e-Mola — a confirmar',
      codigoComissionista: codigoParceiro?.trim() || null
    });

    const userFinal = await aprovarDeposito(tx);

    res.status(201).json({
      mensagem: `Depósito de MT ${montante.toLocaleString('pt-MZ')} confirmado e creditado na sua conta.`,
      deposito: { id: tx._id, estado: 'confirmado', valor: montante, referencia: tx.referencia },
      saldoDisponivel: userFinal.saldoDisponivel,
      creditScore: userFinal.creditScore
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/depositos/validar-comprovativo', authMiddleware, async (req, res) => {
  res.status(400).json({ erro: 'Utilize o novo formulário de comprovativo e-Mola com anexo de ficheiro.' });
});

// ── INVESTIMENTOS ─────────────────────────────────────────────
app.post('/api/investimentos/alocar', authMiddleware, async (req, res) => {
  try {
    const { valor, plano, cicloRendimento } = req.body;
    const ciclo = cicloRendimento === 'mensal' ? 'mensal' : 'quinzenal';
    if (!valor || valor <= 0 || !APY_MAP[plano]) return res.status(400).json({ erro: 'Dados inválidos.' });
    const user = await User.findById(req.user.id);
    if (user.saldoDisponivel < valor) return res.status(400).json({ erro: 'Saldo insuficiente.' });

    const MINS = { starter: 200, gold: 2000, elite: 10000 };
    if (valor < MINS[plano]) return res.status(400).json({ erro: `Mínimo para ${plano}: MT ${MINS[plano].toLocaleString('pt-MZ')}` });

    const diasCiclo = diasCicloInvestimento(ciclo);
    const proximoRendimentoEm = new Date(Date.now() + diasCiclo * 86400000);

    await User.findByIdAndUpdate(req.user.id, { $inc: { saldoDisponivel: -valor, saldoInvestido: valor } });
    const inv = await Investment.create({
      userId: req.user.id,
      plano,
      valor,
      apy: APY_MAP[plano],
      cicloRendimento: ciclo,
      proximoRendimentoEm,
      historico: [{ data: new Date(), valor, descricao: `Capital alocado (${ciclo})` }]
    });
    const cicloLabel = ciclo === 'mensal' ? 'mensal (30 dias)' : 'quinzenal (15 dias)';
    await Transaction.create({ userId: req.user.id, tipo: 'investimento', valor, estado: 'confirmado', descricao: `Investimento ${plano.toUpperCase()} @ ${APY_MAP[plano]}% a.m. · ciclo ${cicloLabel}` });
    await criarNotificacao(req.user.id, '📈 Investimento Criado', `MT ${valor.toLocaleString('pt-MZ')} alocados no Plano ${plano.toUpperCase()} (rendimento ${cicloLabel}).`, 'investimento');

    const userAtualizado = await User.findById(req.user.id);
    res.json({ mensagem: `Capital alocado no Plano ${plano.toUpperCase()}!`, investimento: inv, saldoDisponivel: userAtualizado.saldoDisponivel, saldoInvestido: userAtualizado.saldoInvestido });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/investimentos/meus', authMiddleware, async (req, res) => {
  try {
    const invs = await Investment.find({ userId: req.user.id }).sort({ alocadoEm: -1 });
    const agora = new Date();
    const result = invs.map(i => {
      const calc = calcLucroInvestimento(i, agora);
      const cicloInfo = proximoCicloInvestimento(i, agora);
      const lucroQuinzenal = i.valor * taxaPorCiclo(i.apy, 'quinzenal');
      const lucroMensal = i.valor * taxaPorCiclo(i.apy, 'mensal');
      return {
        ...i.toObject(),
        diasAtivos: calc.diasAtivos,
        lucroEstimado: parseFloat(calc.lucroEstimado.toFixed(2)),
        lucroPorCiclo: parseFloat(calc.lucroPorCiclo.toFixed(2)),
        lucroQuinzenal: parseFloat(lucroQuinzenal.toFixed(2)),
        lucroMensal: parseFloat(lucroMensal.toFixed(2)),
        proxCiclo: cicloInfo.proxCiclo,
        diasRestantes: cicloInfo.diasRestantes,
        progressoCiclo: cicloInfo.progressoCiclo,
        diasCiclo: cicloInfo.diasCiclo
      };
    });
    res.json(result);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/investimentos/estatisticas', authMiddleware, async (req, res) => {
  try {
    const invs = await Investment.find({ userId: req.user.id });
    const agora = new Date();
    let capitalTotal = 0, lucroTotal = 0;
    invs.forEach(i => {
      capitalTotal += i.valor;
      lucroTotal += calcLucroInvestimento(i, agora).lucroEstimado;
    });
    const evDiaria = [];
    for (let d = 6; d >= 0; d--) {
      const data = new Date(agora.getTime() - d * 86400000);
      const lucro = invs.reduce((acc, i) => acc + calcLucroInvestimento(i, data).lucroEstimado, 0);
      evDiaria.push({ data: data.toLocaleDateString('pt-MZ'), lucro: parseFloat(lucro.toFixed(2)) });
    }
    res.json({ capitalTotal, lucroTotal: parseFloat(lucroTotal.toFixed(2)), evDiaria });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── LEVANTAMENTOS ─────────────────────────────────────────────
app.post('/api/levantamentos/pedir', authMiddleware, async (req, res) => {
  try {
    const { valor } = req.body;
    if (!valor || valor <= 0) return res.status(400).json({ erro: 'Valor inválido.' });
    const user = await User.findById(req.user.id);
    if (user.saldoDisponivel < valor) return res.status(400).json({ erro: 'Saldo disponível insuficiente.' });

    const agora = new Date();
    const limite = new Date(agora.getTime() - CICLO_QUINZENAL_DIAS * 24 * 3600 * 1000);
    const emCarencia = await Investment.findOne({ userId: req.user.id, estado: 'ativo', alocadoEm: { $gt: limite } });
    if (emCarencia) {
      const dias = Math.ceil((emCarencia.alocadoEm.getTime() + CICLO_QUINZENAL_DIAS * 24 * 3600 * 1000 - agora.getTime()) / 86400000);
      return res.status(403).json({ erro: `Capital em carência. Levantamento disponível em ${dias} dia(s).` });
    }

    const destino = user.telefone;
    await User.findByIdAndUpdate(req.user.id, { $inc: { saldoDisponivel: -valor } });
    const tx = await Transaction.create({ userId: req.user.id, tipo: 'levantamento', valor, estado: 'a_caminho', descricao: `Levantamento a caminho — ${EMOLA_METODO} ${destino}` });
    await criarNotificacao(req.user.id, '⏳ Levantamento Iniciado', `MT ${valor.toLocaleString('pt-MZ')} a caminho para ${destino} via ${EMOLA_METODO}.`, 'levantamento');

    setTimeout(async () => {
      try {
        const t = await Transaction.findById(tx._id);
        if (t && t.estado === 'a_caminho') {
          await Transaction.findByIdAndUpdate(tx._id, { estado: 'depositado', descricao: `Fundos depositados via ${EMOLA_METODO} ${destino}`, atualizadoEm: new Date() });
          await criarNotificacao(req.user.id, '✅ Levantamento Concluído', `MT ${valor.toLocaleString('pt-MZ')} depositados no seu e-Mola (${destino}).`, 'levantamento');
        }
      } catch {}
    }, 120000);

    const userAt = await User.findById(req.user.id);
    res.json({
      mensagem: `Levantamento a caminho para ${destino}. Fundos em ~2 min via ${EMOLA_METODO}.`,
      numeroDestino: destino,
      saldoDisponivel: userAt.saldoDisponivel
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── EMPRÉSTIMOS ───────────────────────────────────────────────
app.get('/api/emprestimos/simular', authMiddleware, (req, res) => {
  try {
    const valor = parseFloat(req.query.valor);
    const prazoMeses = parseInt(req.query.prazoMeses, 10) || 3;
    const freqPagamento = req.query.freqPagamento === 'quinzenal' ? 'quinzenal' : 'mensal';
    if (!valor || valor <= 0) return res.status(400).json({ erro: 'Valor inválido.' });
    const valorPrestacao = calcPrestacaoEmprestimo(valor, TAXA_EMPRESTIMO_MENSAL, prazoMeses, freqPagamento);
    const cronograma = gerarCronogramaEmprestimo(valor, TAXA_EMPRESTIMO_MENSAL, prazoMeses, freqPagamento);
    res.json({
      valor,
      prazoMeses,
      freqPagamento,
      taxaMensal: TAXA_EMPRESTIMO_MENSAL,
      numeroPrestacoes: cronograma.numeroPrestacoes,
      valorPrestacao: cronograma.valorPrestacao,
      totalPagar: cronograma.totalPagar,
      jurosTotais: parseFloat((cronograma.totalPagar - valor).toFixed(2)),
      labelPrestacao: freqPagamento === 'quinzenal' ? 'Prestação quinzenal' : 'Prestação mensal'
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/emprestimos/pedir', authMiddleware, async (req, res) => {
  try {
    const dep = await Transaction.findOne({ userId: req.user.id, tipo: 'deposito', estado: 'confirmado' });
    if (!dep) return res.status(403).json({ erro: 'Efetue o primeiro depósito de 200 MT para ativar o crédito.' });
    const { valor, prazoMeses, freqPagamento } = req.body;
    const freq = freqPagamento === 'quinzenal' ? 'quinzenal' : 'mensal';
    if (!valor || valor <= 0) return res.status(400).json({ erro: 'Valor inválido.' });
    const meses = parseInt(prazoMeses, 10) || 3;
    const user = await User.findById(req.user.id);
    const limite = user.creditScore * 50;
    if (limite > 0 && valor > limite) return res.status(400).json({ erro: `Excede o limite de MT ${limite.toLocaleString('pt-MZ')}.` });

    const cronograma = gerarCronogramaEmprestimo(valor, TAXA_EMPRESTIMO_MENSAL, meses, freq);
    const emprestimo = await Loan.create({
      userId: req.user.id,
      valor,
      taxaMensal: TAXA_EMPRESTIMO_MENSAL,
      freqPagamento: freq,
      prazoMeses: meses,
      numeroPrestacoes: cronograma.numeroPrestacoes,
      valorPrestacao: cronograma.valorPrestacao,
      totalPagar: cronograma.totalPagar,
      saldoDevedor: cronograma.totalPagar,
      prestacoes: cronograma.prestacoes,
      estado: 'ativo'
    });
    await User.findByIdAndUpdate(req.user.id, { $inc: { saldoDisponivel: valor } });
    const freqLabel = freq === 'quinzenal' ? 'quinzenal' : 'mensal';
    await Transaction.create({ userId: req.user.id, tipo: 'credito', valor, estado: 'confirmado', descricao: `Empréstimo ${meses}m (${freqLabel}) @ ${TAXA_EMPRESTIMO_MENSAL}% a.m.` });
    await criarNotificacao(
      req.user.id,
      '✅ Empréstimo Aprovado',
      `MT ${valor.toLocaleString('pt-MZ')} creditados. ${cronograma.numeroPrestacoes} prestações ${freqLabel}es de MT ${cronograma.valorPrestacao.toLocaleString('pt-MZ')} (débito automático do saldo).`,
      'emprestimo'
    );
    const userAt = await User.findById(req.user.id);
    res.json({
      mensagem: `Empréstimo aprovado! MT ${valor.toLocaleString('pt-MZ')} creditados.`,
      emprestimo,
      valorPrestacao: cronograma.valorPrestacao,
      saldoDisponivel: userAt.saldoDisponivel
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/emprestimos/meus', authMiddleware, async (req, res) => {
  try {
    const loans = await Loan.find({ userId: req.user.id }).sort({ criadoEm: -1 });
    const agora = new Date();
    const result = loans.map(l => {
      const proxima = l.prestacoes?.find(p => p.estado === 'pendente' || p.estado === 'atrasada');
      const atrasadas = l.prestacoes?.filter(p => p.estado === 'atrasada').length || 0;
      return {
        ...l.toObject(),
        proximaPrestacao: proxima || null,
        prestacoesAtrasadas: atrasadas,
        cobranca: 'debito_automatico_saldo'
      };
    });
    res.json(result);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── TRANSAÇÕES ────────────────────────────────────────────────
app.get('/api/transacoes', authMiddleware, async (req, res) => {
  try {
    const txs = await Transaction.find({ userId: req.user.id }).sort({ criadoEm: -1 }).limit(50);
    res.json(txs);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── NOTIFICAÇÕES ──────────────────────────────────────────────
app.get('/api/notificacoes', authMiddleware, async (req, res) => {
  try {
    const notifs = await Notification.find({ userId: req.user.id }).sort({ criadoEm: -1 }).limit(30);
    const naoLidas = await Notification.countDocuments({ userId: req.user.id, lida: false });
    res.json({ notificacoes: notifs, naoLidas });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.put('/api/notificacoes/marcar-lidas', authMiddleware, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.id, lida: false }, { lida: true });
    res.json({ mensagem: 'Notificações marcadas como lidas.' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── COMISSIONISTAS ────────────────────────────────────────────
app.post('/api/comissionistas/aderir', authMiddleware, async (req, res) => {
  try {
    const { bi } = req.body;
    if (!bi || bi.length < 5) return res.status(400).json({ erro: 'Número de BI inválido.' });
    const user = await User.findById(req.user.id);
    if (user.isComissionista) return res.status(400).json({ erro: 'Já é parceiro ANURA.' });
    const codigo = await gerarCodigoParceiro();
    await User.findByIdAndUpdate(req.user.id, {
      isComissionista: true,
      codigoComissionista: codigo,
      biComissionista: bi,
      nivelParceiro: 0,
      depositosReferidos: 0,
      depositosNoNivelAtual: 0
    });
    const meta = getMetaParceiro(0);
    await criarNotificacao(
      req.user.id,
      '🎉 Parceiro ANURA Ativado!',
      `O seu código é: ${codigo}. Meta inicial: ${meta.depositos} depósitos confirmados = MT ${meta.premio.toLocaleString('pt-MZ')}.`,
      'sistema'
    );
    res.json({ mensagem: 'Adesão como parceiro aprovada!', codigo });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/comissionistas/painel', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user.isComissionista) return res.status(403).json({ erro: 'Não é parceiro ANURA.' });
    const comissoes = await Comissao.find({ comissionistaId: req.user.id }).populate('clienteId', 'nome').sort({ criadoEm: -1 });
    const totalConversoes = comissoes.length;
    const totalDepositos  = comissoes.reduce((a, c) => a + c.valorDeposito, 0);
    const agora = new Date();
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const premiosMes = await Transaction.find({
      userId: req.user.id,
      tipo: 'comissao',
      estado: 'confirmado',
      criadoEm: { $gte: inicioMes }
    });
    const ganhosMes = premiosMes.reduce((a, t) => a + t.valor, 0);
    const nivelIdx = user.nivelParceiro || 0;
    const metaAtual = getMetaParceiro(nivelIdx);
    const progresso = user.depositosNoNivelAtual || 0;
    res.json({
      codigo: user.codigoComissionista,
      nivelParceiro: nivelIdx,
      totalConversoes,
      totalDepositos,
      totalGanhos: user.ganhosTotaisComissoes,
      ganhosMes,
      metaAtual: metaAtual.depositos,
      premioAtual: metaAtual.premio,
      progresso,
      faltam: Math.max(0, metaAtual.depositos - progresso),
      depositosReferidos: user.depositosReferidos || totalConversoes,
      comissoes: comissoes.slice(0, 20),
      ultimosDepositos: comissoes.slice(0, 10).map(c => ({
        nome: c.clienteId?.nome || 'Cliente',
        valor: c.valorDeposito,
        data: c.criadoEm
      }))
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── RANKING ───────────────────────────────────────────────────
app.get('/api/ranking/investidores', async (req, res) => {
  try {
    const users = await User.find({ saldoInvestido: { $gt: 0 } }).select('nome nivel saldoInvestido saldoDisponivel lucroAcumulado').sort({ saldoInvestido: -1 }).limit(10);
    res.json(users);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/ranking/comissionistas', async (req, res) => {
  try {
    const users = await User.find({ isComissionista: true, ganhosTotaisComissoes: { $gt: 0 } }).select('nome nivel ganhosTotaisComissoes codigoComissionista').sort({ ganhosTotaisComissoes: -1 }).limit(10);
    res.json(users);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── ADMIN ─────────────────────────────────────────────────────
app.get('/api/admin/utilizadores', adminMiddleware, async (req, res) => {
  try { res.json(await User.find().select('-passwordHash').sort({ criadoEm: -1 })); }
  catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/admin/transacoes', adminMiddleware, async (req, res) => {
  try { res.json(await Transaction.find().populate('userId', 'nome email').sort({ criadoEm: -1 }).limit(100)); }
  catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/admin/levantamentos/aprovar/:id', adminMiddleware, async (req, res) => {
  try {
    const t = await Transaction.findById(req.params.id);
    if (!t) return res.status(404).json({ erro: 'Não encontrado.' });
    await Transaction.findByIdAndUpdate(req.params.id, { estado: 'depositado', descricao: 'Aprovado manualmente pelo admin', atualizadoEm: new Date() });
    await criarNotificacao(t.userId, '✅ Levantamento Concluído', 'O seu levantamento foi processado pelo administrador.', 'levantamento');
    res.json({ mensagem: 'Aprovado.' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/admin/kyc/aprovar/:userId', adminMiddleware, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.userId, { kycAprovado: true });
    await criarNotificacao(req.params.userId, '✅ KYC Aprovado', 'A sua identidade foi verificada com sucesso.', 'sistema');
    res.json({ mensagem: 'KYC aprovado.' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/admin/depositos', adminMiddleware, async (req, res) => {
  try {
    const estado = req.query.estado || 'pendente';
    const filtro = { tipo: 'deposito' };
    if (estado !== 'todos') filtro.estado = estado;
    const depositos = await Transaction.find(filtro).populate('userId', 'nome email telefone').sort({ criadoEm: -1 }).limit(100);
    res.json(depositos);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/admin/depositos/aprovar/:id', adminMiddleware, async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ erro: 'Depósito não encontrado.' });
    const userFinal = await aprovarDeposito(tx);
    res.json({ mensagem: 'Depósito aprovado. Saldo e estatísticas atualizados.', saldoDisponivel: userFinal.saldoDisponivel, creditScore: userFinal.creditScore });
  } catch (err) { res.status(400).json({ erro: err.message }); }
});

app.post('/api/admin/depositos/rejeitar/:id', adminMiddleware, async (req, res) => {
  try {
    const { motivo } = req.body;
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.tipo !== 'deposito') return res.status(404).json({ erro: 'Depósito não encontrado.' });
    if (tx.estado !== 'pendente') return res.status(400).json({ erro: 'Este depósito já foi processado.' });
    await Transaction.findByIdAndUpdate(tx._id, { estado: 'rejeitado', motivoRejeicao: motivo || 'Comprovativo inválido ou inconsistente.', descricao: 'Depósito rejeitado', atualizadoEm: new Date() });
    await criarNotificacao(tx.userId, '❌ Depósito Rejeitado', motivo || 'O seu comprovativo foi rejeitado. Verifique os dados e tente novamente.', 'deposito');
    res.json({ mensagem: 'Depósito rejeitado. Utilizador notificado.' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── SERVE FRONTEND ────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`🚀  ANURA v2 a correr em http://localhost:${PORT}`);
  iniciarJobsFinanceiros();
});
module.exports = app;