"""Descarga los datos abiertos de la PEC 2 y los deja listos para las visualizaciones.

Fuentes:
  - Red Eléctrica (REData): estructura de la generación eléctrica nacional, 2025.
  - INE, Estadística de Migraciones y Cambios de Residencia (tabla 69741):
    migraciones interautonómicas por comunidad de procedencia y destino, 2024.
  - Eurostat GISCO: límites de las regiones NUTS 2 (= comunidades autónomas), 2024.
  - INE: estructura completa de la CNAE-2025.

Uso:  python scripts/preparar_datos.py
Los ficheros descargados se guardan sin modificar en data/originales/ y los
ficheros que usan las páginas web se escriben en data/.
"""

import csv
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

RAIZ = Path(__file__).resolve().parent.parent
DATOS = RAIZ / "data"
ORIGINALES = DATOS / "originales"

URL_REE = (
    "https://apidatos.ree.es/es/datos/generacion/estructura-generacion"
    "?start_date=2025-01-01T00:00&end_date=2025-12-31T23:59&time_trunc=year"
    "&geo_trunc=electric_system&geo_limit=nacional&geo_ids=8741"
)
URL_INE_MIGRACIONES = "https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/69741?nult=1&tip=M"
URL_GISCO = (
    "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/"
    "NUTS_RG_20M_2024_4326_LEVL_2.geojson"
)
URL_CNAE = "https://www.ine.es/daco/daco42/clasificaciones/cnae25/Estructura_CNAE2025.xlsx"

# Nombre en el INE -> (código NUTS 2, nombre corto para el mapa)
COMUNIDADES = {
    "Andalucía": ("ES61", "Andalucía"),
    "Aragón": ("ES24", "Aragón"),
    "Asturias, Principado de": ("ES12", "Asturias"),
    "Balears, Illes": ("ES53", "Illes Balears"),
    "Canarias": ("ES70", "Canarias"),
    "Cantabria": ("ES13", "Cantabria"),
    "Castilla y León": ("ES41", "Castilla y León"),
    "Castilla - La Mancha": ("ES42", "Castilla-La Mancha"),
    "Cataluña": ("ES51", "Cataluña"),
    "Comunitat Valenciana": ("ES52", "C. Valenciana"),
    "Extremadura": ("ES43", "Extremadura"),
    "Galicia": ("ES11", "Galicia"),
    "Madrid, Comunidad de": ("ES30", "Madrid"),
    "Murcia, Región de": ("ES62", "Murcia"),
    "Navarra, Comunidad Foral de": ("ES22", "Navarra"),
    "País Vasco": ("ES21", "País Vasco"),
    "Rioja, La": ("ES23", "La Rioja"),
    "Ceuta": ("ES63", "Ceuta"),
    "Melilla": ("ES64", "Melilla"),
}

# Agrupación de las tecnologías de REE en cinco porciones (máximo recomendado para un pie)
GRUPOS_GENERACION = [
    ("Eólica", "Renovable", {"Eólica"}),
    ("Solar", "Renovable", {"Solar fotovoltaica", "Solar térmica"}),
    ("Hidráulica y otras renovables", "Renovable", None),  # resto de renovables
    ("Gas y otras no renovables", "No renovable", None),  # resto de no renovables
    ("Nuclear", "No renovable", {"Nuclear"}),
]


def descargar(url, destino):
    peticion = urllib.request.Request(url, headers={"User-Agent": "pec2-visualizacion (UOC)"})
    with urllib.request.urlopen(peticion, timeout=120) as respuesta:
        contenido = respuesta.read()
    destino.write_bytes(contenido)
    print(f"  descargado {destino.name} ({len(contenido) / 1024:.0f} KB)")
    return contenido


def escribir_csv(ruta, columnas, filas):
    with open(ruta, "w", newline="", encoding="utf-8") as f:
        escritor = csv.writer(f)
        escritor.writerow(columnas)
        escritor.writerows(filas)
    print(f"  escrito {ruta.relative_to(RAIZ)} ({len(filas)} filas)")


