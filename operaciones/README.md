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

## 4. Conectar la base de datos (Vercel Postgres / Neon)

1. En el proyecto de Vercel, ve a la pestaña **Storage** → **Create Database**
   → elige **Postgres** (Neon).
2. Vercel crea automáticamente la variable de entorno `DATABASE_URL` y la
   conecta a tu proyecto. No necesitas copiarla a mano.

## 5. Variables de entorno

En el proyecto de Vercel → **Settings → Environment Variables**, agrega:

| Variable              | Valor                                                                 |
|------------------------|------------------------------------------------------------------------|
| `SESSION_SECRET`       | Cadena aleatoria de **al menos 32 caracteres** (`openssl rand -hex 32`). En producción la app no inicia si es corta o es un valor de ejemplo |
| `INITIAL_ADMIN_PASSWORD` | Contraseña **temporal** del administrador inicial. **Obligatoria en producción** (mín. 10 caracteres, no un valor de ejemplo); solo se usa mientras no exista ningún usuario. El sistema obliga a cambiarla en el primer ingreso. En local, si falta, es `admin` |
| `INITIAL_ADMIN_USER`   | (Opcional) nombre del administrador inicial; por defecto `admin`. Conviene usar otro |

**Seguridad adicional**
- **Registro de accesos:** ingresos (correctos y fallidos), salidas y exportaciones a Excel quedan en la tabla `auditoria_accesos` con IP y navegador, y se conservan 180 días. Los administradores los ven en **Usuarios → Accesos recientes**. La subida y el borrado de archivos aparecen en el historial de cada ticket.
- **Política de contenido (CSP):** las páginas llevan un `nonce` distinto en cada petición y solo ejecutan los scripts que lo traen (ver `src/lib/server/csp.ts`). Si agregas un script externo (analítica, etc.) tendrá que cargarse desde código de la app, no con una etiqueta `<script>` suelta. También se envían HSTS, COOP y CORP.
- **Rol de base de datos con permisos mínimos (recomendado):** la app no necesita crear tablas ni borrar tickets. Crea el rol con `scripts/rol-app.sql`, ejecuta `npm run db:migrate` con `DATABASE_URL_MIGRACION` (conexión del propietario) y `APP_DB_ROLE=app_correctivos`, y en Vercel pon en `DATABASE_URL` la conexión de ese rol. Así, aunque alguien lograra ejecutar SQL desde la app, no podría borrar tablas, tickets ni el historial.

**Sesiones:** cada sesión dura 12 h y se renueva sola mientras se usa, con un tope de 7 días desde el ingreso. El botón **Salir de todos** cierra la sesión en todos los dispositivos. Las contraseñas creadas o restablecidas por un administrador son temporales: la persona debe cambiarlas al ingresar.

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
npm run db:migrate   # crea las tablas y columnas, y el índice único de N° Refer.
```

**Importante:** la app ya no crea ni modifica tablas al arrancar. Ejecuta
`npm run db:migrate` **antes de desplegar** cada versión nueva (es seguro repetirlo).
Si la base no está al día, la app avisa con un error claro en vez de fallar a medias.
Si hay N° Refer. repetidos, la migración los lista y omite el índice único:
corrígelos y vuelve a ejecutarla.

**Alternativa sin terminal:** abre el panel de Neon (Vercel → Storage → tu base
de datos → "Browse data" o el enlace a Neon) → **SQL Editor** → pega ahí todo el
contenido de `scripts/schema.sql` → Ejecutar.

## 7. Desplegar

Vuelve a Vercel y haz clic en **Deploy** (o **Redeploy** si ya existía el
proyecto). En unos minutos tendrás tu URL, por ejemplo
`https://correctivos-app.vercel.app`.

Entra con el usuario inicial `admin` (se crea solo en el primer ingreso, con la
contraseña de `INITIAL_ADMIN_PASSWORD`; en producción la app no lo crea si esa
variable falta o tiene menos de 10 caracteres). Cámbiala con el botón **Contraseña**.

## 8. Uso diario

- **Panel** (`/dashboard`): KPIs y gráficos (monto por estado, por tipo de
  trabajo, tendencia mensual, monto por área).
