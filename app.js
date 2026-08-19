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
let MOVLIST_PERIODO = 'mes';
let MOVLIST_TIPO = '';
let MOVLIST_CAJA = '';
let MOVLIST_BUSCAR = '';

// ---------- Mayúsculas automáticas ----------
// Cualquier campo de texto libre con class="mayus" se convierte a
// mayúsculas mientras el usuario escribe (login no lleva esta clase).
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.classList && el.classList.contains('mayus')) {
    const pos = el.selectionStart;
    el.value = el.value.toUpperCase();
    if (pos !== null) el.setSelectionRange(pos, pos);
  }
});

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

  const cajaSelects = ['mov-caja', 'tr-origen', 'tr-destino', 'cobro-caja'];
  cajaSelects.forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = CAJAS.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  });

  renderCategoriaSelect();

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

  // filtros de la pantalla Movimientos
  const movCajaFiltersEl = document.getElementById('mov-list-caja-filters');
  movCajaFiltersEl.innerHTML = '<div class="chip active" data-caja="">Ambas cajas</div>' +
    CAJAS.map(c => `<div class="chip" data-caja="${c.id}">${c.nombre}</div>`).join('');
  movCajaFiltersEl.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      movCajaFiltersEl.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      MOVLIST_CAJA = chip.dataset.caja;
      loadMovimientosList();
    });
  });

  document.getElementById('mov-list-periodo-filters').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#mov-list-periodo-filters .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      MOVLIST_PERIODO = chip.dataset.periodo;
      loadMovimientosList();
    });
  });

  document.getElementById('mov-list-tipo-filters').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#mov-list-tipo-filters .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      MOVLIST_TIPO = chip.dataset.tipo;
      loadMovimientosList();
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
  renderCategoriaSelect();
}

// ---------- Categoría: filtrar por tipo (Entrada/Salida) + alta rápida ----------

function renderCategoriaSelect() {
  const catSelect = document.getElementById('mov-categoria');
  const valorPrevio = catSelect.value;
  const tipoCatalogo = TIPO_ACTUAL === 'Entrada' ? 'Ingreso' : 'Egreso';
  const opciones = CATEGORIAS.filter(c => c.tipo === tipoCatalogo || c.tipo === 'Ambos');
  catSelect.innerHTML = '<option value="">(sin categoría)</option>' +
    opciones.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  // si la categoría que estaba elegida sigue siendo válida para este tipo, la conservamos
  if (opciones.some(c => c.id === valorPrevio)) catSelect.value = valorPrevio;
}

function toggleNuevaCategoria(forzarCerrado) {
  const box = document.getElementById('nueva-categoria-box');
  const abrir = forzarCerrado === true ? false : box.classList.contains('hide');
  box.classList.toggle('hide', !abrir);
  document.getElementById('nueva-categoria-msg').textContent = '';
  document.getElementById('nueva-categoria-nombre').value = '';
  document.getElementById('nueva-categoria-ambos').checked = false;
  if (abrir) {
    document.getElementById('nueva-categoria-opuesto').textContent = TIPO_ACTUAL === 'Entrada' ? 'salidas' : 'entradas';
    document.getElementById('nueva-categoria-nombre').focus();
  }
}

document.getElementById('btn-nueva-categoria').addEventListener('click', () => toggleNuevaCategoria());
document.getElementById('btn-cancelar-categoria').addEventListener('click', () => toggleNuevaCategoria(true));

