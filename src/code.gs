/* =====================================================================
   Centro de Pilates - Backend (v1, esquema relacional)
   Tablas: Clientes, ServiciosPacks, Contrataciones, TiposClases,
           Disponibilidad, SemanasPersonalizadas, Clases, Reservas, Asistencias
   ===================================================================== */
const ADMIN_USER = 'admin';
function adminPass_() { return PropertiesService.getScriptProperties().getProperty('ADMIN_PASS') || ''; }
const CUPO = 6, NOMBRE = 'Pilates Reformer', HORIZONTE_SEMANAS = 8;
const CONTAR_PENDIENTES = true; // true: un pack con pago "Pendiente" ya habilita clases
const ESTADOS_PAGO = ['Pagado', 'Pendiente', 'Cancelado'];
const VIGENCIA_DIAS = 31; // plazo para usar un pack, contado desde su primera clase

const SCHEMA = {
  Clientes: ['ID_Cliente', 'Nombre', 'Apellido', 'Email', 'Telefono', 'PasswordHash', 'EstadoCuenta', 'FechaAlta'],
  ServiciosPacks: ['ID_Servicio', 'NombreServicio', 'CantidadClases', 'Precio', 'Activo', 'CategoriasPermitidas'],
  Contrataciones: ['ID_Contratacion', 'ID_Cliente', 'ID_Servicio', 'FechaInicio', 'FechaContratacion', 'ClasesIncluidas', 'PrecioAcordado', 'EstadoPago', 'FechaPago', 'Notas', 'CreadoEn'],
  TiposClases: ['ID_Tipo', 'NombreClase', 'CupoDefault', 'Activo', 'Categoria'],
  Disponibilidad: ['ID_Disponibilidad', 'Semana', 'DiaSemana', 'HoraInicio', 'HoraFin', 'ID_Tipo', 'CupoMaximo', 'Activo'],
  SemanasPersonalizadas: ['Semana'],
  Clases: ['ID_Clase', 'FechaClase', 'HoraInicio', 'HoraFin', 'ID_Tipo', 'CupoMaximo', 'Estado', 'Personalizada', 'ID_Disponibilidad'],
  Reservas: ['ID_Reserva', 'ID_Cliente', 'ID_Clase', 'Estado', 'CreadoEn', 'EventoCalendarID', 'ID_Contratacion', 'CanceladaPor', 'CanceladaEn'],
  Asistencias: ['ID_Asistencia', 'ID_Reserva', 'Estado', 'RegistradoEn']
};
const NUM_ = new Set(['CantidadClases', 'Precio', 'ClasesIncluidas', 'PrecioAcordado', 'CupoDefault', 'CupoMaximo', 'DiaSemana']);
const BOOL_ = new Set(['Activo', 'Personalizada']);

function versionApp() { return 1; }

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Clases de Pilates')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ---------- Utilidades ---------- */
function tz_() { return Session.getScriptTimeZone(); }
function iso_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function isoDT_() { return Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd'T'HH:mm:ss"); }
function ahoraS_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }
function date_(f, h) { return Utilities.parseDate(f + ' ' + h, tz_(), 'yyyy-MM-dd HH:mm'); }
function parseFechaLocal_(str) {
  const p = String(str || '').split('T')[0].split('-');
  if (p.length < 3) return new Date();
  return new Date(+p[0], +p[1] - 1, +p[2]);
}
function lunes_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)); }
function addDays_(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function min_(h) { const p = String(h).split(':'); return +p[0] * 60 + +p[1]; }
function hhmm_(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function num_(v) { const n = Number(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; }
function hash_(p) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(p))); }
function id_(p) { return p + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase(); }
function adm_(c) { const p = adminPass_(); return !!p && c === p; }
function fail_(msg) { return { ok: false, msg: msg }; }
function mapa_(rows, key) { const m = {}; rows.forEach(r => m[r[key]] = r); return m; }
function agrupar_(rows, key) { const m = {}; rows.forEach(r => (m[r[key]] = m[r[key]] || []).push(r)); return m; }
function esFecha_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function finProyeccion_() {
  let fin = iso_(addDays_(new Date(), HORIZONTE_SEMANAS * 7));
  R_('Clases').forEach(c => { if (c.FechaClase > fin) fin = c.FechaClase; });
  return fin;
}

/* ---------- Capa de datos: lectura masiva en memoria, escritura masiva ---------- */
let DB_ = {};
function tipo_(h, v) {
  if (NUM_.has(h)) return num_(v);
  if (BOOL_.has(h)) return v === true || ['TRUE', 'SI', 'SÍ', 'ACTIVO', '1'].indexOf(String(v).trim().toUpperCase()) >= 0;
  if (v instanceof Date) {
    if (h.indexOf('Hora') === 0) return Utilities.formatDate(v, tz_(), 'HH:mm');
    if (h === 'CreadoEn' || h === 'RegistradoEn' || h === 'FechaAlta') return Utilities.formatDate(v, tz_(), "yyyy-MM-dd'T'HH:mm:ss");
    return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  }
  return v == null ? '' : String(v).trim();
}
function ser_(h, v) {
  if (BOOL_.has(h)) return v ? 'TRUE' : 'FALSE';
  if (NUM_.has(h)) return Number(v) || 0;
  return v == null ? '' : v;
}
function initHoja_(s, n) {
  const H = SCHEMA[n];
  s.getRange(1, 1, Math.max(s.getMaxRows(), 2), H.length).setNumberFormat('@');
  s.getRange(1, 1, 1, H.length).setValues([H]).setFontWeight('bold').setBackground('#E8F0FE');
  s.setFrozenRows(1);
}
function sh_(n) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('El script no está vinculado a un Google Sheet.');
  let s = ss.getSheetByName(n);
  if (!s) { s = ss.insertSheet(n); initHoja_(s, n); }
  return s;
}
function T_(n) {
  if (DB_[n]) return DB_[n];
  const s = sh_(n), H = SCHEMA[n], lr = s.getLastRow();
  const v = lr > 1 ? s.getRange(2, 1, lr - 1, H.length).getValues() : [];
  const rows = [];
  v.forEach((r, i) => {
    if (r[0] === '' || r[0] == null) return;
    const o = { _row: i + 2 };
    H.forEach((h, j) => o[h] = tipo_(h, r[j]));
    rows.push(o);
  });
  return DB_[n] = { rows: rows, dirty: new Set(), rewrite: false };
}
function R_(n) { return T_(n).rows; }
function ins_(n, o) {
  SCHEMA[n].forEach(h => { if (o[h] === undefined) o[h] = NUM_.has(h) ? 0 : BOOL_.has(h) ? false : ''; });
  o._row = 0;
  T_(n).rows.push(o);
  return o;
}
function upd_(n, o, cambios) { Object.assign(o, cambios); if (o._row) T_(n).dirty.add(o._row); }
function del_(n, pred) { const t = T_(n); t.rows = t.rows.filter(o => !pred(o)); t.rewrite = true; }
function filasHasta_(s, hasta) { if (hasta > s.getMaxRows()) s.insertRowsAfter(s.getMaxRows(), hasta - s.getMaxRows() + 100); }
function commit_() {
  Object.keys(DB_).forEach(n => {
    const t = DB_[n], H = SCHEMA[n];
    const matriz = rows => rows.map(o => H.map(h => ser_(h, o[h])));
    if (t.rewrite) {
      const s = sh_(n), last = s.getLastRow();
      if (last > 1) s.getRange(2, 1, last - 1, H.length).clearContent();
      if (t.rows.length) {
        filasHasta_(s, t.rows.length + 1);
        s.getRange(2, 1, t.rows.length, H.length).setNumberFormat('@').setValues(matriz(t.rows));
        t.rows.forEach((o, i) => o._row = i + 2);
      }
      t.rewrite = false; t.dirty.clear();
      return;
    }
    if (t.dirty.size) {
      const s = sh_(n), arr = [...t.dirty], a = Math.min.apply(null, arr), b = Math.max.apply(null, arr), by = {};
      t.rows.forEach(o => { if (o._row) by[o._row] = o; });
      const m = [];
      for (let r = a; r <= b; r++) m.push(by[r] ? H.map(h => ser_(h, by[r][h])) : H.map(() => ''));
      s.getRange(a, 1, m.length, H.length).setNumberFormat('@').setValues(m);
      t.dirty.clear();
    }
    const nuevos = t.rows.filter(o => !o._row);
    if (nuevos.length) {
      const s = sh_(n), r0 = s.getLastRow() + 1;
      filasHasta_(s, r0 + nuevos.length);
      s.getRange(r0, 1, nuevos.length, H.length).setNumberFormat('@').setValues(matriz(nuevos));
      nuevos.forEach((o, i) => o._row = r0 + i);
    }
  });
}
function tx_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { DB_ = {}; const r = fn(); commit_(); return r; }
  finally { lock.releaseLock(); }
}
function descartar_() { DB_ = {}; }

/* ---------- Calendario del centro ---------- */
let CAL_ = null;

function cal_() {
  if (CAL_) return CAL_;
  const id = PropertiesService.getScriptProperties().getProperty('CALENDARIO_ID');
  if (!id) throw new Error('Falta la propiedad CALENDARIO_ID (Configuración del proyecto → Propiedades de la secuencia de comandos).');
  CAL_ = CalendarApp.getCalendarById(id);
  if (!CAL_) throw new Error('No se encontró el calendario del centro. Revisá la propiedad CALENDARIO_ID.');
  return CAL_;
}

