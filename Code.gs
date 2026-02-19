const CONFIG = {
  SPREADSHEET_ID: "1ly1OGGwWvRzIjdoABIAYGdkHkz5025-Haoqkx_lyZG0",
  API_KEY: ""  // ESTO VA VACÍO O CON TEXTO
};

// ================================
// Helpers
// ================================
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function openSS_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getSheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error("La pestaña '" + name + "' no existe en el Google Sheet.");
  return sh;
}

function getHeaders_(sh) {
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) return [];
  return sh.getRange(1, 1, 1, lastCol).getValues()[0];
}

function findRowIndexById_(sh, idColIndex1Based, idValue) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sh.getRange(2, idColIndex1Based, lastRow - 1, 1).getValues(); // col of IDs
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(idValue)) return i + 2; // actual row in sheet
  }
  return -1;
}









// ================================
// doGet
// ================================
function doGet(e) {
  try {
    const ss = openSS_();

    // BLOQUE DE SEGURIDAD agregado el 19/2/2026
    if (e.parameter.key !== CONFIG.API_KEY) {
      return json_({ ok: false, error: "Clave incorrecta" });
    }



    const action = String(e?.parameter?.action || "").trim();

    // 1) GET clásico por tabla: ?table=NombreHoja
    if (!action) {
      const table = (e.parameter.table || "").trim();
      if (!table) return json_({ ok: false, error: "No se envió el nombre de la tabla." });

      const sh = getSheet_(ss, table);
      const values = sh.getDataRange().getValues();
      if (values.length < 1) return json_({ ok: true, rows: [] });

      const headers = values[0];
      const rows = values.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
      return json_({ ok: true, rows });
    }

    // 2) sync: devuelve todas las pestañas que usa tu app
    if (action === "sync") {
      const tables = [
        "Catalogo_Perros_Inscriptos",
        "Catalogo_Razas",
        "Catalogo_Categorias",
        "Catalogo_Sexos",
        "Catalogo_Titulos",
        "Catalogo_Grupos",
        "Eventos",
        "Jueces",
        "Gestion_pistas",
        "Resultados_Razas",
        "Resultados_Grupos",
        "Resultados_BIS"
      ];

      const data = {};
      tables.forEach(t => {
        const sh = ss.getSheetByName(t);
        if (!sh) { data[t] = []; return; } // si falta, devolvemos vacío
        const values = sh.getDataRange().getValues();
        if (values.length < 1) { data[t] = []; return; }
        const headers = values[0];
        const rows = values.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
        data[t] = rows;
      });

      return json_({ ok: true, data });
    }

    return json_({ ok: false, error: "Acción GET no reconocida: " + action });

  } catch (err) {
    return json_({ ok: false, error: "Error de sistema: " + err.toString() });
  }
}













// ================================
// doPost
// ================================
function doPost(e) {
  try {
    const ss = openSS_();
    const body = JSON.parse(e.postData.contents || "{}");

    if (body.key !== CONFIG.API_KEY) return json_({ ok: false, error: "Clave incorrecta" });

    const action = String(body.action || "").trim();
    const table = String(body.table || "").trim();
    if (!action) return json_({ ok: false, error: "Falta body.action" });
    if (!table) return json_({ ok: false, error: "Falta body.table" });

    const sh = getSheet_(ss, table);
    const headers = getHeaders_(sh);
    if (headers.length === 0) return json_({ ok: false, error: "La hoja '" + table + "' no tiene encabezados." });

    const idHeader = headers[0];       // asumimos ID en la primer columna (como estás usando)
    const idColIndex = 1;              // 1-based
    const payload = body.payload || {};
    const id = String(body.id || payload[idHeader] || "").trim();

    // -------- CREATE --------
    if (action === "create") {
      const newId = String(payload[idHeader] || Utilities.getUuid());
      const row = headers.map((col, i) => (i === 0 ? newId : (payload[col] ?? "")));
      sh.appendRow(row);
      return json_({ ok: true, id: newId });
    }

    // -------- UPDATE --------
    if (action === "update") {
      if (!id) return json_({ ok: false, error: "Falta id para update" });
      const rowIndex = findRowIndexById_(sh, idColIndex, id);
      if (rowIndex === -1) return json_({ ok: false, error: "No se encontró id '" + id + "' en " + table });

      // arma la fila completa respetando headers
      const row = headers.map((col, i) => (i === 0 ? id : (payload[col] ?? sh.getRange(rowIndex, i + 1).getValue())));
      sh.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
      return json_({ ok: true, id });
    }

    // -------- DELETE --------
    if (action === "delete") {
      if (!id) return json_({ ok: false, error: "Falta id para delete" });
      const rowIndex = findRowIndexById_(sh, idColIndex, id);
      if (rowIndex === -1) return json_({ ok: false, error: "No se encontró id '" + id + "' en " + table });

      sh.deleteRow(rowIndex);
      return json_({ ok: true, id });
    }

    return json_({ ok: false, error: "Acción no reconocida: " + action });

  } catch (err) {
    return json_({ ok: false, error: err.toString() });
  }
}
