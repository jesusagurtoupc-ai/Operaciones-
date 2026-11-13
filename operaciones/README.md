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

**Cargar muchos documentos a la vez (botón "+ Documentos").** Elige (o arrastra) todos los PDF que
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

**Si una OC no se lee bien.** Prueba el PDF sin guardar nada con
`npx tsx scripts/probar-oc.ts ruta/al/archivo.pdf`: muestra qué datos se leen y por qué falla.
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
navegador (no pasa por el servidor, así que también lo puede usar un usuario de solo lectura) y lleva datos
de la solicitud, tabla de materiales, totales, notas del proveedor (pedido mínimo y plazo de entrega) y
espacio para firmas. El borrador se guarda en el navegador mientras se trabaja; no se guarda en la base de datos.

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

## 9. Estructura del proyecto

```
src/
  app/                       páginas y rutas (lo que ve el navegador)
    login/  dashboard/  usuarios/
    correctivos/             lista y /[id] (ver y editar el ticket)
    materiales/              solicitud de materiales (PDF)
    api/                     auth, usuarios, correctivos (+ archivos, documentos, desde-oc,
                             actualizar-oc, aplicar-cotizacion, restaurar, avisos),
                             ordenes-compra, cotizaciones, materiales, dashboard, export
  components/
    layout/                  barra superior, logo, cambio de contraseña
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
    solicitudPdf.ts          PDF de la solicitud de materiales
    importarExcel.ts         importar materiales desde Excel
  proxy.ts                   control de acceso (sesión y rol de solo lectura)
public/                      logo y catálogos de materiales (JSON)
scripts/                     schema.sql y migrate.mjs (crean las tablas), importar-catalogo.mjs,
                             probar-oc.ts
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

