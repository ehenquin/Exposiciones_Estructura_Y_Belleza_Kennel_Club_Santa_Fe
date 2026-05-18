import { CONFIG } from "./config.js";

const $ = (id) => document.getElementById(id);
const CACHE = new Map();

// Variable para recordar qué pista de grupo estamos juzgando actualmente
window._pistaGrupoActiva = {
  eventId: null,
  groupIds: [], // Ahora es un array para selección múltiple
  judgeId: null,
  superCats: [],
  eventName: "",
  judgeName: ""
};

// --- ESTRUCTURA PARA EL TEMPORIZADOR (AUTO-GUARDADO) ---
const pendingTimers = new Map();

// *************************************************************************************
// >>> CONFIGURACIÓN DEL TIEMPO DE ESPERA DEL AUTO-GUARDADO (en milisegundos) <<<
const TIEMPO_ESPERA_GUARDADO = 3000;
// *************************************************************************************

// --- MAPEO DE SUPER-CATEGORÍAS REALES (REFORMA GRUPOS) ---
const MAPA_SUPER_CATS = {
  "CACHORROS ESPECIALES": ["C00"],
  "CACHORROS": ["C01"],
  "JOVENES": ["C02", "C03"],
  "ADULTOS": ["C04", "C05", "C06", "C07"],
  "VETERANOS": ["C08"]
};

// --- FUNCIONES AUXILIARES IMPORTANTES ---
const normalizeID = (id) => String(id || "").trim().toLowerCase();
function isTruthy(v) {
  return ["true", "1", "si", "sí", "yes", "x"].includes(String(v || "").trim().toLowerCase());
}
// --- NORMALIZADOR DE GRUPO: "Grupo 1" y "G1" pasan a ser "G1" ---
function normalizeGrupo(gr) {
  const s = String(gr || "").trim();

  // Caso "G1", "g1", " G1 "
  const m1 = s.match(/^g\s*(\d+)$/i);
  if (m1) return "G" + String(parseInt(m1[1], 10));

  // Caso "Grupo 1", "grupo 01", etc.
  const m2 = s.match(/^grupo\s*(\d+)$/i);
  if (m2) return "G" + String(parseInt(m2[1], 10));

  // Si no matchea nada, lo dejo igual (pero trimmeado)
  return s;
}

const eventoOf = (r) => normalizeID(r?.IDEvento ?? r?.IDEvento ?? "");
const juezOf = (r) => normalizeID(r?.IDJuez ?? r?.IDJuez ?? "");








function formatFechaCristiana(fechaInput) {
  if (!fechaInput) return "";
  const [year, month, day] = fechaInput.split("-");
  return `${day}/${month}/${year}`;
}





// --- 1. NÚCLEO Y COMUNICACIÓN ---

// --- 1. NÚCLEO Y COMUNICACIÓN (MODIFICADO PARA MODO RESILIENTE/CORS) ---
// --- 1. NÚCLEO Y COMUNICACIÓN (REPARADO) ---
async function api(metodo, params = {}, body = null, opts = {}) {
  const url = new URL(CONFIG.API_URL);

  // Obtenemos la llave de la memoria temporal del navegador
  const sessionKey = sessionStorage.getItem("USER_API_KEY") || CONFIG.API_KEY;

  // Parámetros en la URL (solo para GET como el sync)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const options = {
    method: metodo,
    redirect: "follow"
  };

  if (body) {
    // Incluimos la KEY recuperada de la sesión dentro del JSON
    const payloadCompleto = {
      key: sessionKey,
      ...body
    };
    options.body = JSON.stringify(payloadCompleto);
    options.headers = { "Content-Type": "text/plain;charset=utf-8" };
  } else {
    // Si es GET, la key va en la URL
    url.searchParams.set("key", sessionKey);
  }

  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("Respuesta no válida del servidor. Verifica la URL de la API.");
    }

    if (!data.ok) throw new Error(data.error || "Error en el servidor");
    return data;

  } catch (err) {
    console.error("Error API:", err);
    throw err;
  }
}
window.api = api;





function setStatus(m, err = false) {
  const s = $("status");
  if (s) { s.textContent = m; s.style.color = err ? "red" : "black"; }
}

// 1. FUNCION SYNCALL (CORREGIDA)
async function syncAll() {
  setStatus("Sincronizando datos...");
  try {
    const res = await api("GET", { action: "sync" });

    CACHE.clear();

    Object.keys(res.data || {}).forEach(tabla => {
      CACHE.set(tabla, res.data[tabla]);
    });

    setStatus("Sincronizado.");

    const rows = res.data?.Catalogo_Perros_Inscriptos || [];
    sugerirNroCatalogo(rows);

    // 🔥 FIX BIS
    if (window._pistaBisActiva) {
      renderJuzgamientoBis();
    }

    return res.data;

  } catch (e) {
    setStatus("Error de red: " + e.message, true);
    throw e;
  }
}


window.syncAll = syncAll;




function traducirTitulos(idsStr, listaTitulos) {
  if (!idsStr) return "Ninguno";
  const titulos = listaTitulos || [];
  return idsStr.split(", ")
    .map(id => titulos.find(t => String(t.IDTitulo) === String(id.trim()))?.NombreTitulo || id)
    .join(", ");
}



// --- 2. GESTIÓN DE CATÁLOGOS (CONSOLIDADOS Y COMPLETOS) ---
async function loadCatalog() {
  const table = $("catalogo").value;
  if (!table) return;

  // 1. Manejo del Filtro de Evento para Perros Inscriptos
  const filterContainerId = "catalogFilterContainer";
  let filterContainer = $(filterContainerId);

  // Si no existe el contenedor de filtros, lo creamos antes del contenedor de la tabla
  if (!filterContainer) {
    filterContainer = document.createElement("div");
    filterContainer.id = filterContainerId;
    filterContainer.className = "catalog-toolbar-extra";
    $("contCatalogos").parentNode.insertBefore(filterContainer, $("contCatalogos"));
  }

  // Solo mostramos el selector si estamos en la tabla de perros inscriptos
  if (table === "Catalogo_Perros_Inscriptos") {
    const eventos = CACHE.get("Eventos") || [];

    // Recuperamos o definimos el evento seleccionado (si ya existía el select)
    let selectedEventId = $(filterContainerId).querySelector("select")?.value || "";

    // Si no hay selección previa, tomamos el último evento cargado
    if (!selectedEventId && eventos.length > 0) {
      selectedEventId = String(eventos[eventos.length - 1].IDEvento);
    }

    // Inyectamos el HTML (sin onchange inline)
    filterContainer.innerHTML = `
      <div class="field" style="max-width: 400px; margin-bottom: 15px; background: #fdf2e9; padding: 10px; border-radius: 8px; border: 1px solid #e67e22;">
        <label style="color: #a04000; font-weight: bold;">🔍 Filtrar Perros por Evento:</label>
        <select id="filterCatalogEvento" class="select-lg">
          <option value="TODOS">-- Mostrar Todos los Eventos --</option>
          ${eventos.map(e => `
            <option value="${e.IDEvento}" ${String(e.IDEvento) === selectedEventId ? 'selected' : ''}>
              ${e.NombreEvento}
            </option>
          `).join("")}
        </select>
      </div>
    `;
    filterContainer.style.display = "block";

    // ASIGNACIÓN DE EVENTO POR CÓDIGO (Solución al ReferenceError)
    const selFiltro = $("filterCatalogEvento");
    if (selFiltro) {
      selFiltro.onchange = () => loadCatalog();
    }

  } else {
    // Si elegimos otra tabla, ocultamos el filtro de perros
    filterContainer.style.display = "none";
  }

  let rows = CACHE.get(table) || [];

  if (rows.length > 0) {
    const insc = CACHE.get("Catalogo_Perros_Inscriptos") || [];
    const razas = CACHE.get("Catalogo_Razas") || [];
    const cats = CACHE.get("Catalogo_Categorias") || [];
    const sexos = CACHE.get("Catalogo_Sexos") || [];
    const titulos = CACHE.get("Catalogo_Titulos") || [];
    const eventos = CACHE.get("Eventos") || [];
    const jueces = CACHE.get("Jueces") || [];
    const grupos = CACHE.get("Catalogo_Grupos") || [];

    if (table === "Catalogo_Perros_Inscriptos") {
      const activeFilterId = $("filterCatalogEvento")?.value;

      // Aplicamos filtro de evento si no es "TODOS"
      if (activeFilterId && activeFilterId !== "TODOS") {
        rows = rows.filter(r => normalizeID(r.IDEvento) === normalizeID(activeFilterId));
      }

      // MAPEADO LIMPIO: Sin ...r para evitar columnas duplicadas o técnicas
      rows = rows.map(r => {
        const eData = eventos.find(e => normalizeID(e.IDEvento) === normalizeID(r.IDEvento));
        return {
          "Evento": eData ? eData.NombreEvento : "N/D",
          "Nro": r.NumeroCatalogo,
          "Grupo": r.IDGrupo,
          "Raza": razas.find(rz => String(rz.IDRaza) === String(r.IDRaza))?.NombreRaza || r.IDRaza,
          "Categoría": cats.find(c => String(c.IDCategoria) === String(r.IDCategoria))?.NombreCategoria || r.IDCategoria,
          "Sexo": sexos.find(s => String(s.IDSexo) === String(r.IDSexo))?.NombreSexo || r.IDSexo,
          "Títulos": r.Titulos,
          "Observaciones": r.Observaciones
        };
      });

    } else if (table === "Resultados_Razas") {
      const consolidados = new Map();
      rows.forEach(r => {
        const claveUnica = `${r.IDInscripcion}_${r.IDEvento}_${r.IDJuez}`;
        if (!consolidados.has(claveUnica)) {
          consolidados.set(claveUnica, { ...r });
        } else {
          const existente = consolidados.get(claveUnica);
          if (r.Puesto) existente.Puesto = r.Puesto;
          if (r.Calificacion) existente.Calificacion = r.Calificacion;
          if (r.Titulo_Ganado) existente.Titulo_Ganado = r.Titulo_Ganado;
        }
      });
      rows = Array.from(consolidados.values()).map(r => {
        const iData = insc.find(i => String(i.IDInscripcion) === String(r.IDInscripcion));
        const rData = iData ? razas.find(rz => String(rz.IDRaza) === String(iData.IDRaza)) : null;
        const eData = eventos.find(e => String(e.IDEvento) === String(r.IDEvento));
        const jData = jueces.find(j => String(j.IDJuez) === String(r.IDJuez));
        const cData = iData ? cats.find(c => String(c.IDCategoria) === String(iData.IDCategoria)) : null;
        const sData = iData ? sexos.find(s => String(s.IDSexo) === String(iData.IDSexo)) : null;

        return {
          "Nro Cat.": iData ? iData.NumeroCatalogo : "N/D",
          "Raza": rData ? rData.NombreRaza : "N/D",
          "Categoría": cData ? cData.NombreCategoria : (iData ? iData.IDCategoria : "N/D"),
          "Sexo": sData ? sData.NombreSexo : (iData ? iData.IDSexo : "N/D"),
          "Puesto": r.Puesto,
          "Calif.": r.Calificacion,
          "Títulos Ganados": r.Titulo_Ganado,
          "Evento": eData ? eData.NombreEvento : r.IDEvento,
          "Juez": jData ? jData.NombreJuez : r.IDJuez
        };
      });

    } else if (table === "Resultados_Grupos") {
      const consolidadosG = new Map();
      rows.forEach(r => {
        const claveUnica = `${r.IDInscripcion}_${r.IDEvento}_${r.IDGrupo}`;
        if (!consolidadosG.has(claveUnica)) {
          consolidadosG.set(claveUnica, { ...r });
        } else {
          const existente = consolidadosG.get(claveUnica);
          if (r.PuestoGrupo) existente.PuestoGrupo = r.PuestoGrupo;
        }
      });
      rows = Array.from(consolidadosG.values()).map(r => {
        const iData = insc.find(i => String(i.IDInscripcion) === String(r.IDInscripcion));
        const eData = eventos.find(e => String(e.IDEvento) === String(r.IDEvento));
        const gData = grupos.find(g => String(g.IDGrupo) === String(r.IDGrupo));

        const rData = iData ? razas.find(rz => String(rz.IDRaza) === String(iData.IDRaza)) : null;
        const sData = iData ? sexos.find(s => String(s.IDSexo) === String(iData.IDSexo)) : null;
        const cData = iData ? cats.find(c => String(c.IDCategoria) === String(iData.IDCategoria)) : null;

        return {
          "Nro Cat.": iData ? iData.NumeroCatalogo : "N/D",
          "Raza": rData ? rData.NombreRaza : "N/D",
          "Sexo": sData ? sData.NombreSexo : "N/D",
          "Categoría": cData ? cData.NombreCategoria : (iData ? iData.IDCategoria : "N/D"),
          "Puesto Grupo": r.PuestoGrupo,
          "Grupo": gData ? (gData.NombreGrupo || r.IDGrupo) : r.IDGrupo,
          "Evento": eData ? eData.NombreEvento : r.IDEvento
        };
      });
    } else if (table === "Resultados_BIS") {
      rows = rows.map(r => {
        const iData = insc.find(i => String(i.IDInscripcion) === String(r.IDInscripcion));
        const rData = iData ? razas.find(rz => String(rz.IDRaza) === String(iData.IDRaza)) : null;
        const eData = eventos.find(e => String(e.IDEvento) === String(r.IDEvento));
        return {
          "Tipo BIS": r.TipoBIS,
          "Puesto": r.PuestoBIS,
          "Nro Cat.": iData ? iData.NumeroCatalogo : "N/D",
          "Raza": rData ? rData.NombreRaza : "N/D",
          "Evento": eData ? eData.NombreEvento : r.IDEvento
        };
      });
    }
  }
  renderTable("contCatalogos", rows);
}