function probarCalendario() { Logger.log('Calendario: ' + cal_().getName()); }

/* Busca el evento en el calendario del centro y, si no está, en el calendario principal (reservas viejas) */
function evento_(id) {
  if (!id) return null;
  let e = null;
  try { e = cal_().getEventById(id); } catch (x) { Logger.log(x); }
  if (!e) { try { e = CalendarApp.getDefaultCalendar().getEventById(id); } catch (x) { Logger.log(x); } }
  return e;
}

/* ---------- Créditos: se calculan desde Contrataciones y Reservas (sin contadores) ---------- */
function cuenta_(c) { return c.EstadoPago === 'Pagado' || (CONTAR_PENDIENTES && c.EstadoPago === 'Pendiente'); }
function sumDias_(f, n) { return iso_(addDays_(parseFechaLocal_(f), n)); }
function fmtF_(f) { const p = String(f).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(f); }
function porInicio_(a, b) { return (a.FechaInicio + a.FechaContratacion + a.CreadoEn).localeCompare(b.FechaInicio + b.FechaContratacion + b.CreadoEn); }
/* Una fecha entra en el plazo de un pack si todas sus clases (incluida la nueva) caen dentro de los 30 días posteriores a la primera */
function ventanaOk_(fechas, d) {
  let ini = d;
  fechas.forEach(f => { if (f < ini) ini = f; });
  const fin = sumDias_(ini, VIGENCIA_DIAS);
  return d <= fin && fechas.every(f => f <= fin);
}
/* Estado de créditos por cliente: cada reserva descuenta del pack indicado en ID_Contratacion.
   El plazo (30 días) de cada pack corre desde su primera clase reservada. */
function resumen_() {
  const hoy = iso_(new Date());
  const clases = mapa_(R_('Clases'), 'ID_Clase'), asis = {}, cache = {};
  R_('Asistencias').forEach(a => asis[a.ID_Reserva] = a.Estado);
  const contr = agrupar_(R_('Contrataciones').filter(cuenta_), 'ID_Cliente'), res = agrupar_(R_('Reservas').filter(r => r.Estado === 'Agendada'), 'ID_Cliente');
  const calc = id => {
    const packs = (contr[id] || []).slice().sort(porInicio_).map(t => ({ id: t.ID_Contratacion, servicio: t.ID_Servicio, clases: t.ClasesIncluidas, desde: t.FechaInicio, usadas: 0, fechas: [] }));
    const por = {};
    packs.forEach(p => por[p.id] = p);
    const x = { total: 0, usadas: 0, asistidas: 0, faltas: 0, agendadas: 0, restantes: 0, vencidas: 0, packs: packs }, sueltas = [];
    packs.forEach(p => x.total += p.clases);
    (res[id] || []).forEach(r => {
      const c = clases[r.ID_Clase], f = c ? c.FechaClase : hoy, e = asis[r.ID_Reserva], p = por[r.ID_Contratacion];
      x.usadas++;
      if (e === 'Asistio') x.asistidas++; else if (e === 'Falto') x.faltas++; else x.agendadas++;
      if (p) { p.usadas++; p.fechas.push(f); } else sueltas.push(f);
    });
    sueltas.sort().forEach(f => { const p = packs.find(q => q.usadas < q.clases) || packs[packs.length - 1]; if (p) { p.usadas++; p.fechas.push(f); } });
    packs.forEach(p => {
      p.saldo = p.clases - p.usadas;
      p.inicio = p.desde;
     p.vence = sumDias_(p.desde, VIGENCIA_DIAS);
      p.vencido = !!p.vence && hoy > p.vence;
      if (p.saldo > 0) { if (p.vencido) x.vencidas += p.saldo; else x.restantes += p.saldo; }
    });
    return x;
  };
  return { get: id => { const x = cache[id] || (cache[id] = calc(id)); x.saldoTotal = x.total - x.usadas; return x; } };
}
function invalido_(r) { return r.saldoTotal < 0 || r.packs.some(p => p.saldo < 0); }

/* Categorías de clase. Un tipo sin categoría cuenta como Grupal; un pack sin categorías habilita todas */
const CATEGORIAS = ['Grupal', 'Personalizada'];
function catDe_(t) { return t && t.Categoria ? t.Categoria : 'Grupal'; }
function catsDe_(s) { return s && s.CategoriasPermitidas ? String(s.CategoriasPermitidas).split(',').map(x => x.trim()).filter(Boolean) : []; }
function permite_(p, cat) { return !p.cats.length || p.cats.indexOf(cat) >= 0; }

/* Asigna a un pack las reservas activas que todavía no lo tienen (migración y datos viejos) */
function imputarReservas_() {
  const clases = mapa_(R_('Clases'), 'ID_Clase');
  const contr = agrupar_(R_('Contrataciones').filter(cuenta_), 'ID_Cliente'), res = agrupar_(R_('Reservas').filter(r => r.Estado === 'Agendada'), 'ID_Cliente');
  const fecha = r => (clases[r.ID_Clase] || {}).FechaClase || '';
  let n = 0;
  Object.keys(res).forEach(id => {
    const packs = (contr[id] || []).slice().sort(porInicio_).map(t => ({ id: t.ID_Contratacion, cap: t.ClasesIncluidas })), por = {}, sueltas = [];
    packs.forEach(p => por[p.id] = p);
    res[id].forEach(r => { const p = por[r.ID_Contratacion]; if (p) p.cap--; else sueltas.push(r); });
    sueltas.sort((a, b) => fecha(a).localeCompare(fecha(b))).forEach(r => {
      const p = packs.find(q => q.cap > 0) || packs[packs.length - 1];
      if (p) { p.cap--; upd_('Reservas', r, { ID_Contratacion: p.id }); n++; }
    });
  });
  return n;
}
function packActual_(idCliente, servicios, contrataciones) {
  const mine = (contrataciones || R_('Contrataciones')).filter(t => t.ID_Cliente === idCliente && t.EstadoPago !== 'Cancelado')
    .sort((a, b) => (b.FechaContratacion + b.CreadoEn).localeCompare(a.FechaContratacion + a.CreadoEn));
  const s = mine.length ? (servicios || mapa_(R_('ServiciosPacks'), 'ID_Servicio'))[mine[0].ID_Servicio] : null;
  return { nombre: mine.length ? (s ? s.NombreServicio : 'Pack migrado') : 'Sin pack', ultima: mine[0] || null, todas: mine };
}

/* ---------- Clases: se generan desde Disponibilidad ---------- */
function plan_(ini, fin) {
  const hoy = iso_(new Date());
  const tope = iso_(addDays_(new Date(), 400));
  if (ini < hoy) ini = hoy;
  if (fin > tope) fin = tope;
  const res = { crear: [], reactivar: [], actualizar: [], cancelar: [] };
  if (ini > fin) return res;
  const rec = {}, sem = {};
  R_('Disponibilidad').filter(r => r.Activo).forEach(r => {
    if (r.Semana) ((sem[r.Semana] = sem[r.Semana] || {})[r.DiaSemana] = (sem[r.Semana][r.DiaSemana] || [])).push(r);
    else (rec[r.DiaSemana] = rec[r.DiaSemana] || []).push(r);
  });
  const pers = new Set(R_('SemanasPersonalizadas').map(r => r.Semana));
  const exist = {};
  R_('Clases').forEach(c => { if (c.FechaClase >= ini && c.FechaClase <= fin) exist[c.FechaClase + '|' + c.HoraInicio] = c; });
  const vistos = {};
  for (let d = parseFechaLocal_(ini), f = ini; f <= fin; d.setDate(d.getDate() + 1), f = iso_(d)) {
    const dow = (d.getDay() + 6) % 7 + 1, s = iso_(lunes_(d));
    const lista = pers.has(s) ? ((sem[s] || {})[dow] || []) : (rec[dow] || []);
    lista.forEach(r => {
      const k = f + '|' + r.HoraInicio;
      if (vistos[k]) return;
      vistos[k] = 1;
      const c = exist[k], cupo = r.CupoMaximo || CUPO;
      if (!c) res.crear.push({ fecha: f, r: r });
      else if (c.Estado !== 'Activa') res.reactivar.push({ c: c, r: r });
      else if (!c.Personalizada && (c.ID_Tipo !== r.ID_Tipo || c.CupoMaximo !== cupo || c.HoraFin !== r.HoraFin)) res.actualizar.push({ c: c, r: r });
    });
  }
  Object.keys(exist).forEach(k => { const c = exist[k]; if (c.Estado === 'Activa' && !vistos[k]) res.cancelar.push(c); });
  return res;
}
function cancelarRes_(r, por) {
  upd_('Reservas', r, { Estado: 'Cancelada', CanceladaPor: por || '', CanceladaEn: isoDT_() });
  if (r.EventoCalendarID) {
    try { const e = evento_(r.EventoCalendarID); if (e) e.deleteEvent(); } catch (x) { Logger.log(x); }
  }
}
function aplicar_(p, cancelar) {
  p.crear.forEach(x => ins_('Clases', { ID_Clase: id_('CS'), FechaClase: x.fecha, HoraInicio: x.r.HoraInicio, HoraFin: x.r.HoraFin, ID_Tipo: x.r.ID_Tipo, CupoMaximo: x.r.CupoMaximo || CUPO, Estado: 'Activa', Personalizada: false, ID_Disponibilidad: x.r.ID_Disponibilidad }));
  p.reactivar.concat(p.actualizar).forEach(x => upd_('Clases', x.c, { Estado: 'Activa', HoraFin: x.r.HoraFin, ID_Tipo: x.r.ID_Tipo, CupoMaximo: x.r.CupoMaximo || CUPO, Personalizada: false, ID_Disponibilidad: x.r.ID_Disponibilidad }));
  if (cancelar) {
    const porClase = agrupar_(R_('Reservas').filter(r => r.Estado === 'Agendada'), 'ID_Clase');
    p.cancelar.forEach(c => { (porClase[c.ID_Clase] || []).forEach(r => cancelarRes_(r, 'Horario')); upd_('Clases', c, { Estado: 'Cancelada' }); });
  }
}
function asegurar_(ini, fin) {
  DB_ = {};
  const p = plan_(ini, fin);
  if (!(p.crear.length || p.reactivar.length || p.actualizar.length)) return;
  tx_(() => aplicar_(plan_(ini, fin), false));
}
function slotsRango_(ini, fin) {
  const tipos = mapa_(R_('TiposClases'), 'ID_Tipo'), cnt = {}, now = ahoraS_();
  R_('Reservas').forEach(r => { if (r.Estado === 'Agendada') cnt[r.ID_Clase] = (cnt[r.ID_Clase] || 0) + 1; });
  return R_('Clases').filter(c => c.Estado === 'Activa' && c.FechaClase >= ini && c.FechaClase <= fin).map(c => {
    const t = tipos[c.ID_Tipo], cupo = c.CupoMaximo || CUPO, o = cnt[c.ID_Clase] || 0;
    return { idClase: c.ID_Clase, fecha: c.FechaClase, nombre: t ? t.NombreClase : NOMBRE, idTipo: c.ID_Tipo, categoria: catDe_(t), dia: (parseFechaLocal_(c.FechaClase).getDay() + 6) % 7 + 1, inicio: c.HoraInicio, fin: c.HoraFin, ocupados: o, cupo: cupo, completa: o >= cupo, pasada: (c.FechaClase + ' ' + c.HoraInicio) < now };
  }).sort((a, b) => (a.fecha + a.inicio).localeCompare(b.fecha + b.inicio));
}
function getClasesDisponibles(fechaInicio, fechaFin) {
  asegurar_(fechaInicio, fechaFin);
  return slotsRango_(fechaInicio, fechaFin);
}
function proyectarMesCorriente(clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  return tx_(() => { const p = plan_(iso_(new Date()), finProyeccion_()); aplicar_(p, false); return { ok: true, total: p.crear.length }; });
}

