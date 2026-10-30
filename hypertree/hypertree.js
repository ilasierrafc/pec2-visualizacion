// Hyperbolic tree: estructura de la CNAE-2025 (INE) en el disco de Poincaré.
// Implementación propia: cada nivel se coloca a la misma distancia hiperbólica del
// centro y las traslaciones de Möbius llevan cualquier nodo al centro del disco.

const ANCHO = 800;
const CENTRO = ANCHO / 2;
const R = 360; // radio del disco en unidades del viewBox
const L = 1.15; // distancia hiperbólica entre niveles
const EXPONENTE_PESO = 0.7; // cada rama recibe un ángulo proporcional a (nº de clases)^0.7
const S_MINIMO = 0.004; // por debajo de este factor de escala el nodo no se dibuja
const UMBRAL_ETIQUETA = 0.45;
const UMBRAL_ETIQUETA_CERCANA = 0.15; // para el padre, los antepasados y los hijos del foco
const ALCANCE_ETIQUETA = 1.1; // las etiquetas pueden llegar hasta 1,1 radios del centro
const ANCHO_LETRA = 0.47; // anchura media de un carácter, en em (medida con la fuente del sistema)
const DURACION = 600;
const RADIO_BASE = { raiz: 8, seccion: 7, division: 5.5, grupo: 4.5, clase: 3.5 };
const NIVELES = {
  raiz: ["raíz", "raíz"],
  seccion: ["sección", "secciones"],
  division: ["división", "divisiones"],
  grupo: ["grupo", "grupos"],
  clase: ["clase", "clases"],
};
const ORDEN_NIVELES = ["seccion", "division", "grupo", "clase"];

const es = d3.formatLocale({ decimal: ",", thousands: ".", grouping: [3], currency: ["", " €"] });
const entero = es.format(",d");
const porcentaje = v => `${es.format(".1f")(v)} %`;

const mayuscula = t => t.charAt(0).toUpperCase() + t.slice(1);
const cuantos = (n, nivel) => `${entero(n)} ${NIVELES[nivel][n === 1 ? 0 : 1]}`;
const normalizar = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const nombre = n => (n.data.nivel === "raiz" ? n.data.titulo : `${n.data.codigo} · ${n.data.titulo}`);
const redondear = v => Math.round(v * 10) / 10;

const svg = d3.select("#arbol");
const tooltip = document.querySelector(".tooltip");
const reducirMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let raiz;
let nodos = [];
let foco;
let animacion = null;
let arrastrando = false;
let escalaTexto = 1;
let seleccionAristas;
let seleccionNodos;
let anillo;
let capaEtiquetas;
let etiquetaFoco;

// --- Geometría del disco de Poincaré -------------------------------------------

function acotar(z, maximo = 0.9999) {
  const m = Math.hypot(z[0], z[1]);
  return m > maximo ? [(z[0] * maximo) / m, (z[1] * maximo) / m] : z;
}

// Traslación de Möbius T_a(z) = (z − a) / (1 − ā·z): lleva el punto a al centro
function trasladar(z, a) {
  const nr = z[0] - a[0];
  const ni = z[1] - a[1];
  const dr = 1 - (a[0] * z[0] + a[1] * z[1]);
  const di = -(a[0] * z[1] - a[1] * z[0]);
  const m = dr * dr + di * di;
  return acotar([(nr * dr + ni * di) / m, (ni * dr - nr * di) / m]);
}

const aPantalla = z => [CENTRO + z[0] * R, CENTRO + z[1] * R];
const aDisco = (x, y) => [(x - CENTRO) / R, (y - CENTRO) / R];

// Geodésica entre p y q: arco de la circunferencia ortogonal al borde del disco
function geodesica(p, q) {
  const [x1, y1] = aPantalla(p).map(redondear);
  const [x2, y2] = aPantalla(q).map(redondear);
  const recta = `M${x1},${y1}L${x2},${y2}`;
  const det = p[0] * q[1] - p[1] * q[0];
  if (Math.abs(det) < 1e-9) return recta;
  const kp = (1 + p[0] * p[0] + p[1] * p[1]) / 2;
  const kq = (1 + q[0] * q[0] + q[1] * q[1]) / 2;
  const cx = (kp * q[1] - p[1] * kq) / det;
  const cy = (p[0] * kq - kp * q[0]) / det;
  const radio = redondear(Math.sqrt(cx * cx + cy * cy - 1) * R);
  if (!Number.isFinite(radio) || radio > 1e5) return recta;
  const giro = (p[0] - cx) * (q[1] - cy) - (p[1] - cy) * (q[0] - cx) > 0 ? 1 : 0;
  return `M${x1},${y1}A${radio},${radio} 0 0,${giro} ${x2},${y2}`;
}