function renderTable(div, rows) {
  if (!rows.length) { $(div).innerHTML = "Vacío."; return; }
  // Ocultamos los IDs técnicos incluyendo el de BIS
  const colsToDelete = ['IDResultado', 'IDResultadoGrupo', 'IDResultadoBIS', 'IDInscripcion', 'IDJuez', 'IDEvento', 'IDRaza', 'IDCategoria', 'IDSexo', 'IDTitulo'];

  let displayRows = rows.map(r => {
    let newRow = { ...r };
    colsToDelete.forEach(c => delete newRow[c]);
    return newRow;
  });

  if (displayRows.length === 0) { $(div).innerHTML = "Vacío o solo datos técnicos."; return; }

  const cols = Object.keys(displayRows[0]);
  $(div).innerHTML = `<table><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead>
    <tbody>${displayRows.map(r => `<tr>${cols.map(c => `<td>${r[c] || ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}



// --- 3. EVENTOS Y JUECES ---
async function loadEventos() {
  const rows = CACHE.get("Eventos") || [];
  $("eventosList").innerHTML = rows.map(r => {
    let f = r.Fecha || "";
    if (f.includes("-")) {
      f = f.split("T")[0].split("-").reverse().join("/");
    }
    return `
      <div class="card ev-card" onclick="window.editEvento('${r.IDEvento}')">
        <strong>${r.NombreEvento}</strong><br>
        <small class="muted">📅 ${f}</small>
      </div>`;
  }).join("");
  window._evCache = rows;
}








window.editEvento = (id) => {
  const row = (window._evCache || []).find(r => String(r.IDEvento) === String(id));
  if (!row) return;
  $("formTitle").textContent = "Editar Evento";
  buildForm("eventosForm", ["IDEvento", "NombreEvento", "Fecha", "Lugar", "Observaciones"], row);
};

async function loadJueces() {
  const rows = CACHE.get("Jueces") || [];
  const eventos = CACHE.get("Eventos") || [];
  const asignaciones = CACHE.get("Gestion_pistas") || [];

  // 1. Manejo del Filtro de Evento
  const filterContainerId = "juecesFilterContainer";
  let filterContainer = $(filterContainerId);

  if (!filterContainer) {
    filterContainer = document.createElement("div");
    filterContainer.id = filterContainerId;
    filterContainer.className = "catalog-toolbar-extra";
    $("juecesList").parentNode.insertBefore(filterContainer, $("juecesList"));
  }

  let selectedEventId = filterContainer.querySelector("select")?.value || "";
  if (!selectedEventId && eventos.length > 0) {
    selectedEventId = String(eventos[eventos.length - 1].IDEvento);
  }

  filterContainer.innerHTML = `
    <div class="field" style="max-width: 450px; margin-bottom: 20px; background: #f4f7f9; padding: 12px; border-radius: 10px; border: 1px solid #3498db;">
      <label style="color: #2980b9; font-weight: bold;">🌍 Ver Jueces de la Exposición:</label>
      <select id="filterJuecesEvento" class="select-lg">
        ${eventos.map(e => `
          <option value="${e.IDEvento}" ${String(e.IDEvento) === selectedEventId ? 'selected' : ''}>
            ${e.NombreEvento}
          </option>
        `).join("")}
      </select>
    </div>
  `;

  const selFiltro = $("filterJuecesEvento");
  if (selFiltro) {
    selFiltro.onchange = () => loadJueces();
  }

  // 2. Filtrado por Gestion_pistas
  const asignEvento = asignaciones.filter(a => String(a.IDEvento) === String(selectedEventId));
  const idsJuecesAsignados = [...new Set(asignEvento.map(a => String(a.IDJuez)))];
  const rowsFiltrados = rows.filter(j => idsJuecesAsignados.includes(String(j.IDJuez)));

  // Guardar en cache global para edición
  window._juecesCache = rows;

  if (rowsFiltrados.length === 0) {
    $("juecesList").innerHTML = `<p class="hint-text">No hay jueces asignados a este evento.</p>`;
    return;
  }

  // 3. Renderizado
  $("juecesList").innerHTML = rowsFiltrados.map(r => {
    const pistasJuez = [...new Set(
      asignEvento
        .filter(a => String(a.IDJuez) === String(r.IDJuez))
        .map(a => a.IDPista)
    )].sort().join(", ");

    const { code, name, flagUrl } = getFlagInfoFromCode(r.Nacionalidad);

    const flagHtml = flagUrl
      ? `<img class="flag" src="${flagUrl}" alt="${code}">`
      : `<span class="flag-fallback">🌍</span>`;

    const obsHtml = r.Observaciones ? `
      <div class="juez-observaciones">
        <strong>Observaciones:</strong> ${r.Observaciones}
      </div>` : "";

    const esLimitada = String(r.TipoJuez || "GENERAL").toUpperCase() === "LIMITADA";
    const gruposTexto = esLimitada ? (r.GruposHabilitados || "Ninguno") : "Todos";

    const tipoHtml = `
      <div class="juez-observaciones">
        <strong>Tipo:</strong> ${esLimitada ? "LIMITADA" : "GENERAL"}
      </div>
      <div class="juez-observaciones">
        <strong>Grupos habilitados:</strong> ${gruposTexto}
      </div>`;

    const photoHtml = r.FotoURL
      ? `<img src="${r.FotoURL}" alt="Foto de ${r.NombreJuez || 'Juez'}" class="juez-photo">`
      : `<div class="juez-photo-placeholder">👤</div>`;

    return `
      <div class="card juez-card" onclick="window.editJuez('${r.IDJuez}')">
        <div class="juez-main">
          <div class="juez-head">
            ${flagHtml}
            <strong>${r.NombreJuez || ""}</strong>
          </div>
          <div class="juez-body">
            <div class="juez-info-row">
              <span class="juez-label">Nacionalidad:</span>
              <span>${name || r.Nacionalidad || "N/D"}</span>
            </div>
            <div class="juez-info-row">
              <span class="juez-label">Pista(s) en este evento:</span>
              <span class="pista-pill">${pistasJuez || "?"}</span>
            </div>
            ${obsHtml}
            ${tipoHtml}
          </div>
        </div>
        ${photoHtml}
      </div>
    `;
  }).join("");
}









// 1. Mapa centralizado de países (podes moverlo arriba de todo en el archivo)
const PAISES_MAP = {
  AR: "ARGENTINA", BR: "BRASIL", UY: "URUGUAY", CL: "CHILE", PY: "PARAGUAY",
  PE: "PERÚ", CO: "COLOMBIA", BO: "BOLIVIA", EC: "ECUADOR", VE: "VENEZUELA",
  MX: "MÉXICO", CR: "COSTA RICA", PA: "PANAMÁ", CU: "CUBA", DO: "REP. DOMINICANA",
  PR: "PUERTO RICO", GT: "GUATEMALA", SV: "EL SALVADOR", US: "EEUU", CA: "CANADÁ",
  ES: "ESPAÑA", IT: "ITALIA", FR: "FRANCIA", DE: "ALEMANIA", GB: "REINO UNIDO",
  PT: "PORTUGAL", CH: "SUIZA", SE: "SUECIA", NO: "NORUEGA", NL: "PAÍSES BAJOS",
  BE: "BÉLGICA", AT: "AUSTRIA", RU: "RUSIA", IE: "IRLANDA", PL: "POLONIA",
  CZ: "REP. CHECA", HU: "HUNGRÍA", JP: "JAPÓN", CN: "CHINA", KR: "COREA DEL SUR"
};

function getFlagInfoFromCode(codeRaw) {
  const code = String(codeRaw || "").trim().toUpperCase();
  const name = PAISES_MAP[code] || (code ? code : "N/A");
  const flagUrl = code ? `https://flagcdn.com/w40/${code.toLowerCase()}.png` : "";
  return { code, name, flagUrl };
}












window.editJuez = (id) => {
  const row = (window._juecesCache || []).find(r => String(r.IDJuez) === String(id));
  if (!row) return;
  $("formTitleJuez").textContent = "Editar Juez";
  buildForm("juecesForm", ["IDJuez", "NombreJuez", "Nacionalidad", "IDPista", "Telefono", "Mail", "Redes", "Activo", "Observaciones", "FotoURL", "TipoJuez", "GruposHabilitados"], row);
  setTimeout(() => {
    setupBtnGroup("GruposHabilitados", true);
    if (window.toggleGruposHabilitados) window.toggleGruposHabilitados(row.TipoJuez || "GENERAL");
  }, 10);
};






// --- 4. INSCRIPCIONES ---
// --- BLOQUE 2: LIMPIEZA CON PERSISTENCIA DE EVENTO ---
// --- BLOQUE CORREGIDO: LIMPIEZA TOTAL DE FORMULARIO (EVITA ARRASTRE DE DATOS) ---
function limpiarInscripcion() {
  const f = $("inscripcionForm");
  if (!f) return;

  // 1. Persistencia del Evento Activo
  const activeId = localStorage.getItem("UI_ACTIVE_EVENT_ID");

  // 2. Reset estándar de HTML (Limpia Texto y Selects básicos)
  f.reset();

  // 3. LIMPIEZA EXPLÍCITA DE CAMPOS OCULTOS (Evita que se arrastren Títulos, Grupos, etc.)
  if (f.elements["IDInscripcion"]) f.elements["IDInscripcion"].value = "";
  if (f.elements["Titulos"]) f.elements["Titulos"].value = "";
  if (f.elements["IDGrupo"]) f.elements["IDGrupo"].value = "";
  if (f.elements["IDCategoria"]) f.elements["IDCategoria"].value = "";
  if (f.elements["IDSexo"]) f.elements["IDSexo"].value = "";
  if (f.elements["Observaciones"]) f.elements["Observaciones"].value = "";

  // 4. Asegurar que el IDEvento se mantenga tras el reset
  if (f.elements["IDEvento"]) f.elements["IDEvento"].value = activeId;

  // 5. Limpieza visual de botoneras (Quitar clases 'active' y 'multi')
  document.querySelectorAll("#viewInscripciones .btn-opt").forEach(btn => {
    btn.classList.remove("active", "multi");
  });

  // 6. Sincronizar el selector visual de evento
  const sel = $("insEventoSelect");
  if (sel && activeId) sel.value = activeId;

  // 7. Reset de la lista de razas dependiente del grupo
  if ($("insRaza")) $("insRaza").innerHTML = '<option value="">Seleccione un Grupo primero</option>';

  // 8. Restaurar estado de botones de acción
  if ($("btnEliminarInscripcion")) $("btnEliminarInscripcion").style.display = "none";
  if ($("btnGuardarInscripcion")) $("btnGuardarInscripcion").textContent = "Inscribir Perro";

  // 9. Recalcular número sugerido basado en el evento actual
  let rows = CACHE.get("Catalogo_Perros_Inscriptos") || [];
  const filtrados = rows.filter(r => String(r.IDEvento) === String(activeId));
  const proximo = sugerirNroCatalogo(filtrados);

  if (f.elements["NumeroCatalogo"]) f.elements["NumeroCatalogo"].value = proximo;

  setStatus("Formulario limpio y listo.");
}



async function setActiveEventInscripcion(eventId) {
  const id = String(eventId || "").trim();
  if (!id) return;

  // Guardar activo
  localStorage.setItem("UI_ACTIVE_EVENT_ID", id);
  CACHE.set("UI_ACTIVE_EVENT_ID", id);

  // Setear select (si existe)
  const sel = $("insEventoSelect");
  if (sel) {
    const exists = Array.from(sel.options || []).some(o => String(o.value) === id);
    if (exists) sel.value = id;
  }

  // Setear hidden del form (si existe)
  const f = $("inscripcionForm");
  if (f && f.elements["IDEvento"]) f.elements["IDEvento"].value = id;

  // Texto “Estás inscribiendo en...”
  const eventos = CACHE.get("Eventos") || [];
  const info = $("insEventoInfo");
  if (info) {
    const ev = eventos.find(x => String(x.IDEvento) === id);
    info.textContent = ev
      ? `Estás inscribiendo en: ${ev.NombreEvento || ev.Nombre || ev.IDEvento}`
      : "";
  }

  // Refrescar lista filtrada por evento (así el contexto coincide)
  await loadInscripciones();

  return id;
}



















async function prepareInscripcionForm() {
  const grupos = CACHE.get("Catalogo_Grupos") || [];
  const cats = CACHE.get("Catalogo_Categorias") || [];
  const sexos = CACHE.get("Catalogo_Sexos") || [];
  const titulos = CACHE.get("Catalogo_Titulos") || [];

  if ($("insGrupoBtns")) {
    $("insGrupoBtns").innerHTML = grupos
      .map(g => `<button type="button" class="btn-opt" data-value="${g.IDGrupo}">${g.IDGrupo}</button>`)
      .join("");
  }

  if ($("insCatBtns")) {
    $("insCatBtns").innerHTML = cats
      .map(c => `<button type="button" class="btn-opt" data-value="${c.IDCategoria}">${c.NombreCategoria}</button>`)
      .join("");
  }

  if ($("insSexoBtns")) {
    $("insSexoBtns").innerHTML = sexos
      .map(s => `<button type="button" class="btn-opt" data-value="${s.IDSexo}">${s.NombreSexo}</button>`)
      .join("");
  }

  if ($("insTitulosBtns")) {
    $("insTitulosBtns").innerHTML = titulos
      .map(t => `<button type="button" class="btn-opt" data-value="${t.IDTitulo}">${t.NombreTitulo}</button>`)
      .join("");
  }

  setupBtnGroup("IDGrupo", false, (v) => filtrarRazasPorGrupo(v));
  setupBtnGroup("IDCategoria", false);
  setupBtnGroup("IDSexo", false);
  setupBtnGroup("Titulos", true);

  const f = $("inscripcionForm");
  const sel = $("insEventoSelect");
  const eventos = CACHE.get("Eventos") || [];

  // 1) Construir/actualizar options SOLO si cambió la lista
  if (sel) {
    const hash = eventos.map(e => String(e.IDEvento)).join("|");
    if (sel.dataset.hash !== hash) {
      sel.innerHTML = eventos.map(ev => {
        const nombre = ev.NombreEvento || ev.Nombre || ev.IDEvento;

        let fechaTxt = "";
        if (ev.Fecha) {
          const d = new Date(ev.Fecha);
          if (!isNaN(d.getTime())) {
            const dd = String(d.getDate()).padStart(2, "0");
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const yy = d.getFullYear();
            fechaTxt = ` (${dd}/${mm}/${yy})`;
          } else {
            fechaTxt = ` (${String(ev.Fecha)})`;
          }
        }

        return `<option value="${ev.IDEvento}">${nombre}${fechaTxt}</option>`;
      }).join("");

      sel.dataset.hash = hash;
    }

    // 2) Elegir activo (solo si existe en options)
    const stored = String(localStorage.getItem("UI_ACTIVE_EVENT_ID") || "");
    const cached = String(CACHE.get("UI_ACTIVE_EVENT_ID") || "");
    const lastId = eventos.length ? String(eventos[eventos.length - 1].IDEvento || "") : "";

    let activo = stored || cached || lastId || "";

    if (sel.options.length) {
      const exists = Array.from(sel.options).some(o => String(o.value) === String(activo));
      if (!exists) activo = String(sel.options[0].value || "");
      sel.value = activo;
    }

    // 3) Persistir + volcar al hidden IDEvento
    localStorage.setItem("UI_ACTIVE_EVENT_ID", activo);
    CACHE.set("UI_ACTIVE_EVENT_ID", activo);
    if (f && f.elements["IDEvento"]) f.elements["IDEvento"].value = activo;

    // 4) Info debajo
    const info = $("insEventoInfo");
    if (info) {
      const ev = eventos.find(x => String(x.IDEvento) === String(sel.value));
      info.textContent = ev
        ? `Estás inscribiendo en: ${ev.NombreEvento || ev.Nombre || ev.IDEvento}`
        : "";
    }

    // 5) onchange SOLO 1 vez
    if (!sel.dataset.bound) {
      sel.onchange = () => {
        const id = String(sel.value || "");

        localStorage.setItem("UI_ACTIVE_EVENT_ID", id);
        CACHE.set("UI_ACTIVE_EVENT_ID", id);

        if (f && f.elements["IDEvento"]) f.elements["IDEvento"].value = id;

        const info2 = $("insEventoInfo");
        const ev2 = (CACHE.get("Eventos") || []).find(x => String(x.IDEvento) === String(id));
        if (info2) {
          info2.textContent = ev2
            ? `Estás inscribiendo en: ${ev2.NombreEvento || ev2.Nombre || ev2.IDEvento}`
            : "";
        }

        loadInscripciones();
        // recalcular número sugerido por evento
        let rr = CACHE.get("Catalogo_Perros_Inscriptos") || [];
        if (id) rr = rr.filter(r => String(r.IDEvento) === String(id));
        const prox = sugerirNroCatalogo(rr);
        if (f && f.elements["NumeroCatalogo"]) f.elements["NumeroCatalogo"].value = prox;
      };

      sel.dataset.bound = "1";
    }
  }

  // 6) Sugerir nro al entrar (por evento activo)
  if (f && f.elements["NumeroCatalogo"]) {
    const activeId = String(localStorage.getItem("UI_ACTIVE_EVENT_ID") || (sel?.value || ""));
    let rr = CACHE.get("Catalogo_Perros_Inscriptos") || [];
    if (activeId) rr = rr.filter(r => String(r.IDEvento) === String(activeId));
    f.elements["NumeroCatalogo"].value = sugerirNroCatalogo(rr);
  }
}











function filtrarRazasPorGrupo(grupoId) {
  const razas = CACHE.get("Catalogo_Razas") || [];
  const filt = razas.filter(r => String(r.IDGrupo) === String(grupoId)).sort((a, b) => (a.NombreRaza || "").localeCompare(b.NombreRaza || ""));
  $("insRaza").innerHTML = filt.map(r => `<option value="${r.IDRaza}">${r.NombreRaza}</option>`).join("");
}





async function loadInscripciones(filtroManual = {}) {
  const listCont = $("inscripcionesList");

  // Util: buscar valor por variantes de nombre de columna
  const pick = (obj, keys) => {
    for (const k of keys) {
      if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) {
        const v = String(obj[k]).trim();
        if (v !== "" && v !== "undefined" && v !== "null") return v;
      }
    }
    return "";
  };

  // Util: setear hint en el DOM (probamos varios IDs comunes sin romper nada)
  const setNumeroHint = (txt) => {
    const ids = [
      "insNumeroHint",
      "insNumeroSugerencia",
      "insNumeroSug",
      "numeroCatalogoHint",
      "numeroCatalogoSugerencia"
    ];
    for (const id of ids) {
      const el = $(id);
      if (el) { el.textContent = txt; return true; }
    }

    // fallback ultra seguro: si no existe un contenedor dedicado,
    // buscamos un <small> o <div> cercano al input NumeroCatalogo
    const f = $("inscripcionForm");
    const input = f?.elements?.["NumeroCatalogo"];
    if (input) {
      const parent = input.closest?.("div") || input.parentElement;
      if (parent) {
        let small = parent.querySelector?.(".hint-text, small, .muted, .help, .help-text");
        if (small) { small.textContent = txt; return true; }
      }
    }
    return false;
  };

  // Util: calcular sugerencia (no depende de tu sugerirNroCatalogo)
  const calcSugerencia = (rows) => {
    let maxN = 0;
    for (const r of rows) {
      const n = Number(String(r?.NumeroCatalogo ?? "").replace(/[^\d]/g, ""));
      if (!Number.isNaN(n) && n > maxN) maxN = n;
    }
    const next = maxN + 1 || 1;
    const padded = String(next).padStart(3, "0");
    return { next, padded };
  };

  // 1) Rows base
  let rowsAll = CACHE.get("Catalogo_Perros_Inscriptos") || [];

  // 2) Evento activo (select > localStorage > CACHE)
  const sel = $("insEventoSelect");
  let activeEventId =
    (sel && sel.value ? String(sel.value) : "") ||
    String(localStorage.getItem("UI_ACTIVE_EVENT_ID") || "") ||
    String(CACHE.get("UI_ACTIVE_EVENT_ID") || "");

  activeEventId = String(activeEventId || "").trim();

  // 3) Normalizar IDEvento por fila (NO pisamos r.IDEvento; usamos __IDEvento)
  rowsAll = (rowsAll || []).map(r => {
    const idev = pick(r, ["IDEvento", "IdEvento", "ID Evento", "ID_EVENTO", "Evento", "IDEVENTO"]);
    return { ...r, __IDEvento: idev };
  });

  const hayEventoEnFilas = rowsAll.some(r => String(r.__IDEvento || "").trim() !== "");

  // 3.1) Si el selector no tiene valor, forzar uno desde Eventos
  if (!activeEventId) {
    const eventos = (CACHE.get("Eventos") || [])
      .map(e => ({ ...e, __IDEvento: pick(e, ["IDEvento", "IdEvento", "ID Evento", "ID_EVENTO", "IDEVENTO"]) }))
      .filter(e => String(e.__IDEvento || "").trim() !== "");

    if (eventos.length) {
      activeEventId = String(eventos[eventos.length - 1].__IDEvento).trim(); // último por defecto
      if (sel) sel.value = activeEventId;

      localStorage.setItem("UI_ACTIVE_EVENT_ID", activeEventId);
      CACHE.set("UI_ACTIVE_EVENT_ID", activeEventId);

      const f = $("inscripcionForm");
      if (f && f.elements && f.elements["IDEvento"]) f.elements["IDEvento"].value = activeEventId;
    }
  }

  console.log("[Insc] rowsAll:", rowsAll.length, "| hayEventoEnFilas:", hayEventoEnFilas, "| activeEventId:", activeEventId);

  // 4) Filtrar por evento SOLO si el dataset realmente trae IDEvento
  let rows = rowsAll;
  if (activeEventId && hayEventoEnFilas) {
    rows = rowsAll.filter(r => String(r.__IDEvento || "").trim() === String(activeEventId).trim());
  }

  const razas = CACHE.get("Catalogo_Razas") || [];
  const cats = CACHE.get("Catalogo_Categorias") || [];
  const sexos = CACHE.get("Catalogo_Sexos") || [];
  const titulos = CACHE.get("Catalogo_Titulos") || [];

  // 5) Empty state
  if (!rows || rows.length === 0) {
    if (listCont) listCont.innerHTML = `<p class="hint-text ins-empty">No hay perros cargados en el sistema.</p>`;
    window._insCache = [];

    // también limpiamos hint para que no quede viejo
    setNumeroHint("");
    return;
  }

  // ✅ 5.1) Restaurar sugerencia de Número de Catálogo (texto + opcional autocompletar)
  try {
    const { next, padded } = calcSugerencia(rows);
    setNumeroHint(`Sugerencia: ${next} o ${padded}`);

    // si el input está vacío, lo completamos con el sugerido (no pisa si ya hay algo)
    const f = $("inscripcionForm");
    const inputNC = f?.elements?.["NumeroCatalogo"];
    if (inputNC && String(inputNC.value || "").trim() === "") {
      inputNC.value = next;
    }

    // si vos tenés sugerirNroCatalogo y querés mantener su lógica interna, la llamamos igual
    if (typeof sugerirNroCatalogo === "function") {
      sugerirNroCatalogo(rows);
    }
  } catch (e) {
    console.warn("No se pudo actualizar sugerencia NumeroCatalogo:", e?.message || e);
  }

  // 6) Enriched
  let enriched = rows.map(r => ({
    ...r,
    NombreRaza:
      razas.find(x => String(x.IDRaza) === String(r.IDRaza))?.NombreRaza ||
      ("Raza " + (r.IDRaza ?? "")),
    NombreSexo:
      sexos.find(x => String(x.IDSexo) === String(r.IDSexo))?.NombreSexo ||
      (r.IDSexo ?? ""),
    NombreCategoria:
      cats.find(x => String(x.IDCategoria) === String(r.IDCategoria))?.NombreCategoria ||
      (r.IDCategoria ?? "")
  }));

  // 7) Filtros UI (grupo/raza)
  const fGrupo = $("filterGrupo"), fRaza = $("filterRaza");
  if (fGrupo && fRaza) {
    const gruposEnLista = [...new Set(enriched.map(r => r.IDGrupo))].filter(Boolean).sort();
    const curG = filtroManual.grupo || fGrupo.value;

    fGrupo.innerHTML =
      '<option value="">Todos Grupos</option>' +
      gruposEnLista.map(g => `<option value="${g}">${g}</option>`).join("");

    fGrupo.value = curG || "";

    const currentRows = curG ? enriched.filter(r => r.IDGrupo === curG) : enriched;
    const razasEnLista = [...new Set(currentRows.map(r => r.NombreRaza))].filter(Boolean).sort();

    fRaza.innerHTML =
      '<option value="">Todas Razas</option>' +
      razasEnLista.map(r => `<option value="${r}">${r}</option>`).join("");

    fRaza.value = filtroManual.raza || fRaza.value || "";
  }

  if (filtroManual.grupo) enriched = enriched.filter(r => r.IDGrupo === filtroManual.grupo);
  if (filtroManual.raza) enriched = enriched.filter(r => r.NombreRaza === filtroManual.raza);

  // 8) Orden
  enriched.sort((a, b) =>
    (String(a.IDGrupo || "")).localeCompare(String(b.IDGrupo || "")) ||
    (String(a.NombreRaza || "")).localeCompare(String(b.NombreRaza || "")) ||
    (Number(a.NumeroCatalogo) - Number(b.NumeroCatalogo))
  );

  // 9) Render
  let html = "", lg = "", lr = "";
  enriched.forEach(r => {
    if (r.IDGrupo !== lg) {
      html += `<div class="list-group-header">Grupo ${r.IDGrupo}</div>`;
      lg = r.IDGrupo; lr = "";
    }

    if (r.NombreRaza !== lr) {
      html += `<div class="list-breed-header">${r.NombreRaza}</div>`;
      lr = r.NombreRaza;
    }

    const sexoDisplay = r.IDSexo ? r.NombreSexo : `<span class="warn-strong">SIN SEXO</span>`;

    let nombresTitulos = "";
    if (r.Titulos) {
      const ids = String(r.Titulos).split(",").map(t => t.trim()).filter(Boolean);
      nombresTitulos = ids
        .map(id => titulos.find(x => String(x.IDTitulo) === String(id))?.NombreTitulo || id)
        .join(", ");
    }

    html += `
      <div class="card insc-item" data-id="${r.IDInscripcion}">
        <div style="display:flex;align-items:center;gap:12px;">
          <span class="insc-num">#${r.NumeroCatalogo}</span>
          <span class="insc-meta">${sexoDisplay} | ${r.NombreCategoria}</span>

          ${nombresTitulos
        ? `<span style="font-size:12px;color:#666;margin-left:auto;">${nombresTitulos}</span>`
        : `<span style="margin-left:auto;"></span>`}

          <button type="button" class="btn" style="padding:6px 10px;font-size:12px;"
            onclick="event.stopPropagation(); window.editInscripcion('${r.IDInscripcion}')">
            EDITAR PERRO
          </button>
        </div>
      </div>
    `;
  });

  if (listCont) listCont.innerHTML = html;
  else console.error("Error: No se encontró el contenedor 'inscripcionesList'");

  // cache para editar
  window._insCache = rows;
}



async function refreshInscripcionesUI({ setNextNumero = true } = {}) {
  // 1) Sincronizar cache desde backend
  await syncAll();

  // 2) Re-poblar selects/botones (evento activo, grupos, etc.)
  await prepareInscripcionForm();

  // 3) Re-render listado
  loadInscripciones();

  // 4) Recalcular y setear Número de Catálogo (si el input está vacío o si pedís forzar)
  try {
    const f = $("inscripcionForm");
    const sel = $("insEventoSelect");
    const activeId =
      String(sel?.value || "") ||
      String(localStorage.getItem("UI_ACTIVE_EVENT_ID") || "") ||
      String(CACHE.get("UI_ACTIVE_EVENT_ID") || "");

    let rows = CACHE.get("Catalogo_Perros_Inscriptos") || [];
    if (activeId) rows = rows.filter(r => String(r.IDEvento) === String(activeId));

    // calcula próximo
    let maxN = 0;
    for (const r of rows) {
      const n = Number(String(r?.NumeroCatalogo ?? "").replace(/[^\d]/g, ""));
      if (!Number.isNaN(n) && n > maxN) maxN = n;
    }
    const next = maxN + 1 || 1;

    const inputNC = f?.elements?.["NumeroCatalogo"];
    if (inputNC) {
      const cur = String(inputNC.value || "").trim();
      if (setNextNumero || cur === "") inputNC.value = next;
    }

    // también refrescamos el hint si existe (sin depender de IDs exactos)
    const hintCandidates = [
      $("insNumeroHint"),
      $("insNumeroSugerencia"),
      $("insNumeroSug"),
      $("numeroCatalogoHint"),
      $("numeroCatalogoSugerencia")
    ].filter(Boolean);

    if (hintCandidates.length) {
      hintCandidates[0].textContent = `Sugerencia: ${next} o ${String(next).padStart(3, "0")}`;
    }
  } catch (e) {
    console.warn("refreshInscripcionesUI: no pude recalcular NumeroCatalogo", e?.message || e);
  }
}
















window.editInscripcion = (id) => {
  const row = (window._insCache || []).find(r => String(r.IDInscripcion) === String(id));
  const f = $("inscripcionForm");
  if (!row || !f) return;

  // 🔒 NO recargar lista
  // 🔒 NO cambiar evento dinámicamente
  // Solo cargar datos del perro

  if ($("btnEliminarInscripcion")) $("btnEliminarInscripcion").style.display = "inline-block";
  if ($("btnGuardarInscripcion")) $("btnGuardarInscripcion").textContent = "Actualizar Perro";

  if (f.elements["IDInscripcion"]) f.elements["IDInscripcion"].value = row.IDInscripcion || "";
  if (f.elements["IDEvento"]) f.elements["IDEvento"].value = row.IDEvento || "";
  if (f.elements["NumeroCatalogo"]) f.elements["NumeroCatalogo"].value = row.NumeroCatalogo || "";
  if (f.elements["IDGrupo"]) f.elements["IDGrupo"].value = row.IDGrupo || "";
  if (f.elements["IDCategoria"]) f.elements["IDCategoria"].value = row.IDCategoria || "";
  if (f.elements["IDSexo"]) f.elements["IDSexo"].value = row.IDSexo || "";
  if (f.elements["Titulos"]) f.elements["Titulos"].value = row.Titulos || "";
  if (f.elements["Observaciones"]) f.elements["Observaciones"].value = row.Observaciones || "";

  refreshBtnVisuals("IDGrupo", row.IDGrupo);
  refreshBtnVisuals("IDCategoria", row.IDCategoria);
  refreshBtnVisuals("IDSexo", row.IDSexo);
  refreshBtnVisuals("Titulos", row.Titulos, true);

  filtrarRazasPorGrupo(row.IDGrupo);
  if ($("insRaza")) $("insRaza").value = row.IDRaza || "";

  setStatus("Editando perro #" + row.NumeroCatalogo);
};






// --- 5. PISTAS Y RESULTADOS (ETAPA RAZAS) ---
// --- 5. PISTAS Y RESULTADOS (ETAPA RAZAS) ---
window._juezSeleccionadoPista = null;

async function preparePistasForm() {
  const E = CACHE.get("Eventos") || [];
  const selectEvento = $("pistaEventoSelect");
  if (selectEvento) {
    selectEvento.innerHTML = E.map(e => `<option value="${e.IDEvento}">${e.NombreEvento}</option>`).join("");
    selectEvento.onchange = () => {
      window._juezSeleccionadoPista = null;
      // LIMPIEZA: Al cambiar el evento, vaciamos el panel de juzgamiento
      $("panelJuzgamiento").innerHTML = `<p class="hint-text">Seleccione una pista a la izquierda.</p>`;
      renderBotonerasPista();
    };
  }
  renderBotonerasPista();
}


function renderBotonerasPista() {
  const idEvento = $("pistaEventoSelect")?.value;
  if (!idEvento) return;

  const J = CACHE.get("Jueces") || [];
  const insc = CACHE.get("Catalogo_Perros_Inscriptos") || [];
  const asign = CACHE.get("Gestion_pistas") || [];

  const inscEvento = insc.filter(i => String(i.IDEvento) === String(idEvento));

  // --- CORTE TEMPRANO (REFORMA SEGURIDAD) ---
  if (inscEvento.length === 0) {
    window._juezSeleccionadoPista = null;
    $("formPistasDinamico").innerHTML = `
      <div class="field">
        <p class="hint-text">No hay perros inscriptos para este evento.</p>
      </div>
    `;
    $("panelJuzgamiento").innerHTML = `<p class="hint-text">No hay perros inscriptos para este evento.</p>`;
    renderCronograma();
    actualizarEstadoBotoneraGrupos();
    sugerirNroCatalogo(insc);
    return;
  }

  const conteo = {};
  inscEvento.forEach(p => {
    const g = p.IDGrupo;
    if (g) conteo[g] = (conteo[g] || 0) + 1;
  });

  const gruposUnicos = Object.keys(conteo).sort();

  const pistaAsignadaParaJuez = (idJuez) => {
    const a = asign.find(x =>
      String(x.IDEvento) === String(idEvento) &&
      String(x.IDJuez) === String(idJuez) &&
      x.IDPista !== undefined &&
      x.IDPista !== null &&
      String(x.IDPista) !== ""
    );
    return a ? String(a.IDPista) : "";
  };

  const gruposTextoJuez = (j) => {
    const esLimitada = String(j.TipoJuez || "GENERAL").toUpperCase() === "LIMITADA";
    if (!esLimitada) return "";
    return String(j.GruposHabilitados || "")
      .split(",")
      .map(g => g.trim())
      .filter(Boolean)
      .join(", ");
  };

  // Renombrar botones derechos de pistas según juez LIMITADA
  document.querySelectorAll("#selectorPistaTrabajo .btn-opt").forEach(btn => {
    const pistaBtn = String(btn.dataset.value || "");
    const asignPista = asign.find(a =>
      String(a.IDEvento) === String(idEvento) &&
      String(a.IDPista) === pistaBtn
    );

    const juezPista = asignPista
      ? J.find(j => String(j.IDJuez) === String(asignPista.IDJuez))
      : null;

    const gruposHab = juezPista ? gruposTextoJuez(juezPista) : "";

    if (juezPista && gruposHab) {
      btn.textContent = `Pista ${pistaBtn} - ${gruposHab}`;
      btn.title = `${juezPista.NombreJuez} - ${gruposHab}`;
    } else {
      btn.textContent = `Pista ${pistaBtn}`;
      btn.title = "";
    }
  });

  const juecesHtml = J.map(j => {
    const pistaReal = pistaAsignadaParaJuez(j.IDJuez) || String(j.IDPista || "");
    const pistaTxt = pistaReal ? `Pista ${pistaReal}` : "Pista ?";
    const gruposHab = gruposTextoJuez(j);

    const etiquetaJuez = gruposHab
      ? `${j.NombreJuez} (${pistaTxt} - ${gruposHab})`
      : `${j.NombreJuez} (${pistaTxt})`;

    return `
      <button type="button"
              class="btn-opt btn-juez-pista ${window._juezSeleccionadoPista?.idJuez === j.IDJuez ? 'active' : ''}"
              id="btnJuez_${j.IDJuez}"
              title="${etiquetaJuez}"
              onclick="window.seleccionarJuezPista('${j.IDJuez}', '${pistaReal || (j.IDPista || '')}')">
        ${etiquetaJuez}
      </button>`;
  }).join("");

  const gruposHtml = gruposUnicos.map(g => {
    const yaAsignado = asign.find(a =>
      String(a.IDEvento) === String(idEvento) &&
      String(a.IDGrupo) === String(g)
    );
    return `
      <button type="button"
              class="btn-opt btn-grupo-directo"
              id="btnGrupoPista_${String(g).replace(/\s+/g, '_')}"
              onclick="window.toggleAsignacionGrupo('${g}')">
        ${g} (${conteo[g]}) ${yaAsignado ? '✓' : ''}
      </button>`;
  }).join("");

  $("formPistasDinamico").innerHTML = `
    <div class="field">
      <label><strong>2. Seleccionar Juez</strong></label>
      <div class="btn-group-pistas">${juecesHtml || 'No hay jueces.'}</div>
    </div>
    <div class="field">
      <label><strong>3. Grupos (${inscEvento.length} perros inscriptos)</strong></label>
      <div class="btn-group-pistas">${gruposHtml || 'No hay perros.'}</div>
    </div>
  `;

  renderCronograma();
  actualizarEstadoBotoneraGrupos();
  sugerirNroCatalogo(insc);
}







window.seleccionarJuezPista = (idJuez, pista) => {
  // 1. Activar visualmente el botón del juez
  document.querySelectorAll(".btn-juez-pista").forEach(b => b.classList.remove("active"));
  const btn = $(`btnJuez_${idJuez}`);
  if (btn) btn.classList.add("active");

  // 2. Guardar estado global
  window._juezSeleccionadoPista = { idJuez, pista };

  // 3. Sincronizar con la botonera de pistas de la derecha
  document.querySelectorAll("#selectorPistaTrabajo .btn-opt").forEach(b => b.classList.remove("active"));
  const btnPista = document.querySelector(`#selectorPistaTrabajo .btn-opt[data-value="${pista}"]`);
  if (btnPista) btnPista.classList.add("active");

  // 4. Renderizar el panel de juzgamiento para esa pista
  if (pista) {
    renderJuzgamiento(pista);
  }
};





// 2. FUNCION TOGGLE ASIGNACION (PISTAS) (CORREGIDA)
window.toggleAsignacionGrupo = async (grupoId) => {
  if (!window._juezSeleccionadoPista) {
    setStatus("Error: Seleccione un juez primero.", true);
    return;
  }

  const { idJuez, pista } = window._juezSeleccionadoPista;
  const idEvento = $("pistaEventoSelect").value;

  let asignaciones = CACHE.get("Gestion_pistas") || [];
  const existente = asignaciones.find(a =>
    String(a.IDEvento) === String(idEvento) &&
    String(a.IDJuez) === String(idJuez) &&
    String(a.IDGrupo) === String(grupoId)
  );

  // --- UPDATE INMEDIATO (optimista) ---
  let tempIdCreado = null;

  if (existente) {
    asignaciones = asignaciones.filter(a => String(a.IDAsignacion) !== String(existente.IDAsignacion));
  } else {
    tempIdCreado = "TEMP_" + Date.now();
    asignaciones.push({
      IDAsignacion: tempIdCreado,
      IDEvento: idEvento, IDJuez: idJuez, IDGrupo: grupoId, IDPista: pista
    });
  }

  CACHE.set("Gestion_pistas", asignaciones);
  renderBotonerasPista();

  // --- COMUNICACIÓN ASÍNCRONA ---
  // FIX: si borramos un TEMP_, NO llamar al servidor
  if (existente && String(existente.IDAsignacion || "").startsWith("TEMP_")) {
    setStatus("Eliminado local (TEMP).");
    return;
  }

  api("POST", {}, {
    action: existente ? "delete" : "create",
    table: "Gestion_pistas",
    id: existente ? existente.IDAsignacion : null,
    payload: existente ? null : { IDEvento: idEvento, IDJuez: idJuez, IDGrupo: grupoId, IDPista: pista }
  })
    .then((resp) => {
      // FIX: si creamos y el servidor devuelve id, reemplazar TEMP -> real en CACHE
      if (!existente && tempIdCreado && resp?.id) {
        const a = CACHE.get("Gestion_pistas") || [];
        const idx = a.findIndex(x => String(x.IDAsignacion) === String(tempIdCreado));
        if (idx !== -1) {
          a[idx].IDAsignacion = resp.id;
          CACHE.set("Gestion_pistas", a);
          renderBotonerasPista();
        }
      }
      setStatus("Sincronizado.");
    })
    .catch(e => {
      setStatus("Error de red: " + e.message, true);
      // opcional: syncAll();
    });
};







function actualizarEstadoBotoneraGrupos() {
  const asignaciones = CACHE.get("Gestion_pistas") || [];
  const idEvento = $("pistaEventoSelect")?.value;
  document.querySelectorAll(".btn-grupo-directo").forEach(b => b.classList.remove("active"));
  if (!window._juezSeleccionadoPista || !idEvento) return;
  asignaciones.forEach(a => {
    if (String(a.IDEvento) === String(idEvento) && String(a.IDJuez) === String(window._juezSeleccionadoPista.idJuez)) {
      const btn = $(`btnGrupoPista_${String(a.IDGrupo).replace(/\s+/g, '_')}`);
      if (btn) btn.classList.add("active");
    }
  });
}

function renderCronograma() {
  const data = CACHE.get("Gestion_pistas") || [], J = CACHE.get("Jueces") || [], idEvento = $("pistaEventoSelect")?.value;
  if (!idEvento) { $("cronogramaPistas").innerHTML = "Seleccione un evento."; return; }
  const items = data.filter(p => String(p.IDEvento) === String(idEvento));
  $("cronogramaPistas").innerHTML = items.map(p => {
    const jNom = J.find(j => String(j.IDJuez) === String(p.IDJuez))?.NombreJuez || p.IDJuez;
    return `<div class="cronograma-item"><span><strong>Pista ${p.IDPista}</strong> | ${p.IDGrupo} | ${jNom}</span><button onclick="window.borrarAsignacionPista('${p.IDAsignacion}')" class="btn-del">✕</button></div>`;
  }).join("") || "No hay asignaciones.";
}


// 3. FUNCION BORRAR ASIGNACION (CRONOGRAMA) (CORREGIDA)
window.borrarAsignacionPista = async (id) => {
  if (!confirm("¿Borrar asignación?")) return;

  // 1) Borrado local inmediato
  let asignaciones = CACHE.get("Gestion_pistas") || [];
  asignaciones = asignaciones.filter(a => String(a.IDAsignacion) !== String(id));
  CACHE.set("Gestion_pistas", asignaciones);

  renderBotonerasPista();
  setStatus("Borrando en segundo plano...");

  // FIX: si es TEMP_ no existe en servidor
  if (String(id || "").startsWith("TEMP_")) {
    setStatus("Eliminado local (TEMP).");
    return;
  }

  // 2) Borrado remoto
  api("POST", {}, { action: "delete", table: "Gestion_pistas", id: id })
    .then(() => setStatus("Eliminado correctamente."))
    .catch(e => {
      setStatus("Error al borrar: " + e.message, true);
      syncAll();
    });
};






async function renderJuzgamiento(pistaNro) {
  // 1. Obtener el evento activo desde el selector superior
  const idEventoActivo = $("pistaEventoSelect")?.value;
  if (!idEventoActivo) {
    $("panelJuzgamiento").innerHTML = `<p class="hint-text">Seleccione un evento arriba para comenzar.</p>`;
    return;
  }

  const asign = CACHE.get("Gestion_pistas") || [],
    insc = CACHE.get("Catalogo_Perros_Inscriptos") || [],
    razas = CACHE.get("Catalogo_Razas") || [],
    cats = CACHE.get("Catalogo_Categorias") || [],
    sexos = CACHE.get("Catalogo_Sexos") || [],
    titulosPosibles = CACHE.get("Catalogo_Titulos") || [],
    res = CACHE.get("Resultados_Razas") || [],
    J = CACHE.get("Jueces") || [];

  const catOrderMap = new Map(cats.map(c => [c.IDCategoria, parseInt(c.Orden) || 999]));

  // 2. FILTRO CRÍTICO: Misma pista Y mismo evento
  const asignacionesPista = asign.filter(a =>
    String(a.IDPista) === String(pistaNro) &&
    normalizeID(a.IDEvento) === normalizeID(idEventoActivo)
  );

  if (asignacionesPista.length === 0) {
    $("panelJuzgamiento").innerHTML = `<p class="hint-text">Pista ${pistaNro} sin asignaciones para este evento.</p>`;
    return;
  }

  const juezId = asignacionesPista[0].IDJuez;
  const juezActual = J.find(j => String(j.IDJuez) === String(juezId));
  const juezNombre = juezActual?.NombreJuez || juezId;
  const esLimitada = String(juezActual?.TipoJuez || "GENERAL").toUpperCase() === "LIMITADA";

  const gruposAsignadosPista = [...new Set(
    asignacionesPista.map(a => normalizeGrupo(a.IDGrupo))
  )].filter(Boolean).sort();

  const gruposHabilitadosJuez = String(juezActual?.GruposHabilitados || "")
    .split(",")
    .map(g => normalizeGrupo(g.trim()))
    .filter(Boolean);

  let gruposEnPista = gruposAsignadosPista;

  if (esLimitada) {
    gruposEnPista = gruposHabilitadosJuez;

    if (gruposEnPista.length === 0) {
      $("panelJuzgamiento").innerHTML = `
      <p class="hint-text">
        El juez ${juezNombre} está marcado como LIMITADA, pero no tiene GruposHabilitados cargados.
      </p>`;
      return;
    }
  }

  // 3. FILTRO CRÍTICO PERROS: Mismo evento Y grupo incluido en la pista
  let perrosEnriched = insc
    .filter(i =>
      normalizeID(i.IDEvento) === normalizeID(idEventoActivo) &&
      gruposEnPista.includes(normalizeGrupo(i.IDGrupo))
    )
    .map(p => {
      const rNom = razas.find(r => String(r.IDRaza) === String(p.IDRaza))?.NombreRaza || p.IDRaza;
      const catObj = cats.find(c => String(c.IDCategoria) === String(p.IDCategoria));
      const sObj = sexos.find(s => String(s.IDSexo) === String(p.IDSexo));
      return {
        ...p,
        razaNombre: rNom,
        catNombre: catObj?.NombreCategoria || p.IDCategoria,
        catOrden: catOrderMap.get(p.IDCategoria) || 999,
        NombreSexo: sObj?.NombreSexo || p.IDSexo
      };
    });

  perrosEnriched.sort((a, b) =>
    (a.IDGrupo || "").localeCompare(b.IDGrupo || "") ||
    (a.razaNombre || "").localeCompare(b.razaNombre || "") ||
    (a.catOrden || 999) - (b.catOrden || 999) ||
    String(a.NumeroCatalogo || "").localeCompare(String(b.NumeroCatalogo || ""))
  );

  let html = `<div class="live-summary"><strong>${juezNombre}</strong> | Grupos: ${gruposEnPista.join(", ")}</div>`;

  if (esLimitada) {
    html += `
      <div style="background:#fff3cd;color:#856404;padding:8px 10px;margin:8px 0 12px 0;border:1px solid #ffeeba;border-radius:6px;font-size:13px;font-weight:700;text-align:center;">
        Competencia limitada / nacional — no otorga títulos.
      </div>
    `;
  }

  let lastGrupo = "", lastRaza = "", lastCat = "";

  perrosEnriched.forEach(p => {
    if (p.IDGrupo !== lastGrupo) {
      html += `<h3 class="juzg-header-grupo">Grupo ${p.IDGrupo}</h3>`;
      lastGrupo = p.IDGrupo; lastRaza = ""; lastCat = "";
    }

    if (p.razaNombre !== lastRaza) {
      html += `<h4 class="juzg-header-raza">${p.razaNombre}</h4>`;
      lastRaza = p.razaNombre; lastCat = "";
    }

    if (p.catNombre !== lastCat) {
      html += `<div class="list-cat-header">${p.catNombre}</div>`;
      lastCat = p.catNombre;
    }

    const nP = normalizeID(p.IDInscripcion), nJ = normalizeID(juezId), nE = normalizeID(idEventoActivo);
    const r = res.find(x =>
      normalizeID(x.IDInscripcion) === nP &&
      normalizeID(x.IDJuez) === nJ &&
      normalizeID(x.IDEvento) === nE
    );

    const isAus = isTruthy(r?.Ausente);
    const tGanados = (r?.Titulo_Ganado || "").split(",").map(x => x.trim()).filter(Boolean);
    const esCachorro = ["C00", "C01"].includes(p.IDCategoria);
    const califBtns = esCachorro ? ["MP", "P"] : ["Exc", "MB", "B", "D"];

    html += `
      <div class="card dog-card-compact ${r ? 'has-result' : ''} ${isAus ? 'is-ausente' : ''}">
        <div class="dog-topline">
          <div class="dog-oneline">
            <span class="dog-num">#${p.NumeroCatalogo}</span>
            <span class="dog-meta-inline">${p.razaNombre} | ${p.catNombre} | ${p.NombreSexo}</span>
            ${isAus ? '<span class="ausente-badge">AUSENTE</span>' : ''}
          </div>

          <div class="puesto-btns">
            <button type="button"
                    class="btn-xs btn-aus ${isAus ? 'active' : ''}"
                    onclick="window.guardarResultado(event, '${p.IDInscripcion}','${juezId}','${idEventoActivo}','${!isAus}','Ausente')">
              AUS
            </button>
            <div class="puesto-separator"></div>
            ${["1", "2", "3", "4", "5", "6", "7"].map(pst => `
              <button type="button"
                      class="btn-xs ${String(r?.Puesto) === pst ? 'active' : ''}"
                      ${isAus ? 'disabled' : ''}
                      onclick="window.guardarResultado(event, '${p.IDInscripcion}','${juezId}','${idEventoActivo}','${pst}','Puesto')">
                ${pst}°
              </button>
            `).join("")}
          </div>
        </div>

        <div class="rowline">
          <span class="rowlabel">Calif:</span>
          <div class="rowbuttons">
            ${califBtns.map(c => `
              <button type="button"
                      class="btn-xs ${r?.Calificacion === c ? 'active' : ''}"
                      ${isAus ? 'disabled' : ''}
                      onclick="window.guardarResultado(event, '${p.IDInscripcion}','${juezId}','${idEventoActivo}','${c}','Calificacion')">
                ${c}
              </button>
            `).join("")}
          </div>
        </div>

        ${!esLimitada ? `
          <div class="rowline">
            <span class="rowlabel">Título:</span>
            <div class="rowbuttons rowbuttons-wrap">
              ${titulosPosibles.map(t => {
      const nom = (t.NombreTitulo || "").trim();
      const isSelected = tGanados.includes(nom);
      return `
                  <button type="button"
                          class="btn-xs titulo-btn ${isSelected ? 'active multi' : ''}"
                          ${isAus ? 'disabled' : ''}
                          onclick="window.guardarResultado(event, '${p.IDInscripcion}','${juezId}','${idEventoActivo}','${nom.replace(/'/g, "\\'")}','Titulo_Ganado', true)">
                    ${nom}
                  </button>`;
    }).join("")}
            </div>
          </div>
        ` : ""}
      </div>
    `;
  });

  $("panelJuzgamiento").innerHTML = html;
}






// --- 6. PISTAS GRUPOS (REFORMADO: ACCIÓN DIRECTA Y MULTISELECCIÓN) ---

// Variable global para la selección del juez
window._juezSeleccionadoGrupo = null;

function getSuperCatsSeleccionadas() {
  const checks = Array.from(document.querySelectorAll('input[name="superCat"]:checked'))
    .map(cb => cb.value)
    .filter(Boolean);

  return checks.length ? checks : Object.keys(MAPA_SUPER_CATS);
}

async function preparePistasGruposForm() {
  const E = CACHE.get("Eventos") || [];

  $("formPistasGruposDinamico").innerHTML = `
    <div class="field">
      <label><strong>1. Seleccionar Evento</strong></label>
      <select id="pgEvento" class="select-lg">
        ${E.length > 0
      ? E.map(e => `<option value="${e.IDEvento}">${e.NombreEvento}</option>`).join("")
      : '<option value="">Sin eventos cargados</option>'
    }
      </select>
    </div>

    <div class="field">
      <label><strong>2. Seleccionar Juez de Grupo</strong></label>
      <div id="pgJuezBotonera" class="btn-group-pistas"></div>
    </div>

    <div class="field">
      <label><strong>3. Grupos a Juzgar (Tocar para activar)</strong></label>
      <div id="pgGrupoBotonera" class="btn-group-pistas"></div>
    </div>

    <div class="field supercats-box">
      <label><strong>4. Super-Categorías a Incluir:</strong></label>
      <table class="supercats-table">
        ${Object.keys(MAPA_SUPER_CATS).map(sc => `
            <tr>
              <td class="supercats-td-check">
                <input class="supercats-check" type="checkbox" name="superCat" value="${sc}" checked onchange="autoUpdatePistaGrupo()">
              </td>
              <td class="supercats-td-label" onclick="this.previousElementSibling.querySelector('input').click()">
                <span class="supercats-name">${sc}</span>
              </td>
            </tr>
          `).join("")
    }
      </table>
    </div>
  `;

  const selectEvento = $("pgEvento");
  if (selectEvento) {
    selectEvento.onchange = () => {
      window._juezSeleccionadoGrupo = null;
      window._pistaGrupoActiva = null;
      renderBotonerasPistasGrupos();
      renderJuzgamientoGrupos();
    };
  }

  renderBotonerasPistasGrupos();
}

function renderJuzgamientoGrupos() {
  const config = window._pistaGrupoActiva;
  const container = $("panelJuzgamientoGrupos");

  if (!config || !container || !config.judgeId || !config.groupIds || config.groupIds.length === 0) {
    container.innerHTML = `
      <div class="empty-center">
        <strong>Seleccioná primero un juez y los grupos a juzgar.</strong>
      </div>`;
    return;
  }

  const insc = CACHE.get("Catalogo_Perros_Inscriptos") || [];
  const resR = CACHE.get("Resultados_Razas") || [];
  const resG = CACHE.get("Resultados_Grupos") || [];
  const razas = CACHE.get("Catalogo_Razas") || [];
  const jueces = CACHE.get("Jueces") || [];

  const nE = normalizeID(config.eventId);
  const nJ = normalizeID(config.judgeId);

  const juezActual = jueces.find(j => normalizeID(j.IDJuez) === nJ);
  const esLimitada = String(juezActual?.TipoJuez || "GENERAL").toUpperCase() === "LIMITADA";
  const gruposHabilitados = String(juezActual?.GruposHabilitados || "")
    .split(",")
    .map(g => normalizeGrupo(g.trim()))
    .filter(Boolean);

  let html = "";

  if (esLimitada) {
    html += `
      <div style="background:#fff3cd;color:#856404;padding:8px 10px;margin:8px 0 12px 0;border:1px solid #ffeeba;border-radius:6px;font-size:13px;font-weight:700;text-align:center;">
        Competencia limitada / nacional — finaliza en Mejor de Grupo.
      </div>
    `;
  }

  let hayPerros = false;

  config.superCats.forEach(scName => {
    const idsCatIncluidas = MAPA_SUPER_CATS[scName] || [];

    const candidatos = insc.filter(p => {
      if (p.IDEvento && normalizeID(p.IDEvento) !== nE) return false;

      const gPerro = normalizeGrupo(p.IDGrupo);
      const grupoEnSeleccion = config.groupIds.includes(gPerro);
      const grupoPermitido = esLimitada ? gruposHabilitados.includes(gPerro) : true;

      return grupoEnSeleccion && grupoPermitido && idsCatIncluidas.includes(p.IDCategoria);
    });

    const ganadores = candidatos.filter(p => {
      if (!nE || !nJ) return false;

      const rRaza = resR.find(rr =>
        normalizeID(rr.IDInscripcion) === normalizeID(p.IDInscripcion) &&
        normalizeID(rr.IDEvento) === nE &&
        normalizeID(rr.IDJuez) === nJ &&
        String(rr.Puesto) === "1" &&
        !isTruthy(rr.Ausente)
      );

      if (!rRaza) return false;

      if (esLimitada) {
        return true;
      }

      return ["exc", "mp"].includes(normalizeID(rRaza.Calificacion));
    });

    ganadores.sort((a, b) => normalizeGrupo(a.IDGrupo).localeCompare(normalizeGrupo(b.IDGrupo)));

    if (ganadores.length > 0) {
      hayPerros = true;

      html += `<div class="juzg-header-supercat">🏆 ${scName}</div>`;

      let lastG = "";
      ganadores.forEach(p => {
        const rNom = razas.find(rz => String(rz.IDRaza) === String(p.IDRaza))?.NombreRaza || p.IDRaza;
        const gPerro = normalizeGrupo(p.IDGrupo);

        if (gPerro !== lastG) {
          html += `<div class="grupo-sep"><span class="grupo-pill">${gPerro}</span><div class="grupo-line"></div></div>`;
          lastG = gPerro;
        }

        const r = resG.find(rg =>
          normalizeID(rg.IDInscripcion) === normalizeID(p.IDInscripcion) &&
          normalizeID(rg.IDEvento) === nE &&
          normalizeID(rg.IDJuez) === nJ
        );

        const isAus = isTruthy(r?.Ausente);

        html += `
          <div class="card dog-card-compact grupo-card ${r ? 'has-grupo' : ''} ${isAus ? 'is-ausente' : ''}">
            <div class="dog-flex-row">
              <div>
                <strong class="dog-num-lg">#${p.NumeroCatalogo}</strong>
                <div class="dog-meta">${rNom}</div>
              </div>

              <div class="grupo-aus-zone">
                <button type="button"
                        class="btn-xs btn-aus-grupo ${isAus ? 'active' : ''}"
                        onclick="window.guardarResultadoGrupo(event, '${p.IDInscripcion}', 'AUS')">
                  AUS
                </button>
              </div>

              <div class="puesto-btns">
                ${["1", "2", "3", "4", "5", "6", "7"].map(pst => `
                  <button class="btn-xs ${String(r?.PuestoGrupo) === pst ? 'active' : ''}"
                          ${isAus ? 'disabled' : ''}
                          onclick="window.guardarResultadoGrupo(event, '${p.IDInscripcion}', '${pst}')">
                    ${pst}°
                  </button>
                `).join("")}
              </div>
            </div>
          </div>`;
      });
    }
  });

  if (!hayPerros) {
    html += `
      <div class="wait-box">
        <span class="wait-ico">⚠️</span>
        <p class="wait-title">Esperando ganadores de raza...</p>
        <p class="wait-text">
          Los perros aparecerán aquí automáticamente cuando tengan 1° Puesto en raza.
          <br><br>
          <strong class="danger-strong">
            En jueces GENERALES también se exige Exc o MP. En jueces LIMITADA alcanza con 1° Puesto y no estar AUSENTE.
          </strong>
        </p>
        <button class="btn-solid" onclick="window.syncAll().then(() => window.renderJuzgamientoGrupos())">
          🔄 Forzar Re-sincronización
        </button>
      </div>
    `;
  }

  container.innerHTML = html;
}

async function renderBotonerasPistasGrupos() {
  const idEvento = $("pgEvento")?.value || "";

  const J = CACHE.get("Jueces") || [];
  const insc = CACHE.get("Catalogo_Perros_Inscriptos") || [];
  const asign = CACHE.get("Gestion_pistas") || [];
  const G = CACHE.get("Catalogo_Grupos") || [];

  const inscEvento = insc.filter(i => String(i.IDEvento) === String(idEvento));
  const asignEvento = asign.filter(a => String(a.IDEvento) === String(idEvento));

  if (inscEvento.length === 0) {
    window._juezSeleccionadoGrupo = null;
    window._pistaGrupoActiva = null;

    $("pgJuezBotonera").innerHTML = `<p class="hint-text">No hay jueces porque este evento no tiene perros inscriptos.</p>`;
    $("pgGrupoBotonera").innerHTML = `<p class="hint-text">No hay grupos porque este evento no tiene perros inscriptos.</p>`;

    renderJuzgamientoGrupos();
    return;
  }

  if (asignEvento.length === 0) {
    window._juezSeleccionadoGrupo = null;
    window._pistaGrupoActiva = null;

    $("pgJuezBotonera").innerHTML = `<p class="hint-text">No hay jueces asignados para este evento.</p>`;
    $("pgGrupoBotonera").innerHTML = `<p class="hint-text">No hay grupos asignados para este evento.</p>`;

    renderJuzgamientoGrupos();
    return;
  }

  const juecesIds = [...new Set(asignEvento.map(a => String(a.IDJuez)))];

  if (
    window._juezSeleccionadoGrupo &&
    !juecesIds.includes(String(window._juezSeleccionadoGrupo.idJuez))
  ) {
    window._juezSeleccionadoGrupo = null;
    window._pistaGrupoActiva = null;
  }

  const juecesFiltrados = J.filter(j => juecesIds.includes(String(j.IDJuez)));

  $("pgJuezBotonera").innerHTML = juecesFiltrados.map(j => {
    const asignJuez = asignEvento.find(a =>
      String(a.IDJuez) === String(j.IDJuez) &&
      a.IDPista !== undefined &&
      a.IDPista !== null &&
      String(a.IDPista) !== ""
    );

    const pistaReal = asignJuez ? String(asignJuez.IDPista) : String(j.IDPista || "");
    const pistaTxt = pistaReal ? `Pista ${pistaReal}` : "Pista ?";
    const isActive = String(window._juezSeleccionadoGrupo?.idJuez || "") === String(j.IDJuez);

    const esLimitada = String(j.TipoJuez || "GENERAL").toUpperCase() === "LIMITADA";
    const gruposHabTexto = String(j.GruposHabilitados || "")
      .split(",")
      .map(g => g.trim())
      .filter(Boolean)
      .join(", ");

    const labelExtra = esLimitada && gruposHabTexto ? ` - ${gruposHabTexto}` : "";

    return `
      <button type="button"
              class="btn-opt btn-juez-grupo ${isActive ? 'active' : ''}"
              id="btnJuezGrupo_${j.IDJuez}"
              onclick="window.seleccionarJuezGrupo('${j.IDJuez}', '${pistaReal}')">
        ${j.NombreJuez} (${pistaTxt}${labelExtra})
      </button>`;
  }).join("") || `<p class="hint-text">No hay jueces asignados para este evento.</p>`;

  const gruposConPerros = [...new Set(inscEvento.map(p => normalizeGrupo(p.IDGrupo)).filter(Boolean))];

  const juezActual = J.find(j => String(j.IDJuez) === String(window._juezSeleccionadoGrupo?.idJuez));
  const esLimitada = String(juezActual?.TipoJuez || "GENERAL").toUpperCase() === "LIMITADA";

  let gruposDisponibles = [];

  if (esLimitada) {
    const gruposHabilitados = String(juezActual?.GruposHabilitados || "")
      .split(",")
      .map(g => normalizeGrupo(g.trim()))
      .filter(Boolean);

    gruposDisponibles = G.filter(g => {
      const gid = normalizeGrupo(g.IDGrupo);
      return gruposHabilitados.includes(gid) && gruposConPerros.includes(gid);
    });
  } else {
    const gruposAsignados = [...new Set(asignEvento.map(a => normalizeGrupo(a.IDGrupo)).filter(Boolean))];

    gruposDisponibles = G.filter(g => {
      const gid = normalizeGrupo(g.IDGrupo);
      return gruposAsignados.includes(gid) && gruposConPerros.includes(gid);
    });
  }

  if (gruposDisponibles.length === 0) {
    window._pistaGrupoActiva = null;

    $("pgGrupoBotonera").innerHTML = esLimitada
      ? `<p class="hint-text">Este juez LIMITADA no tiene grupos habilitados con perros inscriptos en este evento.</p>`
      : `<p class="hint-text">Seleccione un juez o no hay grupos disponibles para este evento.</p>`;

    renderJuzgamientoGrupos();
    return;
  }

  $("pgGrupoBotonera").innerHTML = gruposDisponibles.map(g => {
    const gid = normalizeGrupo(g.IDGrupo);
    const isActive =
      !!window._juezSeleccionadoGrupo &&
      (window._pistaGrupoActiva?.groupIds || []).includes(gid);

    return `
      <button type="button"
              class="btn-opt btn-grupo-item ${isActive ? 'active' : ''}"
              data-value="${gid}"
              onclick="window.toggleBotonGrupo(this)">
        ${gid}
      </button>`;
  }).join("");

  autoUpdatePistaGrupo();
}

window.seleccionarJuezGrupo = (idJuez, pista) => {
  const J = CACHE.get("Jueces") || [];
  const asign = CACHE.get("Gestion_pistas") || [];
  const idEvento = $("pgEvento")?.value || "";

  const juezActual = J.find(j => String(j.IDJuez) === String(idJuez));
  const nombre = juezActual?.NombreJuez || idJuez;

  window._juezSeleccionadoGrupo = { idJuez, pista, nombre };

  const esLimitada = String(juezActual?.TipoJuez || "GENERAL").toUpperCase() === "LIMITADA";
  const gruposHabilitados = String(juezActual?.GruposHabilitados || "")
    .split(",")
    .map(g => normalizeGrupo(g.trim()))
    .filter(Boolean);

  let gruposDelJuez = asign
    .filter(a =>
      String(a.IDEvento) === String(idEvento) &&
      String(a.IDJuez) === String(idJuez)
    )
    .map(a => normalizeGrupo(a.IDGrupo))
    .filter(Boolean);

  if (esLimitada) {
    gruposDelJuez = gruposHabilitados;
  }

  window._pistaGrupoActiva = gruposDelJuez.length > 0
    ? {
      eventId: idEvento,
      groupIds: gruposDelJuez,
      judgeId: idJuez,
      superCats: getSuperCatsSeleccionadas(),
      eventName: $("pgEvento").options[$("pgEvento").selectedIndex]?.text || "",
      judgeName: nombre
    }
    : null;

  renderBotonerasPistasGrupos();
};

window.toggleBotonGrupo = (btn) => {
  if (!window._juezSeleccionadoGrupo) {
    setStatus("Error: Seleccione un juez primero.", true);
    return;
  }

  btn.classList.toggle("active");
  autoUpdatePistaGrupo();
};

function autoUpdatePistaGrupo() {
  const evId = $("pgEvento")?.value || "";
  const jId = window._juezSeleccionadoGrupo?.idJuez || "";

  const groupIds = Array.from(document.querySelectorAll("#pgGrupoBotonera .btn-grupo-item.active"))
    .map(b => normalizeGrupo(b.dataset.value))
    .filter(Boolean);

  const superCats = getSuperCatsSeleccionadas();

  if (!evId || !jId || groupIds.length === 0 || superCats.length === 0) {
    window._pistaGrupoActiva = null;
  } else {
    window._pistaGrupoActiva = {
      eventId: evId,
      groupIds,
      judgeId: jId,
      superCats,
      eventName: $("pgEvento").options[$("pgEvento").selectedIndex]?.text || "",
      judgeName: window._juezSeleccionadoGrupo?.nombre || ""
    };
  }

  renderJuzgamientoGrupos();
}

window.autoUpdatePistaGrupo = autoUpdatePistaGrupo;
window.renderBotonerasPistasGrupos = renderBotonerasPistasGrupos;















// --- 7. AYUDANTES DE UI (NO TOCAR) ---
// --- 7. AYUDANTES DE UI ---
function setupBtnGroup(name, multi, callback) {
  const g = document.querySelector(`.btn-group[data-name="${name}"]`),
    h = document.querySelector(`input[name="${name}"]`);

  if (!g || !h) return;

  g.onclick = (e) => {
    const b = e.target.closest(".btn-opt");
    if (!b) return;

    // LÓGICA MULTISELECCIÓN (Para Títulos)
    if (multi) {
      b.classList.toggle("active");
      // Agregamos o quitamos la clase 'multi' para el color verde del CSS
      b.classList.toggle("multi");

      // Juntamos todos los valores seleccionados separados por coma
      h.value = Array.from(g.querySelectorAll(".btn-opt.active"))
        .map(x => x.dataset.value)
        .join(", ");
    }
    // LÓGICA SELECCIÓN ÚNICA (Para Sexo, Categoría, Grupo)
    else {
      g.querySelectorAll(".btn-opt").forEach(x => x.classList.remove("active", "multi"));
      b.classList.add("active");
      h.value = b.dataset.value;
    }

    if (callback) callback(h.value);
  };
}

function refreshBtnVisuals(name, value, multi) {
  const g = document.querySelector(`.btn-group[data-name="${name}"]`);
  if (!g) return;

  // Si es multi, convertimos "T01, T03" en un array ['T01', 'T03']
  // Si no es multi, creamos un array de un solo elemento [value]
  const vals = multi ? (value || "").split(",").map(v => v.trim()) : [String(value).trim()];

  g.querySelectorAll(".btn-opt").forEach(b => {
    // Verificamos si el valor del botón está incluido en nuestra lista
    const estaSeleccionado = vals.includes(String(b.dataset.value).trim());

    // Aplicamos las clases para que se vea pintado
    b.classList.toggle("active", estaSeleccionado);
    if (multi) {
      b.classList.toggle("multi", estaSeleccionado);
    }
  });
}

window.toggleGruposHabilitados = (tipo) => {
  const campo = document.getElementById("campoGruposHabilitados");
  if (campo) {
    campo.style.display = String(tipo || "").toUpperCase() === "LIMITADA" ? "block" : "none";
  }
};

// ESTA FUNCIÓN ES LA QUE FALTA EN TU CÓDIGO Y ARREGLA EL ERROR
function buildForm(d, f, r) {
  $(d).innerHTML = f.map(x => {
    const isID = (x.startsWith("ID") && x !== "IDPista");
    let val = r ? (r[x] || "") : "";

    // A. Lógica para el Selector de Países
    if (x === "Nacionalidad") {
      const opciones = Object.entries(PAISES_MAP)
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([code, nombre]) => `<option value="${code}" ${val === code ? "selected" : ""}>${nombre}</option>`)
        .join("");
      return `<div class="field"><label>Nacionalidad</label><select name="Nacionalidad"><option value="">Seleccione</option>${opciones}</select></div>`;
    }

    // Lógica para Tipo de Juez
    if (x === "TipoJuez") {
      const esLimitada = String(val).toUpperCase() === "LIMITADA";
      return `<div class="field"><label>Tipo de Juez</label><select name="TipoJuez" onchange="window.toggleGruposHabilitados(this.value)"><option value="GENERAL" ${!esLimitada ? "selected" : ""}>GENERAL</option><option value="LIMITADA" ${esLimitada ? "selected" : ""}>LIMITADA</option></select></div>`;
    }

    // Lógica para Grupos Habilitados
    if (x === "GruposHabilitados") {
      const grupos = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10"];
      const seleccionados = (val || "").split(",").map(s => s.trim());
      const botones = grupos.map(g => {
        const isActive = seleccionados.includes(g) ? "active multi" : "";
        return `<button type="button" class="btn-opt ${isActive}" data-value="${g}">${g}</button>`;
      }).join("");

      return `
        <div class="field" id="campoGruposHabilitados" style="display: none;">
          <label>Grupos Habilitados</label>
          <div class="btn-group" data-name="GruposHabilitados">
            ${botones}
          </div>
          <input type="hidden" name="GruposHabilitados" value="${val}">
        </div>
      `;
    }

    // B. Lógica para el Calendario (Fecha)
    if (x === "Fecha") {
      let valFecha = "";
      if (val.includes("/")) {
        const [dia, mes, anio] = val.split("/");
        valFecha = `${anio}-${mes}-${dia}`; // Convierte DD/MM/YYYY a YYYY-MM-DD para el input date
      } else {
        valFecha = val;
      }
      return `<div class="field"><label>Fecha</label><input type="date" id="eventFecha" name="Fecha" value="${valFecha}"></div>`;
    }

    // IDs especiales para que saveEvento los encuentre
    let extraID = "";
    if (x === "NombreEvento") extraID = 'id="eventName"';
    if (x === "Lugar") extraID = 'id="eventLugar"';

    return `<div class="field"><label>${isID ? "" : x}</label><input type="${isID ? "hidden" : "text"}" ${extraID} name="${x}" value="${val}"></div>`;
  }).join("");
}







