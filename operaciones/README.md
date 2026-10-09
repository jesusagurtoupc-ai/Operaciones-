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
| `SESSION_SECRET`       | Cualquier cadena larga y aleatoria (ej. genera una con `openssl rand -hex 32`) |
| `INITIAL_ADMIN_PASSWORD` | Contraseña inicial del usuario `admin` (recomendado; si falta, es `admin`) |

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
contraseña de `INITIAL_ADMIN_PASSWORD`, o `admin` si no la definiste; cámbiala
de inmediato con el botón **Contraseña**).

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
    correctivos/             lista, /nuevo y /[id] (editar)
    api/                     auth, usuarios, correctivos (+ archivos y documentos),
                             dashboard, export
  components/
    layout/                  barra superior, logo, cambio de contraseña
    ticket/                  formulario, documentos, historial, ficha imprimible,
                             guardado en carpeta, etiqueta de estado
    lista/                   tarjetas y filtros de la lista de correctivos
    dashboard/               gráficos (se cargan aparte) y tipos del panel
  lib/
    server/                  solo servidor: base de datos, sesión, filtros SQL,
                             historial, límite de intentos de login
    client/                  solo navegador: usuario en sesión, carpeta local
    shared/                  común: tipos, listas desplegables, formatos,
                             reglas de archivos
  proxy.ts                   control de acceso (sesión y rol de solo lectura)
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
queda al menos un administrador activo. Las tablas `usuarios` y `archivos` se
crean solas la primera vez que la app las necesita.

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

## 11. Editar las listas desplegables

Las opciones de **Estado**, **Tipo de trabajo**, **Sub tipo**, **Área** y
**Lugar** están en `src/lib/shared/opciones.ts`. Edita ese archivo, sube el cambio
a GitHub y Vercel volverá a desplegar automáticamente.
