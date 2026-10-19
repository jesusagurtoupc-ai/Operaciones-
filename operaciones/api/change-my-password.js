import { neon } from "@neondatabase/serverless";
import { getFreshSession, loadUsers, verifyPassword, hashPassword } from "./auth.js";

// Endpoint dedicado y muy acotado: cualquier usuario autenticado (admin o no) puede cambiar
// SU PROPIA contraseña, siempre que confirme la actual. A propósito NO reusa /api/storage.js:
// esa ruta nunca deja que un usuario no-admin toque el array "users" de torre_ops_data (ver
// mergeTorreWorkerWrite), y eso es correcto — evitar que un miembro modifique roles, permisos
// o la cuenta de otra persona. Este endpoint hace exactamente lo mínimo necesario: localiza
// SOLO la fila del usuario de la sesión y le actualiza el passwordHash, sin tocar nada más
// (ni siquiera del mismo usuario: rol, permisos, trabajador vinculado, etc. quedan intactos).

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "metodo no soportado" });
  }

  const session = await getFreshSession(req);
  if (!session) return res.status(401).json({ error: "sin_sesion" });

  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    console.error("change-my-password: cuerpo invalido", e);
    return res.status(400).json({ error: "cuerpo_invalido" });
  }
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "faltan_campos" });
  if (newPassword.length < 4) return res.status(400).json({ error: "contrasena_muy_corta" });

  try {
    const users = await loadUsers();
    const user = users.find((u) => String(u.name || "").toLowerCase() === String(session.name || "").toLowerCase());
    if (!user || user.activo === false) return res.status(401).json({ error: "sin_sesion" });

    const stored = user.passwordHash || "";
    const { valid } = await verifyPassword(currentPassword, stored);
    if (!valid) return res.status(401).json({ error: "contrasena_actual_incorrecta" });

    const nuevoHash = await hashPassword(newPassword);

    // Reintenta ante conflictos de versión (otro guardado concurrente de torre_ops_data),
    // releyendo y reaplicando el cambio cada vez — nunca confía en un "users" completo
    // recibido del cliente, arma la lista siempre desde lo que ya está en la base.
    for (let intento = 0; intento < 5; intento++) {
      const rows = await sql`SELECT value, version FROM app_storage WHERE key = 'torre_ops_data'`;
      if (!rows.length) return res.status(404).json({ error: "not_found" });
      let data;
      try {
        data = JSON.parse(rows[0].value);
      } catch (e) {
        console.error("change-my-password: JSON invalido en torre_ops_data", e);
        return res.status(500).json({ error: "error_interno" });
      }
      const list = Array.isArray(data.users) ? data.users : [];
      let found = false;
      const nextUsers = list.map((u) => {
        if (String(u.name || "").toLowerCase() === String(session.name || "").toLowerCase()) {
          found = true;
          const { password: _plain, ...rest } = u;
          return { ...rest, passwordHash: nuevoHash };
        }
        return u;
      });
      if (!found) return res.status(404).json({ error: "usuario_no_encontrado" });

      const nextValue = JSON.stringify({ ...data, users: nextUsers });
      const updated = await sql`
        UPDATE app_storage
        SET value = ${nextValue}, version = version + 1, updated_at = now()
        WHERE key = 'torre_ops_data' AND version = ${rows[0].version}
        RETURNING version
      `;
      if (updated.length) return res.status(200).json({ ok: true });
      // Version cambió entre el SELECT y el UPDATE: se reintenta desde el inicio del for.
    }
    return res.status(409).json({ error: "conflicto_version" });
  } catch (e) {
    console.error("change-my-password error", e);
    return res.status(500).json({ error: "error_interno" });
  }
}