function switchView(i) {
  ["viewCatalogos", "viewEventos", "viewJueces", "viewInscripciones", "viewPistas", "viewPistasGrupos", "viewBis"].forEach((v, x) => {
    if ($(v)) $(v).classList.toggle("hidden", x !== i);
  });
}




function sugerirNroCatalogo(rows) {
  let maxN = 0, maxI = 0;

  (rows || []).forEach(r => {
    const num = String(r.NumeroCatalogo || "").toLowerCase();
    const val = parseInt(num.replace(/\D/g, ''), 10) || 0;
    if (num.includes('i')) {
      if (val > maxI) maxI = val;
    } else {
      if (val > maxN) maxN = val;
    }
  });

  const nextN = maxN + 1;
  const nextI = String(maxI + 1).padStart(3, '0') + "i";

  // ✅ escribir hint en el ID correcto (probamos varios, sin romper nada)
  const hintTxt = `Sugerencia: ${nextN} o ${nextI}`;
  const hintHtml = `Sugerencia: <strong>${nextN}</strong> o <strong>${nextI}</strong>`;

  const hintIds = [
    "nroHint",
    "insNumeroHint",
    "insNumeroSugerencia",
    "insNumeroSug",
    "numeroCatalogoHint",
    "numeroCatalogoSugerencia"
  ];

  for (const id of hintIds) {
    const el = $(id);
    if (el) {
      // si es el hint viejo usa HTML, si no texto plano
      if (id === "nroHint") el.innerHTML = hintHtml;
      else el.textContent = hintTxt;
      break;
    }
  }

  return nextN;
}