def generacion_electrica():
    print("Pie chart · generación eléctrica 2025 (REE)")
    datos = json.loads(descargar(URL_REE, ORIGINALES / "ree_estructura_generacion_2025.json"))
    tecnologias = []
    total = None
    for item in datos["included"]:
        atributos = item["attributes"]
        mwh = atributos["values"][0]["value"]
        if atributos["title"] == "Generación total":
            total = mwh
        else:
            renovable = atributos["type"] == "Renovable"
            tecnologias.append((atributos["title"], "Renovable" if renovable else "No renovable", mwh))

    filas = []
    for categoria, grupo, incluidas in GRUPOS_GENERACION:
        if incluidas is None:
            asignadas = {t for g in GRUPOS_GENERACION if g[2] for t in g[2]}
            miembros = [t for t in tecnologias if t[1] == grupo and t[0] not in asignadas]
        else:
            miembros = [t for t in tecnologias if t[0] in incluidas]
        mwh = sum(t[2] for t in miembros)
        detalle = " + ".join(
            f"{t[0]} {t[2] / total * 100:.1f} %".replace(".", ",")
            for t in sorted(miembros, key=lambda t: -t[2])
            if t[2] > 0
        )
        filas.append([categoria, grupo, round(mwh), round(mwh / total * 100, 2), detalle])

    suma = sum(f[2] for f in filas)
    assert abs(suma - total) < 1, f"las porciones ({suma}) no suman el total ({total})"
    escribir_csv(
        DATOS / "generacion_electrica_2025.csv",
        ["categoria", "grupo", "mwh", "porcentaje", "detalle"],
        filas,
    )
    renovable = sum(f[3] for f in filas if f[1] == "Renovable")
    print(f"  total {total / 1e6:.1f} TWh · renovables {renovable:.1f} %")


def migraciones():
    print("Flow map · migraciones interautonómicas 2024 (INE)")
    series = json.loads(
        descargar(URL_INE_MIGRACIONES, ORIGINALES / "ine_69741_migraciones_interautonomicas.json")
    )
    # Identificadores de variable del INE: 96 = residencia/origen, 1030 = lugar de destino, 18 = sexo
    flujos = []
    for serie in series:
        metadatos = {m["FK_Variable"]: m["Nombre"] for m in serie["MetaData"]}
        origen, destino, sexo = metadatos[96], metadatos[1030], metadatos[18]
        if sexo != "Ambos sexos" or "Total Nacional" in (origen, destino) or origen == destino:
            continue
        dato = serie["Data"][0]
        flujos.append((origen, destino, int(dato["Valor"]), dato["Anyo"]))

    desconocidas = {n for f in flujos for n in f[:2]} - COMUNIDADES.keys()
    assert not desconocidas, f"comunidades sin código NUTS: {desconocidas}"
    flujos.sort(key=lambda f: -f[2])
    escribir_csv(
        DATOS / "migraciones_ccaa_2024.csv",
        ["origen_id", "origen", "destino_id", "destino", "personas", "anyo"],
        [
            [COMUNIDADES[o][0], COMUNIDADES[o][1], COMUNIDADES[d][0], COMUNIDADES[d][1], n, a]
            for o, d, n, a in flujos
        ],
    )
    print(f"  {len(flujos)} flujos · {sum(f[2] for f in flujos):,} personas".replace(",", "."))


