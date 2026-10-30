# PEC 2 · Visualización de datos

Tres técnicas de visualización aplicadas a datos abiertos, cada una publicada en su propia URL pública con GitHub Pages.

| Técnica | Pregunta | Datos | URL |
|---|---|---|---|
| Pie chart (grupo I) | ¿Qué parte de la electricidad generada en España es ya renovable? | Red Eléctrica, estructura de la generación 2025 | https://ilasierrafc.github.io/pec2-visualizacion/pie/ |
| Flow map (grupo II) | ¿Entre qué comunidades autónomas se muda la gente? | INE, migraciones interautonómicas 2024 | https://ilasierrafc.github.io/pec2-visualizacion/flowmap/ |
| Hyperbolic tree (grupo III) | ¿Cómo se organiza la clasificación oficial de actividades económicas? | INE, estructura de la CNAE-2025 | https://ilasierrafc.github.io/pec2-visualizacion/hypertree/ |

Portada: https://ilasierrafc.github.io/pec2-visualizacion/

## Fuentes de datos

| Fichero | Fuente | Transformación |
|---|---|---|
| `data/generacion_electrica_2025.csv` | [Red Eléctrica · REData](https://www.ree.es/es/datos/generacion/estructura-generacion), estructura de la generación nacional 2025 (API `apidatos.ree.es`) | 13 tecnologías agrupadas en 5 porciones |
| `data/migraciones_ccaa_2024.csv` | [INE · Estadística de Migraciones y Cambios de Residencia](https://www.ine.es/dyngs/Prensa/EMCR2024.htm), tabla 69741 (API JSON del INE) | Matriz origen-destino en formato largo, solo ambos sexos |
| `data/comunidades.geojson` | [Eurostat GISCO](https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/territorial-units-statistics), NUTS 2 2024, escala 1:20M. © EuroGeographics para los límites administrativos | Solo las 19 regiones de España, coordenadas redondeadas |
| `data/cnae2025.csv` | [INE · Estructura completa de la CNAE-2025](https://www.ine.es/daco/daco42/clasificaciones/cnae25/Estructura_CNAE2025.xlsx) | Se añade la columna `padre` a partir del código |

Los ficheros originales descargados están en `data/originales/`.

## Cómo regenerar los datos

```bash
python scripts/preparar_datos.py
```

Solo usa la biblioteca estándar de Python 3.

## Estructura

```
index.html            portada con enlaces a las tres visualizaciones
pie/                  pie chart
flowmap/              flow map
hypertree/            hyperbolic tree (disco de Poincaré, implementación propia)
assets/estilo.css     estilos comunes (modo claro y oscuro)
data/                 datos listos para las visualizaciones
scripts/              script de descarga y preparación de los datos
```

Herramientas: [D3.js v7](https://d3js.org/) y GitHub Pages.