/* ---------- Setup y migración ---------- */
function stamp_() { return Utilities.formatDate(new Date(), tz_(), 'yyyyMMdd_HHmm'); }
function esLegacy_(ss) {
  const cab = n => { const s = ss.getSheetByName(n); return s && s.getLastRow() > 0 ? s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].map(String) : null; };
  const c = cab('Clientes'), r = cab('Reservas');
  return !!((c && c.indexOf('CreditosDisponibles') >= 0) || (r && r.indexOf('FechaClase') >= 0) || ss.getSheetByName('ClasesHorarios') || ss.getSheetByName('PacksServicios'));
}
function leerLegacy_(ss, n) {
  const s = ss.getSheetByName(n);
  if (!s || s.getLastRow() < 2) return [];
  const v = s.getDataRange().getDisplayValues(), h = v[0];
  return v.slice(1).filter(r => r[0] !== '').map(r => { const o = {}; h.forEach((k, j) => o[k] = r[j]); return o; });
}
function toIsoDT_(s) {
  s = String(s || '');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.length === 16 ? s + ':00' : s;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return s.replace(' ', 'T') + ':00';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00:00';
  return isoDT_();
}
function migrarEsquemaV4_(ss) {
  const L = {};
  ['Clientes', 'PacksServicios', 'ClasesHorarios', 'Reservas', 'ExcepcionesSemana', 'TiposClases'].forEach(n => L[n] = leerLegacy_(ss, n));
  const st = stamp_();
  ['Clientes', 'PacksServicios', 'ClasesHorarios', 'Reservas', 'ExcepcionesSemana', 'AgendaProyectada', 'TiposClases'].forEach(n => {
    const s = ss.getSheetByName(n);
    if (s) s.setName('bak_' + n + '_' + st);
  });
  let huerfanas = 0;
  tx_(() => {
    const tipoPorNombre = {};
    const tipoDe = (nombre, cupo) => {
      const k = String(nombre || NOMBRE).toLowerCase();
      if (!tipoPorNombre[k]) tipoPorNombre[k] = ins_('TiposClases', { ID_Tipo: id_('T'), NombreClase: nombre || NOMBRE, CupoDefault: cupo || CUPO, Activo: true });
      return tipoPorNombre[k];
    };
    L.TiposClases.forEach(t => { tipoPorNombre[String(t.NombreClase).toLowerCase()] = ins_('TiposClases', { ID_Tipo: t.ID_Tipo, NombreClase: t.NombreClase, CupoDefault: num_(t.CupoDefault) || CUPO, Activo: true }); });
    tipoDe(NOMBRE, CUPO);

    L.PacksServicios.forEach(p => ins_('ServiciosPacks', { ID_Servicio: p.ID_Pack, NombreServicio: p.NombrePack, CantidadClases: num_(p.CantidadClases), Precio: num_(p.Precio), Activo: String(p.Estado).toLowerCase() === 'activo' }));

    L.ClasesHorarios.forEach(c => ins_('Disponibilidad', { ID_Disponibilidad: c.ID_Clase, Semana: '', DiaSemana: num_(c.DiaSemana), HoraInicio: c.HoraInicio, HoraFin: c.HoraFin, ID_Tipo: tipoDe(c.NombreClase, num_(c.CupoMaximo)).ID_Tipo, CupoMaximo: num_(c.CupoMaximo) || CUPO, Activo: String(c.Estado).toLowerCase() === 'activo' }));
    const semanas = {};
    L.ExcepcionesSemana.forEach(e => {
      semanas[e.Semana] = 1;
      if (num_(e.DiaSemana) > 0 && e.HoraInicio) ins_('Disponibilidad', { ID_Disponibilidad: id_('D'), Semana: e.Semana, DiaSemana: num_(e.DiaSemana), HoraInicio: e.HoraInicio, HoraFin: e.HoraFin, ID_Tipo: tipoDe(e.NombreClase, num_(e.CupoMaximo)).ID_Tipo, CupoMaximo: num_(e.CupoMaximo) || CUPO, Activo: true });
    });
    Object.keys(semanas).forEach(s => ins_('SemanasPersonalizadas', { Semana: s }));

    const agend = {};
    L.Reservas.forEach(r => { if (String(r.EstadoReserva) === 'Agendada') agend[r.ID_Cliente] = (agend[r.ID_Cliente] || 0) + 1; });
    const packs = mapa_(L.PacksServicios, 'ID_Pack');
    L.Clientes.forEach(c => {
      const estado = c.EstadoCuenta === 'Pendiente_Activacion' ? 'Pendiente' : (c.EstadoCuenta || 'Activo');
      const alta = toIsoDT_(c.FechaAlta);
      ins_('Clientes', { ID_Cliente: c.ID_Cliente, Nombre: c.Nombre, Apellido: c.Apellido, Email: c.Email, Telefono: c.Telefono, PasswordHash: c.PasswordHash, EstadoCuenta: estado, FechaAlta: alta });
      const pack = packs[c.ID_Pack], total = Math.max(num_(c.CreditosDisponibles) + (agend[c.ID_Cliente] || 0), pack ? num_(pack.CantidadClases) : 0);
      if (total > 0) ins_('Contrataciones', { ID_Contratacion: id_('CT'), ID_Cliente: c.ID_Cliente, ID_Servicio: pack ? pack.ID_Pack : '', FechaInicio: alta.slice(0, 10), FechaContratacion: alta.slice(0, 10), ClasesIncluidas: total, PrecioAcordado: pack && total === num_(pack.CantidadClases) ? num_(pack.Precio) : 0, EstadoPago: estado === 'Pendiente' ? 'Pendiente' : 'Pagado', FechaPago: estado === 'Pendiente' ? '' : alta.slice(0, 10), Notas: 'Migrado del esquema anterior', CreadoEn: alta });
    });

    const oldCl = mapa_(L.ClasesHorarios, 'ID_Clase'), claseDe = {};
    L.Reservas.forEach(r => {
      const k = r.ID_Clase + '|' + r.FechaClase;
      if (!claseDe[k]) {
        const dt = parseFechaLocal_(r.FechaClase), dow = (dt.getDay() + 6) % 7 + 1, sem = iso_(lunes_(dt)), base = oldCl[r.ID_Clase];
        let hIni, hFin, nombre, cupo, dispId = '';
        if (base) { hIni = base.HoraInicio; hFin = base.HoraFin; nombre = base.NombreClase; cupo = num_(base.CupoMaximo) || CUPO; dispId = base.ID_Clase; }
        else if (String(r.ID_Clase).indexOf('X_') === 0) { hIni = String(r.ID_Clase).split('_')[2]; hFin = hhmm_(min_(hIni) + 60); nombre = NOMBRE; cupo = CUPO; }
        else { huerfanas++; return; }
        const ex = L.ExcepcionesSemana.find(e => e.Semana === sem && num_(e.DiaSemana) === dow && e.HoraInicio === hIni);
        const pers = !!(ex && base && (ex.NombreClase !== base.NombreClase || num_(ex.CupoMaximo) !== num_(base.CupoMaximo)));
        if (ex) { nombre = ex.NombreClase || nombre; cupo = num_(ex.CupoMaximo) || cupo; hFin = ex.HoraFin || hFin; }
        claseDe[k] = ins_('Clases', { ID_Clase: id_('CS'), FechaClase: r.FechaClase, HoraInicio: hIni, HoraFin: hFin, ID_Tipo: tipoDe(nombre, cupo).ID_Tipo, CupoMaximo: cupo, Estado: 'Activa', Personalizada: pers, ID_Disponibilidad: dispId });
      }
      const c = claseDe[k];
      if (!c) return;
      const creado = toIsoDT_(r.FechaRegistro), activa = String(r.EstadoReserva) === 'Agendada';
      ins_('Reservas', { ID_Reserva: r.ID_Reserva, ID_Cliente: r.ID_Cliente, ID_Clase: c.ID_Clase, Estado: activa ? 'Agendada' : 'Cancelada', CreadoEn: creado, EventoCalendarID: activa ? r.EventoCalendarID : '' });
      if (activa && (r.Asistencia === 'Asistio' || r.Asistencia === 'Falto')) ins_('Asistencias', { ID_Asistencia: id_('A'), ID_Reserva: r.ID_Reserva, Estado: r.Asistencia, RegistradoEn: creado });
    });
  });
  Logger.log('Migración completa. Respaldos: hojas "bak_*_' + st + '". Reservas huérfanas omitidas: ' + huerfanas);
}
function setupDemoData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const migrar = esLegacy_(ss);
  if (migrar) migrarEsquemaV4_(ss);
  Object.keys(SCHEMA).forEach(n => {
    const s = ss.getSheetByName(n), H = SCHEMA[n];
    if (!s) { sh_(n); return; }
    if (s.getLastRow() === 0) { initHoja_(s, n); return; }
    const act = s.getRange(1, 1, 1, Math.max(s.getLastColumn(), 1)).getValues()[0].map(String).filter(x => x !== '');
    if (act.join('|') === H.join('|')) return;
    if (act.length < H.length && act.join('|') === H.slice(0, act.length).join('|')) { // migración aditiva: se agregan columnas sin tocar los datos
      s.getRange(1, act.length + 1, 1, H.length - act.length).setValues([H.slice(act.length)]).setFontWeight('bold').setBackground('#E8F0FE');
      s.getRange(1, act.length + 1, Math.max(s.getMaxRows(), 2), H.length - act.length).setNumberFormat('@');
      return;
    }
    s.setName('bak_' + n + '_' + stamp_());
    sh_(n);
  });
  tx_(() => {
    const hoy = iso_(new Date());
    if (!R_('ServiciosPacks').length) {
      [['P001', 'Clase de prueba', 1, 5000], ['P002', 'Pack mensual 4 clases', 4, 28000], ['P003', 'Pack mensual 8 clases', 8, 50000], ['P004', 'Pack mensual 16 clases', 16, 90000], ['P005', 'Clase personalizada', 1, 15000]]
        .forEach(p => ins_('ServiciosPacks', { ID_Servicio: p[0], NombreServicio: p[1], CantidadClases: p[2], Precio: p[3], Activo: true }));
    }
    if (!R_('TiposClases').length) ins_('TiposClases', { ID_Tipo: 'T001', NombreClase: NOMBRE, CupoDefault: CUPO, Activo: true });
    if (!R_('Disponibilidad').length) {
      const t = R_('TiposClases')[0];
      let n = 1;
      for (let d = 1; d <= 5; d++) [['09:00', '10:00'], ['10:00', '11:00'], ['18:00', '19:00'], ['19:00', '20:00']].forEach(h =>
        ins_('Disponibilidad', { ID_Disponibilidad: 'D' + String(n++).padStart(3, '0'), Semana: '', DiaSemana: d, HoraInicio: h[0], HoraFin: h[1], ID_Tipo: t.ID_Tipo, CupoMaximo: t.CupoDefault, Activo: true }));
    }
    if (!R_('Clientes').length) {
      ins_('Clientes', { ID_Cliente: 'CL000001', Nombre: 'Ana', Apellido: 'Demo', Email: 'demo@pilates.com', Telefono: '1155550000', PasswordHash: hash_('demo123'), EstadoCuenta: 'Activo', FechaAlta: isoDT_() });
      ins_('Contrataciones', { ID_Contratacion: id_('CT'), ID_Cliente: 'CL000001', ID_Servicio: 'P003', FechaInicio: hoy, FechaContratacion: hoy, ClasesIncluidas: 8, PrecioAcordado: 50000, EstadoPago: 'Pagado', FechaPago: hoy, Notas: 'Demo', CreadoEn: isoDT_() });
    }
    imputarReservas_();
    aplicar_(plan_(hoy, finProyeccion_()), false);
  });
  Logger.log((migrar ? 'Esquema migrado a v4. ' : '') + 'Listo. Cliente demo: demo@pilates.com / demo123. Admin: admin / admin123');
  ss.toast(migrar ? 'Migración v4 completa (respaldos bak_*).' : 'Datos demo cargados.', 'Pilates', 8);
  return 'OK';
}

