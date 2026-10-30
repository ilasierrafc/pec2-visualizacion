// Flow map: cambios de residencia entre comunidades autónomas en 2024 (INE, tabla 69741)

const es = d3.formatLocale({ decimal: ",", thousands: ".", grouping: [3], currency: ["", " €"] });
const fmtEntero = es.format(",.0f");
const fmtPct = v => es.format(",.1f")(v) + " %";
const conSigno = v => (v > 0 ? "+" : v < 0 ? "−" : "") + fmtEntero(Math.abs(v));

const ANCHO = 960;
const ALTO = 720;
const CANARIAS = "ES70";
const CAJA_CANARIAS = [[16, 590], [250, 704]];
const CURVATURA = 0.18;
const GROSOR_MAX = 16;
const RADIO_ANCLA = 3.5;
const MUESTRAS_CURVA = 48;

// Desplazamientos de algunas etiquetas para que no se pisen entre sí (unidades del viewBox)
const AJUSTE_ETIQUETA = {
  ES13: { dx: -4, dy: -9 },
  ES21: { dx: 4, dy: -9 },
  ES22: { dx: 12, dy: 15 },
  ES23: { dx: -6, dy: 15 },
};
// Etiquetas que se ocultan en pantallas estrechas (siguen en el tooltip, el desplegable y la tabla)
const ETIQUETAS_PEQUENAS = new Set(["ES13", "ES21", "ES22", "ES23", "ES63", "ES64"]);

const tooltip = document.querySelector(".tooltip");
const estado = { n: 30, region: null };

Promise.all([
  d3.csv("../data/migraciones_ccaa_2024.csv", d3.autoType),
  d3.json("../data/comunidades.geojson"),
]).then(([flujos, mapa]) => iniciar(flujos, mapa));

