// Pie chart: estructura de la generación eléctrica en España, 2025 (Red Eléctrica)

const ORDEN = [
  "Eólica",
  "Solar",
  "Hidráulica y otras renovables",
  "Gas y otras no renovables",
  "Nuclear",
];

const COLOR = {
  "Eólica": "var(--pie-eolica)",
  "Solar": "var(--pie-solar)",
  "Hidráulica y otras renovables": "var(--pie-hidraulica)",
  "Gas y otras no renovables": "var(--pie-gas)",
  "Nuclear": "var(--pie-nuclear)",
};

const es = d3.formatLocale({ decimal: ",", thousands: ".", grouping: [3], currency: ["", " €"] });
const f1 = es.format(",.1f");
const pct = v => `${f1(v)} %`;
const twh = mwh => `${f1(mwh / 1e6)} TWh`;

const FUENTE_NOMBRE = "600 13px system-ui, -apple-system, 'Segoe UI', sans-serif";
const FUENTE_VALOR = "12px system-ui, -apple-system, 'Segoe UI', sans-serif";

const grafico = document.querySelector("#grafico");
const tooltip = document.querySelector(".tooltip");
const lienzo = document.createElement("canvas").getContext("2d");

let datos = [];
let anchoDibujado = null;

d3.csv("../data/generacion_electrica_2025.csv", d3.autoType).then(filas => {
  const total = d3.sum(filas, d => d.mwh);
  datos = ORDEN
    .map(nombre => filas.find(f => f.categoria === nombre))
    .filter(Boolean)
    .map(f => ({ ...f, cuota: f.mwh / total * 100 }));

  const renovable = d3.sum(datos.filter(d => d.grupo === "Renovable"), d => d.cuota);

  document.querySelector("#subtitulo").textContent =
    `Estructura de la generación eléctrica nacional en 2025 por tecnología. ` +
    `El círculo completo son los ${f1(total / 1e6)} TWh generados (100 %).`;

  clave(renovable);
  nota(renovable);
  tabla(total);
  dibujar();

  let espera;
  window.addEventListener("resize", () => {
    clearTimeout(espera);
    espera = setTimeout(dibujar, 150);
  });
});

function punto(color) {
  const el = document.createElement("span");
  el.className = "muestra";
  el.style.background = color;
  return el;
}

function clave(renovable) {
  const contenedor = document.querySelector("#clave");
  const grupos = [
    ["Renovable", "Renovables", renovable],
    ["No renovable", "No renovables", 100 - renovable],
  ];
  for (const [grupo, nombre, valor] of grupos) {
    const item = document.createElement("span");
    item.className = "grupo";
    const puntos = document.createElement("span");
    puntos.className = "puntos";
    puntos.setAttribute("aria-hidden", "true");
    datos.filter(d => d.grupo === grupo).forEach(d => puntos.append(punto(COLOR[d.categoria])));
    const etiqueta = document.createElement("span");
    etiqueta.textContent = nombre;
    const cifra = document.createElement("strong");
    cifra.textContent = pct(valor);
    item.append(puntos, etiqueta, cifra);
    contenedor.append(item);
  }
}

function nota(renovable) {
  const cuota = nombre => datos.find(d => d.categoria === nombre).cuota;
  const gas = datos.find(d => d.categoria === "Gas y otras no renovables");
  const ciclo = gas && gas.detalle.match(/Ciclo combinado ([\d,]+) %/);

  const p = document.querySelector("#nota");
  p.append(
    "Se lee en el sentido de las agujas del reloj desde las 12: las porciones de color son renovables y las grises, no renovables. " +
    "Juntas, las de color sobrepasan la marca del 50 % y suman un "
  );
  const fuerte = document.createElement("strong");
  fuerte.textContent = `${pct(renovable)} de toda la electricidad generada`;
  p.append(
    fuerte,
    `. La eólica es la tecnología que más produce (${pct(cuota("Eólica"))}), por delante de la nuclear (${pct(cuota("Nuclear"))})` +
    (ciclo ? ` y del ciclo combinado de gas (${ciclo[1]} %)` : "") +
    ". Ese es el mejor uso de un pie: mostrar de un vistazo que unas pocas partes suman más de la mitad del todo."
  );
}

