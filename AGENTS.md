# AGENTS.md

## Resumen Del Proyecto

`Sticker Tracker 2026` es una app web mobile-first hecha con `React + Vite`
para llevar control personal de una coleccion de estampitas del album base
2026.

La app permite:

- Cargar el checklist base desde
  `public/data/checklist_mundial_2026_base_980_template.json`.
- Marcar estampitas como tenidas o faltantes.
- Registrar repetidas por estampita.
- Marcar una estampa como pegada fisicamente en el album.
- Proteger cartas pegadas para que no vuelvan a faltantes por accidente.
- Ver progreso general, faltantes, repetidas y ruedas visuales de resumen.
- Navegar por `Inicio`, `Mi album`, `Faltantes`, `Repetidas` y `Ajustes`.
- Buscar por codigo, equipo, jugador o tipo.
- Filtrar el album por `Todas`, `Tengo`, `Faltan` y `Repetidas`.
- Guardar progreso, filtro activo, pestana activa, seccion abierta,
  personalizacion visual y preferencia de sonido en `localStorage`.
- Exportar e importar respaldo JSON.

Importante:

- Es una herramienta no oficial.
- No usar logos oficiales, escudos oficiales ni imagenes protegidas.
- Las banderas se derivan por codigo de pais con `flagcdn.com`.
- El foco visual debe sentirse como app de coleccionista e intercambio, no como
  dashboard corporativo.
- Mobile-first siempre.
- La app debe mantenerse compacta y usable en telefono angosto.

---

## Stack Y Comandos

- Framework: `React + Vite`.
- Entrada HTML: `index.html`.
- Entrada React: `src/main.jsx`.
- Estilos: `src/styles.css`.
- Dependencias nuevas: evitar agregarlas salvo que sean claramente necesarias.

Comando principal de verificacion:

```bash
npm.cmd run build
```

Para cambios visuales importantes, tambien revisar en viewport movil real o con
dev server:

```bash
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

---

## Arquitectura General

### Entrada Principal

- `src/main.jsx`
  Monta React.

- `src/App.jsx`
  Orquesta la app completa:
  - carga el JSON base
  - carga, normaliza y guarda la coleccion
  - maneja tabs de navegacion
  - guarda tab activa
  - guarda filtro activo de `Mi album`
  - guarda seccion abierta
  - sincroniza secciones abiertas con historial del navegador
  - maneja sonidos y mute global
  - maneja pulsos visuales de tabs
  - maneja saltos desde Faltantes/Repetidas hacia Mi album con resaltado
  - maneja estado `targetStickerCode` y `targetStickerTransition`
  - maneja pegar/despegar cartas con `pasted`
  - pasa props compartidas a las paginas

### Paginas

- `src/pages/HomePage.jsx`
  Inicio compacto. Contiene:
  - `ProgressCard`
  - portada de album personalizable
  - acciones laterales de personalizacion
  - bottom sheet de color
  - bottom sheet de banderas
  - ruedas estadisticas informativas

- `src/pages/AlbumPage.jsx`
  Experiencia central del album:
  - buscador
  - filtros
  - tarjeta de progreso
  - indice por seccion/pais
  - vista abierta de seccion
  - navegacion por flechas y swipe
  - scroll/resaltado de carta objetivo

- `src/pages/MissingPage.jsx`
  Vista de faltantes:
  - resumen
  - copiar lista
  - compartir por WhatsApp
  - indice por seccion
  - vista de cartas faltantes por seccion
  - salto a Mi album al tocar carta faltante

- `src/pages/DuplicatesPage.jsx`
  Vista de repetidas:
  - resumen
  - copiar lista
  - compartir por WhatsApp
  - indice por seccion
  - vista de cartas repetidas por seccion
  - quitar repetida y saltar a Mi album al tocar carta repetida

- `src/pages/SettingsPage.jsx`
  Ajustes:
  - toggle global de sonidos
  - exportar respaldo JSON
  - importar respaldo JSON
  - reiniciar coleccion con confirmacion
  - aviso de herramienta no oficial

### Componentes

- `src/components/ProgressCard.jsx`
  Tarjeta compacta de progreso general usada en Inicio.

- `src/components/BottomNav.jsx`
  Navegacion inferior fija. Labels:
  `Inicio`, `Mi album`, `Faltantes`, `Repetidas`, `Ajustes`.

- `src/components/SearchBar.jsx`
  Busqueda y filtros visuales:
  `Todas`, `Tengo`, `Faltan`, `Repetidas`.

- `src/components/StickerCard.jsx`
  Tarjeta individual. Tiene variante default y variante `album-grid`.
  La variante `album-grid` cambia apariencia/comportamiento segun `context`:
  album normal, `missing` o `duplicates`.

- `src/components/TeamSection.jsx`
  Bloques por equipo/seccion heredados. La experiencia principal hoy vive en
  `AlbumPage.jsx`.

### Utilidades

- `src/utils/collectionStats.js`
  Calculos, filtros, busqueda, agrupacion por secciones y banderas derivadas.

- `src/utils/teamAccents.js`
  Colores de acento por pais/seccion.

- `src/utils/progressDisplay.js`
  Ancho visual minimo para barras de progreso.

- `src/utils/exportText.js`
  Texto para copiar o compartir faltantes/repetidas.

- `src/utils/sounds.js`
  Sonidos generados con Web Audio. No usa archivos de audio.

- `src/hooks/useSwipe.js`
  Swipe horizontal para moverse entre paises/secciones abiertas.

- `src/storage/localCollection.js`
  Normalizacion, carga, guardado, export e import de coleccion.

---

## Persistencia En LocalStorage

Claves actuales:

- `sticker-tracker-2026-collection`
  Coleccion normalizada:
  `{ [code]: { owned, duplicates, pasted } }`.

- `sticker-tracker-tab`
  Ultima tab activa.

- `sticker-tracker-section`
  Seccion abierta actualmente.

- `sticker-tracker-album-filter`
  Filtro activo de `Mi album`: `all`, `owned`, `missing` o `duplicates`.

- `sticker-tracker-2026-book-customization`
  Personalizacion de portada:
  `bookColor`, `hasCustomBookColor`, `bookFlags`.

- `sticker-tracker-2026-sound-enabled`
  Preferencia global de sonidos. Por defecto esta activada salvo que sea
  `"false"`.

Reglas de normalizacion de coleccion:

- `duplicates` siempre se normaliza a numero entero no negativo.
- Si `duplicates > 0`, la carta se considera `owned`.
- Si `pasted === true`, la carta se considera `owned`.
- Si una entrada no esta `owned`, tiene `duplicates === 0` y no esta `pasted`,
  se elimina del objeto guardado.
- Si una carta deja de estar `owned`, `pasted` debe pasar a `false`.
- Export/import conserva `owned`, `duplicates` y `pasted`.

---

## Estado Global En App.jsx

Estados importantes:

- `activeTab`
  Tab actual.

- `selectedSectionId`
  Seccion abierta compartida por Mi album, Faltantes y Repetidas.

- `albumFilter`
  Filtro persistente de Mi album.

- `targetStickerCode`
  Carta que debe resaltarse al saltar desde Faltantes/Repetidas.

- `targetStickerTransition`
  Badge temporal para cambios de repetidas: `xN -> xN-1`.

- `highlightedTabId`
  Tab que pulsa temporalmente.

- `isSoundEnabled`
  Preferencia global de sonidos.

- `collection`
  Estado de coleccion normalizado.

Reglas:

- `handleToggleOwned` no debe quitar una carta si esta `pasted`.
- `handleTogglePasted` solo actua si la carta ya esta `owned`.
- Pegar reproduce sonido `paste`.
- Despegar no reproduce sonido.
- Al sumar repetidas con `+`, siempre pulsa la tab `Repetidas`.
- Al navegar desde Inicio a Mi album, suena `page` y se cierra seccion abierta.
- Al tocar `Inicio`, se cierran secciones y se limpian targets.
- Si el filtro de Mi album es `missing` o `duplicates`, al tocar cualquier tab
  del navbar inferior se resetea el filtro a `all`.
- El filtro `owned` se conserva al cambiar de tab.

---

## Inicio

Inicio es compacto y no debe convertirse en hero grande.

Composicion actual:

- `ProgressCard` arriba:
  - label `Mi coleccion base`
  - conteo `owned / total`
  - badge de porcentaje
  - barra verde de progreso
- Portada central del album (`.book-cta`) con proporcion tipo libro:
  - `Mi album`
  - `Mundial 2026`
  - boton `INICIAR`
- Acciones laterales:
  - color
  - banderas
- Ruedas estadisticas:
  - `Album base`: tengo vs faltan
  - `Intercambio`: repetidas vs tengo

Reglas de interaccion de portada:

- Click/tap en la portada, excepto `INICIAR` y banderas, abre editor de color.
- Click/tap en `INICIAR` navega a `Mi album`.
- Click/tap en una bandera abre editor de banderas con esa bandera seleccionada.
- Las ruedas estadisticas son informativas, no navegables.
- Los botones laterales tambien abren color/banderas.

Reglas de Inicio:

- Mantenerlo compacto.
- No reintroducir header/hero grande salvo pedido explicito.
- No convertir ruedas o datos visuales en botones reales.
- No mezclar reset de coleccion con personalizacion de portada.
- El reset de coleccion vive en Ajustes.

---

## Personalizacion De Portada

Todo vive principalmente en `src/pages/HomePage.jsx` y `src/styles.css`.

### Color

- `bookColorOptions` vive en `HomePage.jsx`.
- El color elegido actualiza `--album-theme-color` en `documentElement`.
- El fondo global usa ese color de forma sutil.
- No pintar toda la app con el color fuerte elegido.
- El editor de color es un bottom sheet.
- La paleta debe tener dos filas.
- La paleta debe funcionar en telefono angosto:
  - `custom-color-panel` queda a la izquierda ocupando dos filas.
  - los colores predefinidos van a la derecha en dos filas.
  - si no caben, la grilla hace scroll horizontal.
- El panel personal no tiene texto; se entiende por su color.
- El boton redondo de flecha atras restaura el color anterior, no el color base.
- Si no hay color anterior en la sesion, ese boton aparece deshabilitado.
- El boton redondo verde con check cierra el editor.
- La `X` superior tambien cierra el editor.

### Banderas

- `MAX_FLAGS = 7`.
- Las banderas visibles vienen de `buildFlagUrlFromCode`.
- Las banderas se guardan como objetos:
  `{ id, code, x, y, rotation }`.
- Hay migracion desde `bookTeamCode` y desde `bookFlags` antiguos como strings.
- Al agregar una bandera:
  - se crea con posicion predefinida mas variacion aleatoria
  - se limita a la zona superior de la portada
  - se selecciona automaticamente
- En Inicio las banderas se muestran y son clicables para abrir el editor.
- En el editor:
  - se pueden seleccionar
  - se pueden arrastrar con mouse/dedo
  - se pueden rotar con el control circular
  - se pueden quitar individualmente con `X`
  - el movimiento queda limitado a la region superior de la portada, arriba del
    texto `Mi album`
- La opcion principal del carrusel de banderas:
  - si hay 0 o 1 bandera, se muestra como `Ninguna`
  - si hay mas de 1 bandera, se muestra como `Quitar N`
  - siempre quita solo la ultima bandera
  - si hay 7 banderas y se toca 7 veces, quita las 7 una por una
- No existe boton global de `Limpiar`.
- El boton redondo verde con check cierra el editor.
- La `X` superior tambien cierra el editor.

---

## Mi Album

La experiencia central vive en:

- `src/pages/AlbumPage.jsx`
- `src/components/SearchBar.jsx`
- `src/components/StickerCard.jsx`
- `src/styles.css`

### Vista De Indice

- Muestra buscador/filtros arriba.
- El toolbar del buscador es sticky.
- Muestra tarjeta de progreso de album.
- Muestra indice por seccion/pais.
- Cada carta de indice incluye bandera/emoji, codigo, conteo y mini barra verde.
- Inglaterra usa `gb-eng`.
- Escocia usa `gb-sct`.
- Todas las barras de progreso deben verse verdes.
- Azul queda para acciones, navegacion, foco y resaltados temporales.

### Busqueda

- Si el buscador tiene 3 o mas caracteres, aparece seccion `Resultados`.
- Con busqueda activa, el indice de paises sigue visible.
- Con busqueda activa, tocar un pais filtra resultados a ese pais y query.
- Con busqueda activa no se abre la seccion completa.
- Si tambien hay filtro (`Tengo`, `Faltan`, `Repetidas`), el resultado por pais
  respeta ese filtro.

### Filtros

Filtros de `SearchBar`:

- `Todas` (`all`)
- `Tengo` (`owned`)
- `Faltan` (`missing`)
- `Repetidas` (`duplicates`)

Reglas:

- El filtro vive en `App.jsx` como `albumFilter`.
- Se persiste en `sticker-tracker-album-filter`.
- Si se activa `Tengo` y se cambia de tab, se conserva.
- Si se activa `Faltan` o `Repetidas` y se toca cualquier tab del navbar
  inferior, el filtro vuelve a `Todas`.
- Si el filtro es `Faltan` y se toca una seccion del indice sin busqueda activa:
  - se abre esa seccion en la tab `Faltantes`
  - no se abre dentro de `Mi album`
- Si el filtro es `Repetidas` y se toca una seccion del indice sin busqueda
  activa:
  - se abre esa seccion en la tab `Repetidas`
  - no se abre dentro de `Mi album`
- Si el filtro es `Todas` o `Tengo`, tocar una seccion abre esa seccion dentro
  de `Mi album`.

### Vista De Seccion

- Abrir una seccion agrega estado al historial del navegador.
- El boton/gesto atras debe cerrar la seccion antes de salir de la app.
- Si `selectedSectionId` existe, la cabecera sticky muestra:
  - flecha izquierda
  - bandera/emoji
  - codigo/titulo
  - flecha derecha
  - conteo
  - cerrar
  - progreso
- Las flechas y swipe reproducen sonido `page`.
- `useSwipe` solo considera swipe horizontal si el movimiento horizontal domina
  claramente al vertical.

### Navegacion Segun Filtro

En una seccion abierta de `Mi album`:

- Con filtro `Todas`, flechas/swipe navegan por todas las secciones.
- Con filtro `Tengo`, navegan solo por secciones con al menos una carta verde.
- Con filtro `Faltan`, navegan solo por secciones con al menos una faltante.
- Con filtro `Repetidas`, navegan solo por secciones con al menos una repetida.
- Si la seccion actual deja de cumplir el filtro, se puede mostrar vacia, pero
  flechas/swipe deben encontrar la seccion valida mas cercana.

### Layout De Cartas

- `.album-sticker-grid` usa 3 columnas moviles:
  `repeat(3, minmax(0, 108px))`.
- En pantallas `min-width: 641px`, usa 6 columnas.
- `.sticker-card-grid` mantiene `aspect-ratio: 10 / 16`.
- `.sticker-card-grid` mantiene `max-width: 108px`.
- Si hay pocas cartas, el grupo queda centrado.
- No estirar cartas para llenar ancho.
- Las fuentes de cartas no deben escalar por viewport hasta verse gigantes en
  tablet.

---

## StickerCard

`src/components/StickerCard.jsx` es el centro del comportamiento de cartas.

### Estado Normal

- Carta faltante en `Mi album`:
  - borde rojo suave
  - fondo claro
  - chip `Agregar`
  - el chip usa `--sticker-accent`
- Tocar carta faltante la marca como `owned`.
- Carta `owned`:
  - fondo verde
  - borde verde
  - check verde visible
  - contador `x1`
- Si `duplicates === 0` y `pasted === false`, tocar una carta verde la vuelve
  faltante.
- Si `duplicates > 0`, tocar la carta no la vuelve faltante.
- Si `pasted === true`, tocar la carta no la vuelve faltante.
- Para cartas con repetidas se usa el boton `-` para bajar copias.
- El contador visual muestra `x${duplicates + 1}`.
- `x1` queda verde.
- `x2` o mayor usa estilo naranja.
- Los botones `+` y `-` son naranjas y aparecen solo cuando la carta esta
  `owned` y no esta en contexto `duplicates`.
- `+` aumenta repetidas y pulsa la tab `Repetidas` siempre.
- `-` baja repetidas si existen.
- Si no hay repetidas, `-` puede volver la carta faltante solo si no esta
  `pasted`.
- Si la carta esta `pasted` y no tiene repetidas, `-` aparece deshabilitado.

### Pegar Y Despegar

Concepto:

- `owned` significa que la estampa existe en la coleccion.
- `pasted` significa que ya se pego fisicamente en el album.

Reglas:

- El icono de pegar/despegar solo aparece sobre cartas verdes (`owned`) en Mi
  album.
- Doble click o doble toque rapido sobre una carta verde alterna `pasted`.
- El boton/icono de pegar/despegar tambien alterna `pasted`.
- Si una carta esta pegada, un toque normal no puede cambiarla a faltante.
- Solo se puede volver a cambiar a faltante despues de despegarla.
- Pegar reproduce sonido `paste` tipo victoria.
- Despegar no reproduce sonido.
- El estado `pasted` se guarda, exporta e importa.

### Contexto Faltantes

- `MissingPage.jsx` usa `StickerCard` con `context="missing"` y
  `variant="album-grid"`.
- Las cartas en Faltantes son rojas.
- Al tocar una carta de Faltantes:
  - se marca como `owned`
  - se navega a `Mi album`
  - se abre la seccion correcta
  - se hace scroll a la carta
  - se resalta con halo azul temporal
  - se pulsa la tab `Mi album`
- Este flujo vive en `handleOpenStickerInAlbum` en `App.jsx`.

### Contexto Repetidas

- `DuplicatesPage.jsx` usa `StickerCard` con `context="duplicates"` y
  `variant="album-grid"`.
- Las cartas en Repetidas son naranjas.
- En Repetidas no aparece el check verde.
- En Repetidas no aparece `xN`; se muestra `Sobra N`, donde `N` es la cantidad
  de copias sobrantes (`duplicates`).
- Aparece `Quitar` como accion visual.
- Aunque parezca boton, la carta completa es el control principal.
- Al tocar una carta de Repetidas:
  - se quita una repetida
  - se navega a `Mi album`
  - se abre la seccion correcta
  - se hace scroll a la carta
  - se resalta con halo azul temporal
  - aparece badge `xN -> xN-1`
  - se pulsa la tab `Mi album`
- Este flujo vive en `handleOpenDuplicateInAlbum` en `App.jsx`.

---

## Faltantes

`src/pages/MissingPage.jsx`

- Vista resumen con cantidad total de faltantes.
- Botones para copiar lista y compartir por WhatsApp.
- Indice por secciones con conteo rojo.
- Al abrir una seccion, se muestran solo cartas faltantes.
- Las cartas son rojas en este contexto.
- Si una seccion no tiene faltantes, se muestra estado vacio de equipo completo.
- Navegacion por flechas/swipe solo va a secciones con faltantes.
- Si una seccion deja de tener faltantes, puede verse vacia, pero las flechas
  deben saltar hacia una seccion cercana que si tenga faltantes.

---

## Repetidas

`src/pages/DuplicatesPage.jsx`

- Vista resumen con cantidad de estampitas que tienen repetidas.
- Botones para copiar lista y compartir por WhatsApp.
- Indice por secciones con conteo naranja de copias sobrantes.
- Al abrir una seccion, se muestran solo cartas con repetidas.
- Las cartas son naranjas en este contexto.
- Si una seccion no tiene repetidas, se muestra estado vacio.
- Navegacion por flechas/swipe solo va a secciones con repetidas.
- Si una seccion deja de tener repetidas, puede verse vacia, pero las flechas
  deben saltar hacia una seccion cercana que si tenga repetidas.

---

## Resaltados Y Transiciones

Constante:

- `TARGET_HIGHLIGHT_MS = 880`

Flujos:

- Faltantes -> Mi album:
  - carta marcada como verde
  - halo azul temporal
- Repetidas -> Mi album:
  - se reduce `xN` a `xN-1`
  - halo azul temporal
  - badge de cambio
- Al sumar repetidas con `+`, la tab `Repetidas` pulsa siempre.

Detalles:

- `App.jsx` controla `targetStickerCode`, `targetStickerTransition` y
  `highlightedTabId`.
- `AlbumPage.jsx` hace scroll usando `data-sticker-code`.
- El timeout del resaltado no debe reiniciarse por cambios ajenos en
  `collection`.
- `BottomNav.jsx` usa `is-highlighted-target` para el pulso de tabs.

---

## Sonidos

Todos los sonidos se generan con Web Audio en `src/utils/sounds.js`.
No hay archivos de audio.

Tipos actuales:

- `add`
  Sonido feliz para agregar/marcar una carta como tenida.

- `duplicate`
  Sonido mas neutro/triste para repetidas, incluyendo `+` y `-`.

- `close`
  Sonido de cerrar/quitar cuando una carta vuelve a faltante.

- `page`
  Sonido suave de paso de pagina. Se usa al abrir Mi album desde Inicio y al
  moverse entre secciones con flechas o swipe.

- `paste`
  Sonido de victoria al pegar una estampa.

Reglas:

- Todos los sonidos deben pasar por `playAppSound` en `App.jsx`.
- `playAppSound` respeta `isSoundEnabled`.
- El toggle global vive en `SettingsPage.jsx`.
- La preferencia se guarda en `sticker-tracker-2026-sound-enabled`.
- Mantener volumen suave.
- Despegar no debe sonar.
- No agregar archivos de audio salvo pedido explicito.

---

## Ajustes

`SettingsPage.jsx` contiene:

- Toggle de sonidos:
  - `Apagar sonidos` cuando estan activos
  - `Activar sonidos` cuando estan apagados
- Exportar respaldo JSON.
- Importar respaldo JSON.
- Reiniciar coleccion con confirmacion.
- Aviso de herramienta no oficial.

Reglas:

- Reset de coleccion vive solo en Ajustes.
- Reset/personalizacion de portada vive solo en Inicio.
- No mezclar ambos conceptos.

---

## Estilos Principales

Archivo central:

- `src/styles.css`

Areas importantes:

- `:root`
  Variables globales, incluyendo `--album-theme-color`.

- `.app-shell`, `.app-main`
  Layout base mobile-first y espacio para bottom nav.

- `.progress-card`
  Progreso general.

- `.home-book-panel`, `.book-cta`, `.book-side-actions`
  Portada personalizable de Inicio.

- `.book-customizer`, `.modal-backdrop`
  Bottom sheets de personalizacion.

- `.color-picker-grid`, `.custom-color-panel`, `.customizer-round-action`
  Paleta de color, panel personal y botones redondos.

- `.book-flag-zone`, `.book-flag-node`, `.book-flag-rotate-handle`,
  `.book-flag-remove-handle`
  Banderas sobre portada y editor.

- `.flag-carousel`, `.flag-carousel-item`
  Carrusel de banderas.

- `.home-stat-wheels`, `.home-stat-wheel-card`, `.wheel-album`,
  `.wheel-duplicates`
  Ruedas estadisticas de Inicio.

- `.album-toolbar`, `.album-country-header`, `.album-sticker-grid`
  Vista de album y secciones abiertas.

- `.sticker-card-grid`, `.is-missing-context`, `.is-duplicates-context`,
  `.is-highlighted-target`, `.sticker-grid-paste`
  Estados visuales de cartas.

- `.bottom-nav`, `.tab-button`, `.tab-icon-shell`
  Navegacion inferior.

Nota:

- Todavia existen estilos antiguos de `.app-header` en `styles.css`, pero el
  header grande ya no forma parte central de Inicio. No reactivarlo salvo pedido
  explicito.

---

## Colores Y Semantica

Mantener estas reglas:

- Verde = tengo, pegado, progreso, ok.
- Rojo = faltante.
- Naranja = repetida/intercambio.
- Azul = acciones generales, navegacion, foco y resaltados temporales.
- El color personalizado del album puede influir sutilmente el fondo global.
- El color personalizado no debe reemplazar colores semanticos.
- Todas las barras de progreso deben seguir verdes.
- Evitar que la app se vuelva monocromatica por el color elegido.

---

## Donde Tocar Segun El Cambio

### Inicio

- `src/pages/HomePage.jsx`
- `src/components/ProgressCard.jsx`
- `src/styles.css`

### Personalizacion De Portada

- `src/pages/HomePage.jsx`
- `src/styles.css`
- `src/utils/collectionStats.js` solo si cambian banderas/codigos

### Mi Album

- `src/pages/AlbumPage.jsx`
- `src/components/SearchBar.jsx`
- `src/components/StickerCard.jsx`
- `src/styles.css`

### Faltantes

- `src/pages/MissingPage.jsx`
- `src/components/StickerCard.jsx`
- `src/utils/exportText.js`
- `src/styles.css`

### Repetidas

- `src/pages/DuplicatesPage.jsx`
- `src/components/StickerCard.jsx`
- `src/utils/exportText.js`
- `src/styles.css`

### Pegar/Despegar

- `src/components/StickerCard.jsx`
- `src/App.jsx`
- `src/storage/localCollection.js`
- `src/utils/sounds.js`
- `src/styles.css`

### Sonidos

- `src/utils/sounds.js`
- `src/App.jsx`
- `src/pages/SettingsPage.jsx`
- `src/styles.css`

### Bottom Nav

- `src/components/BottomNav.jsx`
- `src/styles.css`
- `src/App.jsx` si cambia comportamiento de tabs

### Persistencia

- `src/storage/localCollection.js`
- `src/App.jsx`

---

## Reglas De Implementacion

- Mantener cambios pequenos y enfocados.
- No romper mobile.
- Revisar especialmente telefono angosto.
- No agregar funciones reales disfrazadas de UI informativa.
- No convertir elementos informativos en botones sin razon.
- No agregar modales complejos si un bottom sheet simple encaja.
- No usar logos oficiales ni assets protegidos.
- No usar nuevas dependencias para algo que ya resuelve React/CSS/Web Audio.
- Evitar introducir emojis nuevos en codigo fuente.
- Hay textos con mojibake en algunos archivos; si se corrigen, hacerlo con
  cuidado y en UTF-8 consistente.
- Preferir texto ASCII en documentacion y comentarios si no hay razon fuerte
  para usar caracteres especiales.
- Antes de editar UI, revisar como esa pantalla conversa con `Mi album`,
  `Faltantes` y `Repetidas`.
- Despues de cambios en JSX, CSS o utilidades compartidas, correr:

```bash
npm.cmd run build
```

---

## Resumen Corto

Mapa mental para futuros cambios:

1. `src/App.jsx`
   Estado global, tabs, filtros, historial, sonidos, saltos con resaltado,
   pegar/despegar y props compartidas.
2. `src/pages/HomePage.jsx`
   Inicio, portada, color, banderas, paleta, bottom sheets y ruedas.
3. `src/components/ProgressCard.jsx`
   Resumen compacto de progreso.
4. `src/pages/AlbumPage.jsx`
   Experiencia central de album, filtros, busqueda, indice y secciones.
5. `src/pages/MissingPage.jsx`
   Flujo de faltantes hacia album.
6. `src/pages/DuplicatesPage.jsx`
   Flujo de repetidas hacia album.
7. `src/components/StickerCard.jsx`
   Apariencia y comportamiento de cartas, repetidas y pegado.
8. `src/components/BottomNav.jsx`
   Navegacion inferior y pulsos de tabs.
9. `src/storage/localCollection.js`
   Persistencia de `owned`, `duplicates` y `pasted`.
10. `src/utils/sounds.js`
   Sonidos generados, incluyendo `paste`.
11. `src/styles.css`
   Sistema visual completo.