// Disposición radial en el plano hiperbólico: profundidad · L desde el centro
function disponer(nodo, a0, a1) {
  const angulo = (a0 + a1) / 2;
  const radio = Math.tanh((nodo.depth * L) / 2);
  nodo.z = [radio * Math.cos(angulo), radio * Math.sin(angulo)];
  if (!nodo.children) return;
  const pesos = nodo.children.map(h => Math.pow(Math.max(1, h.cuenta.clase), EXPONENTE_PESO));
  const total = d3.sum(pesos);
  let inicio = a0;
  nodo.children.forEach((hijo, i) => {
    const amplitud = ((a1 - a0) * pesos[i]) / total;
    disponer(hijo, inicio, inicio + amplitud);
    inicio += amplitud;
  });
}

// --- Dibujo ---------------------------------------------------------------------

function construirSvg() {
  svg.append("circle").attr("class", "disco").attr("cx", CENTRO).attr("cy", CENTRO).attr("r", R);
  seleccionAristas = svg
    .append("g")
    .selectAll("path")
    .data(nodos.filter(n => n.parent))
    .join("path")
    .attr("class", "arista");
  seleccionNodos = svg
    .append("g")
    .selectAll("circle")
    .data(nodos)
    .join("circle")
    .attr("class", d => `nodo ${d.data.nivel}`)
    .on("pointerenter", (evento, d) => {
      if (!arrastrando) mostrarTooltip(d, evento.clientX, evento.clientY);
    })
    .on("pointermove", evento => {
      if (!arrastrando && !tooltip.hidden) moverTooltip(evento.clientX, evento.clientY);
    })
    .on("pointerleave", ocultarTooltip)
    .on("click", (evento, d) => enfocar(d));
  anillo = svg.append("circle").attr("class", "anillo");
  capaEtiquetas = svg.append("g");
  etiquetaFoco = svg.append("text").attr("class", "etiqueta-nodo etiqueta-foco halo").attr("text-anchor", "middle");
}

function pintar() {
  for (const n of nodos) n.s = 1 - (n.z[0] * n.z[0] + n.z[1] * n.z[1]);

  seleccionAristas.each(function (d) {
    const visible = d.s >= S_MINIMO || d.parent.s >= S_MINIMO;
    this.style.display = visible ? "" : "none";
    if (!visible) return;
    this.setAttribute("d", geodesica(d.parent.z, d.z));
    this.style.strokeWidth = `${Math.max(0.4, 1.4 * d.s)}px`;
  });

  seleccionNodos.each(function (d) {
    const visible = d.s >= S_MINIMO;
    this.style.display = visible ? "" : "none";
    if (!visible) return;
    const [x, y] = aPantalla(d.z);
    this.setAttribute("cx", redondear(x));
    this.setAttribute("cy", redondear(y));
    this.setAttribute("r", Math.max(0.6, RADIO_BASE[d.data.nivel] * d.s));
  });

  const [fx, fy] = aPantalla(foco.z);
  const radioFoco = RADIO_BASE[foco.data.nivel] * foco.s;
  anillo.attr("cx", fx).attr("cy", fy).attr("r", radioFoco + 3);
  etiquetaFoco
    .attr("x", fx)
    .attr("y", fy - radioFoco - 10 * escalaTexto)
    .style("font-size", `${15 * escalaTexto}px`)
    .text(recortar(nombre(foco), 50));

  pintarEtiquetas();
}

function recortar(texto, maximo) {
  return texto.length <= maximo ? texto : `${texto.slice(0, Math.max(1, maximo - 1)).trimEnd()}…`;
}

// Recorta "código · título" al espacio radial disponible hasta el borde;
// si del título solo cabría un trozo muy corto, se deja únicamente el código
function textoEtiqueta(n, sitio, fuente) {
  const completo = nombre(n);
  const caben = Math.floor(sitio / (fuente * ANCHO_LETRA));
  if (caben >= completo.length) return completo;
  const codigo = n.data.nivel === "raiz" ? n.data.titulo : n.data.codigo;
  if (caben >= codigo.length + 13) return recortar(completo, caben);
  if (caben >= codigo.length) return codigo;
  return null;
}