function tabla(total) {
  const cuerpo = d3.select("#tabla tbody");
  const filas = cuerpo.selectAll("tr").data(datos).join("tr");
  filas.append("td").each(function (d) {
    this.append(punto(COLOR[d.categoria]), " ", d.categoria);
  });
  filas.append("td").text(d => d.grupo);
  filas.append("td").attr("class", "num").text(d => f1(d.mwh / 1e6));
  filas.append("td").attr("class", "num").text(d => f1(d.cuota));
  filas.append("td").text(d => d.detalle);

  const pie = d3.select("#tabla tfoot").append("tr");
  pie.append("td").text("Total");
  pie.append("td");
  pie.append("td").attr("class", "num").text(f1(total / 1e6));
  pie.append("td").attr("class", "num").text(f1(100));
  pie.append("td");
}

function medir(texto, fuente) {
  lienzo.font = fuente;
  return lienzo.measureText(texto).width;
}

const textoValor = d => `${pct(d.cuota)} · ${twh(d.mwh)}`;

function dibujar() {
  const ancho = Math.floor(grafico.clientWidth - 32);
  if (ancho === anchoDibujado || ancho <= 0) return;
  anchoDibujado = ancho;
  grafico.replaceChildren();

  const arcos = d3.pie().sort(null).value(d => d.mwh)(datos);

  // Ángulo donde se ancla la etiqueta: el centro de la porción, salvo junto a las 6,
  // donde se aparta de la marca del 50 %.
  arcos.forEach(a => {
    let angulo = (a.startAngle + a.endAngle) / 2;
    if (Math.abs(angulo - Math.PI) < 0.2) {
      const lado = (a.endAngle - Math.PI) >= (Math.PI - a.startAngle) ? 1 : -1;
      angulo = Math.min(Math.max(Math.PI + lado * 0.21, a.startAngle + 0.05), a.endAngle - 0.05);
    }
    a.ancla = angulo;
    a.derecha = Math.sin(angulo) >= 0;
    a.anchoTexto = Math.max(medir(a.data.categoria, FUENTE_NOMBRE), medir(textoValor(a.data), FUENTE_VALOR));
  });

  // Espacio que necesitan las columnas de etiquetas a cada lado del círculo
  const SEPARACION = 56;
  const necesitaIzq = d3.max(arcos.filter(a => !a.derecha), a => a.anchoTexto) + SEPARACION + 8 || 0;
  const necesitaDer = d3.max(arcos.filter(a => a.derecha), a => a.anchoTexto) + SEPARACION + 8 || 0;
  const radioAmplio = Math.min(165, (ancho - necesitaIzq - necesitaDer) / 2);

  if (radioAmplio >= 105) {
    dibujarAmplio(arcos, ancho, radioAmplio, necesitaIzq, necesitaDer, SEPARACION);
  } else {
    dibujarCompacto(arcos, ancho);
  }
}

function crearSvg(ancho, alto) {
  return d3.select(grafico).append("svg")
    .attr("viewBox", `0 0 ${ancho} ${alto}`)
    .attr("width", ancho)
    .attr("height", alto)
    .attr("role", "group")
    .attr("aria-label", "Porciones del gráfico de sectores");
}

function dibujarPorciones(svg, arcos, cx, cy, r) {
  const arco = d3.arc().innerRadius(0).outerRadius(r).padRadius(r).padAngle(2 / r);
  const g = svg.append("g").attr("transform", `translate(${cx},${cy})`);
  const porciones = g.selectAll("path.porcion").data(arcos).join("path")
    .attr("class", "porcion")
    .attr("d", arco)
    .style("fill", a => COLOR[a.data.categoria])
    .attr("tabindex", 0)
    .attr("role", "img")
    .attr("aria-label", a => `${a.data.categoria}: ${pct(a.data.cuota)} (${twh(a.data.mwh)})`);

  const resaltar = actual => porciones.style("opacity", a => (a === actual ? 1 : 0.35));
  const restaurar = () => porciones.style("opacity", null);

  porciones
    .on("pointerenter", (evento, a) => {
      resaltar(a);
      mostrarTooltip(a.data, evento.clientX, evento.clientY);
    })
    .on("pointermove", evento => moverTooltip(evento.clientX, evento.clientY))
    .on("pointerleave", () => {
      restaurar();
      ocultarTooltip();
    })
    .on("focus", (evento, a) => {
      resaltar(a);
      const caja = evento.currentTarget.getBoundingClientRect();
      mostrarTooltip(a.data, caja.left + caja.width / 2, caja.top + caja.height / 2);
    })
    .on("blur", () => {
      restaurar();
      ocultarTooltip();
    });

  // Marca del 50 %: a las 6, justo fuera del círculo
  g.append("line")
    .attr("x1", 0).attr("x2", 0)
    .attr("y1", r + 4).attr("y2", r + 16)
    .style("stroke", "var(--texto-2)")
    .attr("stroke-width", 1);
  g.append("text")
    .attr("x", 6)
    .attr("y", r + 15)
    .attr("font-size", 12)
    .style("fill", "var(--texto-2)")
    .text("50 %");
}