function replaceTempIdEverywhere(tempId, realId) {
  // 1) Perros inscriptos
  const insc = CACHE.get("Catalogo_Perros_Inscriptos") || [];
  insc.forEach(r => { if (String(r.IDInscripcion) === String(tempId)) r.IDInscripcion = realId; });
  CACHE.set("Catalogo_Perros_Inscriptos", insc);

  // 2) Resultados Razas
  const rr = CACHE.get("Resultados_Razas") || [];
  rr.forEach(r => { if (String(r.IDInscripcion) === String(tempId)) r.IDInscripcion = realId; });
  CACHE.set("Resultados_Razas", rr);

  // 3) Resultados Grupos
  const rg = CACHE.get("Resultados_Grupos") || [];
  rg.forEach(r => { if (String(r.IDInscripcion) === String(tempId)) r.IDInscripcion = realId; });
  CACHE.set("Resultados_Grupos", rg);

  // 4) Resultados BIS
  const rb = CACHE.get("Resultados_BIS") || [];
  rb.forEach(r => { if (String(r.IDInscripcion) === String(tempId)) r.IDInscripcion = realId; });
  CACHE.set("Resultados_BIS", rb);
}
















// --- 8. ACCIONES DE GUARDADO ---
// --- 8. ACCIONES DE GUARDADO ---