/* ---------- Autenticación ---------- */
function limpiarCliente_(c) { return { id: c.ID_Cliente, nombre: c.Nombre, apellido: c.Apellido, email: c.Email, telefono: c.Telefono }; }
function porEmail_(email) {
  const e = String(email || '').trim().toLowerCase();
  return R_('Clientes').find(c => c.Email.toLowerCase() === e);
}
function loginCliente(email, password) {
  DB_ = {};
  const c = porEmail_(email);
  if (!c) return fail_('Correo o contraseña incorrectos.');
  if (c.EstadoCuenta === 'Pendiente') return fail_('Tu cuenta está pendiente. Tocá "Activar mi cuenta".');
  if (c.PasswordHash !== hash_(password)) return fail_('Correo o contraseña incorrectos.');
  if (c.EstadoCuenta === 'Inactivo') return fail_('Tu cuenta está inactiva. Comunicate con el centro.');
  return { ok: true, cliente: limpiarCliente_(c) };
}
function loginAdmin(usuario, password) {
  const p = adminPass_();
  return (p && usuario === ADMIN_USER && password === p) ? { ok: true } : fail_('Usuario o contraseña incorrectos.');
}
function verificarPreAlta(email) {
  DB_ = {};
  const c = porEmail_(email);
  return (c && c.EstadoCuenta === 'Pendiente') ? { ok: true, nombre: c.Nombre } : fail_('No encontramos una pre-alta pendiente con ese correo.');
}
function activarCuentaCliente(email, password, confirmacion) {
  return tx_(() => {
    const c = porEmail_(email);
    if (!c || c.EstadoCuenta !== 'Pendiente') return fail_('No encontramos una pre-alta pendiente.');
    if (String(password).length < 6) return fail_('La contraseña debe tener al menos 6 caracteres.');
    if (password !== confirmacion) return fail_('Las contraseñas no coinciden.');
    upd_('Clientes', c, { PasswordHash: hash_(password), EstadoCuenta: 'Activo' });
    return { ok: true, cliente: limpiarCliente_(c) };
  });
}