- **Correctivos** (`/correctivos`): tabla con filtros (estado, área, tipo,
  lugar, búsqueda de texto, rango de fechas), paginación, crear/editar/
  eliminar, y botón **Exportar Excel** que descarga exactamente lo que
  estás viendo (respeta los filtros aplicados).

## 9. Estructura del proyecto

```
src/
  app/                       páginas y rutas (lo que ve el navegador)
    login/  dashboard/  usuarios/
    correctivos/             lista, /nuevo, /eliminados y /[id] (editar)
    api/                     auth, usuarios, correctivos (+ archivos y documentos),
                             dashboard, export
  components/
    layout/                  barra superior, logo, cambio de contraseña
    ticket/                  formulario, documentos, historial, ficha imprimible,
                             guardado en carpeta, etiqueta de estado
    lista/                   tarjetas y filtros de la lista de correctivos
    dashboard/               gráficos (se cargan aparte) y tipos del panel
    ui/                      diálogos propios (confirmar, pedir texto o contraseña)
  lib/
    server/                  solo servidor: base de datos, sesión, filtros SQL,
                             historial, límite de intentos de login
    client/                  solo navegador: usuario en sesión, carpeta local
    shared/                  común: tipos, listas desplegables, formatos,
                             reglas de archivos
  proxy.ts                   control de acceso (sesión y rol de solo lectura)
tests/                       pruebas automáticas (Vitest)
.github/workflows/ci.yml     revisión automática en GitHub (lint, tipos, pruebas, build, audit)
public/                      logo
scripts/                     schema.sql y migrate.mjs (crean las tablas)
```

## 10. Usuarios, roles y archivos adjuntos

**Usuarios y roles.** Entra como administrador y abre **Usuarios** en la barra
superior. Hay dos roles:

- **Administrador**: crea, edita y elimina tickets y archivos, y gestiona usuarios.
- **Solo lectura**: ve y filtra tickets, abre archivos y exporta a Excel, sin modificar nada
  (el servidor bloquea cualquier cambio aunque se intente por fuera de la pantalla).

Cualquier usuario puede cambiar su propia contraseña con el botón **Contraseña** de la barra superior (pide la actual). Desde la página Usuarios, el administrador también restablece la de cualquier otro, se desactivan o eliminan
usuarios. No se puede eliminarse ni quitarse el rol a uno mismo, y siempre
queda al menos un administrador activo. Las tablas las crea
`npm run db:migrate` (ver sección 6), no la app.

**Archivos adjuntos.** En la pantalla del ticket (`/correctivos/[id]`) hay una
sección "Archivos adjuntos": los administradores agregan PDF, imágenes, Word o
Excel (máx. 4 MB por archivo, 20 por ticket; las fotos se reducen solas) y
cualquier usuario puede abrirlos con el enlace. Se guardan en la misma base de
datos Postgres, así que no requieren conectar ningún servicio nuevo; si algún
día se necesitan archivos más pesados, el cambio natural es Vercel Blob.

**Guardar en una carpeta del computador.** En la pantalla del ticket, el botón
**Guardar en carpeta** crea dentro de la carpeta elegida una carpeta por ticket
(`123_Descripción del ticket/`: N° de referencia, guion bajo y la descripción) con una subcarpeta por cada documento que tenga archivo
(`cotizacion/`, `oc/`, `informe/`, `certificado/`), y dentro de cada una el
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

## 11. Seguridad y validaciones

- **Archivos adjuntos**: además de la extensión se comprueba el contenido
  (los primeros bytes) para que un archivo `.pdf` sea de verdad un PDF, una
  imagen una imagen, etc. SVG y HTML siguen excluidos.
- **Límite de intentos de login**: 5 fallos por usuario + IP bloquean durante
  15 minutos. Se guarda en la tabla `intentos_login`, así vale para todas las
  instancias del servidor.
- **Registro de acciones sobre usuarios** (tabla `auditoria_usuarios`): crear,
  cambiar rol, activar/desactivar, restablecer o cambiar contraseña y eliminar.
  Se ve en **Usuarios → Actividad reciente**.