// --- 8. ACCIONES DE GUARDADO (CORREGIDO) ---

// --- BLOQUE 1: GUARDADO OPTIMIZADO (SIN SYNCALL) ---
async function guardarInscripcion() {
  const f = $("inscripcionForm");
  if (!f) return;

  const fd = new FormData(f);
  const row = {};
  for (const [k, v] of fd.entries()) row[k] = (typeof v === "string" ? v.trim() : v);

  const activeId = localStorage.getItem("UI_ACTIVE_EVENT_ID");
  if (!row.IDEvento) row.IDEvento = activeId;
  if (!row.IDEvento) { alert("Error: No hay evento seleccionado."); return; }

  const isEdit = !!(row.IDInscripcion && String(row.IDInscripcion).trim() !== "");

  // --- PASO 1: ACTUALIZACIÓN OPTIMISTA (INSTANTÁNEA) ---
  const localId = isEdit ? row.IDInscripcion : "LOCAL_" + Date.now();
  const payload = { ...row };
  if (!isEdit) payload.IDInscripcion = localId;

  let insc = CACHE.get("Catalogo_Perros_Inscriptos") || [];
  if (isEdit) {
    const idx = insc.findIndex(i => String(i.IDInscripcion) === String(row.IDInscripcion));
    if (idx !== -1) insc[idx] = payload;
  } else {
    insc.push(payload);
  }

  CACHE.set("Catalogo_Perros_Inscriptos", insc);

  // Renderizado y limpieza inmediata (0ms)
  loadInscripciones();
  limpiarInscripcion();
  setStatus("Inscripción procesada...");

  // --- PASO 2: ENVÍO A SEGUNDO PLANO (SIN AWAIT PARA LA UI) ---
  const apiPayload = { ...row };
  if (!isEdit) delete apiPayload.IDInscripcion;

  api("POST", {}, {
    action: isEdit ? "update" : "create",
    table: "Catalogo_Perros_Inscriptos",
    payload: apiPayload,
    id: isEdit ? row.IDInscripcion : null
  }).then(resp => {
    if (resp.ok && !isEdit) {
      // Reemplazamos el ID local por el ID real del servidor en el CACHE
      const listaActual = CACHE.get("Catalogo_Perros_Inscriptos") || [];
      const perro = listaActual.find(i => i.IDInscripcion === localId);
      if (perro) {
        perro.IDInscripcion = resp.id;
        CACHE.set("Catalogo_Perros_Inscriptos", listaActual);
        // Refrescamos visualmente para que los botones de "Editar" tengan el ID real
        loadInscripciones();
      }
    }
    setStatus("Sincronizado con Google Sheets.");
  }).catch(e => {
    setStatus("Error de sincronización. Reintente.", true);
    console.error("Error en segundo plano:", e);
  });
}