def limites_comunidades():
    print("Flow map · límites de las comunidades (Eurostat GISCO, NUTS 2)")
    europa = json.loads(descargar(URL_GISCO, ORIGINALES / "NUTS_RG_20M_2024_4326_LEVL_2.geojson"))
    nombres = {codigo: nombre for codigo, nombre in COMUNIDADES.values()}

    def redondear(coordenadas):
        if isinstance(coordenadas[0], (int, float)):
            return [round(coordenadas[0], 4), round(coordenadas[1], 4)]
        return [redondear(c) for c in coordenadas]

    regiones = []
    for f in europa["features"]:
        codigo = f["properties"]["NUTS_ID"]
        if codigo in nombres:
            geometria = dict(f["geometry"], coordinates=redondear(f["geometry"]["coordinates"]))
            regiones.append(
                {"type": "Feature", "properties": {"id": codigo, "nombre": nombres[codigo]}, "geometry": geometria}
            )
    assert len(regiones) == len(nombres), "faltan comunidades en el fichero de GISCO"
    ruta = DATOS / "comunidades.geojson"
    ruta.write_text(json.dumps({"type": "FeatureCollection", "features": regiones}), encoding="utf-8")
    print(f"  escrito {ruta.relative_to(RAIZ)} ({ruta.stat().st_size / 1024:.0f} KB)")
    # El fichero europeo completo no hace falta en el repositorio
    (ORIGINALES / "NUTS_RG_20M_2024_4326_LEVL_2.geojson").unlink()


def leer_xlsx(ruta, hoja):
    """Lee una hoja de un .xlsx con la biblioteca estándar (sin pandas)."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    libro = zipfile.ZipFile(ruta)
    compartidas = [
        "".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t"))
        for si in ET.fromstring(libro.read("xl/sharedStrings.xml")).findall("m:si", ns)
    ]
    nombres = [s.get("name") for s in ET.fromstring(libro.read("xl/workbook.xml")).find("m:sheets", ns)]
    hoja_xml = ET.fromstring(libro.read(f"xl/worksheets/sheet{nombres.index(hoja) + 1}.xml"))
    filas = []
    for fila in hoja_xml.iter(f"{{{ns['m']}}}row"):
        valores = {}
        for celda in fila.findall("m:c", ns):
            columna = re.match(r"[A-Z]+", celda.get("r")).group(0)
            valor = celda.find("m:v", ns)
            if valor is None:
                continue
            valores[columna] = compartidas[int(valor.text)] if celda.get("t") == "s" else valor.text
        filas.append(valores)
    return filas


def frase(titulo):
    """'AGRICULTURA, GANADERÍA ...' -> 'Agricultura, ganadería ...' (las secciones vienen en mayúsculas)."""
    return titulo[:1] + titulo[1:].lower() if titulo.isupper() else titulo


def cnae():
    print("Hyperbolic tree · estructura de la CNAE-2025 (INE)")
    ruta = ORIGINALES / "Estructura_CNAE2025.xlsx"
    descargar(URL_CNAE, ruta)
    filas = [["CNAE", "", "raiz", "CNAE-2025"]]
    seccion = None
    for fila in leer_xlsx(ruta, "Estructura_CNAE2025")[1:]:
        codigo, titulo = fila.get("A", "").strip(), fila.get("B", "").strip()
        if not codigo:
            continue
        if re.fullmatch(r"[A-Z]", codigo):
            seccion = codigo
            filas.append([codigo, "CNAE", "seccion", frase(titulo)])
        elif re.fullmatch(r"\d\d", codigo):
            filas.append([codigo, seccion, "division", titulo])
        elif re.fullmatch(r"\d\d\.\d", codigo):
            filas.append([codigo, codigo[:2], "grupo", titulo])
        elif re.fullmatch(r"\d\d\.\d\d", codigo):
            filas.append([codigo, codigo[:4], "clase", titulo])
        else:
            raise ValueError(f"código CNAE no reconocido: {codigo!r}")
    escribir_csv(DATOS / "cnae2025.csv", ["codigo", "padre", "nivel", "titulo"], filas)
    niveles = {}
    for f in filas:
        niveles[f[2]] = niveles.get(f[2], 0) + 1
    print("  " + " · ".join(f"{n} {k}" for k, n in niveles.items()))


if __name__ == "__main__":
    ORIGINALES.mkdir(parents=True, exist_ok=True)
    generacion_electrica()
    migraciones()
    limites_comunidades()
    cnae()
