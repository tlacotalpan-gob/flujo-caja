// ============================================================
// Flujo de Caja — lógica de la app (captura + flujo)
// No necesitas editar este archivo. Toda la configuración vive en config.js.
// ============================================================

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let CAJAS = [];       // catálogo de cajas cargado de Supabase
let CATEGORIAS = [];  // catálogo de categorías cargado de Supabase
let TIPO_ACTUAL = 'Entrada';
let CAJA_FILTRO = '';
let PERIODO_FILTRO = 'mes';

// ---------- Sesión / login ----------

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    errEl.textContent = 'No se pudo entrar: revisa tu correo y contraseña.';
    return;
  }
  await startApp();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await sb.auth.signOut();
  document.getElementById('app-view').classList.add('hide');
  document.getElementById('login-view').classList.remove('hide');
});

async function checkSession() {
  const { data } = await sb.auth.getSession();
  if (data.session) {
    await startApp();
  }
}

async function startApp() {
  const { data: { user } } = await sb.auth.getUser();
  document.getElementById('user-email').textContent = user ? user.email : '';
  document.getElementById('login-view').classList.add('hide');
  document.getElementById('app-view').classList.remove('hide');

  await loadCatalogos();
  setDefaultDates();
  setTipo('Entrada');
  await loadSaldos();
  await loadFlujo();
}

// ---------- Catálogos ----------

async function loadCatalogos() {
  const { data: cajas } = await sb.from('cajas').select('*').eq('activa', true).order('nombre');
  CAJAS = cajas || [];
  const { data: categorias } = await sb.from('categorias').select('*').eq('activa', true).order('nombre');
  CATEGORIAS = categorias || [];

  const cajaSelects = ['mov-caja', 'tr-origen', 'tr-destino'];
  cajaSelects.forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = CAJAS.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  });

  const catSelect = document.getElementById('mov-categoria');
  catSelect.innerHTML = '<option value="">(sin categoría)</option>' +
    CATEGORIAS.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');

  // chips de filtro por caja en pantalla Flujo
  const cajaFiltersEl = document.getElementById('flujo-caja-filters');
  cajaFiltersEl.innerHTML = '<div class="chip active" data-caja="">Ambas cajas</div>' +
    CAJAS.map(c => `<div class="chip" data-caja="${c.id}">${c.nombre}</div>`).join('');
  cajaFiltersEl.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      cajaFiltersEl.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      CAJA_FILTRO = chip.dataset.caja;
      loadFlujo();
    });
  });

  document.getElementById('flujo-periodo-filters').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#flujo-periodo-filters .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      PERIODO_FILTRO = chip.dataset.periodo;
      loadFlujo();
    });
  });
}

function setDefaultDates() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('mov-fecha').value = today;
  document.getElementById('tr-fecha').value = today;
}

// ---------- Captura: modo (Movimiento / Transferencia) ----------

function setMode(mode) {
  document.getElementById('tab-mov').classList.toggle('active', mode === 'mov');
  document.getElementById('tab-tr').classList.toggle('active', mode === 'tr');
  document.getElementById('mov-form').classList.toggle('hide', mode !== 'mov');
  document.getElementById('tr-form').classList.toggle('hide', mode !== 'tr');
}

function setTipo(tipo) {
  TIPO_ACTUAL = tipo;
  document.getElementById('btn-entrada').classList.toggle('active-in', tipo === 'Entrada');
  document.getElementById('btn-salida').classList.toggle('active-out', tipo === 'Salida');
}

// ---------- Captura: guardar movimiento ----------

document.getElementById('mov-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById('mov-msg');
  msgEl.textContent = '';
  msgEl.style.color = 'var(--critical)';

  const payload = {
    fecha: document.getElementById('mov-fecha').value,
    caja_id: document.getElementById('mov-caja').value,
    tipo: TIPO_ACTUAL,
    monto: parseFloat(document.getElementById('mov-monto').value),
    categoria_id: document.getElementById('mov-categoria').value || null,
    concepto: document.getElementById('mov-concepto').value || null,
    descripcion: document.getElementById('mov-descripcion').value || null,
  };

  if (!payload.monto || payload.monto <= 0) {
    msgEl.textContent = 'El monto debe ser mayor a cero.';
    return;
  }

  const { error } = await sb.from('movimientos').insert(payload);
  if (error) {
    msgEl.textContent = 'No se pudo guardar: ' + error.message;
    return;
  }

  msgEl.style.color = 'var(--good)';
  msgEl.textContent = '✓ Movimiento guardado.';
  showToast(`${TIPO_ACTUAL === 'Entrada' ? '↓' : '↑'} $${payload.monto.toLocaleString('es-MX')} guardado`);

  // limpiar solo lo variable, para capturar el siguiente movimiento rápido
  document.getElementById('mov-monto').value = '';
  document.getElementById('mov-concepto').value = '';
  document.getElementById('mov-descripcion').value = '';
  document.getElementById('mov-monto').focus();

  await loadSaldos();
  await loadFlujo();
});

// ---------- Captura: guardar transferencia ----------