function iniciar(flujos, mapa) {
  // --- Geografía -------------------------------------------------------------
  const regiones = mapa.features;
  regiones.forEach(orientar);
  const nombre = new Map(regiones.map(f => [f.properties.id, f.properties.nombre]));
  const continente = { type: "FeatureCollection", features: regiones.filter(f => f.properties.id !== CANARIAS) };
  const canarias = regiones.find(f => f.properties.id === CANARIAS);

  const proyeccion = d3.geoConicConformal()
    .parallels([36, 43])
    .rotate([3.5, 0])
    .fitExtent([[24, 24], [ANCHO - 24, ALTO - 24]], continente);
  const proyeccionCanarias = d3.geoConicConformal()
    .parallels([27.6, 29.4])
    .rotate([15.8, 0])
    .fitExtent([[CAJA_CANARIAS[0][0] + 10, CAJA_CANARIAS[0][1] + 10], [CAJA_CANARIAS[1][0] - 10, CAJA_CANARIAS[1][1] - 10]], canarias);
  const rutaContinente = d3.geoPath(proyeccion);
  const rutaCanarias = d3.geoPath(proyeccionCanarias);
  const ruta = f => (f.properties.id === CANARIAS ? rutaCanarias : rutaContinente);
  const ancla = new Map(regiones.map(f => [f.properties.id, ruta(f).centroid(f)]));

  // --- Cifras ----------------------------------------------------------------
  const total = d3.sum(flujos, d => d.personas);
  const ordenados = flujos.slice().sort((a, b) => d3.descending(a.personas, b.personas));
  const llegadas = d3.rollup(flujos, v => d3.sum(v, d => d.personas), d => d.destino_id);
  const salidas = d3.rollup(flujos, v => d3.sum(v, d => d.personas), d => d.origen_id);
  const saldo = id => (llegadas.get(id) || 0) - (salidas.get(id) || 0);
  const grosor = d3.scaleLinear().domain([0, ordenados[0].personas]).range([0, GROSOR_MAX]);
  const anchoDe = d => Math.max(1, grosor(d.personas));
  flujos.forEach(d => {
    d.clave = `${d.origen_id}-${d.destino_id}`;
    d.geo = geometriaFlujo(ancla.get(d.origen_id), ancla.get(d.destino_id), anchoDe(d));
  });

  // --- SVG -------------------------------------------------------------------
  const svg = d3.select("#grafico").append("svg").attr("viewBox", `0 0 ${ANCHO} ${ALTO}`);
  const capaMarco = svg.append("g");
  const capaRegiones = svg.append("g");
  const capaFlujos = svg.append("g");
  const capaAnclas = svg.append("g").attr("pointer-events", "none");
  const capaEtiquetas = svg.append("g").attr("pointer-events", "none");
  const capaLeyenda = svg.append("g").attr("pointer-events", "none");

  capaMarco.append("rect")
    .attr("class", "marco")
    .attr("x", CAJA_CANARIAS[0][0])
    .attr("y", CAJA_CANARIAS[0][1])
    .attr("width", CAJA_CANARIAS[1][0] - CAJA_CANARIAS[0][0])
    .attr("height", CAJA_CANARIAS[1][1] - CAJA_CANARIAS[0][1])
    .attr("rx", 6);

  const caminos = capaRegiones.selectAll("path")
    .data(regiones)
    .join("path")
    .attr("class", "region")
    .attr("d", f => ruta(f)(f))
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", f => {
      const id = f.properties.id;
      return `${nombre.get(id)}: ${fmtEntero(llegadas.get(id) || 0)} llegadas, ${fmtEntero(salidas.get(id) || 0)} salidas, saldo ${conSigno(saldo(id))}. Pulsa para ver sus flujos.`;
    })
    .on("click", (evento, f) => alternarRegion(f.properties.id))
    .on("keydown", (evento, f) => {
      if (evento.key === "Enter" || evento.key === " ") {
        evento.preventDefault();
        alternarRegion(f.properties.id);
      }
    })
    .on("pointerenter", (evento, f) => tooltipRegion(f.properties.id, evento.clientX, evento.clientY))
    .on("pointermove", evento => colocarTooltip(evento.clientX, evento.clientY))
    .on("pointerleave", ocultarTooltip)
    .on("focus", (evento, f) => {
      const [x, y] = enPantalla(ancla.get(f.properties.id));
      tooltipRegion(f.properties.id, x, y);
    })
    .on("blur", ocultarTooltip);

  const anclas = capaAnclas.selectAll("circle")
    .data(regiones)
    .join("circle")
    .attr("class", "ancla")
    .attr("cx", f => ancla.get(f.properties.id)[0])
    .attr("cy", f => ancla.get(f.properties.id)[1])
    .attr("r", 2.5);

  const etiquetas = capaEtiquetas.selectAll("text")
    .data(regiones)
    .join("text")
    .attr("class", f => `etiqueta-region halo${ETIQUETAS_PEQUENAS.has(f.properties.id) ? " pequena" : ""}`)
    .attr("x", f => ancla.get(f.properties.id)[0] + (AJUSTE_ETIQUETA[f.properties.id]?.dx ?? 0))
    .attr("y", f => ancla.get(f.properties.id)[1] + (AJUSTE_ETIQUETA[f.properties.id]?.dy ?? -8))
    .attr("text-anchor", "middle")
    .text(f => f.properties.nombre);

  // Leyenda de grosores en la esquina superior derecha (Francia, sin datos)
  const leyenda = capaLeyenda.attr("transform", `translate(${ANCHO - 170}, 30)`);
  leyenda.append("text").attr("class", "texto-leyenda").text("Personas");
  [5000, 15000, 30000].forEach((valor, i) => {
    const y = 22 + i * 24;
    leyenda.append("line")
      .attr("x1", 0)
      .attr("x2", 44)
      .attr("y1", y)
      .attr("y2", y)
      .style("stroke", "var(--serie-azul)")
      .style("stroke-opacity", 0.55)
      .style("stroke-width", grosor(valor));
    leyenda.append("text")
      .attr("class", "texto-leyenda")
      .attr("x", 54)
      .attr("y", y)
      .attr("dy", "0.35em")
      .text(fmtEntero(valor));
  });

  // Tamaño de los textos según el ancho real del mapa (en móvil el viewBox se reduce mucho)
  new ResizeObserver(() => {
    const ancho = svg.node().getBoundingClientRect().width || ANCHO;
    const k = Math.min(Math.max(ANCHO / ancho, 1), 2.2);
    svg.style("--k", k).classed("estrecho", k > 1.5);
  }).observe(svg.node());

  // --- Controles --------------------------------------------------------------
  const selector = d3.select("#comunidad");
  selector.selectAll("option.region")
    .data(regiones.slice().sort((a, b) => a.properties.nombre.localeCompare(b.properties.nombre, "es")))
    .join("option")
    .attr("class", "region")
    .attr("value", f => f.properties.id)
    .text(f => f.properties.nombre);
  selector.on("change", function () {
    estado.region = this.value || null;
    actualizar();
  });
  d3.select("#numero").on("input", function () {
    estado.n = +this.value;
    actualizar();
  });

  // --- Nota con las claves calculadas a partir de los datos ------------------
  const ids = regiones.map(f => f.properties.id);
  const idMin = d3.least(ids, id => saldo(id));
  const idMax = d3.greatest(ids, id => saldo(id));
  const enTop10 = ordenados.slice(0, 10).filter(d => d.origen_id === idMin || d.destino_id === idMin).length;
  const perdidas = ids
    .filter(id => id !== idMin)
    .map(id => ({ id, neto: (flujoEntre(id, idMin)?.personas || 0) - (flujoEntre(idMin, id)?.personas || 0) }))
    .filter(d => d.neto < 0)
    .sort((a, b) => d3.ascending(a.neto, b.neto))
    .slice(0, 3)
    .map(d => nombre.get(d.id));
  const lista = perdidas.length > 1 ? `${perdidas.slice(0, -1).join(", ")} y ${perdidas.at(-1)}` : perdidas.join("");
  d3.select("#nota-claves").text(
    `${nombre.get(idMin)} participa en ${enTop10} de los 10 mayores flujos y es la comunidad con el saldo más negativo (${conSigno(saldo(idMin))}): ` +
    `pierde población sobre todo hacia ${lista}. El mayor saldo positivo es el de ${nombre.get(idMax)} (${conSigno(saldo(idMax))}).`
  );

  actualizar();

  // --- Funciones que dependen de los datos -----------------------------------
  function flujoEntre(origen, destino) {
    return flujos.find(d => d.origen_id === origen && d.destino_id === destino);
  }

  function alternarRegion(id) {
    estado.region = estado.region === id ? null : id;
    selector.property("value", estado.region || "");
    actualizar();
  }

  function colorDe(d) {
    if (estado.region && d.destino_id === estado.region) return "var(--serie-naranja)";
    return "var(--serie-azul)";
  }

  function actualizar() {
    const region = estado.region;
    const visibles = region
      ? flujos.filter(d => d.origen_id === region || d.destino_id === region)
      : ordenados.slice(0, estado.n);

    pintarFlujos(visibles);
    caminos.classed("seleccionada", f => f.properties.id === region);
    anclas.classed("activa", f => f.properties.id === region).attr("r", f => (f.properties.id === region ? 4 : 2.5));
    etiquetas.classed("activa", f => f.properties.id === region);

    d3.select("#numero").property("disabled", Boolean(region));
    d3.select("#numero-valor").text(estado.n);
    d3.select("#leyenda-region").property("hidden", !region);
    d3.select("#resumen").text(region
      ? `${nombre.get(region)}: ${fmtEntero(salidas.get(region) || 0)} salidas y ${fmtEntero(llegadas.get(region) || 0)} llegadas`
      : `Los ${estado.n} mayores flujos suman el ${fmtPct(d3.sum(visibles, d => d.personas) / total * 100)} de los ${fmtEntero(total)} cambios de residencia`);

    pintarPanel();
    pintarTabla(visibles);
  }

  function pintarFlujos(visibles) {
    const orden = visibles.slice().sort((a, b) => d3.ascending(a.personas, b.personas));
    const grupos = capaFlujos.selectAll("g.flujo")
      .data(orden, d => d.clave)
      .join(entrada => {
        const g = entrada.append("g").attr("class", "flujo");
        g.append("path").attr("class", "linea");
        g.append("path").attr("class", "punta");
        g.append("path").attr("class", "golpe");
        return g;
      })
      .order();

    grupos.select(".linea")
      .attr("d", d => d.geo.linea)
      .style("stroke", colorDe)
      .style("stroke-width", d => anchoDe(d));
    grupos.select(".punta")
      .attr("d", d => d.geo.punta)
      .style("fill", colorDe);
    grupos.select(".golpe")
      .attr("d", d => d.geo.completa)
      .style("stroke-width", d => anchoDe(d) + 10);

    grupos
      .on("pointerenter", function (evento, d) {
        svg.classed("con-foco", true);
        d3.select(this).classed("activo", true).raise();
        mostrarTooltip(`${fmtEntero(d.personas)} personas`, [`${nombre.get(d.origen_id)} → ${nombre.get(d.destino_id)}`], evento.clientX, evento.clientY);
      })
      .on("pointermove", evento => colocarTooltip(evento.clientX, evento.clientY))
      .on("pointerleave", function () {
        svg.classed("con-foco", false);
        d3.select(this).classed("activo", false);
        // Devuelve el flujo destacado a su sitio: los pequeños debajo, los grandes encima
        capaFlujos.selectAll("g.flujo").sort((a, b) => d3.ascending(a.personas, b.personas));
        ocultarTooltip();
      });
  }

  function pintarPanel() {
    const panel = d3.select("#panel");
    panel.selectAll("*").remove();
    const region = estado.region;

    if (!region) {
      const mayor = ordenados[0];
      const inverso = flujoEntre(mayor.destino_id, mayor.origen_id);
      panel.append("h2").text("Claves de 2024");
      panel.append("p").attr("class", "cifra").text(fmtEntero(total));
      panel.append("p").text("cambios de residencia entre comunidades y ciudades autónomas");
      const dl = panel.append("dl");
      filaClave(dl, "Mayor flujo", `${nombre.get(mayor.origen_id)} → ${nombre.get(mayor.destino_id)}`, fmtEntero(mayor.personas));
      if (inverso) filaClave(dl, "Flujo inverso", `${nombre.get(inverso.origen_id)} → ${nombre.get(inverso.destino_id)}`, fmtEntero(inverso.personas));
      filaClave(dl, "Mayor saldo positivo", nombre.get(idMax), conSigno(saldo(idMax)));
      filaClave(dl, "Mayor saldo negativo", nombre.get(idMin), conSigno(saldo(idMin)));
      panel.append("p").text("Pulsa una comunidad en el mapa, o elígela en el desplegable, para ver sus llegadas y salidas.");
      return;
    }

    panel.append("h2").text(nombre.get(region));
    const cifras = panel.append("div").attr("class", "cifras");
    [
      [fmtEntero(llegadas.get(region) || 0), "llegadas"],
      [fmtEntero(salidas.get(region) || 0), "salidas"],
      [conSigno(saldo(region)), "saldo"],
    ].forEach(([valor, etiqueta]) => {
      const celda = cifras.append("div");
      celda.append("span").attr("class", "valor").text(valor);
      celda.append("span").attr("class", "etiqueta").text(etiqueta);
    });
    panel.append("p").text("Saldo = llegadas − salidas.");

    const destinos = flujos.filter(d => d.origen_id === region).sort((a, b) => d3.descending(a.personas, b.personas)).slice(0, 5);
    const origenes = flujos.filter(d => d.destino_id === region).sort((a, b) => d3.descending(a.personas, b.personas)).slice(0, 5);
    listaTop(panel, "Principales destinos", "salida", destinos, d => nombre.get(d.destino_id));
    listaTop(panel, "Principales orígenes", "llegada", origenes, d => nombre.get(d.origen_id));

    panel.append("button")
      .attr("type", "button")
      .text("Ver todas las comunidades")
      .on("click", () => alternarRegion(region));
  }

  function filaClave(dl, titulo, texto, valor) {
    const fila = dl.append("div");
    fila.append("dt").text(titulo);
    const dd = fila.append("dd");
    dd.append("span").text(texto);
    dd.append("span").attr("class", "num").text(valor);
  }

  function listaTop(panel, titulo, tipo, filas, nombreDe) {
    const h3 = panel.append("h3");
    h3.append("span").attr("class", `clave-linea ${tipo}`);
    h3.append("span").text(titulo);
    const items = panel.append("ol").selectAll("li").data(filas).join("li").append("span");
    items.append("span").text(nombreDe);
    items.append("span").attr("class", "num").text(d => fmtEntero(d.personas));
  }

  function pintarTabla(visibles) {
    const filas = visibles.slice().sort((a, b) => d3.descending(a.personas, b.personas));
    d3.select("#tabla caption").text(estado.region
      ? `Flujos de ${nombre.get(estado.region)} (${filas.length} de ${flujos.length})`
      : `Flujos mostrados en el mapa (${filas.length} de ${flujos.length})`);
    d3.select("#tabla tbody")
      .selectAll("tr")
      .data(filas, d => d.clave)
      .join(entrada => {
        const tr = entrada.append("tr");
        tr.append("td").text(d => nombre.get(d.origen_id));
        tr.append("td").text(d => nombre.get(d.destino_id));
        tr.append("td").attr("class", "num").text(d => fmtEntero(d.personas));
        return tr;
      })
      .order();
  }

  function tooltipRegion(id, x, y) {
    mostrarTooltip(
      `${conSigno(saldo(id))} de saldo`,
      [nombre.get(id), `${fmtEntero(llegadas.get(id) || 0)} llegadas · ${fmtEntero(salidas.get(id) || 0)} salidas`],
      x,
      y
    );
  }

  function enPantalla([x, y]) {
    const punto = svg.node().createSVGPoint();
    punto.x = x;
    punto.y = y;
    const p = punto.matrixTransform(svg.node().getScreenCTM());
    return [p.x, p.y];
  }
}

