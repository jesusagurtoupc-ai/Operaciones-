# Correctivos — Sistema de Gestión (Next.js + Vercel Postgres)

Aplicación web para reemplazar el archivo `Sistema_Correctivos_2025.xlsm`:
listado y CRUD de tickets correctivos, panel con gráficos, exportación a
Excel y acceso protegido con usuario y contraseña.

## 1. Requisitos

- Cuenta en [Vercel](https://vercel.com) (gratuita sirve).
- Cuenta en GitHub (o similar) para subir el código.
- Node.js 20+ instalado en tu computadora (para los pasos locales de migración/seed).

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
| `AUTH_USER`            | El usuario con el que iniciarás sesión (ej. `admin`)                   |
| `AUTH_PASSWORD_HASH`   | El hash de tu contraseña (ver siguiente paso)                          |

Para generar `AUTH_PASSWORD_HASH`, en tu computadora, dentro de la carpeta
del proyecto:

```bash
npm install
npm run hash-password -- "TuContraseñaSegura123"
```

Copia el valor `AUTH_PASSWORD_HASH=...` que imprime y pégalo en Vercel.

`DATABASE_URL` ya la puso Vercel automáticamente en el paso 4.

## 6. Crear la tabla e importar tus 319 tickets

Necesitas ejecutar esto **una sola vez**, apuntando a la base de datos real
de Vercel/Neon. En tu computadora:

1. En Vercel → Storage → tu base de datos → pestaña **.env.local** (o
   **Quickstart**), copia la cadena `DATABASE_URL`.
2. Crea el archivo `.env.local` en la raíz del proyecto (usa `.env.example`
   como plantilla) y pega ahí `DATABASE_URL`, `SESSION_SECRET`, `AUTH_USER`
   y `AUTH_PASSWORD_HASH` (los mismos valores que pusiste en Vercel).
3. Ejecuta:

```bash
npm run db:migrate   # crea la tabla "correctivos"
npm run db:seed      # importa los 319 registros del Excel original
```

Si algo falla por versión de Node, asegúrate de usar Node 20 o superior
(`node -v`).

## 7. Desplegar

Vuelve a Vercel y haz clic en **Deploy** (o **Redeploy** si ya existía el
proyecto). En unos minutos tendrás tu URL, por ejemplo
`https://correctivos-app.vercel.app`.

Entra con el `AUTH_USER` y la contraseña que definiste en el paso 5.

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
  app/
    login/                 página de acceso
    dashboard/              panel con gráficos
    correctivos/            listado, /nuevo, /[id] (editar)
    api/
      auth/login, logout    autenticación
      correctivos/          CRUD (GET, POST, PUT, DELETE)
      dashboard/            datos agregados para los gráficos
      export/                exportación a Excel
  components/               formulario, badge de estado, barra de navegación
  lib/
    db.ts                   conexión a Postgres (Neon)
    auth.ts                 sesión (JWT en cookie)
    opciones.ts             listas desplegables (Estado, Área, Tipo, Lugar)
    types.ts                tipos TypeScript
scripts/
  schema.sql                estructura de la tabla
  migrate.mjs                crea la tabla
  seed.mjs / seed-data.json  importa los 319 registros originales
  hash-password.mjs          genera el hash de la contraseña
```

## 10. Agregar más usuarios o cambiar la contraseña

Este sistema usa un solo usuario/contraseña (definidos por variables de
entorno) para mantenerlo simple. Si más adelante necesitas varios usuarios
con distintos permisos, se puede evolucionar a una tabla `usuarios` en la
misma base de datos — dímelo y lo agregamos.

## 11. Editar las listas desplegables

Las opciones de **Estado**, **Tipo de trabajo**, **Sub tipo**, **Área** y
**Lugar** están en `src/lib/opciones.ts`. Edita ese archivo, sube el cambio
a GitHub y Vercel volverá a desplegar automáticamente.