/* ---------- Contrataciones y ficha del cliente ---------- */
function nuevaContratacion_(idCliente, servicio, fechaInicio, estadoPago, notas) {
  const hoy = iso_(new Date());
  return ins_('Contrataciones', {
    ID_Contratacion: id_('CT'), ID_Cliente: idCliente, ID_Servicio: servicio.ID_Servicio,
    FechaInicio: esFecha_(fechaInicio) ? fechaInicio : hoy, FechaContratacion: hoy,
    ClasesIncluidas: servicio.CantidadClases, PrecioAcordado: servicio.Precio, EstadoPago: estadoPago,
    FechaPago: estadoPago === 'Pagado' ? hoy : '', Notas: String(notas || '').slice(0, 200), CreadoEn: isoDT_()
  });
}
function preAltaCliente(d, clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  return tx_(() => {
    if (!d || !d.nombre || !d.apellido || !d.email || !d.telefono || !d.idServicio) return fail_('Completá todos los campos.');
    if (ESTADOS_PAGO.indexOf(d.estadoPago) < 0) return fail_('Estado de pago inválido.');
    if (porEmail_(d.email)) return fail_('Ya existe un cliente con ese correo.');
    const s = R_('ServiciosPacks').find(x => x.ID_Servicio === d.idServicio && x.Activo);
    if (!s) return fail_('El pack elegido no está disponible.');
    const id = id_('CL');
    ins_('Clientes', { ID_Cliente: id, Nombre: d.nombre.trim(), Apellido: d.apellido.trim(), Email: String(d.email).trim().toLowerCase(), Telefono: String(d.telefono).trim(), PasswordHash: '', EstadoCuenta: 'Pendiente', FechaAlta: isoDT_() });
    nuevaContratacion_(id, s, d.fechaInicio, d.estadoPago, 'Pre-alta');
    return { ok: true, msg: 'Pre-alta creada. El cliente ya puede activar su cuenta con su correo.' };
  });
}
function agregarContratacion(d, clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  return tx_(() => {
    const c = R_('Clientes').find(x => x.ID_Cliente === d.idCliente);
    const s = R_('ServiciosPacks').find(x => x.ID_Servicio === d.idServicio && x.Activo);
    if (!c || !s) return fail_('Cliente o pack no disponible.');
    if (ESTADOS_PAGO.indexOf(d.estadoPago) < 0) return fail_('Estado de pago inválido.');
    nuevaContratacion_(c.ID_Cliente, s, d.fechaInicio, d.estadoPago, d.notas);
    return { ok: true, msg: 'Pack agregado: ' + s.NombreServicio + '.' };
  });
}
function actualizarPagoContratacion(idContratacion, estadoPago, clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  return tx_(() => {
    const t = R_('Contrataciones').find(x => x.ID_Contratacion === idContratacion);
    if (!t) return fail_('Contratación no encontrada.');
    if (ESTADOS_PAGO.indexOf(estadoPago) < 0) return fail_('Estado de pago inválido.');
    const antes = t.EstadoPago;
    t.EstadoPago = estadoPago;
    const r = resumen_().get(t.ID_Cliente);
    if (invalido_(r)) { t.EstadoPago = antes; descartar_(); return fail_('No se puede: el cliente tiene reservas que quedarían sin clases disponibles (' + r.usadas + ' usadas, ' + r.total + ' contratadas).'); }
    upd_('Contrataciones', t, { EstadoPago: estadoPago, FechaPago: estadoPago === 'Pagado' ? (t.FechaPago || iso_(new Date())) : (estadoPago === 'Pendiente' ? '' : t.FechaPago) });
    return { ok: true, msg: 'Estado de pago actualizado a ' + estadoPago + '.' };
  });
}
function editarContratacion(d, clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  return tx_(() => {
    const t = R_('Contrataciones').find(x => x.ID_Contratacion === d.idContratacion);
    if (!t) return fail_('Contratación no encontrada.');
    const total = Math.floor(num_(d.clasesTotales));
    if (!(total >= 1)) return fail_('Las clases totales deben ser 1 o más.');
    if (ESTADOS_PAGO.indexOf(d.estadoPago) < 0) return fail_('Estado de pago inválido.');
    t.ClasesIncluidas = total; t.EstadoPago = d.estadoPago;
    const r = resumen_().get(t.ID_Cliente);
    if (invalido_(r)) { descartar_(); return fail_('No se puede guardar: este pack ya tiene más clases usadas que las totales que indicaste.'); }
    upd_('Contrataciones', t, { FechaInicio: esFecha_(d.fechaInicio) ? d.fechaInicio : t.FechaInicio, ClasesIncluidas: total, EstadoPago: d.estadoPago, FechaPago: d.estadoPago === 'Pagado' ? (t.FechaPago || iso_(new Date())) : (d.estadoPago === 'Pendiente' ? '' : t.FechaPago) });
    return { ok: true, msg: 'Pack actualizado.' };
  });
}
function eliminarContratacion(idContratacion, clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  return tx_(() => {
    const t = R_('Contrataciones').find(x => x.ID_Contratacion === idContratacion);
    if (!t) return fail_('Contratación no encontrada.');
    const idc = t.ID_Cliente;
    del_('Contrataciones', x => x.ID_Contratacion === idContratacion);
    R_('Reservas').forEach(r => { if (r.ID_Contratacion === idContratacion) upd_('Reservas', r, { ID_Contratacion: '' }); });
    const r = resumen_().get(idc);
    if (invalido_(r)) { descartar_(); return fail_('No se puede eliminar: el cliente tiene clases reservadas con este pack y no hay otro con saldo para cubrirlas. Cancelá las reservas o usá el estado de pago "Cancelado".'); }
    return { ok: true, msg: 'Pack eliminado.' };
  });
}
function getFichaCliente(idCliente, clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  DB_ = {};
  const c = R_('Clientes').find(x => x.ID_Cliente === idCliente);
  if (!c) return fail_('Cliente no encontrado.');
  const servicios = mapa_(R_('ServiciosPacks'), 'ID_Servicio'), tipos = mapa_(R_('TiposClases'), 'ID_Tipo'), clases = mapa_(R_('Clases'), 'ID_Clase');
  const asis = {};
  R_('Asistencias').forEach(a => asis[a.ID_Reserva] = a.Estado);
  const r = resumen_().get(idCliente), pk = {};
  r.packs.forEach(p => pk[p.id] = p);
  const contrataciones = R_('Contrataciones').filter(t => t.ID_Cliente === idCliente)
    .sort((a, b) => (b.FechaContratacion + b.CreadoEn).localeCompare(a.FechaContratacion + a.CreadoEn)).map(t => {
      const p = pk[t.ID_Contratacion];
      return { id: t.ID_Contratacion, idServicio: t.ID_Servicio, servicio: servicios[t.ID_Servicio] ? servicios[t.ID_Servicio].NombreServicio : 'Pack migrado', fechaInicio: t.FechaInicio, fechaContratacion: t.FechaContratacion, clases: t.ClasesIncluidas, usadas: p ? p.usadas : 0, saldo: p ? p.saldo : null, inicioUso: p ? p.inicio : null, vence: p ? p.vence : null, vencido: p ? p.vencido : false, precio: t.PrecioAcordado, estadoPago: t.EstadoPago, fechaPago: t.FechaPago, notas: t.Notas };
    });
  const reservas = R_('Reservas').filter(x => x.ID_Cliente === idCliente).map(x => {
    const k = clases[x.ID_Clase] || {};
    return { fecha: k.FechaClase || '', inicio: k.HoraInicio || '', nombre: tipos[k.ID_Tipo] ? tipos[k.ID_Tipo].NombreClase : NOMBRE, estado: x.Estado === 'Cancelada' ? 'Cancelada' : (asis[x.ID_Reserva] || 'Pendiente'), canceladaPor: x.CanceladaPor, canceladaEn: x.CanceladaEn ? x.CanceladaEn.slice(0, 10) : '' };
  }).sort((a, b) => (b.fecha + b.inicio).localeCompare(a.fecha + a.inicio)).slice(0, 150);
  return { ok: true, cliente: { id: c.ID_Cliente, nombre: c.Nombre + ' ' + c.Apellido, email: c.Email, telefono: c.Telefono, estado: c.EstadoCuenta, alta: c.FechaAlta.slice(0, 10) }, resumen: { contratadas: r.total, usadas: r.usadas, restantes: r.restantes, vencidas: r.vencidas, asistidas: r.asistidas, faltas: r.faltas, agendadas: r.agendadas }, contrataciones: contrataciones, reservas: reservas };
}

/* ---------- Clientes (admin) ---------- */
function getClientesAdmin(clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  DB_ = {};
  const res = resumen_(), servicios = mapa_(R_('ServiciosPacks'), 'ID_Servicio'), porCli = agrupar_(R_('Contrataciones'), 'ID_Cliente');
  return {
    ok: true, clientes: R_('Clientes').map(c => {
      const mine = porCli[c.ID_Cliente] || [], pa = packActual_(c.ID_Cliente, servicios, mine).nombre;
      const vivas = mine.filter(t => t.EstadoPago !== 'Cancelado');
      const pago = !vivas.length ? 'Sin contratación' : vivas.some(t => t.EstadoPago === 'Pendiente') ? 'Pendiente' : 'Pagado';
      return { id: c.ID_Cliente, nombre: c.Nombre + ' ' + c.Apellido, email: c.Email, telefono: c.Telefono, pack: pa, creditos: res.get(c.ID_Cliente).restantes, vencidas: res.get(c.ID_Cliente).vencidas, estado: c.EstadoCuenta, pago: pago };
    })
  };
}
function cambiarEstadoCliente(idCliente, estado, clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  return tx_(() => {
    const c = R_('Clientes').find(x => x.ID_Cliente === idCliente);
    if (!c) return fail_('Cliente no encontrado.');
    if (c.EstadoCuenta === 'Pendiente') return fail_('El cliente debe activar su cuenta primero.');
    if (estado !== 'Activo' && estado !== 'Inactivo') return fail_('Estado inválido.');
    if (estado === 'Inactivo') {
      const r = resumen_().get(idCliente);
      if (r.agendadas > 0) return fail_('No se puede desactivar porque tiene clases reservadas.');
      if (r.restantes > 0) return fail_('No se puede desactivar porque tiene créditos restantes.');
    }
    upd_('Clientes', c, { EstadoCuenta: estado });
    return { ok: true, msg: 'Estado del cliente actualizado a ' + estado + '.' };
  });
}
function eliminarClienteAdmin(idCliente, clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  return tx_(() => {
    const c = R_('Clientes').find(x => x.ID_Cliente === idCliente);
    if (!c) return fail_('Cliente no encontrado.');
    if (resumen_().get(idCliente).agendadas > 0) return fail_('No se puede eliminar porque tiene reservas pendientes.');
    const resIds = new Set(R_('Reservas').filter(r => r.ID_Cliente === idCliente).map(r => r.ID_Reserva));
    del_('Asistencias', a => resIds.has(a.ID_Reserva));
    del_('Reservas', r => r.ID_Cliente === idCliente);
    del_('Contrataciones', t => t.ID_Cliente === idCliente);
    del_('Clientes', x => x.ID_Cliente === idCliente);
    return { ok: true, msg: 'Cliente eliminado junto con su historial.' };
  });
}