- **Excel**: la exportación usa `exceljs` (antes `xlsx`, que tiene avisos de
  seguridad sin corrección en npm). Los textos se escriben siempre como texto:
  una descripción que empiece con `=` no se ejecuta como fórmula.

- **Contraseñas nuevas**: mínimo 10 caracteres y hash bcrypt de coste 12. Las
  contraseñas antiguas siguen funcionando para entrar y su hash se actualiza
  solo en el siguiente inicio de sesión.
- **Escritura solo para administradores**: crear, editar y eliminar tickets se
  comprueba también dentro de cada ruta de la API, no solo en `proxy.ts`.
- **Validación en el servidor** (`src/lib/server/validacion.ts`): estado, tipo,
  sub tipo, área y lugar deben estar en las listas (un ticket antiguo conserva
  su valor actual aunque ya no esté en la lista), fechas reales, N° Refer. entero,
  monto en rango y largos máximos de texto. Los errores devuelven 400.
- **Contraseñas: reglas extra**: máximo 72 bytes (bcrypt ignora lo que pase de ahí) y se
  rechazan las muy comunes, las de un solo carácter repetido y las iguales al nombre de
  usuario (`src/lib/shared/passwords.ts`).
- **Verificación de Origin**: en POST/PUT/PATCH/DELETE (incluido el login), `proxy.ts`
  responde 403 si la cabecera `Origin` existe y no coincide con el sitio (`src/lib/server/origen.ts`).
- **Siempre queda un administrador activo**: la regla se aplica dentro de la propia sentencia
  SQL (`src/lib/server/admins.ts`), no con una comprobación previa, para que dos cambios
  simultáneos no puedan dejar cero administradores.
- **Documentos de un ticket**: al guardar, el archivo enlazado debe existir y ser de ese
  mismo ticket; al mostrarlo, el enlace se vuelve a validar.
- **Verificación en dos pasos (TOTP)**: opcional para cualquier usuario (botón **2FA** de la barra
  superior). Compatible con Google/Microsoft Authenticator, Authy, 1Password. El secreto se guarda
  cifrado con una clave derivada de `SESSION_SECRET` (si la cambias, hay que restablecer el 2FA de
  los usuarios), un código no se puede reutilizar y los códigos malos cuentan como fallos de login.
  Requiere correr `npm run db:migrate` (columnas `mfa_*`). Si alguien pierde su teléfono, otro
  administrador usa **Usuarios → Quitar 2FA**. Al activarlo se muestran 8 **códigos de respaldo** de un solo
  uso (solo se guardan sus huellas); se escriben en el mismo campo del login y se pueden regenerar desde el
  botón 2FA. Si fuera el único administrador y no tuviera respaldos:
  `UPDATE usuarios SET mfa_activo=false, mfa_secreto=NULL, mfa_ultimo_paso=0 WHERE username='...';`
- **Destino tras el login** (`src/lib/shared/rutas.ts`): el parámetro `next` solo admite rutas internas; se
  rechazan tabuladores, saltos de línea y barras invertidas (el navegador los elimina y convertiría
  `/<TAB>/sitio.com` en `//sitio.com`).
- **"Salir" revoca la sesión en el servidor** (tabla `sesiones_revocadas`): una cookie copiada deja de valer
  al instante en la instancia que atiende el cierre y en las demás en cuanto vence su caché (≤10 s).
- **Escrituras siempre contra la base**: en POST/PUT/PATCH/DELETE el proxy ignora la caché de 10 s, así que
  una desactivación o cambio de rol aplica de inmediato a cualquier acción que modifique datos.
- **PDF con scripts**: al subir se rechazan los PDF con `/JavaScript`, `/JS`, `/Launch` o `/RichMedia`
  (comprobación de estructura, no un antivirus).
- **IP del cliente**: solo se confía en las cabeceras de reenvío en Vercel o con `TRUST_PROXY=1`.
- **Archivos**: ya no se aceptan `.doc` ni `.xls` (pueden traer macros); usa `.docx` / `.xlsx`.
  Se rechaza por `Content-Length` antes de leer el cuerpo. La exportación a Excel tiene tope de 20 000 filas.