// D3 trabaja sobre la esfera: los anillos exteriores tienen que ir en sentido horario.
// Si un polígono viene al revés (regla de la mano derecha de GeoJSON), se invierte.
function orientar(feature) {
  const geometria = feature.geometry;
  const poligonos = geometria.type === "Polygon" ? [geometria.coordinates] : geometria.coordinates;
  for (const poligono of poligonos) {
    if (d3.geoArea({ type: "Polygon", coordinates: poligono }) > 2 * Math.PI) {
      poligono.forEach(anillo => anillo.reverse());
    }
  }
}

// Curva cuadrática de origen a destino que se dobla a la derecha del sentido de la marcha,
// con la línea recortada para terminar en la base de la punta de flecha.
function geometriaFlujo(p0, p2, ancho) {
  const dx = p2[0] - p0[0];
  const dy = p2[1] - p0[1];
  const largo = Math.hypot(dx, dy);
  const control = [
    (p0[0] + p2[0]) / 2 - (dy / largo) * largo * CURVATURA,
    (p0[1] + p2[1]) / 2 + (dx / largo) * largo * CURVATURA,
  ];
  const punto = t => [
    (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * control[0] + t * t * p2[0],
    (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * control[1] + t * t * p2[1],
  ];
  const derivada = t => [
    2 * (1 - t) * (control[0] - p0[0]) + 2 * t * (p2[0] - control[0]),
    2 * (1 - t) * (control[1] - p0[1]) + 2 * t * (p2[1] - control[1]),
  ];

  // Longitud acumulada para pasar de distancia sobre la curva a parámetro t
  const acumulado = [0];
  let anterior = p0;
  for (let i = 1; i <= MUESTRAS_CURVA; i++) {
    const actual = punto(i / MUESTRAS_CURVA);
    acumulado.push(acumulado[i - 1] + Math.hypot(actual[0] - anterior[0], actual[1] - anterior[1]));
    anterior = actual;
  }
  const longitud = acumulado[MUESTRAS_CURVA];
  const tEn = s => {
    const objetivo = Math.max(0, Math.min(longitud, s));
    const i = Math.max(1, d3.bisectLeft(acumulado, objetivo));
    const tramo = acumulado[i] - acumulado[i - 1] || 1;
    return (i - 1 + (objetivo - acumulado[i - 1]) / tramo) / MUESTRAS_CURVA;
  };

  const disponible = Math.max(0, longitud - 2 * RADIO_ANCLA);
  const largoPunta = Math.min(5 + 0.8 * ancho, disponible * 0.6);
  const mediaPunta = 3 + 0.75 * ancho;
  const tInicio = tEn(RADIO_ANCLA);
  const tPunta = tEn(longitud - RADIO_ANCLA);
  const tBase = tEn(longitud - RADIO_ANCLA - largoPunta);

  // Tramo [tInicio, tBase] de la cuadrática: Q1 = B(t0) + (t1 − t0) / 2 · B'(t0)
  const q0 = punto(tInicio);
  const q2 = punto(tBase);
  const d0 = derivada(tInicio);
  const q1 = [q0[0] + ((tBase - tInicio) / 2) * d0[0], q0[1] + ((tBase - tInicio) / 2) * d0[1]];

  const vertice = punto(tPunta);
  const ux = (vertice[0] - q2[0]) / (Math.hypot(vertice[0] - q2[0], vertice[1] - q2[1]) || 1);
  const uy = (vertice[1] - q2[1]) / (Math.hypot(vertice[0] - q2[0], vertice[1] - q2[1]) || 1);
  const izquierda = [q2[0] - uy * mediaPunta, q2[1] + ux * mediaPunta];
  const derecha = [q2[0] + uy * mediaPunta, q2[1] - ux * mediaPunta];

  const p = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  return {
    linea: `M${p(q0)}Q${p(q1)} ${p(q2)}`,
    punta: `M${p(vertice)}L${p(izquierda)}L${p(derecha)}Z`,
    completa: `M${p(p0)}Q${p(control)} ${p(p2)}`,
  };
}

// --- Tooltip -------------------------------------------------------------------
function mostrarTooltip(valor, etiquetas, x, y) {
  const elementoValor = document.createElement("span");
  elementoValor.className = "valor";
  elementoValor.textContent = valor;
  const lineas = etiquetas.map(texto => {
    const linea = document.createElement("span");
    linea.className = "etiqueta";
    linea.textContent = texto;
    return linea;
  });
  tooltip.replaceChildren(elementoValor, ...lineas);
  tooltip.hidden = false;
  colocarTooltip(x, y);
}

function colocarTooltip(x, y) {
  const margen = 14;
  const caja = tooltip.getBoundingClientRect();
  let izquierda = x + margen;
  let arriba = y + margen;
  if (izquierda + caja.width > window.innerWidth - 8) izquierda = x - margen - caja.width;
  if (arriba + caja.height > window.innerHeight - 8) arriba = y - margen - caja.height;
  tooltip.style.left = `${Math.max(8, izquierda)}px`;
  tooltip.style.top = `${Math.max(8, arriba)}px`;
}

function ocultarTooltip() {
  tooltip.hidden = true;
}