/* ---------- Packs y tipos de clase ---------- */
function getPacksYServicios(todos, clave) {
  DB_ = {};
  const incluir = todos && adm_(clave);
  return R_('ServiciosPacks').filter(p => incluir || p.Activo)
    .map(p => ({ id: p.ID_Servicio, nombre: p.NombreServicio, cantidad: p.CantidadClases, precio: p.Precio, estado: p.Activo ? 'Activo' : 'Inactivo', cats: p.CategoriasPermitidas }));
}
function guardarOPaqueteServicio(d, clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  return tx_(() => {
    if (!d || !d.nombre || !(num_(d.cantidad) > 0) || d.precio === '' || d.precio == null) return fail_('Nombre, cantidad (mayor a 0) y precio son obligatorios.');
    const f = R_('ServiciosPacks').find(p => p.ID_Servicio === d.id);
    const datos = { NombreServicio: d.nombre, CantidadClases: num_(d.cantidad), Precio: num_(d.precio), Activo: d.estado !== 'Inactivo', CategoriasPermitidas: String(d.cats || '') };
    if (f) upd_('ServiciosPacks', f, datos); else ins_('ServiciosPacks', Object.assign({ ID_Servicio: id_('P') }, datos));
    return { ok: true };
  });
}

function getTiposClases(clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  DB_ = {};
  return { ok: true, tipos: R_('TiposClases').filter(t => t.Activo).map(t => ({ id: t.ID_Tipo, nombre: t.NombreClase, cupo: t.CupoDefault || CUPO, categoria: catDe_(t) })) };
}

function guardarTipoClase(id, nombre, cupo, clave, categoria) {
  if (!adm_(clave)) return fail_('No autorizado.');
  return tx_(() => {
    const nom = String(nombre || '').trim(), cp = num_(cupo), cat = CATEGORIAS.indexOf(categoria) >= 0 ? categoria : 'Grupal';
    if (!nom || cp < 1) return fail_('Nombre y cupo inválidos.');
    const rows = R_('TiposClases');
    if (rows.some(x => x.Activo && x.NombreClase.toLowerCase() === nom.toLowerCase() && x.ID_Tipo !== id)) return fail_('Ya existe una clase con ese nombre.');
    if (id) {
      const r = rows.find(x => x.ID_Tipo === id);
      if (!r) return fail_('No se encontró la clase.');
      upd_('TiposClases', r, { NombreClase: nom, CupoDefault: cp, Categoria: cat });
    } else ins_('TiposClases', { ID_Tipo: id_('T'), NombreClase: nom, CupoDefault: cp, Activo: true, Categoria: cat });
    return { ok: true, msg: 'Tipo de clase guardado.' };
  });
}

function eliminarTipoClase(id, clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  return tx_(() => {
    const t = R_('TiposClases').find(x => x.ID_Tipo === id);
    if (!t) return fail_('No se encontró la clase.');
    const enUso = R_('Disponibilidad').some(d => d.ID_Tipo === id && d.Activo) || R_('Clases').some(c => c.ID_Tipo === id);
    if (enUso) { upd_('TiposClases', t, { Activo: false }); return { ok: true, msg: 'La clase estaba en uso: se desactivó (el historial se conserva).' }; }
    del_('TiposClases', x => x.ID_Tipo === id);
    return { ok: true, msg: 'Tipo de clase eliminado.' };
  });
}

/* ---------- Disponibilidad ---------- */
function getDisponibilidad(clave, semanaIso) {
  if (!adm_(clave)) return fail_('No autorizado.');
  DB_ = {};
  const sem = String(semanaIso || iso_(lunes_(new Date())));
  const hayEx = R_('SemanasPersonalizadas').some(s => s.Semana === sem);
  const dias = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
  R_('Disponibilidad').filter(r => r.Activo && (hayEx ? r.Semana === sem : r.Semana === ''))
    .sort((a, b) => a.DiaSemana - b.DiaSemana || a.HoraInicio.localeCompare(b.HoraInicio))
    .forEach(r => {
      const l = dias[r.DiaSemana];
      if (!l) return;
      const u = l[l.length - 1];
      if (u && u.f === r.HoraInicio) u.f = r.HoraFin; else l.push({ i: r.HoraInicio, f: r.HoraFin });
    });
  return { ok: true, dias: dias, tieneExcepcion: hayEx };
}
function guardarDisponibilidad(cfg, clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  return tx_(() => {
    const b = [], vistos = {};
    for (let d = 1; d <= 7; d++) {
      for (const r of ((cfg.dias || {})[d] || [])) {
        if (!r.i || !r.f || min_(r.f) - min_(r.i) < 60) return fail_('Cada franja debe durar al menos 1 hora (' + r.i + ' a ' + r.f + ').');
        for (let m = min_(r.i); m + 60 <= min_(r.f); m += 60) {
          if (!vistos[d + '|' + m]) { vistos[d + '|' + m] = 1; b.push({ dia: d, ini: hhmm_(m), fin: hhmm_(m + 60) }); }
        }
      }
    }
    const semanal = cfg.regla !== 'semana', sem = String(cfg.semana || '');
    const def = R_('TiposClases').find(t => t.Activo);
    if (!def) return fail_('Creá primero un tipo de clase.');
    const prev = {}, nuevos = new Set();
    R_('Disponibilidad').filter(r => semanal ? r.Semana === '' : r.Semana === sem).forEach(r => prev[r.DiaSemana + '|' + r.HoraInicio] = r);
    b.forEach(x => {
      const k = x.dia + '|' + x.ini, p = prev[k];
      nuevos.add(k);
      if (p) upd_('Disponibilidad', p, { HoraFin: x.fin, Activo: true });
      else ins_('Disponibilidad', { ID_Disponibilidad: id_('D'), Semana: semanal ? '' : sem, DiaSemana: x.dia, HoraInicio: x.ini, HoraFin: x.fin, ID_Tipo: def.ID_Tipo, CupoMaximo: def.CupoDefault || CUPO, Activo: true });
    });
    Object.keys(prev).forEach(k => { if (!nuevos.has(k) && prev[k].Activo) upd_('Disponibilidad', prev[k], { Activo: false }); });
    if (!semanal && !R_('SemanasPersonalizadas').some(s => s.Semana === sem)) ins_('SemanasPersonalizadas', { Semana: sem });

    const hoy = iso_(new Date());
    const ini = semanal ? hoy : (sem > hoy ? sem : hoy), fin = semanal ? finProyeccion_() : iso_(addDays_(parseFechaLocal_(sem), 6));
    const plan = plan_(ini, fin);
    const nom = {}, porClase = agrupar_(R_('Reservas').filter(r => r.Estado === 'Agendada'), 'ID_Clase');
    R_('Clientes').forEach(c => nom[c.ID_Cliente] = c.Nombre + ' ' + c.Apellido);
    const afectadas = [];
    plan.cancelar.forEach(c => (porClase[c.ID_Clase] || []).forEach(r => afectadas.push({ idReserva: r.ID_Reserva, cliente: nom[r.ID_Cliente] || r.ID_Cliente, fecha: c.FechaClase, hora: c.HoraInicio })));
    if (afectadas.length && !cfg.confirmarAfectados) {
      descartar_();
      return { ok: true, requiereConfirmacion: true, afectados: afectadas, msg: 'Esta modificación elimina horarios que tienen clientes inscriptos. Si continuás, sus reservas se cancelarán y se les devolverá el crédito.' };
    }
    aplicar_(plan, true);
    return { ok: true, bloques: b.length, canceladas: afectadas.length, msg: 'Disponibilidad guardada: ' + b.length + ' turnos por semana' + (afectadas.length ? ' (' + afectadas.length + ' reservas canceladas y créditos devueltos)' : '') + '.' };
  });
}

function editarClase(idClase, idTipo, nuevoCupo, clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  return tx_(() => {
    const c = R_('Clases').find(x => x.ID_Clase === idClase), t = R_('TiposClases').find(x => x.ID_Tipo === idTipo), cupo = num_(nuevoCupo);
    if (!c || !t || cupo < 1) return fail_('Datos inválidos.');
    const ocup = R_('Reservas').filter(r => r.ID_Clase === idClase && r.Estado === 'Agendada').length;
    if (cupo < ocup) return fail_('Ya hay ' + ocup + ' inscriptos: el cupo no puede ser menor.');
    upd_('Clases', c, { ID_Tipo: t.ID_Tipo, CupoMaximo: cupo, Personalizada: true });
    refrescarTitulos_(idClase);
    return { ok: true, msg: 'Clase del ' + c.FechaClase + ' actualizada a "' + t.NombreClase + '" con cupo de ' + cupo + '.' };
  });
}