async function eliminarInscripcion() {
  const id = $("inscripcionForm").elements["IDInscripcion"].value;
  if (!id || !confirm("¿Borrar definitivamente este registro?")) return;

  try {
    setStatus("Eliminando...");
    // 1. Borrado local inmediato
    let insc = CACHE.get("Catalogo_Perros_Inscriptos") || [];
    insc = insc.filter(i => String(i.IDInscripcion) !== String(id));
    CACHE.set("Catalogo_Perros_Inscriptos", insc);

    // 2. Refrescar UI al toque
    limpiarInscripcion();
    loadInscripciones();

    // 3. Borrado asíncrono en servidor
    await api("POST", {}, { action: "delete", table: "Catalogo_Perros_Inscriptos", id: id });
    setStatus("Eliminado con éxito.");
  } catch (e) {
    setStatus("Error al eliminar: " + e.message, true);
    await syncAll(); // Solo resincroniza si falló
  }
}



window.guardarResultado = async (e, idP, idJ, idE, val, campo, esMulti = false) => {
  // 1. Captura inmediata del evento para que no se pierda
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }

  if (!idE || idE === "undefined") return;

  // 2. Identificar el botón exacto que recibió el clic
  const btn = e?.currentTarget || e?.target?.closest?.(".btn-xs");
  if (!btn) return;

  // 3. Bloqueo de seguridad: Evita doble clic accidental mientras se procesa
  if (btn.disabled) return;
  btn.disabled = true;
  setTimeout(() => { if (btn) btn.disabled = false; }, 300);

  let res = CACHE.get("Resultados_Razas") || [];
  const nP = normalizeID(idP), nJ = normalizeID(idJ), nE = normalizeID(idE);

  // CONTROL JUEZ LIMITADA: no puede guardar títulos
  const jueces = CACHE.get("Jueces") || [];
  const juezActual = jueces.find(j => normalizeID(j.IDJuez) === nJ);
  const esLimitada = String(juezActual?.TipoJuez || "GENERAL").toUpperCase() === "LIMITADA";

  if (esLimitada && campo === "Titulo_Ganado") {
    setStatus("Este juez es de competencia limitada: no carga títulos.", true);
    return;
  }

  // VALIDACIÓN DE UNICIDAD PARA PUESTOS (1° al 7°)
  if (!esMulti && campo === "Puesto" && ["1", "2", "3", "4", "5", "6", "7"].includes(String(val))) {
    const insc = CACHE.get("Catalogo_Perros_Inscriptos") || [];
    const perroActual = insc.find(i => normalizeID(i.IDInscripcion) === nP);

    if (perroActual) {
      const conflicto = res.find(r =>
        normalizeID(r.IDEvento) === nE &&
        normalizeID(r.IDJuez) === nJ &&
        normalizeID(r.Puesto) === String(val) &&
        normalizeID(r.IDInscripcion) !== nP &&
        (() => {
          const otro = insc.find(i => normalizeID(i.IDInscripcion) === normalizeID(r.IDInscripcion));
          return otro && otro.IDRaza === perroActual.IDRaza && otro.IDCategoria === perroActual.IDCategoria;
        })()
      );

      if (conflicto) {
        const otroPerro = insc.find(i => normalizeID(i.IDInscripcion) === normalizeID(conflicto.IDInscripcion));
        alert(`¡ACCIÓN DENEGADA!\n\nYa existe un ${val}° Puesto asignado al perro #${otroPerro?.NumeroCatalogo || '??'} en esta misma Raza y Categoría.\n\nDebe desmarcar el ganador anterior antes de asignar uno nuevo.`);
        return;
      }
    }
  }

  let rec = res.find(x => normalizeID(x.IDInscripcion) === nP && normalizeID(x.IDJuez) === nJ && normalizeID(x.IDEvento) === nE);

  if (!rec) {
    rec = {
      IDResultado: "TEMP_" + Date.now(),
      IDInscripcion: idP,
      IDJuez: idJ,
      IDEvento: idE,
      Calificacion: "",
      Puesto: "",
      Titulo_Ganado: "",
      Ausente: false
    };
    res.push(rec);
  }

  // --- REFORMA AUSENTE (BLOQUE CORREGIDO) ---
  if (campo === "Ausente") {
    const markingAusente = isTruthy(val);
    rec.Ausente = markingAusente;

    if (markingAusente) {
      // Limpiar resultados al marcar como ausente
      rec.Puesto = "";
      rec.Calificacion = "";
      rec.Titulo_Ganado = "";
    }

    // Re-render siempre (tanto al marcar como al desmarcar)
    setTimeout(() => {
      const curPista = Array.from(document.querySelectorAll("#selectorPistaTrabajo .btn-opt.active")).map(b => b.dataset.value)[0];
      if (curPista) renderJuzgamiento(curPista);
    }, 100);

  } else {
    // Carga normal de resultados (solo si no es campo Ausente)
    if (esMulti) {
      let tArr = (rec[campo] || "").split(", ").map(s => s.trim()).filter(Boolean);
      if (tArr.includes(val)) {
        tArr = tArr.filter(x => x !== val);
        btn.classList.remove("active", "multi");
      } else {
        tArr.push(val);
        btn.classList.add("active", "multi");
      }
      rec[campo] = tArr.join(", ");
    } else {
      const parent = btn.parentElement;
      if (parent) {
        parent.querySelectorAll(".btn-xs").forEach(b => b.classList.remove("active"));
      }
      btn.classList.add("active");
      rec[campo] = val;

      const card = btn.closest(".dog-card-compact");
      if (card && campo === "Puesto") {
        card.style.borderLeftColor = (val === "1") ? "#27ae60" : "#bdc3c7";
      }
    }
  }

  CACHE.set("Resultados_Razas", res);
  if (window._pistaGrupoActiva) renderJuzgamientoGrupos();

  const timerKey = `raza_${nP}_${nE}`;
  if (pendingTimers.has(timerKey)) clearTimeout(pendingTimers.get(timerKey));

  pendingTimers.set(timerKey, setTimeout(async () => {
    setStatus("Sincronizando...");
    const isTemp = String(rec.IDResultado).startsWith("TEMP_");
    const payload = { ...rec };
    if (isTemp) delete payload.IDResultado;

    try {
      const servidor = await api("POST", {}, {
        action: isTemp ? "create" : "update",
        table: "Resultados_Razas",
        payload,
        id: isTemp ? null : rec.IDResultado
      });

      if (servidor && servidor.id) {
        rec.IDResultado = servidor.id;
        CACHE.set("Resultados_Razas", res);
      }
      setStatus("Guardado OK.");
    } catch (e) {
      setStatus("Error al guardar: " + e.message, true);
    }
  }, TIEMPO_ESPERA_GUARDADO));
};