function diferenciaAngular(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function pintarEtiquetas() {
  const cercanos = new Set([...foco.ancestors(), ...(foco.children || [])]);
  const candidatos = nodos.filter(
    n => n !== foco && (n.s > UMBRAL_ETIQUETA || (cercanos.has(n) && n.s > UMBRAL_ETIQUETA_CERCANA))
  );
  candidatos.sort((a, b) => cercanos.has(b) - cercanos.has(a) || b.s - a.s);

  // Etiquetas radiales; se descarta la que se solape con otra ya colocada
  const colocadas = [];
  for (const n of candidatos) {
    const distancia = Math.hypot(n.z[0], n.z[1]) * R;
    const fuente = (8 + 6 * n.s) * escalaTexto;
    const separacion = RADIO_BASE[n.data.nivel] * n.s + 4;
    const texto = textoEtiqueta(n, ALCANCE_ETIQUETA * R - distancia - separacion, fuente);
    if (!texto) continue;
    const angulo = Math.atan2(n.z[1], n.z[0]);
    const semiAltura = (fuente * 0.6) / Math.max(distancia, 1);
    const r0 = distancia + separacion;
    const r1 = r0 + texto.length * fuente * ANCHO_LETRA;
    const choca = colocadas.some(
      o => Math.abs(diferenciaAngular(o.angulo, angulo)) < o.semiAltura + semiAltura && r0 < o.r1 && o.r0 < r1
    );
    if (!choca) colocadas.push({ n, texto, fuente, separacion, angulo, semiAltura, r0, r1 });
  }

  capaEtiquetas
    .selectAll("text")
    .data(colocadas, d => d.n.id)
    .join("text")
    .attr("class", "etiqueta-nodo halo")
    .attr("dy", "0.32em")
    .each(function (d) {
      const [x, y] = aPantalla(d.n.z);
      const izquierda = Math.cos(d.angulo) < 0;
      const grados = (d.angulo * 180) / Math.PI + (izquierda ? 180 : 0);
      this.setAttribute("transform", `translate(${redondear(x)},${redondear(y)}) rotate(${redondear(grados)})`);
      this.setAttribute("x", redondear(izquierda ? -d.separacion : d.separacion));
      this.setAttribute("text-anchor", izquierda ? "end" : "start");
      this.style.fontSize = `${redondear(d.fuente)}px`;
      this.textContent = d.texto;
    });
}

// --- Interacción ----------------------------------------------------------------

function detenerAnimacion() {
  if (animacion) animacion.stop();
  animacion = null;
}

// Lleva el nodo al centro moviéndose por la geodésica que lo une con el centro
function enfocar(nodo, desdePanel = false) {
  detenerAnimacion();
  foco = nodo;
  actualizarPanel(desdePanel);
  const p = nodo.z;
  const m = Math.hypot(p[0], p[1]);
  if (m < 1e-9) {
    pintar();
    return;
  }
  const inicio = nodos.map(n => n.z);
  const tope = Math.atanh(Math.min(m, 0.9999));
  const aplicar = t => {
    const k = Math.tanh(t * tope) / m;
    const a = [p[0] * k, p[1] * k];
    nodos.forEach((n, i) => {
      n.z = trasladar(inicio[i], a);
    });
    pintar();
  };
  if (reducirMovimiento) {
    aplicar(1);
    return;
  }
  animacion = d3.timer(transcurrido => {
    const t = Math.min(1, transcurrido / DURACION);
    aplicar(d3.easeCubicInOut(t));
    if (t === 1) detenerAnimacion();
  });
}

function configurarArrastre() {
  let inicio = null;
  let origen = null;
  svg.call(
    d3
      .drag()
      .container(function () {
        return this;
      })
      .clickDistance(4)
      .on("start", evento => {
        detenerAnimacion();
        inicio = nodos.map(n => n.z);
        origen = acotar(aDisco(evento.x, evento.y), 0.95);
      })
      .on("drag", evento => {
        if (!arrastrando) {
          arrastrando = true;
          svg.classed("arrastrando", true);
          ocultarTooltip();
        }
        // z → T_{−e}(T_s(z)): el punto donde empezó el arrastre sigue al puntero
        const destino = acotar(aDisco(evento.x, evento.y), 0.95);
        const opuesto = [-destino[0], -destino[1]];
        nodos.forEach((n, i) => {
          n.z = trasladar(trasladar(inicio[i], origen), opuesto);
        });
        pintar();
      })
      .on("end", () => {
        if (!arrastrando) return;
        arrastrando = false;
        svg.classed("arrastrando", false);
        // El panel pasa a describir el nodo que ha quedado en el centro
        const centrado = d3.least(nodos, n => n.z[0] * n.z[0] + n.z[1] * n.z[1]);
        if (centrado !== foco && 1 - centrado.s < 0.09) {
          foco = centrado;
          actualizarPanel();
          pintar();
        }
      })
  );
}

function mostrarTooltip(n, x, y) {
  const valor = document.createElement("span");
  valor.className = "valor";
  valor.textContent = nombre(n);
  const etiqueta = document.createElement("span");
  etiqueta.className = "etiqueta";
  const nivel = mayuscula(NIVELES[n.data.nivel][0]);
  etiqueta.textContent = n.children ? `${nivel} · ${cuantos(n.cuenta.clase, "clase")}` : nivel;
  tooltip.replaceChildren(valor, etiqueta);
  tooltip.hidden = false;
  moverTooltip(x, y);
}

function moverTooltip(x, y) {
  const caja = tooltip.getBoundingClientRect();
  let izquierda = x + 14;
  let arriba = y + 14;
  if (izquierda + caja.width > window.innerWidth - 8) izquierda = x - caja.width - 14;
  if (arriba + caja.height > window.innerHeight - 8) arriba = y - caja.height - 14;
  tooltip.style.left = `${Math.max(8, izquierda)}px`;
  tooltip.style.top = `${Math.max(8, arriba)}px`;
}

function ocultarTooltip() {
  tooltip.hidden = true;
}

// Con el teclado, el tooltip aparece junto al nodo del botón enfocado
function tooltipEnNodo(n) {
  if (n.s < S_MINIMO) return;
  const caja = seleccionNodos.filter(d => d === n).node().getBoundingClientRect();
  mostrarTooltip(n, caja.left + caja.width / 2, caja.top + caja.height / 2);
}

function boton(texto, alPulsar) {
  const elemento = document.createElement("button");
  elemento.type = "button";
  elemento.textContent = texto;
  elemento.addEventListener("click", alPulsar);
  return elemento;
}

function recuento(n) {
  const total = raiz.cuenta.clase;
  if (!n.children) return `Último nivel · 1 de las ${entero(total)} clases`;
  const partes = ORDEN_NIVELES.filter(nivel => n.cuenta[nivel] > 0).map(nivel => cuantos(n.cuenta[nivel], nivel));
  if (n !== raiz) partes.push(`${porcentaje((n.cuenta.clase / total) * 100)} de todas las clases`);
  return partes.join(" · ");
}

function actualizarPanel(desdePanel = false) {
  const ruta = document.querySelector("#ruta");
  ruta.replaceChildren();
  foco
    .ancestors()
    .reverse()
    .forEach((n, i) => {
      if (i > 0) {
        const separador = document.createElement("span");
        separador.textContent = "›";
        separador.setAttribute("aria-hidden", "true");
        ruta.append(separador);
      }
      const texto = n.data.nivel === "raiz" ? n.data.titulo : n.data.codigo;
      if (n === foco) {
        const actual = document.createElement("span");
        actual.textContent = texto;
        actual.setAttribute("aria-current", "location");
        ruta.append(actual);
      } else {
        const enlace = boton(texto, () => enfocar(n, true));
        enlace.title = nombre(n);
        ruta.append(enlace);
      }
    });

  document.querySelector("#nivel-foco").textContent = mayuscula(NIVELES[foco.data.nivel][0]);
  document.querySelector("#titulo-foco").textContent = nombre(foco);
  document.querySelector("#recuento-foco").textContent = recuento(foco);

  const lista = document.querySelector("#hijos");
  lista.replaceChildren();
  for (const hijo of foco.children || []) {
    const elemento = boton(nombre(hijo), () => enfocar(hijo, true));
    if (hijo.children) {
      const cuenta = document.createElement("span");
      cuenta.className = "cuenta";
      cuenta.textContent = cuantos(hijo.cuenta.clase, "clase");
      elemento.append(cuenta);
    }
    elemento.addEventListener("focus", () => {
      if (elemento.matches(":focus-visible")) tooltipEnNodo(hijo);
    });
    elemento.addEventListener("blur", ocultarTooltip);
    const item = document.createElement("li");
    item.append(elemento);
    lista.append(item);
  }
  document.querySelector("#titulo-hijos").hidden = !foco.children;
  document.querySelector("#sin-hijos").hidden = Boolean(foco.children);

  // Tras navegar desde el panel, el teclado sigue dentro del panel
  if (desdePanel) {
    const destino = lista.querySelector("button") || ruta.querySelector("button:last-of-type");
    if (destino) destino.focus();
  }
}

function buscar(texto) {
  const consulta = normalizar(texto.trim());
  if (!consulta) return null;
  const exacto = nodos.find(n => normalizar(n.data.codigo) === consulta || normalizar(nombre(n)) === consulta);
  if (exacto) return exacto;
  const encontrados = nodos.filter(
    n => normalizar(n.data.codigo).startsWith(consulta) || normalizar(n.data.titulo).includes(consulta)
  );
  const empieza = n => (normalizar(n.data.titulo).startsWith(consulta) ? 0 : 1);
  encontrados.sort((a, b) => empieza(a) - empieza(b) || a.depth - b.depth);
  return encontrados[0] || null;
}

function configurarBuscador() {
  const opciones = document.querySelector("#opciones-cnae");
  const porNombre = new Map();
  for (const n of nodos) {
    const opcion = document.createElement("option");
    opcion.value = nombre(n);
    opciones.append(opcion);
    porNombre.set(nombre(n), n);
  }
  const entrada = document.querySelector("#buscar");
  const aviso = document.querySelector("#aviso-busqueda");
  entrada.addEventListener("input", () => {
    aviso.textContent = "";
    const elegido = porNombre.get(entrada.value);
    if (elegido) enfocar(elegido);
  });
  entrada.addEventListener("keydown", evento => {
    if (evento.key !== "Enter") return;
    evento.preventDefault();
    const encontrado = buscar(entrada.value);
    aviso.textContent = encontrado ? "" : "Sin resultados";
    if (encontrado) enfocar(encontrado);
  });
  document.querySelector("#volver-raiz").addEventListener("click", () => enfocar(raiz));
}

function construirTabla() {
  const cuerpo = document.querySelector("#cuerpo-tabla");
  if (cuerpo.childElementCount) return;
  const filas = document.createDocumentFragment();
  raiz.eachBefore(n => {
    const fila = document.createElement("tr");
    const codigo = document.createElement("td");
    codigo.textContent = n.data.codigo;
    const nivel = document.createElement("td");
    nivel.textContent = mayuscula(NIVELES[n.data.nivel][0]);
    const titulo = document.createElement("td");
    titulo.className = "titulo-arbol";
    titulo.style.paddingLeft = `${8 + n.depth * 14}px`;
    titulo.textContent = n.data.titulo;
    fila.append(codigo, nivel, titulo);
    filas.append(fila);
  });
  cuerpo.append(filas);
}

function rellenarDatos() {
  const seccion = codigo => raiz.children.find(n => n.data.codigo === codigo);
  const [c, k, g] = ["C", "K", "G"].map(seccion);
  const datos = {
    nodos: entero(nodos.length),
    secciones: entero(raiz.cuenta.seccion),
    divisiones: entero(raiz.cuenta.division),
    grupos: entero(raiz.cuenta.grupo),
    clases: entero(raiz.cuenta.clase),
    divisionesC: entero(c.cuenta.division),
    clasesC: entero(c.cuenta.clase),
    pctC: porcentaje((c.cuenta.clase / raiz.cuenta.clase) * 100),
    clasesK: entero(k.cuenta.clase),
    clasesG: entero(g.cuenta.clase),
    divisionesG: entero(g.cuenta.division),
  };
  document.querySelectorAll("[data-dato]").forEach(elemento => {
    if (elemento.dataset.dato in datos) elemento.textContent = datos[elemento.dataset.dato];
  });
}

// En pantallas estrechas el SVG se encoge: se agranda el texto para que siga legible
function ajustarEscala() {
  const ancho = svg.node().getBoundingClientRect().width || ANCHO;
  escalaTexto = Math.min(1.9, Math.max(1, ANCHO / ancho));
  seleccionNodos.style("stroke-width", `${10 * escalaTexto}px`);
}

d3.csv("../data/cnae2025.csv")
  .then(filas => {
    raiz = d3
      .stratify()
      .id(d => d.codigo)
      .parentId(d => d.padre || null)(filas);
    raiz.eachAfter(n => {
      n.cuenta = { seccion: 0, division: 0, grupo: 0, clase: 0 };
      for (const hijo of n.children || []) {
        for (const nivel of ORDEN_NIVELES) n.cuenta[nivel] += hijo.cuenta[nivel];
        n.cuenta[hijo.data.nivel] += 1;
      }
    });
    nodos = raiz.descendants();
    disponer(raiz, -Math.PI / 2, (3 * Math.PI) / 2);
    foco = raiz;

    construirSvg();
    configurarArrastre();
    configurarBuscador();
    rellenarDatos();
    ajustarEscala();
    actualizarPanel();
    pintar();

    document.querySelector("#detalle-tabla").addEventListener("toggle", evento => {
      if (evento.target.open) construirTabla();
    });
    window.addEventListener("resize", () => {
      ajustarEscala();
      pintar();
    });
  })
  .catch(error => {
    console.error(error);
    document.querySelector("#titulo-foco").textContent = "No se han podido cargar los datos";
  });