/* ---------- Dashboard cliente ---------- */
function getDashboardCliente(idCliente) {
  DB_ = {};
  const c = R_('Clientes').find(x => x.ID_Cliente === idCliente);
  if (!c) return fail_('Cliente no encontrado.');
  if (c.EstadoCuenta !== 'Activo') return fail_('Tu cuenta no está activa.');
  const r = resumen_().get(idCliente), clases = mapa_(R_('Clases'), 'ID_Clase'), tipos = mapa_(R_('TiposClases'), 'ID_Tipo'), servicios = mapa_(R_('ServiciosPacks'), 'ID_Servicio'), now = ahoraS_();
  const asis = {};
  R_('Asistencias').forEach(a => asis[a.ID_Reserva] = a.Estado);
  const lista = R_('Reservas').filter(x => x.ID_Cliente === idCliente && x.Estado === 'Agendada').map(x => {
    const k = clases[x.ID_Clase] || {};
    return { idReserva: x.ID_Reserva, idClase: x.ID_Clase, fecha: k.FechaClase || '', nombre: tipos[k.ID_Tipo] ? tipos[k.ID_Tipo].NombreClase : NOMBRE, inicio: k.HoraInicio || '00:00', fin: k.HoraFin || '', asistencia: asis[x.ID_Reserva] || 'Pendiente', pasada: ((k.FechaClase || '') + ' ' + (k.HoraInicio || '')) < now };
  }).sort((a, b) => (a.fecha + a.inicio).localeCompare(b.fecha + b.inicio));
  const packs = r.packs.filter(p => p.saldo > 0).map(p => ({ nombre: servicios[p.servicio] ? servicios[p.servicio].NombreServicio : 'Pack', saldo: p.saldo, desde: p.desde, vence: p.vence, vencido: p.vencido, cats: catsDe_(servicios[p.servicio]) }));
  return { ok: true, pack: packActual_(idCliente).nombre, contratadas: r.total, restantes: r.restantes, vencidas: r.vencidas, agendadas: r.agendadas, asistidas: r.asistidas, faltas: r.faltas, reservas: lista, packs: packs, ventanas: packs.filter(p => !p.vencido).map(p => ({ desde: p.desde, hasta: p.vence })), vigenciaDias: VIGENCIA_DIAS };
}

/* ---------- Reservas ---------- */
function refrescarTitulos_(idClase) {
  try {
    const cli = mapa_(R_('Clientes'), 'ID_Cliente');
    const c = R_('Clases').find(x => x.ID_Clase === idClase), cupo = c ? (c.CupoMaximo || CUPO) : CUPO;
    const rs = R_('Reservas').filter(r => r.ID_Clase === idClase && r.Estado === 'Agendada');
    rs.forEach(r => {
      if (!r.EventoCalendarID) return;
      const e = evento_(r.EventoCalendarID), p = cli[r.ID_Cliente];
      if (e) e.setTitle('Pilates - ' + (p ? p.Nombre + ' ' + p.Apellido : '') + ' (' + rs.length + '/' + cupo + ')');
    });
  } catch (x) { Logger.log('Calendar: ' + x); }
}
function crearReservasMasivas(idCliente, lista) { return crearReservas_(idCliente, lista, false); }
function crearReservasAdmin(idCliente, lista, clave) { return adm_(clave) ? crearReservas_(idCliente, lista, true) : fail_('No autorizado.'); }

function crearReservas_(idCliente, lista, adm) {
  return tx_(() => {
    const cli = R_('Clientes').find(c => c.ID_Cliente === idCliente);
    if (!cli) return fail_('Cliente no encontrado.');
    if (cli.EstadoCuenta === 'Inactivo' || (!adm && cli.EstadoCuenta !== 'Activo')) return fail_(adm ? 'El cliente está inactivo.' : 'Tu cuenta está inactiva: no podés agendar turnos.');
    if (!lista || !lista.length) return fail_('Elegí al menos una clase.');
    const rs = resumen_().get(idCliente), disp = adm ? rs.restantes + rs.vencidas : rs.restantes;
    if (lista.length > disp) {
      if (!adm && rs.vencidas > 0) return fail_('Tenés ' + rs.restantes + ' clases vigentes y ' + rs.vencidas + ' vencidas (pasaron los ' + VIGENCIA_DIAS + ' días de tu pack). Para usarlas consultá con el centro.');
      return fail_((adm ? 'El cliente tiene ' : 'Te quedan ') + disp + ' clases y se eligieron ' + lista.length + '.');
    }
    const clases = mapa_(R_('Clases'), 'ID_Clase'), tipos = mapa_(R_('TiposClases'), 'ID_Tipo'), servicios = mapa_(R_('ServiciosPacks'), 'ID_Servicio');
    const cnt = {}, mias = new Set(), vistos = new Set(), now = ahoraS_(), sel = [];
    R_('Reservas').forEach(r => { if (r.Estado !== 'Agendada') return; cnt[r.ID_Clase] = (cnt[r.ID_Clase] || 0) + 1; if (r.ID_Cliente === idCliente) mias.add(r.ID_Clase); });
    for (const it of lista) {
      const c = clases[it.idClase];
      if (!c || c.Estado !== 'Activa') return fail_('Una de las clases ya no está disponible.');
      if ((c.FechaClase + ' ' + c.HoraInicio) < now) return fail_('No se puede reservar una clase pasada (' + fmtF_(c.FechaClase) + ' ' + c.HoraInicio + ').');
      if (mias.has(c.ID_Clase) || vistos.has(c.ID_Clase)) return fail_('Ya está reservada la clase del ' + fmtF_(c.FechaClase) + ' a las ' + c.HoraInicio + '.');
      if ((cnt[c.ID_Clase] || 0) >= (c.CupoMaximo || CUPO)) return fail_('La clase del ' + fmtF_(c.FechaClase) + ' a las ' + c.HoraInicio + ' está COMPLETA.');
      vistos.add(c.ID_Clase);
      sel.push(c);
    }
    sel.sort((a, b) => (a.FechaClase + a.HoraInicio).localeCompare(b.FechaClase + b.HoraInicio));
    const packs = rs.packs.map(p => ({ id: p.id, nombre: servicios[p.servicio] ? servicios[p.servicio].NombreServicio : 'Pack', cap: p.saldo, desde: p.desde, vence: p.vence, cats: catsDe_(servicios[p.servicio]), fechas: p.fechas.slice() }));
    const asign = [];
    let fuera = 0;
    for (const c of sel) {
      const d = c.FechaClase;
            const cat = catDe_(tipos[c.ID_Tipo]), nomTipo = tipos[c.ID_Tipo] ? tipos[c.ID_Tipo].NombreClase : NOMBRE;
      const ok = q => q.cap > 0 && permite_(q, cat);
      let p = packs.find(q => ok(q) && d >= q.desde && d <= q.vence), excepcion = false;
      if (!p && adm) { p = packs.find(ok); excepcion = true; } // el administrador puede asignar fuera de plazo con el saldo pendiente
      if (!p) {
        const q = packs.find(ok);
        if (!q) return fail_(packs.some(x => x.cap > 0) ? (adm ? 'El cliente no tiene un pack que habilite' : 'Tu pack no incluye') + ' la clase «' + nomTipo + '» (categoría ' + cat + ').' : 'No hay clases disponibles para reservar.');
        if (d < q.desde) return fail_('Tu pack «' + q.nombre + '» habilita turnos desde el ' + fmtF_(q.desde) + '.');
        return fail_('La clase del ' + fmtF_(d) + ' queda fuera de la vigencia de tu pack «' + q.nombre + '» (del ' + fmtF_(q.desde) + ' al ' + fmtF_(q.vence) + '). Elegí una fecha dentro del plazo o consultá con el centro.');
      }
      p.cap--; p.fechas.push(d);
      asign.push({ c: c, p: p });
      if (excepcion) fuera++;
    }
    const cal = cal_();
    asign.forEach(x => {
      const c = x.c;
      let ev = '';
      try { ev = cal.createEvent('Pilates - ' + cli.Nombre + ' ' + cli.Apellido, date_(c.FechaClase, c.HoraInicio), date_(c.FechaClase, c.HoraFin), { description: tipos[c.ID_Tipo] ? tipos[c.ID_Tipo].NombreClase : NOMBRE }).getId(); }
      catch (e) { Logger.log('Calendar: ' + e); }
      ins_('Reservas', { ID_Reserva: id_('R'), ID_Cliente: idCliente, ID_Clase: c.ID_Clase, Estado: 'Agendada', CreadoEn: isoDT_(), EventoCalendarID: ev, ID_Contratacion: x.p.id });
    });
    sel.forEach(c => refrescarTitulos_(c.ID_Clase));
    return { ok: true, restantes: resumen_().get(idCliente).restantes, fueraDePlazo: fuera, email: cli.Email, creadas: sel.map(c => ({ fecha: c.FechaClase, nombre: tipos[c.ID_Tipo] ? tipos[c.ID_Tipo].NombreClase : NOMBRE, inicio: c.HoraInicio })) };
  });
}