// --- 6. PISTAS GRUPOS Y BIS (VERSION BLINDADA CON UNICIDAD) ---






window.guardarResultadoGrupo = async (e, inscId, puesto) => {
  // =====================================================================================
  // 0) CONFIG + BOTÓN (ESTABILIDAD TOTAL DEL CLICK)
  // =====================================================================================
  const config = window._pistaGrupoActiva;

  const btn = e?.currentTarget || e?.target?.closest?.(".btn-xs");
  if (!btn || !config) return;

  if (btn.disabled) return;
  btn.disabled = true;
  setTimeout(() => { if (btn) btn.disabled = false; }, 250);

  // =====================================================================================
  // 1) DATA BASE (CACHE)
  // =====================================================================================
  let resG = CACHE.get("Resultados_Grupos") || [];
  const insc = CACHE.get("Catalogo_Perros_Inscriptos") || [];

  const nI = normalizeID(inscId);
  const nE = normalizeID(config.eventId);
  const nJ = normalizeID(config.judgeId);

  const perroActual = insc.find(i => normalizeID(i.IDInscripcion) === nI);
  if (!perroActual) return;

  const grupoActual = String(perroActual.IDGrupo || "");
  const catActual = String(perroActual.IDCategoria || "");

  // =====================================================================================
  // 2) REGISTRO POR JUEZ (CLAVE REAL)
  //    Antes: (IDInscripcion + IDEvento)
  //    Ahora: (IDInscripcion + IDEvento + IDJuez)
  // =====================================================================================
  let rec = resG.find(r =>
    normalizeID(r.IDInscripcion) === nI &&
    normalizeID(r.IDEvento) === nE &&
    normalizeID(r.IDJuez) === nJ
  );
  const isNew = !rec;

  if (isNew) {
    rec = {
      IDResultadoGrupo: "TEMP_" + Date.now(),
      IDInscripcion: inscId,
      IDEvento: config.eventId,
      IDJuez: config.judgeId,
      IDGrupo: grupoActual,
      IDCategoria: catActual,
      PuestoGrupo: ""
    };
    resG.push(rec);
  } else {
    if (!rec.IDGrupo) rec.IDGrupo = grupoActual;
    if (!rec.IDCategoria) rec.IDCategoria = catActual;
    if (!rec.IDJuez) rec.IDJuez = config.judgeId; // por si quedó data vieja
  }

  // =====================================================================================
  // AUSENTE — toggle de ausencia en grupo
  // =====================================================================================
  if (String(puesto) === "AUS") {
    const nuevoAus = !isTruthy(rec.Ausente);
    rec.Ausente = nuevoAus;

    if (nuevoAus) {
      rec.PuestoGrupo = "";
    }

    CACHE.set("Resultados_Grupos", resG);

    renderJuzgamientoGrupos();
    if (window._pistaBisActiva) renderJuzgamientoBis();

    const payload = { ...rec };
    const isTempAus = String(payload.IDResultadoGrupo || "").startsWith("TEMP_");

    if (isTempAus) delete payload.IDResultadoGrupo;

    api("POST", {}, {
      action: isTempAus ? "create" : "update",
      table: "Resultados_Grupos",
      payload,
      id: isTempAus ? null : rec.IDResultadoGrupo
    }).then(servidor => {
      if (isTempAus && servidor && servidor.id) {
        rec.IDResultadoGrupo = servidor.id;
        CACHE.set("Resultados_Grupos", resG);
      }
      setStatus("Grupo sincronizado.");
    }).catch(e2 => {
      setStatus("Error al guardar grupo: " + e2.message, true);
    });

    return;
  }

  if (isTruthy(rec.Ausente)) return;

  // =====================================================================================
  // 3) TOGGLE COHERENTE DEL PUESTO
  // =====================================================================================
  const nuevoPuesto = (String(rec.PuestoGrupo || "") === String(puesto)) ? "" : String(puesto);

  // =====================================================================================
  // 4) UNICIDAD (MISMO EVENTO + MISMO JUEZ + MISMO GRUPO + MISMA CATEGORÍA)
  // =====================================================================================
  if (nuevoPuesto !== "") {

    const conflicto = resG.find(r =>
      normalizeID(r.IDEvento) === nE &&
      normalizeID(r.IDJuez) === nJ &&                 // <<< CLAVE: juez
      String(r.IDGrupo || "") === grupoActual &&
      String(r.IDCategoria || "") === catActual &&
      String(r.PuestoGrupo || "") === String(nuevoPuesto) &&
      normalizeID(r.IDInscripcion) !== nI
    );

    if (conflicto) {
      const otroPerro = insc.find(i => normalizeID(i.IDInscripcion) === normalizeID(conflicto.IDInscripcion));
      alert(
        `¡ACCIÓN DENEGADA!\n\n` +
        `Ya existe un ${nuevoPuesto}° Puesto asignado al perro #${otroPerro?.NumeroCatalogo || '??'}\n` +
        `en este MISMO Grupo y Categoría.\n\n` +
        `Debe desmarcarlo antes de elegir un nuevo ${nuevoPuesto}°.`
      );
      return;
    }

    // Limpieza defensiva (solo dentro del MISMO juez)
    resG.forEach(r => {
      if (
        normalizeID(r.IDEvento) === nE &&
        normalizeID(r.IDJuez) === nJ &&             // <<< CLAVE: juez
        String(r.IDGrupo || "") === grupoActual &&
        String(r.IDCategoria || "") === catActual &&
        String(r.PuestoGrupo || "") === String(nuevoPuesto) &&
        normalizeID(r.IDInscripcion) !== nI
      ) {
        r.PuestoGrupo = "";
      }
    });
  }

  // =====================================================================================
  // 5) APLICAR EL CAMBIO AL PERRO ACTUAL
  // =====================================================================================
  rec.PuestoGrupo = nuevoPuesto;

  // =====================================================================================
  // 6) VISUALES
  // =====================================================================================
  const parent = btn.parentElement;
  if (parent) {
    parent.querySelectorAll(".btn-xs").forEach(b => b.classList.remove("active"));
  }
  if (rec.PuestoGrupo !== "") btn.classList.add("active");

  // =====================================================================================
  // 7) CACHE + RENDER
  // =====================================================================================
  CACHE.set("Resultados_Grupos", resG);

  renderJuzgamientoGrupos();
  if (window._pistaBisActiva) renderJuzgamientoBis();

  // =====================================================================================
  // 8) GUARDADO EN SEGUNDO PLANO
  // =====================================================================================
  const payload = { ...rec };
  const isTemp = String(payload.IDResultadoGrupo).startsWith("TEMP_");
  if (isTemp) delete payload.IDResultadoGrupo;

  api("POST", {}, {
    action: isTemp ? "create" : "update",
    table: "Resultados_Grupos",
    payload,
    id: isTemp ? null : rec.IDResultadoGrupo
  }).then(servidor => {
    if (isTemp && servidor && servidor.id) rec.IDResultadoGrupo = servidor.id;
    setStatus("Grupo sincronizado.");
  }).catch(e2 => {
    setStatus("Error al guardar grupo: " + e2.message, true);
  });
};







async function saveEvento() {
  const name = $("eventName").value;
  const fechaRaw = $("eventFecha").value;
  const lugar = $("eventLugar").value;
  const id = document.querySelector('#eventosForm input[name="IDEvento"]')?.value;

  if (!name || !fechaRaw) {
    setStatus("Error: Nombre y Fecha son obligatorios", true);
    return;
  }

  const fechaFinal = formatFechaCristiana(fechaRaw);
  const payload = { NombreEvento: name, Fecha: fechaFinal, Lugar: lugar };

  try {
    setStatus("Guardando...");
    const res = await api("POST", {}, {
      action: id ? "update" : "create",
      table: "Eventos",
      payload: payload,
      id: id
    });

    // ACTUALIZACIÓN OPTIMIZADA (Sin syncAll)
    let evs = CACHE.get("Eventos") || [];
    if (id) {
      const idx = evs.findIndex(e => String(e.IDEvento) === String(id));
      if (idx !== -1) evs[idx] = { ...payload, IDEvento: id };
    } else {
      // Si es nuevo, usamos el ID que devuelve el servidor
      evs.push({ ...payload, IDEvento: res.id || Date.now() });
    }

    CACHE.set("Eventos", evs);
    loadEventos(); // Refresca la lista al toque
    $("eventosForm").reset();
    setStatus("Evento guardado.");
  } catch (e) {
    setStatus("Error: " + e.message, true);
  }
}


async function saveJuez() {
  const f = $("juecesForm");
  const p = {};
  new FormData(f).forEach((v, k) => p[k] = v);

  if (!p.NombreJuez) {
    setStatus("Error: Nombre del juez es obligatorio", true);
    return;
  }

  if (String(p.TipoJuez || "GENERAL").toUpperCase() === "GENERAL") {
    p.GruposHabilitados = "";
  }

  try {
    setStatus("Guardando juez...");
    const res = await api("POST", {}, {
      action: p.IDJuez ? "update" : "create",
      table: "Jueces",
      payload: p,
      id: p.IDJuez
    });

    // ACTUALIZACIÓN INSTANTÁNEA EN CACHE
    let jueces = CACHE.get("Jueces") || [];
    if (p.IDJuez) {
      // Edición: buscamos y reemplazamos
      const idx = jueces.findIndex(j => String(j.IDJuez) === String(p.IDJuez));
      if (idx !== -1) jueces[idx] = { ...p };
    } else {
      // Nuevo: agregamos con el ID que devuelve el servidor
      p.IDJuez = res.id || Date.now();
      jueces.push({ ...p });
    }

    CACHE.set("Jueces", jueces);
    loadJueces(); // Refresca la lista en 0ms
    f.reset();
    $("formTitleJuez").textContent = "Nuevo Juez";
    setStatus("Juez guardado correctamente.");
  } catch (e) {
    setStatus("Error al guardar juez: " + e.message, true);
  }
}




function verificarAcceso() {
  const key = sessionStorage.getItem("USER_API_KEY");
  if (!key) {
    const overlay = $("loginOverlay");
    if (overlay) overlay.classList.remove("hidden");

    const btn = $("btnLogin");
    if (btn) {
      btn.onclick = async () => {
        const input = $("inputApiKey").value.trim();
        if (!input) return;
        sessionStorage.setItem("USER_API_KEY", input);
        try {
          setStatus("Verificando...");
          await syncAll();
          if (overlay) overlay.classList.add("hidden");
          // Si entramos por primera vez tras poner la clave, forzamos el arranque
          switchView(0);
          loadCatalog();
        } catch (e) {
          sessionStorage.removeItem("USER_API_KEY");
          const errEl = $("loginError");
          if (errEl) {
            errEl.textContent = "CLAVE INVÁLIDA";
            errEl.classList.remove("hidden");
          }
        }
      };
    }
    return false;
  }
  return true;
}





// --- 9. INICIALIZACIÓN (CON REFORMA GRUPOS Y ALINEACIÓN) ---
document.addEventListener("DOMContentLoaded", async () => {
  const tabs = {
    navCatalogos: () => { switchView(0); loadCatalog(); },
    navEventos: () => { switchView(1); loadEventos(); },
    navJueces: () => { switchView(2); loadJueces(); },
    navInscripciones: async () => { switchView(3); await prepareInscripcionForm(); loadInscripciones(); },
    navPistas: async () => { switchView(4); await preparePistasForm(); },
    navPistasGrupos: async () => {
      switchView(5);
      await preparePistasGruposForm();
    },
    navBis: async () => {
      switchView(6);
      await prepareBisForm();
    }
  };

  Object.entries(tabs).forEach(([id, fn]) => {
    if ($(id)) {
      $(id).onclick = (e) => {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        e.target.classList.add("active");
        fn();
      };
    }
  });

  // Selector catálogo
  if ($("catalogo")) {
    $("catalogo").innerHTML = [
      "Catalogo_Perros_Inscriptos",
      "Resultados_Razas",
      "Resultados_Grupos",
      "Resultados_BIS",
      "Jueces",
      "Eventos",
      "Catalogo_Grupos",
      "Catalogo_Razas",
      "Catalogo_Categorias",
      "Catalogo_Sexos",
      "Catalogo_Titulos"
    ].map(t => `<option value="${t}">${t}</option>`).join("");

    $("catalogo").onchange = () => loadCatalog();
  }

  // Recargar: sync + refrescar vista visible
  if ($("btnRecargar")) {
    $("btnRecargar").onclick = async () => {
      await syncAll();

      // refrescar según vista visible
      const isVisible = (id) => {
        const el = $(id);
        return el && !el.classList.contains("hidden");
      };

      if (isVisible("viewCatalogos")) return loadCatalog();
      if (isVisible("viewEventos")) return loadEventos();
      if (isVisible("viewJueces")) return loadJueces();
      if (isVisible("viewInscripciones")) {
        await prepareInscripcionForm();
        return loadInscripciones();
      }
      if (isVisible("viewPistas")) return preparePistasForm();
      if (isVisible("viewPistasGrupos")) return preparePistasGruposForm();
      if (isVisible("viewBis")) return prepareBisForm();

      // fallback
      loadCatalog();
    };
  }

  // --- ACCIONES: INSCRIPCIONES ---
  if ($("btnGuardarInscripcion")) $("btnGuardarInscripcion").onclick = guardarInscripcion;
  if ($("btnNuevaInscripcion")) $("btnNuevaInscripcion").onclick = limpiarInscripcion;
  if ($("btnEliminarInscripcion")) $("btnEliminarInscripcion").onclick = eliminarInscripcion;

  // --- ACCIONES: EVENTOS ---
  if ($("btnNuevo")) {
    $("btnNuevo").onclick = () => {
      $("formTitle").textContent = "Nuevo Evento";
      buildForm("eventosForm", ["IDEvento", "NombreEvento", "Fecha", "Lugar", "Observaciones"]);
    };
  }
  if ($("btnGuardar")) $("btnGuardar").onclick = saveEvento;



  // --- ACCIONES: JUECES ---
  if ($("btnNuevoJuez")) {
    $("btnNuevoJuez").onclick = () => {
      $("formTitleJuez").textContent = "Nuevo Juez";
      buildForm("juecesForm", ["IDJuez", "NombreJuez", "Nacionalidad", "IDPista", "Telefono", "Mail", "Redes", "Activo", "Observaciones", "FotoURL", "TipoJuez", "GruposHabilitados"]);
      setTimeout(() => {
        setupBtnGroup("GruposHabilitados", true);
        if (window.toggleGruposHabilitados) window.toggleGruposHabilitados("GENERAL");
      }, 10);
    };
  }







  if ($("btnGuardarJuez")) $("btnGuardarJuez").onclick = saveJuez;

  // --- ACCIÓN PISTA TRABAJO (SINCRONIZADA) ---
  if ($("selectorPistaTrabajo")) {
    document.querySelectorAll("#selectorPistaTrabajo .btn-opt").forEach(b => {
      b.onclick = () => {
        const pista = b.dataset.value;
        const idEvento = $("pistaEventoSelect")?.value;
        const asign = CACHE.get("Gestion_pistas") || [];
        const J = CACHE.get("Jueces") || [];

        // Marcar pista activa
        document.querySelectorAll("#selectorPistaTrabajo .btn-opt").forEach(x => x.classList.remove("active"));
        b.classList.add("active");

        // Buscar asignación para este evento y pista
        const asignacion = asign.find(a =>
          String(a.IDEvento) === String(idEvento) &&
          String(a.IDPista) === String(pista)
        );

        // Limpiar botones de jueces
        document.querySelectorAll(".btn-juez-pista").forEach(btnJ => btnJ.classList.remove("active"));

        if (asignacion) {
          const idJuez = asignacion.IDJuez;
          window._juezSeleccionadoPista = { idJuez, pista };

          const btnJuez = $(`btnJuez_${idJuez}`);
          if (btnJuez) btnJuez.classList.add("active");

          const juez = J.find(j => String(j.IDJuez) === String(idJuez));
          const esLimitada = String(juez?.TipoJuez || "GENERAL").toUpperCase() === "LIMITADA";
          const gruposHab = String(juez?.GruposHabilitados || "")
            .split(",")
            .map(g => g.trim())
            .filter(Boolean)
            .join(", ");

          if (esLimitada && gruposHab) {
            b.textContent = `Pista ${pista} - ${gruposHab}`;
            b.title = `${juez.NombreJuez} - ${gruposHab}`;
          }
        } else {
          window._juezSeleccionadoPista = null;
        }

        renderJuzgamiento(pista);
      };
    });
  }

  // --- FINAL DE LA CARGA ---
  if (verificarAcceso()) {
    switchView(0);
    syncAll().then(() => loadCatalog());
  }

  // Splash
  if ($("splashScreen")) {
    setTimeout(() => {
      $("splashScreen").classList.add("hidden");
    }, 1500);
  }
});