document.getElementById('btn-guardar-categoria').addEventListener('click', async () => {
  const nombre = document.getElementById('nueva-categoria-nombre').value.trim().toUpperCase();
  const msgEl = document.getElementById('nueva-categoria-msg');
  msgEl.textContent = '';
  if (!nombre) {
    msgEl.textContent = 'Escribe un nombre para la categoría.';
    return;
  }
  const ambos = document.getElementById('nueva-categoria-ambos').checked;
  const tipo = ambos ? 'Ambos' : (TIPO_ACTUAL === 'Entrada' ? 'Ingreso' : 'Egreso');
  const { data, error } = await sb.from('categorias').insert({ nombre, tipo }).select().single();
  if (error) {
    msgEl.textContent = 'No se pudo guardar: ' + error.message;
    return;
  }
  CATEGORIAS.push(data);
  CATEGORIAS.sort((a, b) => a.nombre.localeCompare(b.nombre));
  renderCategoriaSelect();
  document.getElementById('mov-categoria').value = data.id;
  toggleNuevaCategoria(true);
});

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
    concepto: document.getElementById('mov-concepto').value.toUpperCase() || null,
    descripcion: document.getElementById('mov-descripcion').value.toUpperCase() || null,
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
    motivo: document.getElementById('tr-motivo').value.toUpperCase() || null,
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

// ---------- Proyección ----------

function renderCobroCategoriaSelect() {
  const sel = document.getElementById('cobro-categoria');
  if (!sel) return;
  const opciones = CATEGORIAS.filter(c => c.tipo === 'Ingreso' || c.tipo === 'Ambos');
  sel.innerHTML = '<option value="">(sin categoría)</option>' +
    opciones.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
}

function proyectarRecurrente(movs) {
  // movs: lista ordenada por fecha ascendente de {fecha, monto, caja_id}
  if (!movs || movs.length === 0) return null;
  const fechas = movs.map(m => new Date(m.fecha + 'T00:00:00'));
  const montos = movs.map(m => Number(m.monto));
  const ultimaFecha = fechas[fechas.length - 1];

  let intervalos = [];
  for (let i = 1; i < fechas.length; i++) intervalos.push((fechas[i] - fechas[i - 1]) / 86400000);
  const intervaloProm = intervalos.length ? intervalos.reduce((a, b) => a + b, 0) / intervalos.length : 30;

  const ultimos3 = montos.slice(-3);
  const montoProm = ultimos3.reduce((a, b) => a + b, 0) / ultimos3.length;

  return {
    proximaFecha: new Date(ultimaFecha.getTime() + intervaloProm * 86400000),
    montoEsperado: Math.round(montoProm * 100) / 100,
    cajaId: movs[movs.length - 1].caja_id,
  };
}