function cancelar_(idReserva, idCliente, forzar) {
  return tx_(() => {
    const r = R_('Reservas').find(x => x.ID_Reserva === idReserva && x.Estado === 'Agendada');
    if (!r) return fail_('La reserva no existe o ya fue cancelada.');
    if (!forzar) {
      if (r.ID_Cliente !== idCliente) return fail_('No autorizado.');
      if (R_('Asistencias').some(a => a.ID_Reserva === idReserva)) return fail_('Esta clase ya tiene asistencia registrada.');
      const c = R_('Clases').find(x => x.ID_Clase === r.ID_Clase);
      if (c && (c.FechaClase + ' ' + c.HoraInicio) < ahoraS_()) return fail_('No se puede cancelar una clase pasada.');
    }
    cancelarRes_(r, forzar ? 'Admin' : 'Cliente');
    del_('Asistencias', a => a.ID_Reserva === idReserva);
    refrescarTitulos_(r.ID_Clase);
    return { ok: true, msg: 'Reserva cancelada. Se devolvió 1 clase al saldo.' };
  });
}
function cancelarReserva(idReserva, idCliente) { return cancelar_(idReserva, idCliente, false); }
function cancelarReservaAdmin(idReserva, clave) { return adm_(clave) ? cancelar_(idReserva, null, true) : fail_('No autorizado.'); }

/* ---------- Admin: agenda y asistencia ---------- */
function getAgendaAdmin(clave, ini, fin) {
  if (!adm_(clave)) return fail_('No autorizado.');
  asegurar_(ini, fin);
  const nom = {}, asis = {}, par = {};
  R_('Clientes').forEach(c => nom[c.ID_Cliente] = c.Nombre + ' ' + c.Apellido);
  R_('Asistencias').forEach(a => asis[a.ID_Reserva] = a.Estado);
  R_('Reservas').forEach(r => {
    if (r.Estado === 'Agendada') (par[r.ID_Clase] = par[r.ID_Clase] || []).push({ idReserva: r.ID_Reserva, idCliente: r.ID_Cliente, cliente: nom[r.ID_Cliente] || r.ID_Cliente, asistencia: asis[r.ID_Reserva] || 'Pendiente' });
  });
  return { ok: true, slots: slotsRango_(ini, fin).map(s => { s.participantes = par[s.idClase] || []; return s; }) };
}
function marcarAsistencia(idReserva, estadoAsistencia, clave) {
  if (!adm_(clave)) return fail_('No autorizado.');
  return tx_(() => {
    if (['Asistio', 'Falto', 'Pendiente'].indexOf(estadoAsistencia) < 0) return fail_('Estado inválido.');
    if (!R_('Reservas').some(x => x.ID_Reserva === idReserva && x.Estado === 'Agendada')) return fail_('Reserva no encontrada.');
    const a = R_('Asistencias').find(x => x.ID_Reserva === idReserva);
    if (estadoAsistencia === 'Pendiente') { if (a) del_('Asistencias', x => x.ID_Reserva === idReserva); }
    else if (a) upd_('Asistencias', a, { Estado: estadoAsistencia, RegistradoEn: isoDT_() });
    else ins_('Asistencias', { ID_Asistencia: id_('A'), ID_Reserva: idReserva, Estado: estadoAsistencia, RegistradoEn: isoDT_() });
    return { ok: true };
  });
}

/* ---------- Reporte ---------- */
function getReporteAdmin(clave, desde, hasta) {
  if (!adm_(clave)) return fail_('No autorizado.');
  DB_ = {};
  const hoy = new Date(), ahora = ahoraS_();
  if (!esFecha_(desde)) desde = iso_(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  if (!esFecha_(hasta)) hasta = iso_(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0));
  const todas = mapa_(R_('Clases'), 'ID_Clase'), asis = {}, resCl = {}, asCl = {}, conRes = new Set(), per = {};
  const enRango = id => { const c = todas[id]; return !!c && c.FechaClase >= desde && c.FechaClase <= hasta; };
  const P = id => per[id] || (per[id] = { real: 0, falt: 0, pend: 0, cc: 0, ca: 0, cs: 0 });
  R_('Asistencias').forEach(a => asis[a.ID_Reserva] = a.Estado);
  R_('Reservas').forEach(r => {
    if (!enRango(r.ID_Clase)) return;
    const p = P(r.ID_Cliente);
    if (r.Estado === 'Cancelada') {
      if (r.CanceladaPor === 'Cliente') p.cc++; else if (r.CanceladaPor === 'Admin' || r.CanceladaPor === 'Horario') p.ca++; else p.cs++;
      return;
    }
    if (r.Estado !== 'Agendada') return;
    const e = asis[r.ID_Reserva];
    conRes.add(r.ID_Cliente);
    resCl[r.ID_Clase] = (resCl[r.ID_Clase] || 0) + 1;
    if (e === 'Asistio') { p.real++; asCl[r.ID_Clase] = (asCl[r.ID_Clase] || 0) + 1; }
    else if (e === 'Falto') p.falt++; else p.pend++;
  });
  const clases = R_('Clases').filter(c => c.Estado === 'Activa' && c.FechaClase >= desde && c.FechaClase <= hasta);
  const dictadas = clases.filter(c => (c.FechaClase + ' ' + c.HoraInicio) < ahora);
  const suma = (l, f) => l.reduce((s, c) => s + f(c), 0);
  const cupo = c => c.CupoMaximo || CUPO, res = c => resCl[c.ID_Clase] || 0, asi = c => asCl[c.ID_Clase] || 0;
  const pct = (a, b) => b ? Math.round(a * 1000 / b) / 10 : null;
  const ofrecidos = suma(dictadas, cupo), reservados = suma(dictadas, res);
  const tipos = mapa_(R_('TiposClases'), 'ID_Tipo'), porTipo = {};
  dictadas.forEach(c => {
    const x = porTipo[c.ID_Tipo] || (porTipo[c.ID_Tipo] = { turnos: 0, conAlumnos: 0, ofrecidos: 0, reservados: 0, asistieron: 0 });
    x.turnos++; if (res(c)) x.conAlumnos++;
    x.ofrecidos += cupo(c); x.reservados += res(c); x.asistieron += asi(c);
  });
  const disciplinas = Object.keys(porTipo).map(id => {
    const x = porTipo[id];
    x.nombre = tipos[id] ? tipos[id].NombreClase : NOMBRE;
    x.pct = pct(x.reservados, x.ofrecidos);
    return x;
  }).sort((a, b) => b.turnos - a.turnos);
  let cobrado = 0, pendienteCobro = 0;
  R_('Contrataciones').forEach(t => {
    if (t.FechaContratacion < desde || t.FechaContratacion > hasta) return;
    if (t.EstadoPago === 'Pagado') cobrado += t.PrecioAcordado; else if (t.EstadoPago === 'Pendiente') pendienteCobro += t.PrecioAcordado;
  });
  const rs = resumen_(), servicios = mapa_(R_('ServiciosPacks'), 'ID_Servicio'), contr = agrupar_(R_('Contrataciones'), 'ID_Cliente');
  const clientes = R_('Clientes');
  return {
    ok: true, desde: desde, hasta: hasta,
    kpis: {
      turnos: clases.length, turnosConAlumnos: clases.filter(c => res(c) > 0).length, dictados: dictadas.length, proximos: clases.length - dictadas.length,
      ofrecidos: ofrecidos, reservados: reservados, ocupacion: pct(reservados, ofrecidos), asistieron: suma(dictadas, asi),
      reservasProximas: suma(clases, res) - reservados,
      clientesActivos: clientes.filter(c => c.EstadoCuenta === 'Activo').length, clientesConReservas: conRes.size, cobrado: cobrado, pendienteCobro: pendienteCobro
    },
    disciplinas: disciplinas,
    alumnos: clientes.map(c => {
      const pa = packActual_(c.ID_Cliente, servicios, contr[c.ID_Cliente] || []), s = rs.get(c.ID_Cliente), k = per[c.ID_Cliente] || { real: 0, falt: 0, pend: 0, cc: 0, ca: 0, cs: 0 };
      const pago = !pa.todas.length ? 'Sin contratación' : pa.todas.some(t => t.EstadoPago === 'Pendiente') ? 'Pendiente' : 'Pagado';
      return { id: c.ID_Cliente, nombre: c.Nombre + ' ' + c.Apellido, estado: c.EstadoCuenta, pack: pa.nombre + (pa.todas.length > 1 ? ' (+' + (pa.todas.length - 1) + ')' : ''), pago: pago, realizadas: k.real, faltas: k.falt, reservadas: k.pend, cancCliente: k.cc, cancAdmin: k.ca, cancSinDato: k.cs, restantes: s.restantes, vencidas: s.vencidas };
    })
  };
}

/* ---------- Limpieza de datos de prueba ---------- */
function vistaPreviaLimpieza() {
  DB_ = {};
  const c = {};
  ['Clientes', 'Contrataciones', 'Reservas', 'Asistencias', 'Clases'].forEach(n => c[n] = R_(n).length);
  c.eventosDeCalendario = R_('Reservas').filter(r => r.EventoCalendarID).length;
  Logger.log('Se borrarían: ' + JSON.stringify(c));
}
function limpiarDatosDePrueba() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.copy('Respaldo antes de limpiar ' + stamp_());
  tx_(() => {
    R_('Reservas').forEach(r => {
      if (!r.EventoCalendarID) return;
      try { const e = evento_(r.EventoCalendarID); if (e) e.deleteEvent(); } catch (x) { Logger.log(x); }
    });
    ['Asistencias', 'Reservas', 'Contrataciones', 'Clientes', 'Clases'].forEach(n => del_(n, () => true));
  });
  Logger.log('Listo: se borraron clientes, contrataciones, reservas, asistencias y clases generadas. La configuración quedó intacta.');
  ss.toast('Datos de prueba borrados. El respaldo quedó en tu Drive.', 'Pilates', 8);
}