function dibujarAmplio(arcos, ancho, r, necesitaIzq, necesitaDer, separacion) {
  const alto = Math.round(2 * r + 130);
  const sobrante = ancho - necesitaIzq - necesitaDer - 2 * r;
  const cx = necesitaIzq + r + sobrante / 2;
  const cy = alto / 2 - 6;
  const svg = crearSvg(ancho, alto);

  dibujarPorciones(svg, arcos, cx, cy, r);

  // Posición inicial de cada etiqueta: a la altura del codo de su línea guía
  arcos.forEach(a => {
    const s = Math.sin(a.ancla), c = Math.cos(a.ancla);
    a.borde = [cx + (r + 4) * s, cy - (r + 4) * c];
    a.codo = [cx + (r + 18) * s, cy - (r + 18) * c];
    a.y = a.codo[1];
  });

  // Separa las etiquetas de cada lado para que no se pisen
  for (const derecha of [true, false]) {
    const lado = arcos.filter(a => a.derecha === derecha).sort((a, b) => a.y - b.y);
    for (let i = 1; i < lado.length; i++) lado[i].y = Math.max(lado[i].y, lado[i - 1].y + 38);
    const exceso = lado.length ? lado[lado.length - 1].y + 20 - (alto - 4) : 0;
    if (exceso > 0) lado.forEach(a => { a.y -= exceso; });
    for (let i = lado.length - 2; i >= 0; i--) lado[i].y = Math.min(lado[i].y, lado[i + 1].y - 38);
    lado.forEach(a => { a.y = Math.max(a.y, 18); });
  }

  const etiquetas = svg.append("g").attr("aria-hidden", "true")
    .selectAll("g").data(arcos).join("g");

  etiquetas.each(function (a) {
    const g = d3.select(this);
    const columna = a.derecha ? cx + r + separacion - 10 : cx - r - separacion + 10;
    const finGuia = a.derecha ? columna - 9 : columna + 9;

    g.append("polyline")
      .attr("points", [a.borde, a.codo, [finGuia, a.y - 4]].map(p => p.join(",")).join(" "))
      .attr("fill", "none")
      .style("stroke", "var(--linea-base)")
      .attr("stroke-width", 1);

    g.append("circle")
      .attr("cx", columna)
      .attr("cy", a.y - 4.5)
      .attr("r", 5)
      .style("fill", COLOR[a.data.categoria]);

    const x = a.derecha ? columna + 10 : columna - 10;
    const ancla = a.derecha ? "start" : "end";
    g.append("text")
      .attr("x", x)
      .attr("y", a.y)
      .attr("text-anchor", ancla)
      .attr("font-size", 13)
      .attr("font-weight", 600)
      .style("fill", "var(--texto)")
      .text(a.data.categoria);
    g.append("text")
      .attr("x", x)
      .attr("y", a.y + 17)
      .attr("text-anchor", ancla)
      .attr("font-size", 12)
      .style("fill", "var(--texto-2)")
      .text(textoValor(a.data));
  });
}

function dibujarCompacto(arcos, ancho) {
  const r = Math.max(60, Math.min(140, (ancho - 32) / 2));
  const alto = Math.round(2 * r + 44);
  const svg = crearSvg(ancho, alto);
  dibujarPorciones(svg, arcos, ancho / 2, r + 10, r);

  const lista = d3.select(grafico).append("ul").attr("class", "leyenda-compacta");
  const items = lista.selectAll("li").data(arcos).join("li");
  items.each(function (a) {
    this.append(punto(COLOR[a.data.categoria]));
  });
  items.append("span").text(a => a.data.categoria);
  items.append("span").attr("class", "valores").text(a => textoValor(a.data));
}

function mostrarTooltip(d, x, y) {
  const valor = document.createElement("span");
  valor.className = "valor";
  valor.textContent = textoValor(d);

  const etiqueta = document.createElement("span");
  etiqueta.className = "etiqueta";
  const linea = document.createElement("span");
  linea.className = "clave-linea";
  linea.style.background = COLOR[d.categoria];
  etiqueta.append(linea, d.categoria);

  tooltip.replaceChildren(valor, etiqueta);
  if (d.detalle && d.detalle.includes(" + ")) {
    const detalle = document.createElement("span");
    detalle.className = "etiqueta";
    detalle.textContent = d.detalle;
    tooltip.append(detalle);
  }
  tooltip.hidden = false;
  moverTooltip(x, y);
}

function moverTooltip(x, y) {
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