async function loadProyeccion() {
  renderCobroCategoriaSelect();

  // Saldo actual (mismo cálculo que loadSaldos)
  const { data: movs } = await sb.from('movimientos').select('caja_id, tipo, monto');
  let saldoActual = 0;
  CAJAS.forEach(c => { saldoActual += Number(c.saldo_inicial) || 0; });
  (movs || []).forEach(m => { saldoActual += (m.tipo === 'Entrada' ? 1 : -1) * Number(m.monto); });
  document.getElementById('proy-saldo-actual').textContent = fmtMoney(saldoActual);

  // Predicciones de arrendamientos recurrentes (Retro, Compactador...), a partir del historial
  const catArrendamiento = CATEGORIAS.find(c => c.nombre === 'Arrendamiento');
  let predicciones = [];
  if (catArrendamiento) {
    const { data: movsArr } = await sb.from('movimientos')
      .select('fecha, monto, concepto, caja_id')
      .eq('categoria_id', catArrendamiento.id)
      .eq('tipo', 'Entrada')
      .eq('es_transferencia', false)
      .order('fecha', { ascending: true });

    const porConcepto = {};
    (movsArr || []).forEach(m => {
      const key = m.concepto || '(sin nombre)';
      (porConcepto[key] = porConcepto[key] || []).push(m);
    });

    predicciones = Object.entries(porConcepto)
      .map(([concepto, lista]) => ({ concepto, ...proyectarRecurrente(lista) }))
      .filter(p => p.proximaFecha);
  }

  // Cobros pendientes ya guardados (manuales + recurrentes ya generados antes)
  const { data: pendientesData } = await sb.from('cobros_pendientes')
    .select('*')
    .eq('estado', 'Pendiente');
  const pendientes = pendientesData || [];

  // Si hay una predicción recurrente sin fila pendiente todavía, la creamos
  // (así queda guardada y editable, en vez de recalcularse cada vez)
  const faltantes = predicciones.filter(pred =>
    !pendientes.some(p => p.origen === 'Recurrente' && p.concepto_recurrente === pred.concepto)
  );
  if (faltantes.length > 0 && catArrendamiento) {
    const nuevos = faltantes.map(pred => ({
      descripcion: pred.concepto,
      caja_id: pred.cajaId,
      categoria_id: catArrendamiento.id,
      monto_esperado: pred.montoEsperado,
      fecha_esperada: isoDate(pred.proximaFecha),
      origen: 'Recurrente',
      concepto_recurrente: pred.concepto,
    }));
    const { data: insertados, error: errIns } = await sb.from('cobros_pendientes').insert(nuevos).select();
    if (!errIns && insertados) pendientes.push(...insertados);
  }

  pendientes.sort((a, b) => {
    const fa = a.fecha_esperada ? new Date(a.fecha_esperada) : new Date('9999-12-31');
    const fb = b.fecha_esperada ? new Date(b.fecha_esperada) : new Date('9999-12-31');
    return fa - fb;
  });

  renderRecurrentes(pendientes.filter(p => p.origen === 'Recurrente'));
  renderPendientes(pendientes.filter(p => p.origen !== 'Recurrente'));

  const hoy = new Date();
  const en30dias = new Date(hoy.getTime() + 30 * 86400000);
  const cobrosEsperados30 = pendientes
    .filter(p => !p.fecha_esperada || new Date(p.fecha_esperada + 'T00:00:00') <= en30dias)
    .reduce((sum, p) => sum + Number(p.monto_esperado), 0);

  document.getElementById('proy-cobros-esperados').textContent = fmtMoney(cobrosEsperados30);
  document.getElementById('proy-30').textContent = fmtMoney(saldoActual + cobrosEsperados30);
}

