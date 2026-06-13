const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'public', 'index.html');
let html = fs.readFileSync(file, 'utf8');

const replacements = [
  // 1. Hide balance on landing hero
  [
    /<div class="hero-visual">[\s\S]*?<\/div>\s*<\/section>/,
    `<div class="hero-visual" id="heroVisualPublic">
      <div class="hero-card-demo">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--ivory-muted)">Conta ANURA</div>
          <div class="badge pending">🔒 Privado</div>
        </div>
        <div style="font-family:'Space Grotesk',sans-serif;font-size:1.5rem;font-weight:700;margin-bottom:0.5rem;color:var(--gold)">Saldo protegido</div>
        <div style="font-size:0.82rem;color:var(--ivory-muted);margin-bottom:1.5rem;line-height:1.6">O seu saldo e rendimentos só ficam visíveis após iniciar sessão com a conta registada.</div>
        <button class="btn btn-gold btn-full btn-sm" onclick="showLandingAuth('login')">Entrar para ver saldo</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
        <div class="hero-card-demo" style="padding:1.1rem">
          <div style="font-size:0.68rem;color:var(--ivory-muted);margin-bottom:0.4rem;text-transform:uppercase;letter-spacing:0.1em">Ciclos</div>
          <div style="font-family:'Space Grotesk',sans-serif;font-size:1.5rem;font-weight:700;color:var(--gold)">15 / 30d</div>
          <div style="font-size:0.68rem;color:var(--ivory-muted)">Quinzenal e mensal</div>
        </div>
        <div class="hero-card-demo" style="padding:1.1rem">
          <div style="font-size:0.68rem;color:var(--ivory-muted);margin-bottom:0.4rem;text-transform:uppercase;letter-spacing:0.1em">e-Mola</div>
          <div style="font-family:'Space Grotesk',sans-serif;font-size:1.5rem;font-weight:700;color:var(--success)">2 min</div>
          <div style="font-size:0.68rem;color:var(--ivory-muted)">Levantamentos</div>
        </div>
      </div>
    </div>
  </section>`
  ],
  // 2. Deposit e-Mola numbers - dynamic placeholders
  [
    `<div class="step-title">Envie para o número e-Mola</div>
                    <div class="step-desc">Transfira o valor desejado para:</div>
                    <div class="emola-number" onclick="copyToClipboard('871631824')">871 631 824</div>`,
    `<div class="step-title">Envie para a plataforma e-Mola</div>
                    <div class="step-desc">Transfira o valor para o número da ANURA:</div>
                    <div class="emola-number" id="depNumeroPlataforma" onclick="copyEmolaNumero('plataforma')">—</div>
                    <div class="step-desc" style="margin-top:0.75rem">Número da sua conta (registo):</div>
                    <div class="emola-number" id="depNumeroConta" onclick="copyEmolaNumero('conta')" style="font-size:1.1rem">—</div>`
  ],
  // 3. Withdraw destination
  [
    `<div style="font-size:0.78rem;color:var(--ivory-muted);margin-bottom:0.35rem">Destino do levantamento</div>
                <div style="font-family:'Space Grotesk',sans-serif;font-size:1.1rem;font-weight:700;color:var(--gold)">e-Mola · 871 631 824</div>
                <div style="font-size:0.72rem;color:var(--ivory-muted);margin-top:0.25rem">Processado em ~2 minutos</div>`,
    `<div style="font-size:0.78rem;color:var(--ivory-muted);margin-bottom:0.35rem">Destino do levantamento (seu e-Mola)</div>
                <div style="font-family:'Space Grotesk',sans-serif;font-size:1.1rem;font-weight:700;color:var(--gold)" id="withdrawDestino">—</div>
                <div style="font-size:0.72rem;color:var(--ivory-muted);margin-top:0.25rem">Número registado na conta · processado em ~2 minutos</div>`
  ],
  // 4. Credit form - frequency + simulator
  [
    `<div class="form-group">
                <label class="form-label">Prazo</label>
                <select class="form-input" id="loanPrazo">
                  <option value="3">3 meses — 3.5% a.m.</option>
                  <option value="6">6 meses — 3.5% a.m.</option>
                  <option value="12">12 meses — 3.5% a.m.</option>
                </select>
              </div>
              <div class="card card-sm card-gold" style="margin-bottom:1.5rem">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.78rem">
                  <div><span style="color:var(--ivory-muted)">Taxa mensal</span><br><strong>3.5%</strong></div>
                  <div><span style="color:var(--ivory-muted)">Aprovação</span><br><strong>Automática</strong></div>
                </div>
              </div>`,
    `<div class="form-group">
                <label class="form-label">Frequência de pagamento</label>
                <select class="form-input" id="loanFreq" onchange="updateLoanSimulator()">
                  <option value="quinzenal">Quinzenal (a cada 15 dias)</option>
                  <option value="mensal">Mensal (a cada 30 dias)</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Prazo</label>
                <select class="form-input" id="loanPrazo" onchange="updateLoanSimulator()">
                  <option value="3">3 meses</option>
                  <option value="6">6 meses</option>
                  <option value="12">12 meses</option>
                </select>
              </div>
              <div class="card card-sm card-gold" style="margin-bottom:1rem">
                <div style="font-size:0.78rem;color:var(--ivory-muted);margin-bottom:0.5rem">Simulação</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.78rem">
                  <div><span style="color:var(--ivory-muted)" id="loanSimLabel">Prestação quinzenal</span><br><strong id="loanSimPrestacao">— MT</strong></div>
                  <div><span style="color:var(--ivory-muted)">Total a pagar</span><br><strong id="loanSimTotal">— MT</strong></div>
                  <div><span style="color:var(--ivory-muted)">Prestações</span><br><strong id="loanSimNum">—</strong></div>
                  <div><span style="color:var(--ivory-muted)">Cobrança</span><br><strong>Débito automático</strong></div>
                </div>
              </div>
              <p style="font-size:0.75rem;color:var(--ivory-muted);margin-bottom:1rem;line-height:1.5">As prestações são debitadas automaticamente do seu saldo nas datas de vencimento. Mantenha saldo suficiente para evitar atrasos.</p>`
  ],
  // 5. Investment plan features - quinzenal/mensal
  [
    `<li>Ciclos de 15 dias</li>`,
    `<li>Rendimento quinzenal (15d) ou mensal (30d)</li>`
  ],
  // 6. Invest modal - add ciclo selector
  [
    `<div class="form-group">
      <label class="form-label">Valor a Investir (MT)</label>
      <input type="number" class="form-input" id="investValor" placeholder="Ex: 1000">
      <div class="form-hint" id="investMinHint">Mínimo: MT 200</div>
    </div>`,
    `<div class="form-group">
      <label class="form-label">Ciclo de rendimento</label>
      <select class="form-input" id="investCiclo">
        <option value="quinzenal">Quinzenal — a cada 15 dias</option>
        <option value="mensal">Mensal — a cada 30 dias</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Valor a Investir (MT)</label>
      <input type="number" class="form-input" id="investValor" placeholder="Ex: 1000">
      <div class="form-hint" id="investMinHint">Mínimo: MT 200</div>
    </div>`
  ],
  // 7. STATE - add emola config
  [
    `  charts: {}
};`,
    `  charts: {},
  emolaConfig: null
};`
  ],
  // 8. invCardHTML - show ciclo
  [
    `  const prog = Math.min(100 - (inv.diasRestantes / 15) * 100, 100);`,
    `  const diasCiclo = inv.diasCiclo || (inv.cicloRendimento === 'mensal' ? 30 : 15);
  const prog = Math.min(100, inv.progressoCiclo || (100 - (inv.diasRestantes / diasCiclo) * 100));`
  ],
  [
    `      <div class="inv-meta-item">Próximo ciclo<div class="inv-meta-value">${inv.diasRestantes} dia(s)</div></div>`,
    `      <div class="inv-meta-item">Ciclo<div class="inv-meta-value">${inv.cicloRendimento === 'mensal' ? 'Mensal' : 'Quinzenal'}</div></div>
      <div class="inv-meta-item">Próximo pagamento<div class="inv-meta-value">${inv.diasRestantes} dia(s)</div></div>`
  ],
  [
    `        <div style="font-size:0.72rem;color:var(--ivory-muted)">${inv.apy}% APY</div>`,
    `        <div style="font-size:0.72rem;color:var(--ivory-muted)">${inv.apy}% a.m. · +MT ${fmtMT(inv.lucroPorCiclo || 0)}/${inv.cicloRendimento === 'mensal' ? 'mês' : 'quinzena'}</div>`
  ],
  // 9. confirmInvestment - send ciclo
  [
    `    const data = await api('POST', '/api/investimentos/alocar', { valor, plano: STATE.investPlan });`,
    `    const ciclo = document.getElementById('investCiclo')?.value || 'quinzenal';
    const data = await api('POST', '/api/investimentos/alocar', { valor, plano: STATE.investPlan, cicloRendimento: ciclo });`
  ],
  // 10. submitLoan - send freq
  [
    `  const prazoMeses = parseInt(document.getElementById('loanPrazo').value);
  if (!valor || valor <= 0) return showToast('Valor inválido.', 'error');
  try {
    const data = await api('POST', '/api/emprestimos/pedir', { valor, prazoMeses });`,
    `  const prazoMeses = parseInt(document.getElementById('loanPrazo').value);
  const freqPagamento = document.getElementById('loanFreq')?.value || 'mensal';
  if (!valor || valor <= 0) return showToast('Valor inválido.', 'error');
  try {
    const data = await api('POST', '/api/emprestimos/pedir', { valor, prazoMeses, freqPagamento });`
  ],
  // 11. loadCredit - better loan display + simulator init
  [
    `    if (el) el.innerHTML = loans.length ? loans.slice(0,5).map(l => \`
      <div class="activity-item">
        <div class="activity-icon gold">🏦</div>
        <div class="activity-info">
          <div class="activity-title">Empréstimo ${l.prazoMeses}m @ ${l.taxaMensal}% a.m.</div>
          <div class="activity-time">${fmtDate(l.criadoEm)}</div>
        </div>
        <div>
          <div class="activity-amount positive">MT ${fmtMT(l.valor)}</div>
          <div class="activity-status">${statusBadge(l.estado)}</div>
        </div>
      </div>\`).join('') : \`<div class="empty-state"><div class="empty-state-icon">🏦</div><div class="empty-state-title">Nenhum empréstimo</div></div>\`;`,
    `    if (el) el.innerHTML = loans.length ? loans.slice(0,5).map(l => {
      const freq = l.freqPagamento === 'quinzenal' ? 'quinzenal' : 'mensal';
      const prox = l.proximaPrestacao;
      const proxTxt = prox ? \`Próxima: MT \${fmtMT(prox.valor)} · \${fmtDate(prox.vencimento)}\` : 'Concluído';
      return \`<div class="activity-item">
        <div class="activity-icon gold">🏦</div>
        <div class="activity-info">
          <div class="activity-title">MT \${fmtMT(l.valor)} · \${l.prazoMeses}m (\${freq})</div>
          <div class="activity-time">Prestação \${freq}: MT \${fmtMT(l.valorPrestacao || 0)} · \${proxTxt}</div>
        </div>
        <div>
          <div class="activity-amount negative">Deve MT \${fmtMT(l.saldoDevedor || 0)}</div>
          <div class="activity-status">\${statusBadge(l.estado)}</div>
        </div>
      </div>\`;
    }).join('') : \`<div class="empty-state"><div class="empty-state-icon">🏦</div><div class="empty-state-title">Nenhum empréstimo</div></div>\`;
    updateLoanSimulator();`
  ],
  // 12. TX labels
  [
    `const TX_LABELS = { deposito:'Depósito', levantamento:'Levantamento', investimento:'Investimento', rendimento:'Rendimento', credito:'Empréstimo', comissao:'Prémio Parceiro' };`,
    `const TX_LABELS = { deposito:'Depósito', levantamento:'Levantamento', investimento:'Investimento', rendimento:'Rendimento', credito:'Empréstimo', comissao:'Prémio Parceiro', prestacao:'Prestação' };`
  ],
  [
    `  const isIn = ['deposito','rendimento','credito','comissao'].includes(tx.tipo);`,
    `  const isIn = ['deposito','rendimento','credito','comissao'].includes(tx.tipo);
  const isOut = ['levantamento','investimento','prestacao'].includes(tx.tipo);`
  ],
  [
    `      <div class="activity-amount ${isIn?'positive':'negative'}">${isIn?'+':'-'}MT ${fmtMT(tx.valor)}</div>`,
    `      <div class="activity-amount ${isIn?'positive':'negative'}">${isIn?'+':(isOut?'-':'')}MT ${fmtMT(tx.valor)}</div>`
  ],
  // 13. admin fix codigoParceiro
  [
    `<td>${d.codigoParceiro||'—'}</td>`,
    `<td>${d.codigoComissionista||'—'}</td>`
  ],
  // 14. enterApp - load emola
  [
    `function enterApp() {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  updateSidebar();
  navigate('dashboard');
  loadNotifications();
}`,
    `function enterApp() {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  updateSidebar();
  loadEmolaConfig();
  navigate('dashboard');
  loadNotifications();
}`
  ],
  // 15. loadWithdrawScreen - load destino
  [
    `async function loadWithdrawScreen() {
  try {
    const user = await api('GET', '/api/auth/perfil');
    STATE.user = user;
    document.getElementById('withdrawSaldo').textContent = 'MT ' + fmtMT(user.saldoDisponivel);`,
    `async function loadWithdrawScreen() {
  try {
    const [user, wdCfg] = await Promise.all([
      api('GET', '/api/auth/perfil'),
      api('GET', '/api/levantamentos/config').catch(() => null)
    ]);
    STATE.user = user;
    document.getElementById('withdrawSaldo').textContent = 'MT ' + fmtMT(user.saldoDisponivel);
    const destEl = document.getElementById('withdrawDestino');
    if (destEl) destEl.textContent = 'e-Mola · ' + formatTelefone(wdCfg?.numeroDestino || user.telefone || '—');`
  ],
  // 16. loadDepositHistory - load config
  [
    `async function loadDepositHistory() {
  const el = document.getElementById('depositHistory');
  if (!el) return;
  try {
    const deps = await api('GET', '/api/depositos/meus');`,
    `async function loadDepositHistory() {
  await loadEmolaConfig();
  const el = document.getElementById('depositHistory');
  if (!el) return;
  try {
    const deps = await api('GET', '/api/depositos/meus');`
  ]
];