- **Cabeceras de seguridad** (`next.config.ts`): CSP en las páginas (no en `/api`,
  para que se abran los PDF adjuntos), `X-Frame-Options`, `nosniff`,
  `Referrer-Policy` y `Permissions-Policy`.

- **N° Refer. único** entre los tickets activos (índice en la base). Si dos
  personas crean un ticket a la vez, el sistema reintenta con el siguiente
  número; si se escribe a mano un N° ya usado, responde que ya existe.
- **Eliminar es un borrado lógico**: el ticket desaparece de la lista, el panel
  y el Excel, pero conserva archivos e historial (queda "Ticket eliminado" con
  usuario y fecha). Para recuperarlo, un administrador entra a **Eliminados**
  (menú superior) y pulsa **Restaurar**. Si su N° Refer. ya lo usa otro ticket
  activo, se le asigna el siguiente número libre y se avisa.
- **Cambiar o restablecer una contraseña cierra las demás sesiones abiertas**
  de ese usuario. La sesión desde la que se cambia se renueva.

## 12. Editar las listas desplegables

Las opciones de **Estado**, **Tipo de trabajo**, **Sub tipo**, **Área** y
**Lugar** están en `src/lib/shared/opciones.ts`. Edita ese archivo, sube el cambio
a GitHub y Vercel volverá a desplegar automáticamente.

## 13. Pruebas y revisión automática

```bash
npm test             # pruebas: filtros SQL, orden, validación, historial, firmas de archivo
                     # y rutas de la API (permisos y códigos de respuesta, con la base simulada)
npm run typecheck    # tsc
npm run lint         # eslint
```

En GitHub, el workflow `.github/workflows/ci.yml` corre lint, tipos, pruebas,
`next build` y `npm audit --omit=dev` en cada push y pull request. El audit
solo mira las dependencias de producción; los avisos que quedan en `npm audit`
completo vienen de `eslint-config-next` (herramienta de desarrollo que no
llega a Vercel).


## Seguridad: mejoras de la auditoría (tanda 7)

- **Límite de login atómico**: el intento se cuenta *antes* de verificar la contraseña (una sola
  sentencia SQL). Antes se comprobaba y se sumaba el fallo después, así que muchas peticiones en
  paralelo pasaban el control. Topes: 5 por usuario+IP, 100 intentos por IP y 60 por usuario. Un
  login correcto limpia el contador de usuario+IP y devuelve el intento del contador de usuario.
- **Reautenticación del administrador**: crear, editar (rol, estado, contraseña, 2FA) o eliminar
  usuarios pide de nuevo la contraseña (y el código del 2FA si lo tiene). La confirmación vale 10
  minutos (cookie `correctivos_reauth`). Una cookie de sesión robada ya no basta. Salida de emergencia:
  `REAUTH_ADMIN=0`.
- **2FA obligatorio para administradores** (opcional): `REQUIRE_ADMIN_MFA=1`. Actívalo cuando todos los
  administradores tengan el 2FA activado.
- **`MFA_KEY`**: clave propia para cifrar los secretos TOTP (ver `.env.example`).
- **IP del cliente**: `x-vercel-forwarded-for` solo se confía con `VERCEL=1` (Vercel lo define solo).
- **Registro de accesos**: un intento fallido solo guarda el nombre si es de un usuario real
  (por si alguien escribe su contraseña en el campo usuario).
- **Cambio de contraseña** con límite de intentos (10 por 15 min).
- **Archivos adjuntos**: las imágenes y los archivos de Office se sirven con
  `Content-Security-Policy: default-src 'none'; sandbox` (los PDF no, para no bloquear el visor de
  Chrome), y el tope de 20 por ticket se aplica dentro del propio INSERT.
- **Cookie de sesión** con prefijo `__Host-` en producción (al desplegar, las sesiones abiertas se
  cierran una vez). Las comprobaciones de administrador leen siempre de la base (sin caché).

- **Pruebas con base real**: `tests/integracion-db.test.ts` ejecuta login, 2FA, reautenticación, usuarios,
  archivos y filtros contra un PostgreSQL real en memoria (PGlite), no contra una base simulada.