function fmtFecha(d) {
  if (!(d instanceof Date)) d = new Date(d + 'T00:00:00');
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function filaCobroHtml(p) {
  const mostrarCancelar = p.origen !== 'Recurrente';
  return `
    <div class="cobro-row" data-id="${p.id}">
      <div class="top">
        <div>
          <div class="desc">${p.descripcion || '(sin descripción)'}</div>
          <div class="cuando">${p.fecha_esperada ? 'Esperado: ' + fmtFecha(p.fecha_esperada) : 'Sin fecha esperada'}</div>
        </div>
        <div class="monto">${fmtMoney(p.monto_esperado)}</div>
      </div>
      <div class="acciones">
        <button type="button" class="link-btn" onclick="mostrarEditarCobro('${p.id}')">Editar</button>
        <button type="button" class="link-btn confirmar" onclick="mostrarConfirmarCobro('${p.id}')">Marcar cobrado</button>
        ${mostrarCancelar ? `<button type="button" class="link-btn cancelar" onclick="cancelarCobro('${p.id}')">Cancelar</button>` : ''}
      </div>
      <div class="confirmar-box hide" id="editar-box-${p.id}">
        <input type="number" inputmode="decimal" step="0.01" id="editar-monto-${p.id}" value="${p.monto_esperado}">
        <input type="date" id="editar-fecha-${p.id}" value="${p.fecha_esperada || ''}">
        <button type="button" class="btn good" style="width:auto;padding:9px 14px" onclick="guardarEdicionCobro('${p.id}')">Guardar</button>
      </div>
      <div class="confirmar-box hide" id="confirmar-box-${p.id}">
        <input type="number" inputmode="decimal" step="0.01" id="confirmar-monto-${p.id}" value="${p.monto_esperado}">
        <input type="date" id="confirmar-fecha-${p.id}" value="${isoDate(new Date())}">
        <button type="button" class="btn good" style="width:auto;padding:9px 14px" onclick="confirmarCobro('${p.id}', '${p.caja_id}', '${p.categoria_id || ''}')">✓</button>
      </div>
    </div>`;
}

function renderRecurrentes(recurrentes) {
  const el = document.getElementById('proy-recurrentes');
  el.innerHTML = recurrentes.length === 0
    ? '<div class="empty-note">Todavía no hay suficiente historial para predecir cobros recurrentes.</div>'
    : recurrentes.map(filaCobroHtml).join('');
}

function renderPendientes(pendientes) {
  const el = document.getElementById('proy-pendientes');
  el.innerHTML = pendientes.length === 0
    ? '<div class="empty-note">No tienes cobros pendientes capturados.</div>'
    : pendientes.map(filaCobroHtml).join('');
}

function mostrarConfirmarCobro(id) {
  document.getElementById('confirmar-box-' + id).classList.toggle('hide');
}

function mostrarEditarCobro(id) {
  document.getElementById('editar-box-' + id).classList.toggle('hide');
}

async function guardarEdicionCobro(id) {
  const monto = parseFloat(document.getElementById('editar-monto-' + id).value);
  const fecha = document.getElementById('editar-fecha-' + id).value || null;
  if (!monto || monto <= 0) { alert('El monto debe ser mayor a cero.'); return; }

  const { error } = await sb.from('cobros_pendientes')
    .update({ monto_esperado: monto, fecha_esperada: fecha })
    .eq('id', id);
  if (error) { alert('No se pudo guardar el cambio: ' + error.message); return; }

  showToast('✓ Cambios guardados');
  await loadProyeccion();
}

async function confirmarCobro(id, cajaId, categoriaId) {
  const monto = parseFloat(document.getElementById('confirmar-monto-' + id).value);
  const fecha = document.getElementById('confirmar-fecha-' + id).value;
  if (!monto || monto <= 0) return;

  const { data: mov, error: errMov } = await sb.from('movimientos').insert({
    fecha,
    caja_id: cajaId,
    tipo: 'Entrada',
    monto,
    categoria_id: categoriaId || null,
    concepto: 'Cobro de reintegro',
    descripcion: null,
  }).select().single();
  if (errMov) { alert('No se pudo registrar el cobro: ' + errMov.message); return; }

  const { error: errUpd } = await sb.from('cobros_pendientes')
    .update({ estado: 'Cobrado', movimiento_id: mov.id })
    .eq('id', id);
  if (errUpd) { alert('El cobro se registró, pero no se pudo actualizar el pendiente: ' + errUpd.message); }

  showToast(`✓ Cobro de ${fmtMoney(monto)} registrado`);
  await loadProyeccion();
  await loadSaldos();
}

async function cancelarCobro(id) {
  const { error } = await sb.from('cobros_pendientes').update({ estado: 'Cancelado' }).eq('id', id);
  if (error) { alert('No se pudo cancelar: ' + error.message); return; }
  await loadProyeccion();
}

document.getElementById('btn-nuevo-cobro').addEventListener('click', () => {
  document.getElementById('cobro-form').classList.toggle('hide');
});
document.getElementById('btn-cancelar-cobro').addEventListener('click', () => {
  document.getElementById('cobro-form').classList.add('hide');
  document.getElementById('cobro-form').reset();
});

document.getElementById('cobro-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById('cobro-msg');
  msgEl.textContent = '';

  const payload = {
    descripcion: document.getElementById('cobro-descripcion').value.toUpperCase() || null,
    caja_id: document.getElementById('cobro-caja').value,
    categoria_id: document.getElementById('cobro-categoria').value || null,
    monto_esperado: parseFloat(document.getElementById('cobro-monto').value),
    fecha_pago: document.getElementById('cobro-fecha-pago').value || null,
    fecha_esperada: document.getElementById('cobro-fecha-esperada').value || null,
    origen: 'Manual',
  };

  if (!payload.monto_esperado || payload.monto_esperado <= 0) {
    msgEl.textContent = 'El monto esperado debe ser mayor a cero.';
    return;
  }

  const { error } = await sb.from('cobros_pendientes').insert(payload);
  if (error) {
    msgEl.textContent = 'No se pudo guardar: ' + error.message;
    return;
  }

  showToast('✓ Cobro pendiente guardado');
  document.getElementById('cobro-form').reset();
  document.getElementById('cobro-form').classList.add('hide');
  await loadProyeccion();
});