let failed = 0;
for (const [from, to] of replacements) {
  if (typeof from === 'string') {
    if (!html.includes(from) && !(from instanceof RegExp)) {
      console.warn('MISSING string:', from.slice(0, 60));
      failed++;
      continue;
    }
    html = html.replace(from, to);
  } else {
    if (!from.test(html)) {
      console.warn('MISSING regex:', from);
      failed++;
      continue;
    }
    html = html.replace(from, to);
  }
}

// Insert new JS functions before DEPOSITS section if not present
if (!html.includes('function loadEmolaConfig')) {
  const insert = `
async function loadEmolaConfig() {
  if (!STATE.token) return;
  try {
    const cfg = await api('GET', '/api/depositos/config');
    STATE.emolaConfig = cfg;
    const plat = document.getElementById('depNumeroPlataforma');
    const conta = document.getElementById('depNumeroConta');
    if (plat) plat.textContent = formatTelefone(cfg.numeroPlataforma || '—');
    if (conta) conta.textContent = formatTelefone(cfg.numeroConta || cfg.numeroDestino || '—');
  } catch {}
}

function formatTelefone(t) {
  const d = String(t || '').replace(/\\D/g, '');
  if (d.length === 9) return d.replace(/(\\d{3})(\\d{3})(\\d{3})/, '$1 $2 $3');
  return t || '—';
}

function copyEmolaNumero(tipo) {
  const cfg = STATE.emolaConfig;
  const num = tipo === 'conta' ? (cfg?.numeroConta || cfg?.numeroDestino) : cfg?.numeroPlataforma;
  if (num) copyToClipboard(String(num).replace(/\\s/g, ''));
}

async function updateLoanSimulator() {
  const valor = parseFloat(document.getElementById('loanValor')?.value) || 0;
  const prazoMeses = parseInt(document.getElementById('loanPrazo')?.value, 10) || 3;
  const freq = document.getElementById('loanFreq')?.value || 'quinzenal';
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  if (!valor) {
    set('loanSimPrestacao', '— MT');
    set('loanSimTotal', '— MT');
    set('loanSimNum', '—');
    set('loanSimLabel', freq === 'quinzenal' ? 'Prestação quinzenal' : 'Prestação mensal');
    return;
  }
  try {
    const sim = await api('GET', \`/api/emprestimos/simular?valor=\${valor}&prazoMeses=\${prazoMeses}&freqPagamento=\${freq}\`);
    set('loanSimLabel', sim.labelPrestacao);
    set('loanSimPrestacao', fmtMT(sim.valorPrestacao) + ' MT');
    set('loanSimTotal', fmtMT(sim.totalPagar) + ' MT');
    set('loanSimNum', String(sim.numeroPrestacoes));
  } catch {
    set('loanSimPrestacao', '— MT');
    set('loanSimTotal', '— MT');
  }
}

`;
  html = html.replace('// ── DEPOSITS ─', insert + '// ── DEPOSITS ─');
}

// Wire loan valor input
if (!html.includes("loanValor').addEventListener")) {
  html = html.replace(
    `(async function init() {`,
    `document.getElementById('loanValor')?.addEventListener('input', updateLoanSimulator);

(async function init() {`
  );
}

fs.writeFileSync(file, html, 'utf8');
console.log('Patched index.html. Failed patterns:', failed);
