# Correctivos — Sistema de Gestión (Next.js + Vercel Postgres)

Aplicación web para reemplazar el archivo `Sistema_Correctivos_2025.xlsm`:
listado y CRUD de tickets correctivos, panel con gráficos, exportación a
Excel y acceso protegido con usuario y contraseña.

## 1. Requisitos

- Cuenta en [Vercel](https://vercel.com) (gratuita sirve).
- Cuenta en GitHub (o similar) para subir el código.
- Node.js 20+ instalado en tu computadora (para el paso local de migración).

## 2. Subir el código a GitHub

```bash
cd correctivos-app
git init
git add .
git commit -m "Sistema de Correctivos"
```

Crea un repositorio vacío en GitHub y sigue las instrucciones para
subir (`git remote add origin ...` y `git push`).

## 3. Crear el proyecto en Vercel

1. Entra a [vercel.com/new](https://vercel.com/new) e importa el repositorio.
2. Framework Preset: **Next.js** (se detecta solo). Deja el resto por defecto.
3. **Todavía no despliegues** — primero añade la base de datos (paso 4) y las
   variables de entorno (paso 5); si ya desplegaste, no hay problema, solo
   vuelve a desplegar ("Redeploy") al terminar.

**⚠️ Verifica la estructura del repositorio antes de continuar.** Si subiste
el proyecto arrastrando la carpeta descomprimida completa (en vez de solo
su contenido) a GitHub, puede quedar duplicada dentro de sí misma — por
ejemplo `tu-repo/correctivos-app/package.json` en vez de
`tu-repo/package.json`. Entra a la raíz del repo en GitHub: si ves
`package.json`, `src/`, `scripts/` directamente ahí, está bien. Si en
cambio solo ves una carpeta contenedora con todo adentro, en Vercel ve a
**Settings → Build and Development → Root Directory** y escribe el nombre
de esa carpeta (en vez de mover todos los archivos de nuevo). También
confirma en esa misma pantalla que **Framework Preset diga "Next.js"** y no
"Other" — si dice "Other", el build nunca corre `next build` de verdad y
el sitio da 404 en todo aunque el código esté completo.

**Librería de Excel.** `xlsx` se instala desde el sitio oficial de SheetJS
(`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), no desde el registro de npm: la versión
del registro (0.18.5) está abandonada y tiene vulnerabilidades sin corregir. Vercel la descarga
sola al desplegar; en tu computadora basta con `npm install`.

## 4. Conectar la base de datos (Vercel Postgres / Neon)

1. En el proyecto de Vercel, ve a la pestaña **Storage** → **Create Database**
   → elige **Postgres** (Neon).
2. Vercel crea automáticamente la variable de entorno `DATABASE_URL` y la
   conecta a tu proyecto. No necesitas copiarla a mano.

## 5. Variables de entorno

En el proyecto de Vercel → **Settings → Environment Variables**, agrega:

| Variable              | Valor                                                                 |
|------------------------|------------------------------------------------------------------------|
| `SESSION_SECRET`       | Cadena aleatoria de **al menos 32 caracteres** (genera una con `openssl rand -hex 32`). Con menos, la app no arranca en producción |
| `INITIAL_ADMIN_PASSWORD` | Contraseña inicial del usuario `admin` (mínimo 8 caracteres). **Obligatoria en producción** la primera vez: sin ella no se crea el administrador |
| `LIMITE_BASE_MB`       | Opcional. Tamaño del plan de la base de datos en MB, para el aviso de espacio del Panel (por defecto `512`, el plan gratuito de Neon) |

Los usuarios y contraseñas **ya no** van en variables de entorno: se guardan
en la tabla `usuarios` de la base de datos (ver sección 10).

`DATABASE_URL` ya la puso Vercel automáticamente en el paso 4.

## 6. Crear las tablas

Necesitas ejecutar esto **una sola vez**, apuntando a la base de datos real
de Vercel/Neon. En tu computadora:

1. En Vercel → Storage → tu base de datos → pestaña **.env.local** (o
   **Quickstart**), copia la cadena `DATABASE_URL`.
2. Crea el archivo `.env.local` en la raíz del proyecto (usa `.env.example`
   como plantilla) y pega ahí `DATABASE_URL` y `SESSION_SECRET` (los mismos valores que en Vercel).
3. Ejecuta (solo `DATABASE_URL` es obligatoria aquí):

```bash
npm run db:migrate   # crea la tabla "correctivos" y las demás
```

**Alternativa sin terminal:** abre el panel de Neon (Vercel → Storage → tu base
de datos → "Browse data" o el enlace a Neon) → **SQL Editor** → pega ahí todo el
contenido de `scripts/schema.sql` → Ejecutar.

## 7. Desplegar

Vuelve a Vercel y haz clic en **Deploy** (o **Redeploy** si ya existía el
proyecto). En unos minutos tendrás tu URL, por ejemplo
`https://correctivos-app.vercel.app`.

Entra con el usuario inicial `admin` (se crea solo en el primer ingreso, con la
contraseña de `INITIAL_ADMIN_PASSWORD` (en tu computadora, si no la definiste, es `admin`); cámbiala
de inmediato con el botón **Contraseña**).

## 8. Uso diario

- **Panel** (`/dashboard`): KPIs y gráficos (monto por estado, por tipo de
  trabajo, tendencia mensual, monto por área).
- **Correctivos** (`/correctivos`): tabla con filtros (estado, área, tipo,
  lugar, búsqueda de texto, rango de fechas), paginación, editar/eliminar
  tickets, y botón **Exportar Excel** que descarga exactamente lo que
  estás viendo (respeta los filtros aplicados).

**Los filtros no se pierden.** Lo que eliges (estado, proveedor, fechas, búsqueda, orden y página)
queda en la dirección de la página. Al entrar a un ticket y volver (con **Volver/Cancelar**, al
**Guardar**, con la flecha atrás del navegador o pasando por otras pestañas — Panel, Materiales — y
volviendo con la pestaña **Correctivos**) la lista aparece igual que la dejaste y **a la misma altura**
donde ibas. También puedes copiar la dirección y compartir esa vista filtrada. Para empezar de cero,
usa **Limpiar filtros**.

**Más filtros (plegable).** Tipo, sub tipo, lugar, área y documento pendiente están en un bloque compacto
(título a la izquierda, opciones en la misma fila) que se pliega con **▸ Más filtros**; muestra cuántos
filtros de ese bloque están activos y recuerda si lo dejaste abierto o cerrado. Las categorías con una
sola opción (p. ej. Área = Mantenimiento) no se muestran porque no filtran nada.

**Proveedores: un solo nombre por empresa** (menú **Proveedores**, solo administradores). El sistema
lleva un registro de proveedores. Cada vez que se crea o actualiza un ticket (desde una OC, una
cotización, la carga masiva de documentos o escribiendo el proveedor a mano), el nombre se compara con
el registro:
1. por **RUC** (identifica a la empresa sin dudas);
2. si no hay RUC, por el **nombre comparable**: sin tildes, mayúsculas, puntos ni la forma jurídica
   («MSG Perú S.A.C.», «M.S.G. PERU SAC» y «msg peru» son la misma empresa).

Si coincide, el ticket se guarda con el **nombre oficial**; si no, se registra como proveedor nuevo. Las
otras formas en que llegó escrito quedan como *variantes*. **La OC manda:** en **cada carga de una OC** (crear el
ticket desde la OC, vincularla, reemplazarla o la carga masiva) el proveedor toma la **razón social y
el RUC tal como vienen en la OC**, y todos sus tickets se actualizan a ese nombre (y reciben el RUC si
no lo tenían). Si el ticket tenía antes el proveedor escrito de otra forma («Mantenimiento y Proyectos
Ind.»), ese registro se une al de la OC. Los proveedores que ya existían se revisan solos en segundo
plano leyendo la OC guardada en sus tickets. Un administrador puede **fijar** un nombre (📌) para que
las OC no lo cambien. Los tickets que ya existían se ordenan solos
en segundo plano: la forma más usada de cada empresa queda como nombre oficial. En la página
**Proveedores** puedes:
- **Editar** el nombre oficial o el RUC: todos sus tickets se actualizan.
- **Unir** duplicados: marca dos o más, elige cuál queda y pulsa **Unir**. También aparecen sugerencias
  de **posibles duplicados** (nombres parecidos) para unir con un clic. El RUC del que se une se sigue
  reconociendo como la misma empresa en cargas futuras.

**Buscador de proveedores.** Escribe parte del nombre: no importan tildes, mayúsculas ni puntos
(«sac» encuentra «S.A.C.»), y las palabras pueden ir en cualquier orden («peru msg»). Lo que coincide
se resalta, cada proveedor muestra cuántos tickets y qué monto tiene con los filtros actuales, y
**Enter** elige el primero. Los elegidos aparecen arriba en la lista y, con el buscador cerrado, como
etiquetas que se quitan con la ✕. Se cierra con **Listo**, con Esc o haciendo clic fuera.

**Crear un ticket.** Ya no hay formulario manual: el botón **+ Nuevo Ticket desde OC**
pide el PDF de la orden de compra, lee de él el N° de OC, la fecha, el proveedor y su RUC,
el monto, la descripción, el contrato y la fecha de entrega, los muestra para revisarlos y, al
confirmar, crea el ticket con el PDF guardado como su documento de OC. Lo que la OC no trae (ticket, lugar, área, tipo de trabajo,
fechas del proceso) se completa después en la pantalla del ticket. Una OC no se puede usar en
dos tickets. Además de la OC, un ticket se puede crear desde su cotización (ver abajo); el
servidor rechaza cualquier otra vía. Si se carga
una OC que ya existe (p. ej. una OC reemitida con otro monto), la pantalla no bloquea: muestra los
datos del ticket existente junto a los del PDF nuevo, la persona marca cuáles actualizar (y si
reemplaza el PDF guardado) y el cambio queda en el historial
(`POST /api/correctivos/[id]/actualizar-oc`).

**Crear un ticket desde la cotización.** El botón **+ OC / Cotización / Informe** de la lista acepta
también cotizaciones en PDF (una o varias a la vez). Si el nombre del archivo no indica a qué ticket
pertenece (N° de ticket o Ref), la cotización **crea un ticket nuevo** en estado **enviado**, con:
la descripción (la línea "Solicitud:", "Asunto:" o "Servicio:" del PDF; si no la trae, el nombre del
archivo), el proveedor y su RUC, la fecha de cotización y el monto con IGV (si la cotización dice "no
incluye IGV", se calcula subtotal + 18 %). El PDF queda como su documento de cotización. En la
revisión se puede cambiar a "asignarla a un ticket existente". Una misma cotización (mismo N° y
proveedor) no crea dos tickets: si ya está registrada, aparece como "Ya registrada" y se omite
(`POST /api/correctivos/desde-cotizacion`).

**Cuando llega la OC de un ticket creado desde su cotización.** Al cargar la OC con el mismo botón,
la app busca los tickets que aún no tienen OC, siguen esperándola (cotizar, enviado, Ingresado a PS)
y son del **mismo proveedor**. Si uno coincide además en el **monto** (±S/ 1), la OC se **vincula** a
ese ticket en vez de crear otro: guarda el N° de OC, sus fechas, contrato y monto, el PDF como su
documento de OC, y el ticket pasa a **Por Ejecutar**. Si hay varios por el mismo monto, se elige a
mano; si ninguno coincide en monto, se crea un ticket nuevo, pero se pueden elegir los del mismo
proveedor en la lista. Funciona también si la cotización y su OC se cargan juntas en la misma
selección (`POST /api/correctivos/[id]/actualizar-oc` con `vincular=1`). También se puede hacer desde
el ticket: subir la OC en su línea de documentos y usar "Leer OC".

**Cotizaciones de cualquier proveedor.** El lector reconoce los formatos habituales: N° con o sin
"N°" (p. ej. `612-2026/HVC`, `CA0116-2026`), fechas en número o en palabras ("Lima, 14 de setiembre de
2026"), subtotal con distintas etiquetas (Sub Total, Costo directo, Valor de venta, Total sin IGV; se
elige el que con IGV da el total) y la descripción desde "Solicitud/Asunto/Servicio", "Referencia" en
tabla o el estilo carta ("…sobre su solicitud:"), sumando el Área/Ubicación si la trae. Los PDF hechos
en Word o Excel se leen con el ancho real de cada letra, así que ya no salen palabras partidas.

**Condiciones de la cotización.** Además se leen, si el PDF las trae: **plazo** (días hábiles o
calendario), **validez** de la oferta, **garantía** (meses), **forma de pago** y las **partidas** con su
monto. Se guardan en el ticket (columna `condiciones`) y se usan así:
- la ficha del ticket muestra un recuadro "Condiciones de la cotización" con plazo, hasta cuándo vale la
  oferta, hasta cuándo rige la garantía (desde la fecha de fin) y la tabla de partidas;
- al vincular la OC, si la OC no trae fecha de entrega, se calcula **F. OC + plazo** (saltando sábados y
  domingos si son días hábiles) y queda anotado en el historial;
- alerta **"Cotización por vencer"** en la lista: tickets sin OC cuya oferta vence en 3 días o menos (o ya venció);
- el Excel exportado suma las columnas Plazo cotización, Cotización válida hasta, Garantía hasta y Forma de pago.

**Informes técnicos.** El mismo botón (**+ OC / Cotización / Informe**) acepta informes técnicos o actas
de conformidad en PDF. Se reconocen por su título ("INFORME TÉCNICO", "Informe de servicio", "Acta de
conformidad"…) y se busca el N° de OC que citan (p. ej. "según la OC PER05-0000159613"). El PDF se guarda
en la línea **Informe** del ticket de esa OC y, como siempre al cargar el informe, el ticket pasa a
**Finalizado**. Si la OC está en varios tickets se elige a mano; si no hay ningún ticket con esa OC, se
avisa y no se guarda nada. Un informe nunca se confunde con una OC ni con una cotización aunque cite su
número (`POST /api/informes/leer`, que solo lee y no guarda).

**(Retirado en nov. 2026) Cargar muchos documentos a la vez (botón "+ Documentos").** Ya no está en la app; se deja la descripción como referencia. Elige (o arrastra) todos los PDF que
tengas —OC, cotizaciones, informes técnicos, actas de conformidad, certificados, guías— sueltos o en
carpetas (botón 📁: cada subcarpeta = un trabajo). La app lee cada uno (`POST /api/documentos/leer`,
que solo lee) y los **junta por trabajo** comparando:
- el **N° de OC** que cita el documento o su nombre de archivo ("OC 162764", "…SALAVERRY - 165160");
- el **N° de cotización** (el de la cotización y el que citan la OC o el informe: "CONFORME A COTIZACIÓN Nº
  421-2026/HVC"; "SM-0196-2025" = "SM-0196-25");
- el **RUC** del proveedor (proveedores distintos nunca se juntan), el **monto** (cotización = OC ± S/ 1),
  las **fechas** (la cotización es anterior a la OC; el informe, posterior);
- la **descripción** (palabras en común, códigos como A617 o HSVLAUREATE005, piso y pabellón) y la carpeta.
Y descarta (aunque se parezca) cuando hay una **contradicción**: el documento cita **otra OC** (p. ej. un
informe de la OC PER03-0000111502 nunca va a la OC 161308), la OC dice "conforme a cotización X" y el
documento es otra cotización, el **RUC** es de otro proveedor, o (si no hay RUC) firma **otra empresa**
(nombre o dominio del correo). Resta puntos si el **monto** de la cotización difiere más de 3 % de la OC
(más de 10 %: casi la descarta; se acepta el monto con o sin IGV), si el **piso, aula o pabellón** no
coinciden, o si las fechas no cuadran. Las fichas técnicas o de atención no cuentan como informe, y solo un
informe con título reconocido (no escaneado) finaliza el ticket; si no, queda como adicional. No se vuelve
a subir un archivo que el ticket ya tiene (mismo nombre).
Además: las palabras que solo aparecen en **un** trabajo ("cortafuego", "melamine", "SAF") pesan más que
las comunes ("agua", "puerta"); las palabras del tipo de documento ("certificado", "acta", "informe") no
cuentan; se reconocen abreviaturas (SOT = sótano, OF = oficina, SS.HH. = baño); el **N° de cotización** se
compara también "de fondo" ("2026-0031-SM" ≈ "2025-0031-SMV"); el **N° de ticket** o "Ref 123" en el nombre
del archivo ubica el ticket; un **RUC distinto** ya no se descarta del todo (una persona y su empresa pueden
tener dos RUC) pero resta mucho y siempre queda con ⚠; y la **carpeta** solo cuenta si es una subcarpeta con
una sola OC (la carpeta principal o una con varias OC no junta nada).
Compara contra los demás documentos de la carga y contra los tickets que ya existen. Cada trabajo queda en
**un solo ticket**: se crea con su OC (o con su cotización si no hay OC), se vincula al ticket que creó su
cotización, o se usa el que ya tiene esa OC. Se guardan **todas** sus cotizaciones (la principal completa los
datos; las demás quedan como archivos adicionales de la línea), el informe (el ticket pasa a **Finalizado**),
el certificado, y las guías u otros documentos como adicionales. Los archivos repetidos se omiten. En la
revisión, ⚠ marca lo que se juntó solo por descripción, y cada documento tiene un selector para moverlo a
otro trabajo o no cargarlo; lo que no se pudo ubicar aparece aparte para elegirlo a mano. Los PDF escaneados
(sin texto) solo se ubican por su nombre o su carpeta. La lógica está en `src/lib/agruparDocumentos.ts`.

**Un informe de dos trabajos.** Si un informe o certificado describe dos trabajos del mismo proveedor (p. ej.
"tablero de monóxido Y correctivo IIEE ITSE", de dos OC), se propone guardarlo en los dos tickets (marcado ⚠).
En la revisión, cualquier documento tiene "+ guardarlo también en otro trabajo".

**F. fin de trabajos antiguos.** Cuando el informe finaliza el ticket, la F. fin es la **fecha del informe**
si es creíble (no futura ni anterior a la OC o a la F. inicio); si no, hoy. El historial anota cuál se usó y,
si la fecha del informe se descartó, por qué (p. ej. un informe fechado en 2024 para una OC de 2025).

**Archivos adicionales por línea.** Cada línea de documentos del ticket (Cotización, OC, Informe…) guarda su
archivo principal y, debajo, archivos adicionales (otra cotización, la guía, el acta…), con "Ver" y "Quitar".
La carpeta local de cada ticket también los incluye.

**Si una OC no se lee bien.** Prueba el PDF sin guardar nada: copia el script del final de esta sección en
`scripts/probar-oc.ts` y ejecuta `npx tsx scripts/probar-oc.ts ruta/al/archivo.pdf`: muestra qué datos se leen y
por qué falla. (Ya no viene en el repositorio para respetar el límite de 100 archivos del zip.)
El lector está hecho para las OC que genera PeopleSoft (plantillas en inglés y en español). No
puede leer PDF escaneados (imágenes), protegidos con contraseña, incompletos, ni los guardados
con «Imprimir como PDF» (sus letras quedan incrustadas de forma ilegible): en esos casos avisa y
pide usar el PDF original. Una plantilla nueva con otras etiquetas se agrega en
`src/lib/server/parsearOC.ts` (listas `ET_*` y expresiones de totales).

**Rendimiento.** La primera página de la lista se consulta en el servidor y llega ya dentro del
HTML (`src/app/correctivos/page.tsx` + `src/lib/server/lista.ts`); `loading.tsx` muestra la
estructura mientras tanto. Al guardar, cada operación hace una sola ida y vuelta a la base: el
cambio y su anotación en el historial van en la misma instrucción (guardar ticket, documentos,
eliminar, crear desde OC). La sesión del usuario se guarda en memoria 60 segundos
(`TTL_USUARIO_MS` en `auth.ts`): un cambio de contraseña o la baja de un usuario puede tardar
hasta ese tiempo en reflejarse en otras instancias.

**Sesión.** La sesión dura 7 días y se renueva sola (como mucho una vez al día) mientras la persona
siga usando la app: quien entra al menos una vez por semana no tiene que volver a iniciar sesión.

**Dos personas editando el mismo ticket.** Al guardar, el formulario envía también cómo estaba el
ticket cuando se abrió, y el servidor guarda **solo los campos que esa persona cambió**: no se deshacen
los cambios que otra persona (u otra pestaña, o un paso automático como "Finalizado" al subir el
informe) hizo mientras tanto. Si las dos cambiaron el mismo campo con valores distintos, el guardado se
rechaza con un aviso para recargar. Si se intenta salir del ticket con cambios sin guardar, la app pregunta.

**Solicitud de materiales.** El menú **Materiales** (`/materiales`) arma una solicitud y la exporta en
PDF. Se busca en el catálogo por código o por parte del nombre (sin importar tildes ni mayúsculas) y se
agregan las cantidades; también se pueden agregar materiales **fuera del catálogo** (descripción +
cantidad, con precio de referencia opcional). La pantalla calcula subtotal sin IGV, IGV (18 %) y total, y
avisa si los precios del catálogo ya vencieron (el PDF lo advierte también). El PDF se genera en el
navegador (no pasa por el servidor, así que también lo puede usar un usuario de solo lectura) y lleva el
encabezado (N° y fecha) y la tabla de materiales (N°, **N° de ticket**, descripción, cantidad y, a la derecha, la foto del material cuando es fuera del catálogo y tiene foto), **sin código, precios ni
totales** (los precios se siguen viendo en la pantalla). Diseño: franja roja, ficha
con N° y fecha, tabla con filas alternadas, cantidad grande con su unidad debajo y la foto centrada en su
columna; si son varias páginas, la cabecera de la tabla se repite. El borrador se guarda en el navegador mientras se trabaja; no se guarda en la base de datos.

*Catálogo vigente y carga de uno nuevo.* Arriba de la búsqueda se ve qué catálogo se usa (título,
artículos, hasta cuándo valen sus precios, en rojo si ya vencieron, y quién lo cargó). Un administrador
pulsa **📥 Cargar catálogo nuevo (Excel)** y elige el Excel del proveedor (hoja «catalogo» o la primera;
mismas columnas que el original: Id Articulo, Descripción, Categoria, Nombre Categoria, Id Proveedor,
Nombre Proveedor, MONEDA, Precio (sin igv), Fecha de vencimiento, Cantidad minima, Tiempo de entrega). El
Excel se lee en el navegador, se muestra un resumen (artículos, proveedor, vigencia; avisa si ya está
vencido) y, al confirmar, pasa a ser el catálogo de todos los usuarios. Se guardan los 5 últimos
catálogos. Si nunca se cargó uno, se usa el archivo que trae la app (`public/catalogo-materiales.json`).

*N° de solicitud.* Cada solicitud recibe un número correlativo **SI-<año>-<n>** (SI-2026-1, SI-2026-2,
…), compartido por todos los usuarios y sin repetirse (lo da el servidor; empieza en 1 cada año). Se
asigna la primera vez que se genera la vista previa, el PDF o el Excel, y se mantiene para esa solicitud
(aparece junto a los botones) hasta que se pulsa **Vaciar solicitud** para empezar otra.

*Historial de solicitudes.* Cada solicitud queda registrada (con su N°, fecha, solicitante, tickets,
cantidad de materiales y total sin IGV) al **descargar su PDF o su Excel**; la vista previa no la registra.
En la sección **Historial de solicitudes** de la página de Materiales se puede buscar (por N°, ticket,
usuario o material), filtrar por estado y, por cada solicitud: **Ver** sus materiales, volver a generar el
**PDF** o el **Excel**, y **Editar** (la carga arriba para corregirla; conserva su N° y al descargar se
actualiza). Cada usuario ve las suyas; los administradores ven todas y cambian el **estado**: Enviada →
Aprobada → Atendida, o Anulada (queda quién y cuándo lo cambió).

*N° de ticket por material.* En la tabla de la solicitud cada material tiene su casilla **N° Ticket**:
al escribir aparecen **sugerencias de tickets reales** (por N° Ref, código de ticket, descripción o lugar)
y, debajo, la descripción del ticket encontrado o el aviso **«No existe ese ticket»**. Se reconoce el
código del ticket o su N° Ref escrito como «512», «Ref 512», «#512» o «Nro 512». Un material nuevo toma
el ticket de la línea anterior, y **a todas** copia el de la primera línea a todas. Sale como columna en
el PDF.

*Materiales en el ticket.* Cada ticket muestra la sección **Materiales solicitados**: qué se pidió para
él, en qué solicitud (SI-…), su estado, quién y cuándo, y el costo; el total sin IGV no cuenta las
solicitudes anuladas.

*Excel de los materiales del catálogo.* El botón **📊 Excel del catálogo** descarga un Excel solo con
los materiales del catálogo de la solicitud, con **las mismas columnas y el mismo encabezado gris (con
flechas de filtro) que el catálogo original del proveedor**, precedidas por una columna **N°**: Id Articulo, Descripción, Categoria, Nombre
Categoria, Id Proveedor, Nombre Proveedor, MONEDA y Precio (sin igv) (sin fecha de vencimiento, cantidad
mínima ni tiempo de entrega); al final se agregan la **Cantidad** pedida y el **Costo total**, y debajo
**subtotal, IGV (18 %) y total**. Arriba van los datos de la solicitud (N°, fecha y cantidad de
materiales). Todas las celdas con marco; los textos largos se parten y la fila toma el alto necesario.
Los importes son fórmulas (si se cambia una cantidad o un precio, todo se recalcula) y el archivo trae
también sus resultados. Los materiales fuera del catálogo no entran en este Excel. El .xlsx se escribe
sin librerías (la versión gratuita de SheetJS no guarda bordes ni colores).

*Vista previa del PDF.* Junto a **Exportar PDF** está **👁 Vista previa**: genera el mismo PDF de la
solicitud y lo muestra en un visor dentro de la página (como los documentos del ticket), para revisarlo
antes de descargarlo. Desde el visor se puede **Descargar PDF**, **Abrir en otra pestaña** o **Cerrar**
(Esc). Solo la descarga cuenta como solicitud hecha (suma los materiales a favoritos).

*Fotos de los materiales fuera del catálogo.* Cada material fuera del catálogo (los de la lista, los que
se escriben a mano y los favoritos) muestra una **miniatura** de su foto; al hacer clic se abre el
**visor** —igual que el de los documentos del ticket— con flechas (o ← →) para pasar de una foto a otra,
**Descargar** y **Cerrar** (o Esc). Los **administradores** ven el botón **📷 Foto** para agregar fotos
(hasta 8 por material; desde el celular abre la cámara) y, debajo, **🔎 Buscar**, que abre en otra pestaña la búsqueda de imágenes de ese producto para encontrar su foto real, guardarla y subirla y pueden **borrarlas** desde el visor. Las fotos
se reducen en el navegador antes de subir (máx. 1600 px) y se guardan en Vercel Blob si está conectado
(si no, en la base). La foto queda ligada al material por su descripción: aparece en todas las
solicitudes y para todos los usuarios.

*Materiales fuera del catálogo.* Debajo del buscador hay una lista (oculta hasta que se escribe una búsqueda, igual que el catálogo) de materiales que no están en el catálogo
(`public/materiales-fuera-catalogo.json`, sacados de órdenes de compra anteriores de ELECTRO COMERCIAL TECNICA EIRL,
con el precio sin IGV de la última orden). Se agregan a la solicitud igual que los del catálogo y el mismo buscador
los filtra. Entran a la solicitud como material "libre" (sin código), así que el PDF los trata como tales. Esa lista
también se suma una sola vez (por versión del archivo) a **Materiales favoritos** en cada navegador; si se borra un
favorito no vuelve a aparecer. Cada favorito tiene un botón **Agregar** que lo pasa a la solicitud (con precio si está en el catálogo o en la lista fuera de catálogo; si no, como material libre sin precio). Para ampliar la lista, agrega renglones al JSON y sube `version`.

*Actualizar el catálogo:* cuando llegue un Excel nuevo con el mismo formato (hoja `catalogo`; columnas Id
Articulo, Descripción, Nombre Categoria, Id/Nombre Proveedor, MONEDA, Precio (sin igv), Fecha de vencimiento,
Cantidad minima, Tiempo de entrega), ejecuta `node scripts/importar-catalogo.mjs ruta/al/excel.xlsx`: genera
`public/catalogo-materiales.json` y basta con volver a desplegar. El catálogo solo lo pueden abrir usuarios con
sesión iniciada, porque contiene precios.

**Velocidad.** La página está pensada para responder rápido:
- La **región** importa más que todo lo demás: en Vercel → Settings → Functions → *Function Region*, elige la
  MISMA región que tu base Neon (Neon → Project → Region; p. ej. AWS us-east-1 = Vercel *Washington, D.C.
  (iad1)*). Con regiones distintas cada consulta tarda decenas de milisegundos más.
- La lista trae solo las columnas que muestra (de las condiciones de la cotización, solo el N° y la validez);
  si se cambia de filtro rápido, la consulta anterior se cancela.
- Las cargas masivas ("+ OC / Cotización / Informe") se descargan aparte y solo para
  administradores.
- Las notificaciones (que revisan todos los tickets) se guardan 20 s en el servidor.
- El ticket y su historial se leen a la vez; los documentos ya abiertos se vuelven a ver al instante (en memoria
  de la pestaña, nunca en el disco).
- El **Panel General** llega ya calculado dentro de la página (antes: página → código → recién ahí los datos),
  y su consulta y la del espacio usado van a la vez.
- Al pasar el mouse por un ticket de la lista se adelanta su carga, y mientras una página se prepara se ve
  al instante una pantalla de "Cargando…" (antes la pantalla anterior se quedaba quieta).
- Las notificaciones solo se vuelven a pedir cuando cambian los datos (eliminar, restaurar, cargas masivas),
  no con cada filtro, y se dibujan de a 100.
- El usuario en sesión viene ya en la página (el menú y los botones de administrador salen en el primer
  dibujo, sin esperar otra consulta), y las notificaciones se piden apenas abre la lista.
- Cualquier cambio en un ticket borra la copia de las notificaciones (en esa instancia): al volver a la lista
  se ven al día.
- **Medir:** la lista, las notificaciones, el panel y los archivos responden con la cabecera `Server-Timing`.
  En el navegador: F12 → Red → clic en la petición (p. ej. `correctivos?…`) → Tiempos: se ve cuánto tardó la
  sesión y cuánto la base de datos. Si "base_datos" pasa de ~150 ms con pocos tickets, revisa la región.
- (Retirado) Al aplicar "+ Documentos", los trabajos se procesan de a 3 a la vez (cada uno en su ticket, en orden).
- Al cargar documentos, la lista de tickets se pide en paralelo y el emparejamiento descarta enseguida los
  tickets sin nada en común (200 documentos contra 3000 tickets: ~0,7 s).

**Adjuntos en Vercel Blob (recomendado).** Por defecto los PDF y archivos se guardan dentro de la base de
datos. Con un almacén **privado** de Vercel Blob abren más rápido (llegan tal cual, sin pasar por la base) y la
base no se llena. Para activarlo:
1. En Vercel → tu proyecto → **Storage** → **Create Storage** → **Blob** → **Continue**, acceso **Private**,
   y conéctalo al proyecto (Vercel agrega sola la variable `BLOB_READ_WRITE_TOKEN` / `BLOB_STORE_ID`).
2. Vuelve a desplegar (Deployments → … → Redeploy).
Desde ese momento los archivos nuevos van a Blob, y los que ya estaban en la base **se mueven solos**, de a 25
cada 5 minutos mientras se usa la lista, sin que nadie espere. Un archivo se lee de donde esté, así que la app
funciona igual durante el traslado; el Panel muestra cuántos quedan en la base. Si Blob falla en un momento, el
archivo se guarda en la base (no se pierde la subida). Los archivos nunca quedan públicos: el almacén es privado
y solo la app, con la sesión validada, los entrega. Al borrar un archivo o un ticket (papelera), también se
borra de Blob. Si quitas Blob después, los archivos que ya están allí dejan de abrir: no lo desconectes.

### Panel: proveedores y materiales

Debajo de los gráficos del **Panel** hay dos secciones nuevas:

- **Proveedores**: por empresa (con el nombre ya unificado), cuánto se le compró **este año** (tickets con OC
  de este año), el monto histórico, sus tickets **abiertos** (no finalizados) y el **plazo promedio y máximo**
  en días desde la fecha de la OC hasta el fin del trabajo. Se ordena por "Más comprado", "Más demora" o
  "Más abiertos", y un aviso nombra a los 3 que más demoran (con al menos 2 trabajos medidos). El nombre
  abre la lista de correctivos filtrada por ese proveedor.
- **Materiales** (de las solicitudes registradas, sin las anuladas; importes sin IGV): gasto y solicitudes del
  año, gasto **de catálogo vs fuera de catálogo**, gasto por mes (últimos 12), gasto por **lugar/pabellón**
  (según el ticket que se puso en cada material) y los 10 materiales más pedidos. Los materiales sin precio
  se cuentan pero no suman.

### Cambios de proveedor en el historial del ticket

Cuando el registro de proveedores cambia el nombre o completa el RUC de un ticket (al editar o unir en la
página Proveedores, al cargar una OC o en la unificación automática), queda una línea en el **historial**
de ese ticket: `Proveedor: «antes» → «después» (motivo)` o `RUC del proveedor: (vacío) → 20… (motivo)`, con
el usuario que lo hizo (o "sistema").

### Usar la app en el celular

Se puede **instalar como app** en la pantalla de inicio: en Android (Chrome) menú ⋮ → **Instalar app** (o
"Agregar a la pantalla principal"); en iPhone (Safari) **Compartir → Agregar a inicio**. Se abre a pantalla
completa, directo en Correctivos. En el celular, las pestañas (Panel, Correctivos, Materiales…) están en una
barra fija abajo, al alcance del pulgar, y los campos no hacen zoom al tocarlos.

**Sin internet** (`public/sw.js`): con conexión, el equipo va guardando una copia de lo que se ve (páginas,
lista con sus filtros, tickets, panel, catálogo de materiales y documentos de hasta 8 MB). Además, los tickets
que muestra la lista se guardan solos en segundo plano (hasta 30 a la vez), aunque no se abran. Sin conexión:

- se ve la última copia guardada;
- los **cambios en los datos del ticket** se guardan en el equipo y se envían **solos** al volver internet
  (sin ventanas ni avisos); la solicitud de materiales también se guarda sola en el equipo y se envía al
  volver la conexión. Subir o borrar documentos sí necesita internet;
- una página que nunca se abrió con conexión muestra un aviso con "Reintentar" e "Ir a la lista guardada".

**Guardado automático del ticket**: ya no hay botón "Guardar cambios" ni la pregunta "¿Salir sin guardar?".
Cada cambio queda al instante en el equipo y, un segundo después, se envía al servidor (solo los campos
cambiados, como antes). Junto a "Volver" una línea discreta dice "Guardando…", "✓ Guardado" o "Guardado en el
equipo · se envía solo al volver internet". Si otra persona cambió el mismo dato al mismo tiempo, el aviso
aparece arriba del formulario (no se pisa el cambio de nadie).

Al **cerrar o iniciar sesión**, o si la sesión vence, se borra todo lo guardado en el equipo. El modo sin
internet solo funciona en la versión publicada (Vercel), no con `npm run dev`. Se guardan como máximo 400
copias; las más antiguas se descartan solas.

### Inventario de equipos (página Inventario)

Lista única de los equipos de aire acondicionado, ventilación, extracción, presurización y cortinas de aire.
La primera versión es la consolidación de tres Excel (`public/inventario-equipos.json`): **INVENTARIO DE
EQUIPOS**, **análisis de aire acondicionado UPC San Isidro 2026** y **Depreciados con observaciones**. Un
equipo que aparece en varios archivos es una sola fila (se une por su código); los repetidos con la misma
serie, marca y modelo se omiten y se listan al final. El registro contable usa otros códigos: no se suma,
solo se enlaza por N° de serie o código de barra.

En la página:

- **KPI** (equipos, operativos, con observación, inoperativos, sin informe, recomienda reemplazo, vida útil
  superada) que siguen a los filtros; un toque filtra. **Tipo de equipo** (Aire acondicionado: Split, VRV/VRF,
  Fan coil de agua helada; Ventilación: Jetfan, Inyector, Ventilador centrífugo; Extracción: Extractor,
  Extractor de monóxido; Presurizador; Cortina de aire; Damper) y **buscador**.
- **Gráficos**: estado de mantenimiento por tipo de equipo y antigüedad (año de fabricación o ingreso).
- **Mapa por pabellón y piso**: equipos, inoperativos y con observación por casilla, con color según el
  problema; un toque filtra ese piso.
- **Prioridad de reemplazo**: inoperativos o con reemplazo recomendado, ordenados por puntaje (inoperativo
  100, recomienda reemplazo 60, con observación 10, y 0,3 por mes pasado de su vida útil, máx. 60). Con un
  precio de referencia por tipo (lo pone el usuario y se guarda en su equipo) se estima el costo total.
- **Datos por completar**: sin informe, sin año, sin serie, sin marca/modelo, sin código, sin pabellón/piso.
- **Ambientes con más correctivos** y, en la ficha de cada equipo, sus **correctivos del mismo ambiente**:
  cruce aproximado por ubicación (código de aula como A617/B406 o nombre del ambiente), porque los tickets
  no traen el código del equipo. Se carga solo al pedirlo.
- **Ficha** de cada equipo con su **QR**; **Etiquetas QR** imprime las etiquetas de los equipos filtrados
  (al escanear se abre `/inventario?equipo=CÓDIGO`, con la ficha abierta).
- **Actualizar estado tras el mantenimiento** (administradores): estado, informe, alerta y observaciones de
  un equipo; queda quién y cuándo.
- **Descargar Excel** de lo filtrado y, en la pestaña Datos, **Cargar equipos desde Excel** (administradores):
  - Al terminar de leer los archivos pregunta **«¿Qué quieres hacer con esta información?»**:
  - **Agregar al inventario**: suma solo los equipos nuevos (mismo código; sin código, misma serie+marca+modelo
    o mismo equipo y ubicación cuentan como repetidos). Los que ya están no cambian.
  - **Reemplazar el inventario**: pasa a ser solo los equipos de los archivos elegidos, sin repetidos. Pide un
    segundo clic de confirmación con cuántos se quitan y cuántos quedan.
  - **Descargar plantilla** (con una fila de ejemplo). También se reconocen otros Excel: columnas como
    Cód. Equipo, Nombre equipo, Ambiente, Estado en mantenimiento…; pabellón «A» o «PABELLÓN A»; piso «1»,
    «PISO1», «S3»; nombres de sistema y marca se unifican (AA. AGUA HELADA → Agua helada, S&P → SOLER & PALAU).
    Los códigos numéricos recuperan sus ceros (7674 → 00007674). Los repetidos dentro del Excel se omiten. Se guardan las 5 últimas versiones (tabla `inventario_equipos`,
  ruta `/api/inventario`). Mientras nunca se haya editado, se usa el archivo de `public/`.

**Control del inventario** (desde que el inventario está guardado en la app; la primera visita de un
administrador guarda la consolidación inicial):

- **Ticket ↔ equipo exacto**: en cada ticket, «Equipo del inventario» (se elige escribiendo código, equipo o
  ubicación, o con «Escanear QR» en los celulares que lo permiten, p. ej. Chrome en Android). Queda en el
  historial del ticket. En el inventario: **Gasto en correctivos por equipo** y % frente al precio de
  reemplazo (desde 50 % conviene evaluar reemplazarlo). Tabla `equipo_correctivos`.
- **Bitácora** por equipo: cambios de estado (antes → después), mantenimientos con su fecha e informe, y
  verificaciones en campo. Las **fallas** (pasar a inoperativo o con observación) suman a la prioridad de
  reemplazo (15 c/u, máx. 45). Tabla `inventario_bitacora`.
- **Evolución**: una foto de los KPI por mes (tabla `inventario_kpi_mensual`), con su gráfico.
- **Verificación en campo**: en la ficha, «✓ Verificado hoy» (con nota) y **fotos de la placa**; KPI
  «Verificados <año>» (un toque muestra los no verificados).
- **Plan de reemplazo por años**: presupuesto de cada uno de los 3 próximos años; los equipos se reparten
  en orden de prioridad según el precio de referencia de su tipo.
- **Mantenimiento preventivo**: último mantenimiento (el registrado en la app o, si no hay, el informe del
  Excel de nov-2025) + frecuencia por categoría (sugeridas: aire acondicionado 3 meses, ventilación,
  extracción, presurizador y cortina 6, damper 12; editables) → vencidos, próximos 30 días, al día, sin
  registro; KPI «Mantenimiento vencido».
- **Más sistemas**: un Excel subido puede traer otros sistemas (bombas, tableros, UPS, ascensores…): su
  «Sistema» es la categoría y su «Tipo», el subtipo.

Precios de referencia, presupuestos y frecuencias se guardan para todos (tabla `inventario_config`; los
editan los administradores).

La página Inventario se asigna a los usuarios como las demás (página Usuarios).

### Automatizaciones

1. **Estado por fechas**: un ticket "Por Ejecutar" cuya fecha de fin del trabajo (o, si no la tiene, la de
   entrega de la OC) ya pasó y aún no tiene informe pasa solo a **"Esperando Informe"**. Si sigue así más de
   15 días, se marca como atrasado. Queda en el historial ("automático: pasó la fecha de…").
2. **Ticket desde la solicitud de materiales**: si un material lleva un N° de ticket que no existe, aparece
   "Crear ticket" (administradores). Abre la lista con una franja que lo recuerda: el próximo ticket que se
   cree con su OC o cotización nace con ese N° y la solicitud queda enlazada sola (los tickets se siguen
   creando solo desde un PDF, como siempre).
3. **Proveedor sugerido**: en el ticket, según el tipo/sub tipo de trabajo, se muestran los proveedores que
   más lo han hecho (primero en ese lugar), con su precio y plazo promedio; un toque lo pone en el ticket.
4. **Revisión automática** dentro del ticket (sin ventanas), cuando algo no cuadra: RUC distinto al del
   registro, N° de OC distinto al del documento, monto distinto de la cotización (con o sin IGV),
   cotización vencida sin OC, fechas imposibles, Finalizado sin informe, informe sin fecha de fin, o más de
   15 días esperando el informe.
5. **Solicitud atendida sola**: una solicitud Enviada o Aprobada cuyos materiales tienen todos un ticket,
   y todos esos tickets están Finalizados, pasa a **"Atendida"** (autor "sistema").

Las automatizaciones 1 y 5 corren en segundo plano al usar la lista o el historial de solicitudes, como
mucho cada 30 minutos (sin costo extra apreciable).

### Consumo mínimo en Vercel y Neon

La app está ajustada para gastar lo menos posible del plan:

- El proxy (control de sesión) no se ejecuta para el logo, el ícono, el manifiesto ni el service worker.
- Las pestañas del menú no se precargan solas; un ticket de la lista solo se precarga si el mouse se queda
  sobre él un momento.
- El ticket y la solicitud de materiales se envían al servidor una vez por pausa al escribir (2,5 s).
- Los documentos ya abiertos se toman del equipo (no se vuelven a descargar de Vercel/Blob).
- Los tickets para usar sin internet solo se precargan en la app instalada (máx. 15, una vez al día).
- Los paneles de proveedores y materiales se reutilizan 3 minutos; las notificaciones, 20 s; la sesión, 1 min.
- Las tareas de fondo (papelera, traslado a Blob, unificación de proveedores) corren como mucho cada 5 min
  a 1 hora, después de responder.
- Las rutas que leen PDF se cortan al minuto si algo se traba (`maxDuration = 60`).

**Fluidez**: aunque las pestañas no se precargan solas, se piden apenas el dedo toca la pantalla o el mouse
se posa encima (antes de soltar), igual que un ticket al tocar su fila; así abren casi al instante sin gastar
de más. En el celular la barra superior no usa desenfoque (hace saltar el desplazamiento en equipos
sencillos), los toques no esperan el doble toque, y el Panel reserva el lugar de los gráficos mientras cargan
(la página no salta). La búsqueda en el catálogo (15 000 materiales) responde en menos de 10 ms.

Recomendado en los paneles (no se configura desde el código): en Vercel → Settings → Functions, la
**región** igual a la de la base Neon (menos espera = menos tiempo cobrado) y **Fluid Compute** activado;
en Neon, la suspensión automática por inactividad (5 min) activada.

### Panel ordenado en pestañas

El Panel muestra arriba solo lo esencial: monto total, atrasados, pendientes y finalizados, y una línea de
**"Requiere atención"** (atrasados, cotizados sin OC fuera del SLA, base de datos llena) que lleva a donde se
resuelve. El detalle va en pestañas: **Resumen** (tendencia mensual y monto por estado), **Gastos** (tipo de
trabajo, área y proveedor), **SLA cotización → OC**, **Proveedores** y **Materiales**. La pestaña elegida se
recuerda en cada equipo.

### Montos en dólares

La app lee las OC y cotizaciones en **dólares (US$)** y las guarda en dólares, con su equivalente en soles.

- **Al leer el PDF** (crear ticket desde OC o cotización, carga masiva, subir la OC o la cotización al ticket):
  se detecta la moneda; si es US$, el ticket guarda **moneda US$, monto en dólares y tipo de cambio**, y el
  **monto en soles** (= dólares × tipo de cambio).
- **Tipo de cambio**: el impreso en el documento ("Tipo de cambio", "Exchange rate", "T.C."), si lo trae; si
  no, el **último usado** en la app (queda anotado en el historial para revisarlo). Si todavía no hay ninguno,
  el ticket queda con el monto en dólares y "sin T.C." hasta que se escriba.
- **En el ticket**: junto a "Monto" se elige **S/ o US$**. En US$ se escribe el monto en dólares y el T.C.
  (entre 2 y 10), y se ve el equivalente en soles. El T.C. que se escribe pasa a ser la referencia.
- **Lista, ficha impresa y Excel**: se ve "US$ 56,422.72" con su equivalente en soles; el Excel trae las
  columnas Moneda, Monto US$ y Tipo de cambio. Los totales del panel, el presupuesto y los informes suman
  en soles (con el equivalente).
- La carga masiva empareja una OC en dólares con el ticket creado desde su cotización en dólares por el
  mismo monto en US$.

### SLA cotización → OC

Mide los **días hábiles** (lunes a viernes; los feriados no se descuentan) desde la **fecha de la cotización**
hasta la **fecha de emisión de la OC**. Meta: **5 días hábiles** (`SLA_COTI_OC_DIAS` en `src/lib/shared.ts`).

- **Ticket**: debajo de "F. OC" se ve el SLA ("3 días háb. ✓" o "en curso: 7 días háb. · meta 5"). Si la OC
  tiene fecha anterior a la cotización, avisa que hay un dato a revisar.
- **Notificaciones de la lista**: "SLA de OC vencido" para tickets cotizados que siguen sin OC más allá de la meta.
- **Panel**: promedio, % dentro de la meta, tickets esperando OC (y cuáles están fuera), promedio por mes y por
  proveedor (OC de los últimos 12 meses).
- **Excel** (exportar): columnas "SLA cotización → OC (días hábiles)" y su estado.
- **Informe mensual** (pantalla y PDF): SLA de las OC emitidas en el mes.

### Varios campus (datos separados)

La app maneja más de un campus con los datos **completamente separados**: tickets, adjuntos, historial,
solicitudes de materiales, inventario (con su bitácora, configuración e indicadores) y las 6 páginas de Gestión.
Hoy hay dos: **UPC San Isidro** (todo lo que ya existía) y **UPC Villa** (empieza vacío). La lista está en
`src/lib/shared.ts` (`CAMPUS`): para agregar otro se suma una línea; el nombre visible se puede corregir ahí.

- **Cada usuario tiene un campus** (página Usuarios → columna Campus). Ve y registra solo los datos de ese campus.
  Con **"Todos los campus"** aparece un selector en la barra superior para cambiar de campus (se recuerda en el
  equipo). Los administradores que ya existían quedaron con "Todos los campus"; los de solo lectura, con San Isidro.
- **Administrador de un campus** (por ejemplo, el de Villa): crea, edita y borra solo en su campus, y en Usuarios
  solo ve y crea usuarios de su campus. La página Proveedores (directorio común de empresas y RUC) es solo para
  quien administra todos los campus.
- **Numeración**: cada campus tiene su propio N° Refer. (Villa empieza en 1). El N° de OC y el de ticket siguen
  siendo únicos entre campus: una misma OC no se puede registrar dos veces, y el aviso dice en qué campus está.
- **Inventario**: Villa empieza vacío y se carga con su Excel (Inventario → Datos → modo Reemplazar o Agregar).
- **Reportes por QR**: los QR que se imprimen desde un campus llevan ese campus; el reporte llega a su bandeja.
- Un ticket de otro campus responde "no encontrado"; los PDF y Excel llevan el nombre del campus.

Al desplegar, la base se actualiza sola (columna `campus` en las tablas, todo lo existente queda en San Isidro).

### Gestión (6 páginas nuevas)

En la barra aparece **Gestión** (en el celular, 🗂). Adentro hay una pestaña por página; a cada usuario de solo
lectura se le asigna cada una por separado (Usuarios → páginas). Todo se guarda solo al escribir, sin botón
"Guardar" ni ventanas emergentes; borrar pide un segundo toque en el mismo botón.

- **Garantías** (`/gestion/garantias`): la garantía sale de la cotización del ticket (meses, contados desde la
  fecha de fin) o se agrega a mano. Muestra cuándo vence cada una, las que vencen en 30 días y los **posibles
  reclamos**: tickets abiertos durante la garantía en el mismo equipo del inventario, o en el mismo ambiente
  (A-301, B401…) y la misma especialidad. En la ficha de ese ticket nuevo aparece el aviso "podría estar en
  garantía". Se registra el estado del reclamo al proveedor. Excel.
- **Agenda y contratistas** (`/gestion/agenda`): calendario semanal con los trabajos en obra (de la fecha de
  inicio a la de fin o a la entrega de la OC), los "por programar" y, por trabajo, los riesgos (altura, caliente,
  eléctrico, espacio confinado: se sugieren por la descripción) y el estado del permiso de trabajo. En
  "Contratistas y documentos": SCTR salud y pensión (obligatorios), pólizas, enlaces y personal autorizado, con
  aviso 30 días antes del vencimiento.
- **Presupuesto** (`/gestion/presupuesto`): monto anual por cuenta frente al gasto de los tickets (por fecha de
  OC; comprometido = sin finalizar, ejecutado = finalizado), gasto por mes, proyección al ritmo actual y aviso
  desde el 80 %. Muestra aparte lo pedido en solicitudes de materiales.
- **Preventivos contratados** (`/gestion/preventivos`): servicios por frecuencia (puertas cortafuego, ascensores,
  pozos a tierra, cisternas, extintores…; "+ Servicios sugeridos" los carga con frecuencias de referencia que se
  ajustan al contrato). Último y próximo servicio, marca ITSE, enlace al informe o certificado, historial con
  "Registrar realizado" y calendario de 12 meses.
- **Reportes por QR** (`/gestion/reportes`): "Imprimir QR de ambientes" arma etiquetas (también con los
  ambientes del inventario). Quien escanea abre **/reportar** —página pública, sin usuario— y envía lugar, tipo,
  descripción y foto. Llegan a la bandeja con "✓ desde QR" (firma válida) o "sin QR válido". Se cambia el estado,
  se enlaza al N° Ref. del ticket que lo atiende y se copia el texto para el proveedor. Los tickets se siguen
  creando desde la OC o la cotización. Protección: 6 reportes cada 15 min por conexión, 80 en total, máximo 300
  sin revisar, campo trampa para robots, tiempo mínimo de llenado y foto de hasta 4 MB (el celular la reduce).
- **Informe mensual** (`/gestion/informe`): resumen del mes (tickets, gasto y presupuesto, preventivos,
  garantías, contratistas con faltantes, reportes e inventario) con comentarios para gerencia y **Descargar PDF**.

Todo se guarda en una sola tabla nueva, `gestion_registros` (se crea sola al desplegar).

## 9. Estructura del proyecto

```
src/
  app/                       páginas y rutas (lo que ve el navegador)
    login/  dashboard/  usuarios/
    correctivos/             lista y /[id] (ver y editar el ticket)
    materiales/              solicitud de materiales (PDF)
    inventario/              inventario de equipos
    gestion/[modulo]/        Gestión: garantías, agenda, presupuesto, preventivos, reportes, informe
    reportar/                formulario público de reporte por QR (sin sesión)
    api/                     auth/[accion] (login, logout, me, password), usuarios, correctivos (+ archivos,
                             documentos, desde-oc, actualizar-oc, aplicar-cotizacion, avisos; POST
                             /api/correctivos/[id] = restaurar de la papelera), gestion/[modulo], inventario,
                             ordenes-compra, cotizaciones, materiales, dashboard, export
  components/
    layout/                  barra superior, logo y cambio de contraseña (TopNav.tsx)
    gestion/                 las 6 páginas de Gestión (Modulos.tsx)
    ticket/                  formulario, documentos, historial, ficha imprimible,
                             guardado en carpeta, etiqueta de estado
    lista/                   tarjetas, filtros, notificaciones y carga de OC de la lista
    materiales/              buscador de materiales y solicitud
    dashboard/               gráficos (se cargan aparte) y tipos del panel
  lib/
    server/                  solo servidor: base de datos, sesión, filtros SQL,
                             historial, límite de intentos de login, lector de PDF
                             (OC y cotizaciones)
    client.ts                solo navegador: usuario en sesión, carpeta local
    shared.ts                común: tipos, listas desplegables, formatos,
                             reglas de archivos, acceso por página
    materiales.ts            catálogo, totales e IGV de la solicitud de materiales
    gestion.ts               Gestión: tipos y cálculos (garantías, riesgos, preventivos, contratistas)
    solicitudPdf.ts          PDF de la solicitud de materiales y del informe mensual
    importarExcel.ts         importar materiales desde Excel
  proxy.ts                   control de acceso (sesión y rol de solo lectura)
public/                      logo, catálogos de materiales (JSON) y tableros-circuitos.html
scripts/                     schema.sql y migrate.mjs (crean las tablas), importar-catalogo.mjs
```

## 10. Usuarios, roles y archivos adjuntos

**Usuarios y roles.** Entra como administrador y abre **Usuarios** en la barra
superior. Hay dos roles:

- **Administrador**: crea, edita y elimina tickets y archivos, y gestiona usuarios.
- **Solo lectura**: ve y filtra tickets, abre archivos y exporta a Excel, sin modificar nada
  (el servidor bloquea cualquier cambio aunque se intente por fuera de la pantalla).

Cualquier usuario puede cambiar su propia contraseña con el botón **Contraseña** de la barra superior (pide la actual). Desde la página Usuarios, el administrador también restablece la de cualquier otro, se desactivan o eliminan
usuarios. Al crear o editar un usuario de solo lectura se marcan las páginas a las que entra
(Panel, Correctivos, Materiales); si se marcan todas, también verá las páginas que se agreguen en el
futuro. Al eliminar un usuario se borra también su borrador de materiales, y si después se crea otro
con el mismo nombre, las sesiones antiguas no le sirven. No se puede eliminarse ni quitarse el rol a uno mismo, y siempre
queda al menos un administrador activo. Las tablas `usuarios` y `archivos` se
crean solas la primera vez que la app las necesita.

**Archivos adjuntos.** En la pantalla del ticket (`/correctivos/[id]`) hay una
sección "Archivos adjuntos": los administradores agregan PDF, imágenes, Word o
Excel (máx. 4 MB por archivo, 20 por ticket; se guardan tal cual, sin reducir) y
cualquier usuario puede abrirlos con el enlace. Se guardan en la misma base de
datos Postgres, así que no requieren conectar ningún servicio nuevo; si algún
día se necesitan archivos más pesados, el cambio natural es Vercel Blob. Como los adjuntos
ocupan espacio de la base, el **Panel** muestra a los administradores cuánto se usa del plan
(`LIMITE_BASE_MB`) y avisa desde el 70 %.

**Guardar en una carpeta del computador.** En la pantalla del ticket, el botón
**Guardar en carpeta** crea dentro de la carpeta elegida una carpeta por ticket
(`123_Descripción del ticket/`: N° de referencia, guion bajo y la descripción) con una subcarpeta por cada documento que tenga archivo
(`visita_tecnica/`, `cotizacion/`, `oc/`, `informe/`, `certificado/`), y dentro de cada una el
archivo adjunto. No se guarda nada más (ni fichas ni datos sueltos). Si cambias
el archivo de una línea, el anterior se quita de su subcarpeta. En la lista,
**Guardar vista en carpeta** hace lo mismo con todos los tickets que cumplen los
filtros. La carpeta se elige una sola vez
y queda recordada en ese navegador (al reabrirlo, Chrome puede pedir un clic
para permitir de nuevo el acceso). Solo funciona en Chrome o Edge en computador.

**Guardado automático.** Una vez elegida la carpeta, el ticket se guarda solo
cada vez que se guardan cambios, se crea un ticket o se agrega/quita un documento,
y de forma "mejor esfuerzo" al cerrar la pestaña/navegador. Se puede apagar con
la casilla junto al botón. Si Chrome quitó el permiso de la carpeta (al
reabrirlo), lo vuelve a pedir en el siguiente clic en "Guardar cambios".

## 11. Editar las listas desplegables

Las opciones de **Estado**, **Tipo de trabajo**, **Sub tipo**, **Área** y
**Lugar** están en `src/lib/shared.ts` (sección "opciones"). Edita ese archivo, sube el cambio
a GitHub y Vercel volverá a desplegar automáticamente.

## 12. Seguridad

Medidas que ya trae la app (no hay que configurar nada más que las variables de la sección 5):

- **Acceso:** toda página y toda ruta de la API exige sesión; el rol y el estado del usuario se leen de
  la base en cada petición (un usuario desactivado pierde el acceso en máx. 1 minuto). Cada ruta vuelve
  a comprobar el rol por su cuenta, además del control general (`src/proxy.ts`).
- **Contraseñas:** guardadas con bcrypt (8 a 72 caracteres). Límite de intentos: 5 fallos por usuario
  e IP y 30 por IP en 15 minutos, también al cambiar la contraseña. Cambiarla cierra las demás sesiones.
- **Sesión:** cookie `HttpOnly`, `Secure` y `SameSite=Lax`, firmada con `SESSION_SECRET` (mín. 32
  caracteres); dura 7 días desde el último uso. **Cerrar sesión la invalida también en el servidor**
  (tabla `sesiones_cerradas`): aunque alguien hubiera copiado la cookie, deja de servir. Solo cierra
  esa sesión; las de otros equipos del mismo usuario siguen abiertas.
- **Cotizaciones:** una misma cotización (proveedor + N°) no puede crear dos tickets, ni subiéndola
  dos veces al mismo tiempo: lo impide una clave única en la base (tabla `cotizaciones_tickets`). Al
  leer una cotización desde el ticket, los datos salen siempre del PDF guardado (si el navegador envía
  el archivo, solo se usa si su huella SHA-256 coincide con la del guardado).
- **Dos personas a la vez:** si dos personas (o dos pestañas, o la carga masiva) guardan el mismo
  ticket al mismo tiempo, ninguna pisa a la otra. Los documentos se combinan solos: se vuelve a leer
  el ticket y se aplica solo la línea que tocaste. En los datos del ticket, si hay choque se avisa
  para que recargues. Además, nunca puede quedar el sistema sin un administrador activo, aunque dos
  admins se quiten el rol al mismo tiempo.
- **Archivos enlazados:** un adjunto que el ticket todavía muestra en sus documentos no se puede
  borrar (evita enlaces rotos si una pestaña con datos viejos intenta limpiar). Al vaciar la papelera,
  solo se borran de Blob los archivos de los tickets que realmente se eliminaron.
- **N° Ref nunca se repite:** aunque se elimine para siempre el ticket con el número más alto, el
  siguiente ticket nuevo recibe un número mayor (la tabla `refer_tope` recuerda el más alto borrado;
  se crea sola al desplegar).
- **Peticiones desde otros sitios (CSRF):** toda escritura que no venga de la propia app se rechaza.
- **Redirección tras el login:** solo a páginas de este mismo sitio.
- **Datos:** consultas SQL siempre con parámetros; validación de todos los campos en el servidor.
- **Archivos:** solo PDF, imágenes, Word y Excel (sin SVG ni HTML), máx. 4 MB; se sirven con su tipo
  fijo, `nosniff` y sin quedar guardados en la caché del navegador. El lector de PDF tiene límites de
  tamaño contra archivos maliciosos.
- **Cabeceras:** CSP, HSTS, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy`
  (ver `next.config.ts`).
- **Registro de actividad:** la página **Usuarios** muestra los inicios de sesión, intentos fallidos,
  bloqueos, cambios de contraseña y cambios de usuarios (con fecha, usuario e IP; se conservan 180 días).
- **Dependencias:** Next.js 16.4.5 (parche de seguridad de noviembre de 2026) y SheetJS 0.20.3.
  Revisa cada mes si hay versiones nuevas de Next.js con correcciones de seguridad.

Lo que depende de ti: usar contraseñas fuertes, dar el rol de administrador solo a quien lo necesita,
desactivar a quien deja de trabajar con la app y revisar de vez en cuando la actividad de seguridad.


## Vista uniforme

Todas las páginas usan el mismo encabezado (`EncabezadoPagina` en `TopNav.tsx`): campus o sección arriba en rojo,
título, una línea de descripción y las acciones a la derecha, con el mismo ancho (`CONTENEDOR`). En `globals.css`
hay un acabado común: foco suave en los campos, tablas con cifras alineadas y fila marcada al pasar el mouse, y
barras de desplazamiento finas. Las páginas con sesión llevan un pie con el sistema, el campus y el usuario.
En la página Panel hay una barra agrupada: datos (Exportar Excel de todos los tickets del campus, Guardar en carpeta,
Cargar Excel), administración (Papelera, Proveedores, Usuarios) y Cambiar contraseña. La lista de correctivos ya no
lleva esos botones ni «+ Documentos» (se quitó). Detalle de los botones: «Cargar Excel» (administradores: agrega equipos al inventario del
campus con el mismo cargador de la página Inventario, `src/components/inventario/CargaExcel.tsx`), «Proveedores» (administrador de todos los campus), «Usuarios»
(administradores) y «Cambiar contraseña». Ya no hay páginas /usuarios ni /proveedores: esas direcciones llevan al Panel
con la sección abierta (`/dashboard?vista=usuarios` o `?vista=proveedores`). La barra superior ya no muestra el usuario.
En Usuarios, el acceso a páginas se muestra resumido ("Todas las páginas" / "5 de 10") y se edita al abrirlo.

## Ordenar la lista por columna

En la lista de correctivos (y en la papelera) se ordena tocando el título de la columna; otro toque invierte el orden:
Ref, F. emisión (de la OC), Proveedor (A → Z), Monto (de mayor a menor), Estado (en el orden del flujo) y Docs
(primero los que tienen más documentos pendientes). Los órdenes están en `ORDENES` de `src/lib/server/utils.ts`.


## Búsqueda por texto

Se quitó la caja de búsqueda de la lista (no se usaba). La API sigue aceptando `?q=` (varias palabras, sin tildes) y,
si una vista guardada la trae, aparece como etiqueta «Búsqueda» y las coincidencias se resaltan.

## Colores

La paleta vive en `src/app/globals.css` (`:root`): rojo UPC (#d0112d) como acento, azul marino, verde (#127a56) para
lo cumplido, azul de apoyo (#2f6fb0) y grises neutros. Los estados del ticket usan una escala fija (`ACENTO_ESTADO` en
`filtrosLista.ts` y `ESTADO_COLORS` en `shared.ts`): gris → celeste → ámbar → naranja → violeta → verde.

## Lista: filtros aplicados, atajos, exportar y cambio de estado

- **Filtrando por:** sobre la tabla, una etiqueta por filtro aplicado (búsqueda, fechas, estado, proveedor, lugar…);
  la × lo quita y «Quitar todos» limpia todo.
- **Exportar lo que veo (N):** Excel solo con los tickets que cumplen los filtros y la búsqueda actuales.
- **Atajos de fecha** bajo Desde/Hasta (fecha de registro): Este mes, Mes pasado, Últimos 30 días, Últimos 3 meses,
  Este año. Otro clic en el mismo atajo lo quita.
- **Cambio de estado (administradores):** clic en la etiqueta de estado de una fila para cambiarlo sin abrir el ticket,
  o marcar varias filas y usar la barra «Cambiar estado a…». Usa el mismo PUT que la ficha (con control de cambios
  simultáneos); al pasar a «Finalizado» sin F. fin, se pone la fecha de hoy y se avisa.

## Inventario: Excel con una hoja por sistema

«Descargar Excel» en Inventario genera un solo archivo: la hoja «Todos» (los equipos visibles) y una hoja por cada
sistema (Aire acondicionado, Tableros eléctricos, Extracción…), ordenadas de la que tiene más equipos a la que tiene
menos, cada una con sus filtros de encabezado. `crearXlsx` en `src/lib/importarExcel.ts` acepta varias hojas.

## Velocidad

- **Panel → Velocidad** (administradores): muestra en qué región corre la app (Vercel), en cuál está la base
  (Neon, según `DATABASE_URL`, sin mostrar datos de acceso), cuánto tarda cada consulta y la región de Vercel
  recomendada (`GET /api/auth/velocidad`).
- **La base se despierta antes de hacer falta:** la pantalla de ingreso y la app al volver a la pestaña (tras 4 min
  o más) llaman a `GET /api/auth/despertar` (un `SELECT 1`, como mucho cada 20 s por instancia, sin datos).
- Lo que más pesa y no se arregla con código: que la **Function Region** de Vercel (Settings → Functions) no esté
  en la misma región que la base de Neon, y que Neon se apague tras 5 min sin uso (plan gratuito).

## Regla del informe

Un ticket sin informe no se cierra: se queda en **Por Ejecutar** hasta que se carga el informe (al cargarlo pasa
solo a Finalizado, como antes). Cuenta como informe el archivo cargado o el documento marcado «No aplica».
- «Esperando Informe» ya no existe: los tickets en ese estado pasan a Por Ejecutar.
- Los Finalizados sin informe vuelven a Por Ejecutar (con una línea en el historial, autor «sistema»).
  Lo hace `automatizar()` (lista y panel, como mucho cada 30 min por instancia), así que también corrige
  cualquier caso que aparezca después (p. ej. si se quita el informe de un ticket cerrado, vuelve al instante).
- No se puede elegir «Finalizado» sin informe: ni en la ficha, ni en la lista, ni en el cambio en grupo; la API
  lo rechaza con un mensaje (`MSG_FINALIZAR_SIN_INFORME`).

## Menú lateral

En computador y tablet la navegación está en un menú lateral (botón ☰ arriba a la izquierda) que se oculta solo
al elegir una sección, al cambiar de página, con Esc o con un clic fuera. La barra superior muestra el logo, la
sección actual, el campus y «Salir». En el celular se mantiene la barra de pestañas de abajo.

## Estilo «Institucional UPC»

Diseño elegido (propuesta 1 de 5): fondo gris claro plano, tarjetas blancas con borde fino y sombra mínima, rojo UPC
solo para la marca, la sección activa y lo urgente, y azul marino (`bg-slate-ink`, hover `bg-slate-hover`) para los
botones principales. El menú lateral es blanco con la sección activa en rojo. La ficha del ticket muestra arriba la
línea de tiempo de etapas (cotizar → enviado → PS → Por Ejecutar → Finalizado) con sus fechas y lo que falta para
cerrar. La pantalla de ingreso y el formulario público de reporte mantienen el botón rojo (son la «puerta» UPC).


## Mejoras de seguimiento (noviembre 2026)

- **Semáforo de entrega en la lista:** franja a la izquierda de la Ref en tickets *Por Ejecutar* / *Ingresado a PS* que aún esperan informe: verde a tiempo, ámbar vence en ≤ 3 días, rojo vencida.
- **Feriados del Perú en el SLA:** los días hábiles descuentan sábados, domingos y feriados nacionales (fijos + Jueves y Viernes Santo). Para un feriado nuevo o un día no laborable decretado, agréguelo a `FERIADOS_EXTRA` en `src/lib/shared.ts`.
- **Resumen semanal por correo:** cada lunes 8:00 (Lima) Vercel Cron llama a `/api/correctivos/avisos?resumen=semanal` (ver `vercel.json`) y envía por Resend: creados y finalizados de la semana, entregas vencidas, tickets sin informe y OC fuera de SLA. Variables en Vercel:
  - `RESEND_API_KEY` — clave de https://resend.com
  - `RESUMEN_PARA` — destinatarios separados por coma
  - `RESUMEN_DE` — remitente (dominio verificado en Resend; opcional)
  - `CRON_SECRET` — texto largo al azar (Vercel lo envía al cron)
  - `APP_URL` — dirección pública de la app para los enlaces (opcional)
  En el Panel, el botón **Resumen semanal** (admin) muestra la vista previa y permite enviar una prueba.
- **Evaluación de proveedores:** en Panel → Proveedores, columnas A tiempo, Vencidos, Sin informe y Nota (A/B/C).
- **Mini gráficos de tendencia** en las tarjetas del Panel (últimos 6 meses).
- **Modo presentación:** botón **Presentar** del Panel (pantalla completa; Esc para salir).
- **Frecuencia de mantenimiento por sistema:** valores sugeridos para tableros, bombas, UPS, grupo electrógeno, ascensores, extintores, detección de incendio y pozos a tierra; editable en Inventario.
- **QR para reportar fallas:** en Inventario (admin) se imprimen etiquetas por equipo; al escanearlas, cualquier persona reporta la falla sin usuario y llega a Gestión → Reportes con el código del equipo.
- **Tabla Cómoda / Compacta** en la lista (se recuerda en cada equipo).
- **Íconos de línea** en lugar de emojis en el menú, notificaciones y alertas.

## Seguimiento, presupuesto y preventivos (noviembre 2026, 2.ª tanda)

- **Historial y comentarios:** el ticket muestra una línea de tiempo (estado, documentos, OC/monto, comentarios). Los administradores agregan comentarios internos (Ctrl+Enter para enviar).
- **Recordar al proveedor:** botón en el ticket que abre un correo (Outlook) con el ticket, la OC, el lugar y la fecha de entrega; si la entrega venció, dice hace cuántos días.
- **Presupuesto anual:** en el Panel, el administrador define el presupuesto del año (total y, si quiere, por tipo de trabajo). Se compara con lo gastado (por fecha de OC o de registro) y avisa en «Requiere atención» desde el 80 %.
- **Comparar cotizaciones:** en la lista, selecciona de 2 a 4 tickets y toca «Comparar cotizaciones» (monto, plazo, garantía, validez, forma de pago, partidas).
- **Calendario de preventivos:** Inventario → Mantenimiento muestra los próximos 12 meses con los equipos que tocan mantenimiento y los vencidos.
- **Del reporte QR al ticket:** en Gestión → Reportes, «Pedir cotización por correo» arma el correo con los datos del reporte; al escribir el N° Ref. del ticket creado, el ticket queda enlazado al equipo del QR.
- **Fallas repetidas:** equipos con 3 o más correctivos en 6 meses se avisan en Inventario → Reemplazo y en el Panel.
- **Vistas:** vistas rápidas (Por Ejecutar sin informe, Ingresado a PS este mes, Cotizado sin OC, Registrados este mes) y vistas guardadas con nombre, sin ventanas emergentes.
- **Celular:** en pantallas chicas la lista se ve como tarjetas, con el semáforo de entrega.
- **Documentos PDF por equipo:** en la ficha de cada equipo del inventario, sección «Documentos (ficha técnica, manual, informes)». Los administradores suben PDF (hasta 8 por equipo, 4 MB cada uno) y cualquiera los ve en el visor dentro de la página, igual que las cotizaciones y OC.

## Montos: cotización, OC e informe deben coincidir

- Cada documento (cotización, OC e informe) guarda su **monto total con IGV**. Se lee solo del PDF al
  subirlo (la cotización y la OC siempre; el informe si trae su valorización, p. ej. «TOTAL S/ 1 180.00»).
  Si no se pudo leer, se escribe a mano en la fila del documento (S/ o US$), dentro del ticket.
- Encima de los documentos se ve la comparación: verde si coinciden (diferencia de S/ 1.00 o menos, por
  redondeos) y rojo si no, con la diferencia. Si la diferencia es justo el 18 %, avisa que parece ser el IGV.
- **Campana en la barra superior:** cuenta los tickets con montos que no coinciden y, al hacer clic, los
  lista para ir directo a cada uno. Se revisa al cambiar de página y cada 2 minutos. Solo la ven quienes
  tienen acceso a Correctivos. El mismo aviso («🔔 montos ≠») sale en la columna de alertas de la lista,
  en las notificaciones del Panel y en la revisión automática del ticket.
- Los tickets anteriores a este cambio no tienen montos por documento: se completan al volver a subir o
  leer la cotización y la OC («Leer cotización», «Leer OC»), o escribiéndolos a mano.

## Revisión de diseño (noviembre 2026)

- **Colores unificados** con la paleta institucional: rojo UPC (`danger`), verde (`teal`), ámbar de aviso
  (`aviso`, con su fondo `aviso-soft`) y grises (`page`, `concrete-dim`, `line`, `ink-soft`). Ya no se usan
  colores sueltos (#hex) ni la paleta genérica de Tailwind (slate, emerald, red, amber…).
- **Sin ventanas emergentes de confirmación:** quitar documentos, eliminar definitivamente un ticket,
  eliminar un usuario, borrar una foto, unir proveedores, vaciar o reemplazar la solicitud de materiales
  piden un **segundo clic** en el mismo botón (que cambia su texto por 5 segundos). La contraseña nueva de un
  usuario se escribe en la misma fila, no en una ventana.
- **Accesibilidad:** los campos con una etiqueta visible al lado la tienen también para lectores de
  pantalla, y todos los botones declaran su tipo.

## Presentación (noviembre 2026)

- **Barra de avance en cada ticket:** Cotización → Orden de compra → Ejecución → Informe → Certificado, con
  la fecha y el monto de cada paso, el paso actual resaltado y en rojo el documento cuyo monto no coincide.
  Se actualiza sola al cargar o quitar documentos.
- **Campana con todas las alertas:** agrupa por tipo (montos, atrasos, entregas, cotizaciones por vencer,
  SLA de OC, finalizados sin informe…), con su color y un enlace a cada ticket. Usa las mismas alertas
  elegidas en el Panel; «Montos que no coinciden» siempre aparece. Las alertas nuevas entran activas solas.
- **Lista en el celular:** cada tarjeta muestra lugar, monto, avance de documentos (con «S/ ≠» si los montos
  no coinciden) y fecha de OC; en la papelera, los botones Restaurar y Eliminar.
- **Mensajes uniformes** de «cargando» y «no hay datos», y la pantalla de carga igual a la barra real.
- **Ficha imprimible** (botón Imprimir del ticket): logo, campus, datos del trabajo, proveedor y OC, fechas,
  documentos con sus montos (y si coinciden), observaciones y firmas de mantenimiento, supervisión y
  proveedor, en A4.

## Inventario: búsqueda por ambiente

- Si lo escrito en el buscador del Inventario es un ambiente («aula 616», «a616», «616 a», «auditorio»,
  «sshh hombres», «aula 404 pabellón b»), aparece la **ficha del ambiente**: sus equipos con estado, marca y
  año (clic para abrir la ficha del equipo), cuántos están inoperativos o con observación, los correctivos
  del año que lo mencionan, el próximo mantenimiento (o cuántos equipos lo tienen vencido) y botones para
  **reportar una falla** en ese lugar o **imprimir su QR**.
- Si coinciden varios ambientes (p. ej. «aula 404» existe en los dos pabellones, o «laboratorio»), se
  muestran para elegir uno. «piso 4» o «sótano 1» dentro de lo escrito limita al piso.

## Inventario: buscador con sugerencias, QR, voz y alimentación eléctrica

- **Sugerencias al escribir:** desde la 2.ª letra, un menú propone equipos (con su estado en color), ambientes,
  marcas y tipos, con lo escrito resaltado. Flechas ↑ ↓ y Enter: un equipo abre su ficha, un ambiente su
  ficha de ambiente, una marca busca por ella y un tipo filtra.
- **Sin resultados:** propone la corrección más probable («extrator» → extractor, «fancoyl» → fancoil) y
  entiende palabras de uso diario («baño» → SS.HH., «aire» → split, «soler» → Soler & Palau); ofrece
  quitar los otros filtros o buscar solo la primera palabra.
- **Celular:** botón **QR** para escanear la etiqueta de un equipo (abre su ficha) o de un ambiente (abre la
  ficha del ambiente), y **micrófono** para dictar la búsqueda. Aparecen solo si el navegador los permite
  (QR: Chrome/Edge en Android; voz: Chrome y Edge).
- **Alimentación eléctrica en la ficha del ambiente:** «Ver de qué tablero se alimenta» busca en los planos de
  tableros los circuitos que nombran ese ambiente (por número, como «AULA A-616», o por nombre, como «DATA
  CENTER» o «SS.HH. VARONES»), en el mismo pabellón; cada tablero enlaza a **Gestión → Tableros eléctricos**,
  que abre el árbol en ese tablero y resalta el circuito (`/gestion/tableros#t=TA-A-1&k=C-2`).

## Inventario: cargar una carpeta completa

- Botón **«Cargar inventario»** (arriba a la derecha, administradores): se elige una **carpeta** y la app entra
  **carpeta por carpeta** (subcarpetas y archivos .zip incluidos) y lee **línea por línea todos los archivos**:
  - Excel y similares, **todas las hojas** (.xlsx, .xlsm, .xlsb, .xls, .ods, .csv, .tsv, .dbf…) y HTML;
  - Word (.docx: tablas, párrafos, encabezados y pies), PowerPoint (.pptx), OpenDocument (.odt, .odp), RTF;
  - PDF con texto (los de más de 4 MB se parten por páginas en el navegador y se leen por partes);
  - texto (.txt, .json, .xml, .log…), correos (.eml) y formatos antiguos (.doc, .ppt, .msg…: lectura
    aproximada de los textos que guardan);
  - cualquier otro archivo: si es texto, línea por línea; si es binario, los textos que guarde.
- En cada archivo se buscan **tablas de equipos** (columna de código o de equipo, y ubicación, serie, modelo o
  marca) y **fichas escritas como texto** («Equipo: … Marca: … Serie: … Ubicación: …», también en tablas de
  dos columnas «Marca | YORK»).
- **Nada queda suelto:** el resumen muestra, carpeta por carpeta, cada archivo con lo que se encontró, las
  líneas leídas, o el motivo si no tiene texto (imágenes, planos de AutoCAD, videos, comprimidos .rar/.7z,
  temporales de Office) o si dio error (p. ej. un PDF escaneado).
- Los Excel modernos (.xlsx, .xlsm) también se leen directamente de su XML, por si la librería de Excel no ve
  el texto (archivos que guardan el texto dentro de cada celda); por cada hoja se usa la lectura con más datos.
- **«Elegir archivos de Excel…»** permite marcar uno o varios Excel a la vez (Ctrl o Shift) en cualquier formato de
  hoja de cálculo (.xlsx, .xlsm, .xlsb, .xls, .ods, .csv…); se leen todas sus hojas con las mismas reglas.
- Los nombres de columna se reconocen aunque varíen («N° de inventario», «Descripción del bien», «Ubicación
  física», «EQUIPO (DESCRIPCIÓN)», «UBICACIÓN ACTUAL», «Fabricante»…). Si una hoja con datos no tiene una
  columna reconocible, el resumen muestra sus encabezados para corregirlos. Una lista de personas («Nombre»,
  «Área») no se toma como inventario.
- Con «Agregar» entran **solo los equipos nuevos**: nunca uno que ya esté en el inventario (mismo código; o, sin código,
  misma serie+marca+modelo o mismo equipo y ubicación) ni uno repetido entre archivos. Los existentes no se
  modifican. Cada archivo con equipos tiene una casilla para dejarlo fuera antes de guardar.

## Campana y resumen semanal

- La campana suma las **cuentas del presupuesto** del año al 80 % o más (en rojo si se pasaron), para quien
  tiene acceso a Presupuesto.
- El **correo de los lunes** incluye ahora los tickets con **montos que no coinciden** y las **cotizaciones por
  vencer**, con las mismas reglas que la campana.

## Planos (Gestión → Planos)

- Biblioteca de planos del campus por disciplina (Arquitectura, Seguridad / ITSE, Eléctricas, Sanitarias, HVAC, Estructuras…), con código, revisión, fecha, estado (Vigente / En revisión / Reemplazado), sede o nivel, autor, etiquetas y notas.
- **Subir planos:** se eligen o arrastran varios archivos a la vez (DWG, DXF, PDF, PNG o JPG; hasta 80 MB cada uno). Se crea un plano por archivo y el código, título, disciplina, sede y fecha se completan desde el nombre. El DWG y el PDF con el mismo nombre quedan en el mismo plano.
- **Ver:** el PDF se abre en el visor de la app. El navegador no puede dibujar un DWG: se muestra la miniatura que AutoCAD guarda dentro del archivo y el DWG se descarga para abrirlo en AutoCAD. Para verlo completo, exporte el PDF (Trazar / Publicar) con el mismo nombre del DWG.
- Los archivos se suben en partes de 3 MB (límite de Vercel por envío) y se guardan en Vercel Blob si está conectado; si no, en la base de datos. Para muchos planos se recomienda conectar Vercel Blob (Storage → Blob) para no llenar la base.
- La página se puede asignar por usuario como «Gestión · Planos».
- **Tableros eléctricos (Gestión → Tableros eléctricos, página propia):** árbol de alimentación de los 208 tableros de la sede San Isidro (planos IE-0116, IE-17 e ITSE, abril 2026) con sus 2 081 circuitos (llave termomagnética, diferencial, carga y cable), 25 indicadores que funcionan como filtros (grupo electrógeno, ascensores, presurización, extractores, luces de emergencia, diferenciales, demanda, reservas, inspección de diciembre 2025, inventario) y descarga de cada filtro en PDF. Al tocar el indicador del grupo electrógeno se completan los datos del grupo (potencia, tanque, consumo, autonomía, estado, mantenimiento) y se descarga el «informe FEN»: grupo, cobertura, equipos críticos con y sin respaldo, y brechas y riesgos. Es la página `public/tableros-circuitos.html` (todo incluido, sin conexiones externas), protegida por el inicio de sesión; se asigna por usuario como «Gestión · Tableros eléctricos» (quien tiene «Planos» también puede abrir el archivo). Para actualizarla se reemplaza ese archivo.

## Anexo: script para probar la lectura de una OC

Guárdalo como `scripts/probar-oc.ts`:

```ts
// Prueba la lectura de una o varias órdenes de compra en PDF SIN guardar nada.
//   npx tsx scripts/probar-oc.ts ruta/a/0000168413_PER05.PDF [otra.pdf ...]
// Muestra qué datos se leen y los avisos, para saber por qué una OC no se lee bien.
import fs from "node:fs";
import path from "node:path";
import { leerPdfDeOC } from "../src/lib/server/leerOC";

const archivos = process.argv.slice(2);
if (archivos.length === 0) {
  console.log("Uso: npx tsx scripts/probar-oc.ts archivo.pdf [más.pdf ...]");
  process.exit(1);
}
for (const ruta of archivos) {
  console.log(`\n=== ${path.basename(ruta)}`);
  const r = leerPdfDeOC(fs.readFileSync(ruta), path.basename(ruta));
  if (!r.ok) {
    console.log("NO SE PUDO LEER:", r.error);
    continue;
  }
  const d = r.datos;
  console.log("N° OC:", d.n_oc, "| fecha:", d.f_oc, "| entrega:", d.f_entrega);
  console.log("Proveedor:", d.proveedor, "| RUC:", d.ruc_proveedor, "| contrato:", d.contrato);
  console.log("Moneda:", d.moneda, "| subtotal:", d.subtotal, "| IGV:", d.igv, "| total:", d.total);
  console.log("Líneas:", d.lineas.length, "| fecha ambigua:", d.fecha_ambigua);
  console.log("Descripción:", d.descripcion);
  console.log("Avisos:", d.avisos.length ? d.avisos : "ninguno");
}
```