// ============================================================================
// >>>>> AGREGADO PARA FINALES BEST IN SHOW (BIS) <<<<<
// Pegar esto AL FINAL ABSOLUTO de app.js, sin tocar el código anterior.
// ============================================================================

// Variable para recordar la configuración de la pista BIS activa
window._pistaBisActiva = null;

// Mapeo de qué categorías entran en cada Gran Final de BIS
const MAPA_BIS_FINALES = {
  "BIS CACHORROS": ["C00", "C01"],
  "BIS JOVENES": ["C02", "C03"],
  "BIS ADULTOS": ["C04", "C05", "C06", "C07"],
  "BIS VETERANOS": ["C08"]
};

// --- BIS: FORMULARIO (Evento + Botonera Jueces con Pista) ---
async function prepareBisForm() {
  const J = CACHE.get("Jueces") || [];
  const E = CACHE.get("Eventos") || [];
  const asign = CACHE.get("Gestion_pistas") || [];
  const insc = CACHE.get("Catalogo_Perros_Inscriptos") || [];

  window._juezSeleccionadoBis = null;

  $("formBisDinamico").innerHTML = `
    <div class="field">
      <label>Evento de la Final</label>
      <select id="bisEvento" class="select-lg">
        ${E.length > 0
      ? E.map(e => `<option value="${e.IDEvento}">${e.NombreEvento}</option>`).join("")
      : `<option value="">Sin eventos</option>`
    }
      </select>
    </div>

    <div class="field">
      <label>Juez Principal de BIS</label>
      <div id="bisJuezBotonera" class="btn-group-pistas"></div>
      <input type="hidden" id="bisJuez" value="">
    </div>
  `;

  const renderJuecesBis = () => {
    const evId = $("bisEvento")?.value || "";

    // 4. Si no hay evento
    if (!evId) {
      $("bisJuezBotonera").innerHTML = '<p class="hint-text">Seleccione un evento.</p>';
      $("bisJuez").value = "";
      window._juezSeleccionadoBis = null;
      window._pistaBisActiva = null;
      renderJuzgamientoBis();
      return;
    }

    const inscEvento = insc.filter(i => String(i.IDEvento) === String(evId));
    const asignEvento = asign.filter(a => String(a.IDEvento) === String(evId));

    // 5. Si no hay perros
    if (inscEvento.length === 0) {
      $("bisJuezBotonera").innerHTML = '<p class="hint-text">No hay jueces porque este evento no tiene perros inscriptos.</p>';
      $("bisJuez").value = "";
      window._juezSeleccionadoBis = null;
      window._pistaBisActiva = null;
      renderJuzgamientoBis();
      return;
    }

    // 6. Si no hay asignaciones en Gestion_pistas para este evento
    if (asignEvento.length === 0) {
      $("bisJuezBotonera").innerHTML = '<p class="hint-text">No hay jueces asignados para este evento.</p>';
      $("bisJuez").value = "";
      window._juezSeleccionadoBis = null;
      window._pistaBisActiva = null;
      renderJuzgamientoBis();
      return;
    }

    // 7. Filtrar solo jueces con asignaciones reales en este evento
    const juecesIds = [...new Set(asignEvento.map(a => String(a.IDJuez)))];
    const juecesFiltrados = J.filter(j =>
      juecesIds.includes(String(j.IDJuez)) &&
      String(j.TipoJuez || "GENERAL").toUpperCase() !== "LIMITADA"
    );

    $("bisJuezBotonera").innerHTML = juecesFiltrados.map(j => {
      // 8. Obtener la pista asignada específicamente en este evento
      const asignJuez = asignEvento.find(a =>
        String(a.IDJuez) === String(j.IDJuez) &&
        a.IDPista !== undefined &&
        a.IDPista !== null &&
        String(a.IDPista) !== ""
      );

      const pista = asignJuez ? String(asignJuez.IDPista) : "";
      const pistaTxt = pista ? `Pista ${pista}` : "Pista ?";
      const nombreEscapado = (j.NombreJuez || "").replace(/'/g, "\\'");

      return `
        <button type="button"
                class="btn-opt btn-juez-bis"
                id="btnJuezBis_${j.IDJuez}"
                onclick="window.seleccionarJuezBis('${j.IDJuez}', '${pista}', '${nombreEscapado}')">
          ${j.NombreJuez} (${pistaTxt})
        </button>`;
    }).join("");

    // Reset de estado al cambiar/renderizar
    $("bisJuez").value = "";
    window._juezSeleccionadoBis = null;
    window._pistaBisActiva = null;
    renderJuzgamientoBis();
  };

  const selEv = $("bisEvento");
  if (selEv) {
    selEv.onchange = renderJuecesBis;
  }

  renderJuecesBis();
}






window._juezSeleccionadoBis = null;










function renderJuzgamientoBis() {
  const config = window._pistaBisActiva;

  if (!config) {
    $("panelJuzgamientoBis").innerHTML = `<p class="hint-text">Configure y abra la pista central arriba.</p>`;
    if ($("infoPistaBisActiva")) $("infoPistaBisActiva").style.display = "none";
    return;
  }

  $("txtPistaBisActiva").textContent = `🏆 GRAN FINAL: ${config.eventName} | Juez: ${config.judgeName} 🏆`;
  if ($("infoPistaBisActiva")) $("infoPistaBisActiva").style.display = "block";

  const insc = CACHE.get("Catalogo_Perros_Inscriptos") || [];
  const razas = CACHE.get("Catalogo_Razas") || [];
  const grupos = CACHE.get("Catalogo_Grupos") || [];
  const resGrupos = CACHE.get("Resultados_Grupos") || [];
  const resBis = CACHE.get("Resultados_BIS") || [];

  const nE = normalizeID(config.eventId);
  const nJ = normalizeID(config.judgeId);

  const evOf = (r) => normalizeID(r?.IDEvento ?? r?.IDEvento ?? "");
  const juezOf = (r) => normalizeID(r?.IDJuez ?? r?.IDJuez ?? "");

  let html = "";

  Object.entries(MAPA_BIS_FINALES).forEach(([nombreBis, categoriasIncluidas]) => {

    const ganadoresGrupo = resGrupos.filter(rg =>
      evOf(rg) === nE &&
      juezOf(rg) === nJ &&
      String(rg.PuestoGrupo || "") === "1" &&
      !isTruthy(rg.Ausente)
    );

    const candidatos = ganadoresGrupo
      .map(rg => insc.find(p => normalizeID(p.IDInscripcion) === normalizeID(rg.IDInscripcion)))
      .filter(Boolean)
      .filter(p => categoriasIncluidas.includes(p.IDCategoria));

    const porGrupo = new Map();
    candidatos.forEach(p => {
      const key = String(p.IDGrupo || "");
      if (!porGrupo.has(key)) porGrupo.set(key, p);
    });

    const clasificados = Array.from(porGrupo.values());

    if (clasificados.length > 0) {
      html += `<div class="bis-title">✨ ${nombreBis} ✨</div>`;

      clasificados.sort((a, b) => String(a.IDGrupo || "").localeCompare(String(b.IDGrupo || "")));

      clasificados.forEach(p => {
        const rNom = razas.find(rz => String(rz.IDRaza) === String(p.IDRaza))?.NombreRaza || p.IDRaza;
        const gNom = grupos.find(g => String(g.IDGrupo) === String(p.IDGrupo))?.NombreGrupo || p.IDGrupo;

        const rBis = resBis.find(rb =>
          normalizeID(rb.IDInscripcion) === normalizeID(p.IDInscripcion) &&
          evOf(rb) === nE &&
          juezOf(rb) === nJ &&
          String(rb.TipoBIS || "") === String(nombreBis || "")
        );

        const isAus = isTruthy(rBis?.Ausente);

        html += `
          <div class="card dog-card-compact bis-card ${rBis ? 'has-bis' : ''} ${isAus ? 'is-ausente' : ''}">
            <div class="bis-row">
              <div>
                <span class="muted">[${String(gNom).replace('Grupo ', 'G')}]</span><br>
                <strong>#${p.NumeroCatalogo}</strong> - ${rNom}
              </div>
              <div class="bis-aus-zone">
                <button type="button"
                        class="btn-xs btn-aus-bis ${isAus ? 'active' : ''}"
                        onclick="window.guardarResultadoBis(event, '${p.IDInscripcion}', 'AUS', '${nombreBis}')">
                  AUS
                </button>
              </div>
              <div class="btn-group-inline puesto-btns">
                ${["1", "2", "3", "4", "5", "6", "7"].map(pst => `
                  <button class="btn-xs ${String(rBis?.PuestoBIS || "") === pst ? 'active' : ''}"
                          ${isAus ? 'disabled' : ''}
                          onclick="window.guardarResultadoBis(event, '${p.IDInscripcion}', '${pst}', '${nombreBis}')">
                    ${pst}°
                  </button>
                `).join("")}
              </div>
            </div>
          </div>
        `;
      });
    }
  });

  if (html === "") {
    html = `
      <div class="card bis-empty">
        <p class="muted">🏆 Aún no hay ganadores de Grupo (Puesto 1°) clasificados para este juez.</p>
      </div>
    `;
  }

  $("panelJuzgamientoBis").innerHTML = html;
}











window.guardarResultadoBis = async (e, inscId, puesto, tipoBis) => {
  const config = window._pistaBisActiva;

  const btn = e?.currentTarget || e?.target?.closest?.(".btn-xs");
  if (!btn || !config || !config.eventId || !config.judgeId || !inscId || !tipoBis) return;

  if (btn.disabled) return;
  btn.disabled = true;
  setTimeout(() => { try { btn.disabled = false; } catch { } }, 250);

  try {
    let resB = CACHE.get("Resultados_BIS") || [];
    const nI = normalizeID(inscId);
    const nE = normalizeID(config.eventId);
    const nJ = normalizeID(config.judgeId);
    const tB = String(tipoBis || "").trim();
    const pst = String(puesto || "").trim();

    if (!pst) return;

    let rec = resB.find(r =>
      normalizeID(r.IDInscripcion) === nI &&
      normalizeID(r.IDEvento) === nE &&
      normalizeID(r.IDJuez) === nJ &&
      String(r.TipoBIS || "").trim() === tB
    );

    if (!rec) {
      rec = {
        IDResultadoBIS: "TEMP_" + Date.now(),
        IDInscripcion: inscId,
        IDEvento: config.eventId,
        IDJuez: config.judgeId,
        TipoBIS: tB,
        PuestoBIS: "",
        Ausente: false
      };
      resB.push(rec);
    } else {
      rec.IDJuez = rec.IDJuez || config.judgeId;
      rec.IDEvento = rec.IDEvento || config.eventId;
      rec.TipoBIS = rec.TipoBIS || tB;
    }

    if (pst === "AUS") {
      const nuevoAus = !isTruthy(rec.Ausente);
      rec.Ausente = nuevoAus;

      if (nuevoAus) {
        rec.PuestoBIS = "";
      }

      CACHE.set("Resultados_BIS", resB);
      if (typeof renderJuzgamientoBis === "function") renderJuzgamientoBis();

      const payload = { ...rec, IDJuez: config.judgeId, IDEvento: config.eventId, TipoBIS: tB };
      const isTempAus = String(payload.IDResultadoBIS || "").startsWith("TEMP_");

      if (isTempAus) delete payload.IDResultadoBIS;

      api("POST", {}, {
        action: isTempAus ? "create" : "update",
        table: "Resultados_BIS",
        payload,
        id: isTempAus ? null : rec.IDResultadoBIS
      })
        .then((servidor) => {
          if (isTempAus && servidor?.id) {
            rec.IDResultadoBIS = servidor.id;
            CACHE.set("Resultados_BIS", resB);
          }
          setStatus("BIS sincronizado.");
        })
        .catch((err) => {
          setStatus("Error al guardar BIS: " + (err?.message || err), true);
        });

      return;
    }

    if (isTruthy(rec.Ausente)) return;

    const nuevoPuesto = (String(rec.PuestoBIS || "") === pst) ? "" : pst;

    if (nuevoPuesto) {
      resB.forEach(r => {
        if (
          normalizeID(r.IDEvento) === nE &&
          normalizeID(r.IDJuez) === nJ &&
          String(r.TipoBIS || "").trim() === tB &&
          String(r.PuestoBIS || "") === nuevoPuesto &&
          normalizeID(r.IDInscripcion) !== nI
        ) {
          r.PuestoBIS = "";
        }
      });
    }

    rec.PuestoBIS = nuevoPuesto;

    const parent = btn.parentElement;
    if (parent) parent.querySelectorAll(".btn-xs").forEach(b => b.classList.remove("active"));
    if (nuevoPuesto) btn.classList.add("active");

    CACHE.set("Resultados_BIS", resB);
    if (typeof renderJuzgamientoBis === "function") renderJuzgamientoBis();

    const payload = { ...rec, IDJuez: config.judgeId, IDEvento: config.eventId, TipoBIS: tB };
    const isTemp = String(payload.IDResultadoBIS || "").startsWith("TEMP_");
    if (isTemp) delete payload.IDResultadoBIS;

    api("POST", {}, {
      action: isTemp ? "create" : "update",
      table: "Resultados_BIS",
      payload,
      id: isTemp ? null : rec.IDResultadoBIS
    })
      .then((servidor) => {
        if (isTemp && servidor?.id) {
          rec.IDResultadoBIS = servidor.id;
          CACHE.set("Resultados_BIS", resB);
        }
        setStatus("BIS sincronizado.");
      })
      .catch((err) => {
        setStatus("Error al guardar BIS: " + (err?.message || err), true);
      });

  } catch (err) {
    setStatus("Error BIS: " + (err?.message || err), true);
  }
};
















// --- BIS: INICIALIZACIÓN (sin botón "ABRIR PISTA CENTRAL BIS") ---
function initBisSystem() {
  const catSelect = $("catalogo");
  if (catSelect && !catSelect.querySelector('option[value="Resultados_BIS"]')) {
    const opt = document.createElement("option");
    opt.value = "Resultados_BIS";
    opt.textContent = "Resultados_BIS";
    catSelect.appendChild(opt);
  }

  // API global: click en juez => set pista BIS + render
  window.seleccionarJuezBis = (idJuez, pista, nombre) => {
    // visual active
    document.querySelectorAll("#bisJuezBotonera .btn-juez-bis").forEach(b => b.classList.remove("active"));
    const btn = $(`btnJuezBis_${idJuez}`);
    if (btn) btn.classList.add("active");

    // hidden
    if ($("bisJuez")) $("bisJuez").value = idJuez;

    // memoria juez
    window._juezSeleccionadoBis = { id: idJuez, pista: pista || "", name: nombre || idJuez };

    const evId = $("bisEvento")?.value || "";
    if (!evId || !idJuez) {
      window._pistaBisActiva = null;
      renderJuzgamientoBis();
      return;
    }

    // set pista activa y render directo (sin botón)
    window._pistaBisActiva = {
      eventId: evId,
      judgeId: idJuez,
      eventName: $("bisEvento")?.options[$("bisEvento")?.selectedIndex]?.text || "",
      judgeName: (window._juezSeleccionadoBis?.name || "Juez")
    };

    renderJuzgamientoBis();
  };

  // si existe el botón viejo, lo matamos
  if ($("btnAbrirBis")) $("btnAbrirBis").style.display = "none";
}






if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initBisSystem);
} else {
  initBisSystem();
}
// ============================================================================
// >>>>> FIN DEL AGREGADO BIS <<<<<
// ============================================================================


window.syncAll = syncAll;
window.renderJuzgamientoGrupos = renderJuzgamientoGrupos;

document.addEventListener("click", function (e) {
  const card = e.target.closest(".insc-item");
  if (!card) return;

  const id = card.dataset.id;
  if (id && typeof window.editInscripcion === "function") {
    window.editInscripcion(id);
  }
});