// ---------- Movimientos (ver / editar / eliminar) ----------

function cajaNombre(id) {
  const c = CAJAS.find(c => c.id === id);
  return c ? c.nombre : '—';
}

function categoriaOptionsHtml(tipo, selectedId) {
  const tipoCatalogo = tipo === 'Entrada' ? 'Ingreso' : 'Egreso';
  const opciones = CATEGORIAS.filter(c => c.tipo === tipoCatalogo || c.tipo === 'Ambos');
  return '<option value="">(sin categoría)</option>' +
    opciones.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.nombre}</option>`).join('');
}

async function loadMovimientosList() {
  const { desde, hasta } = rangoDeFechas(MOVLIST_PERIODO);
  let query = sb.from('movimientos')
    .select('id, fecha, tipo, monto, caja_id, categoria_id, concepto, descripcion, es_transferencia')
    .order('fecha', { ascending: false });

  if (desde) query = query.gte('fecha', desde);
  if (hasta) query = query.lte('fecha', hasta);
  if (MOVLIST_CAJA) query = query.eq('caja_id', MOVLIST_CAJA);
  if (MOVLIST_TIPO) query = query.eq('tipo', MOVLIST_TIPO);

  const { data: movs, error } = await query;
  if (error) { console.error(error); return; }

  let lista = movs || [];
  const buscar = MOVLIST_BUSCAR.trim().toUpperCase();
  if (buscar) {
    lista = lista.filter(m =>
      (m.concepto || '').toUpperCase().includes(buscar) ||
      (m.descripcion || '').toUpperCase().includes(buscar)
    );
  }

  renderMovimientosList(lista);
  renderMovimientosSubtotales(lista);
}

function renderMovimientosSubtotales(movs) {
  let totalIn = 0, totalOut = 0;
  movs.forEach(m => {
    if (m.tipo === 'Entrada') totalIn += Number(m.monto);
    else totalOut += Number(m.monto);
  });
  const neto = totalIn - totalOut;
  document.getElementById('mov-list-in').textContent = fmtMoney(totalIn);
  document.getElementById('mov-list-out').textContent = fmtMoney(totalOut);
  const netoEl = document.getElementById('mov-list-neto');
  netoEl.textContent = (neto >= 0 ? '+' : '') + fmtMoney(neto);
  netoEl.style.color = neto >= 0 ? 'var(--good)' : 'var(--critical)';
}

function filaMovimientoHtml(m) {
  const editable = !m.es_transferencia;
  const signo = m.tipo === 'Entrada' ? '+' : '-';
  const claseMonto = m.tipo === 'Entrada' ? 'in' : 'out';
  return `
    <div class="mov-row" data-id="${m.id}">
      <div class="top">
        <div>
          <div class="desc">${m.concepto || m.descripcion || '(sin descripción)'}</div>
          <div class="meta">${fmtFecha(m.fecha)} · ${cajaNombre(m.caja_id)} · ${categoriaNombre(m.categoria_id)}</div>
          ${m.es_transferencia ? '<div class="tag-transferencia">Generado por transferencia</div>' : ''}
        </div>
        <div class="monto ${claseMonto}">${signo}${fmtMoney(m.monto)}</div>
      </div>
      ${editable ? `
      <div class="acciones">
        <button type="button" class="link-btn" onclick="mostrarEditarMovimiento('${m.id}')">Editar</button>
        <button type="button" class="link-btn eliminar" onclick="mostrarEliminarMovimiento('${m.id}')">Eliminar</button>
      </div>
      <div class="edit-box hide" id="mov-edit-box-${m.id}">
        <input type="date" id="mov-edit-fecha-${m.id}" value="${m.fecha}">
        <select id="mov-edit-caja-${m.id}">${CAJAS.map(c => `<option value="${c.id}" ${c.id === m.caja_id ? 'selected' : ''}>${c.nombre}</option>`).join('')}</select>
        <select id="mov-edit-categoria-${m.id}">${categoriaOptionsHtml(m.tipo, m.categoria_id)}</select>
        <input type="number" inputmode="decimal" step="0.01" id="mov-edit-monto-${m.id}" value="${m.monto}">
        <input type="text" id="mov-edit-concepto-${m.id}" class="mayus" value="${m.concepto || ''}" placeholder="Proyecto/Concepto">
        <input type="text" id="mov-edit-descripcion-${m.id}" class="mayus" value="${m.descripcion || ''}" placeholder="Descripción">
        <button type="button" class="btn good" onclick="guardarEdicionMovimiento('${m.id}')">Guardar cambios</button>
      </div>
      <div class="confirmar-eliminar hide" id="mov-del-box-${m.id}">
        ¿Seguro que quieres eliminar este movimiento?
        <button type="button" class="btn secondary" onclick="mostrarEliminarMovimiento('${m.id}')">Cancelar</button>
        <button type="button" class="btn" style="background:var(--critical)" onclick="eliminarMovimiento('${m.id}')">Sí, eliminar</button>
      </div>` : ''}
    </div>`;
}

function renderMovimientosList(movs) {
  const el = document.getElementById('mov-list');
  el.innerHTML = movs.length === 0
    ? '<div class="empty-note">No hay movimientos con estos filtros.</div>'
    : movs.map(filaMovimientoHtml).join('');
}

function mostrarEditarMovimiento(id) {
  document.getElementById('mov-edit-box-' + id).classList.toggle('hide');
}

function mostrarEliminarMovimiento(id) {
  document.getElementById('mov-del-box-' + id).classList.toggle('hide');
}

async function guardarEdicionMovimiento(id) {
  const monto = parseFloat(document.getElementById('mov-edit-monto-' + id).value);
  if (!monto || monto <= 0) { alert('El monto debe ser mayor a cero.'); return; }

  const payload = {
    fecha: document.getElementById('mov-edit-fecha-' + id).value,
    caja_id: document.getElementById('mov-edit-caja-' + id).value,
    categoria_id: document.getElementById('mov-edit-categoria-' + id).value || null,
    monto,
    concepto: document.getElementById('mov-edit-concepto-' + id).value.toUpperCase() || null,
    descripcion: document.getElementById('mov-edit-descripcion-' + id).value.toUpperCase() || null,
  };

  const { error } = await sb.from('movimientos').update(payload).eq('id', id);
  if (error) { alert('No se pudo guardar el cambio: ' + error.message); return; }

  showToast('✓ Movimiento actualizado');
  await loadMovimientosList();
  await loadSaldos();
  await loadFlujo();
}

async function eliminarMovimiento(id) {
  const { error } = await sb.from('movimientos').delete().eq('id', id);
  if (error) { alert('No se pudo eliminar: ' + error.message); return; }

  showToast('✓ Movimiento eliminado');
  await loadMovimientosList();
  await loadSaldos();
  await loadFlujo();
}

document.getElementById('mov-list-buscar').addEventListener('input', () => {
  MOVLIST_BUSCAR = document.getElementById('mov-list-buscar').value;
  loadMovimientosList();
});

// ---------- Utilidades ----------

function isoDate(d) { return d.toISOString().slice(0, 10); }
function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('es-MX'); }

function showScreen(name, btn) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('s-' + name).classList.add('active');
  document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (name === 'flujo') loadFlujo();
  if (name === 'proyeccion') loadProyeccion();
  if (name === 'movimientos') loadMovimientosList();
}

function showToast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------- Arranque ----------
checkSession();