document.getElementById('tr-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById('tr-msg');
  msgEl.textContent = '';
  msgEl.style.color = 'var(--critical)';

  const origen = document.getElementById('tr-origen').value;
  const destino = document.getElementById('tr-destino').value;
  const monto = parseFloat(document.getElementById('tr-monto').value);

  if (origen === destino) {
    msgEl.textContent = 'La caja de origen y destino no pueden ser la misma.';
    return;
  }
  if (!monto || monto <= 0) {
    msgEl.textContent = 'El monto debe ser mayor a cero.';
    return;
  }

  const payload = {
    fecha: document.getElementById('tr-fecha').value,
    caja_origen_id: origen,
    caja_destino_id: destino,
    monto,
    motivo: document.getElementById('tr-motivo').value || null,
  };

  const { error } = await sb.from('transferencias').insert(payload);
  if (error) {
    msgEl.textContent = 'No se pudo guardar: ' + error.message;
    return;
  }

  msgEl.style.color = 'var(--good)';
  msgEl.textContent = '✓ Transferencia guardada (se generaron los dos movimientos automáticamente).';
  showToast(`⇄ Transferencia de $${monto.toLocaleString('es-MX')} guardada`);

  document.getElementById('tr-monto').value = '';
  document.getElementById('tr-motivo').value = '';

  await loadSaldos();
  await loadFlujo();
});

// ---------- Saldos (barra superior) ----------

async function loadSaldos() {
  const { data: movs } = await sb.from('movimientos').select('caja_id, tipo, monto');
  const saldoPorCaja = {};
  CAJAS.forEach(c => { saldoPorCaja[c.id] = c.saldo_inicial || 0; });
  (movs || []).forEach(m => {
    if (!(m.caja_id in saldoPorCaja)) return;
    saldoPorCaja[m.caja_id] += (m.tipo === 'Entrada' ? 1 : -1) * Number(m.monto);
  });

  const total = Object.values(saldoPorCaja).reduce((a, b) => a + b, 0);
  document.getElementById('total-efectivo').textContent = fmtMoney(total);

  const tiles = [document.getElementById('mini-caja-1'), document.getElementById('mini-caja-2')];
  CAJAS.forEach((c, i) => {
    if (!tiles[i]) return;
    const val = saldoPorCaja[c.id] || 0;
    tiles[i].querySelector('.label').textContent = c.nombre;
    tiles[i].querySelector('.value').textContent = fmtMoney(val);
    tiles[i].classList.toggle('neg', val < 0);
  });
}

// ---------- Pantalla Flujo ----------

function rangoDeFechas(periodo) {
  const hoy = new Date();
  if (periodo === 'todo') return { desde: null, hasta: null };
  if (periodo === 'mes_pasado') {
    const desde = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const hasta = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    return { desde: isoDate(desde), hasta: isoDate(hasta) };
  }
  // 'mes' (por defecto): este mes
  const desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  return { desde: isoDate(desde), hasta: isoDate(hasta) };
}

async function loadFlujo() {
  const { desde, hasta } = rangoDeFechas(PERIODO_FILTRO);
  let query = sb.from('movimientos')
    .select('tipo, monto, categoria_id, caja_id, es_transferencia')
    .eq('es_transferencia', false);

  if (desde) query = query.gte('fecha', desde);
  if (hasta) query = query.lte('fecha', hasta);
  if (CAJA_FILTRO) query = query.eq('caja_id', CAJA_FILTRO);

  const { data: movs, error } = await query;
  if (error) { console.error(error); return; }

  let totalIn = 0, totalOut = 0;
  const inPorCat = {}, outPorCat = {};
  (movs || []).forEach(m => {
    const monto = Number(m.monto);
    const catNombre = categoriaNombre(m.categoria_id);
    if (m.tipo === 'Entrada') {
      totalIn += monto;
      inPorCat[catNombre] = (inPorCat[catNombre] || 0) + monto;
    } else {
      totalOut += monto;
      outPorCat[catNombre] = (outPorCat[catNombre] || 0) + monto;
    }
  });

  document.getElementById('flujo-in').textContent = fmtMoney(totalIn);
  document.getElementById('flujo-out').textContent = fmtMoney(totalOut);
  const neto = totalIn - totalOut;
  const netoEl = document.getElementById('flujo-neto');
  netoEl.textContent = (neto >= 0 ? '+' : '') + fmtMoney(neto);
  netoEl.style.color = neto >= 0 ? 'var(--good)' : 'var(--critical)';

  renderRanking('rank-in', inPorCat, 'var(--series-1)');
  renderRanking('rank-out', outPorCat, 'var(--series-2)');
}

function renderRanking(elId, porCategoria, color) {
  const el = document.getElementById(elId);
  const entries = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    el.innerHTML = '<div class="empty-note">Sin movimientos en este periodo.</div>';
    return;
  }
  const max = entries[0][1];
  el.innerHTML = entries.map(([nombre, monto]) => `
    <div class="rank-row">
      <div class="rank-head"><span class="cat">${nombre}</span><span class="amt">${fmtMoney(monto)}</span></div>
      <div class="rank-track"><div class="rank-fill" style="width:${(monto / max * 100).toFixed(0)}%;background:${color}"></div></div>
    </div>`).join('');
}

function categoriaNombre(id) {
  if (!id) return 'Sin categoría';
  const c = CATEGORIAS.find(c => c.id === id);
  return c ? c.nombre : 'Sin categoría';
}

// ---------- Utilidades ----------

function isoDate(d) { return d.toISOString().slice(0, 10); }
function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('es-MX'); }

function showScreen(name, btn) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('s-' + name).classList.add('active');
  document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (name === 'flujo') loadFlujo();
}

function showToast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------- Arranque ----------
checkSession();
