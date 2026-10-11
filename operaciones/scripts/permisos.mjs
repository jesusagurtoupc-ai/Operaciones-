// Permisos mínimos del rol con el que corre la APLICACIÓN (no el de migración).
// La app nunca crea ni modifica tablas, y no necesita borrar tickets (el borrado
// es lógico), ni editar o borrar el historial ni la auditoría.

export const PERMISOS_TABLAS = {
  correctivos: ["SELECT", "INSERT", "UPDATE"],
  usuarios: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  archivos: ["SELECT", "INSERT", "DELETE"],
  historial: ["SELECT", "INSERT"], // solo se agrega: no se edita ni se borra
  auditoria_usuarios: ["SELECT", "INSERT"], // solo se agrega
  auditoria_accesos: ["SELECT", "INSERT", "DELETE"], // DELETE: retención de 180 días
  intentos_login: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  sesiones_revocadas: ["SELECT", "INSERT", "DELETE"], // DELETE: limpieza de las ya vencidas
};

/** Nombre de rol seguro para escribirlo en SQL (se cita igualmente). */
export function rolValido(rol) {
  return typeof rol === "string" && /^[a-z_][a-z0-9_]{0,62}$/.test(rol);
}

/** Sentencias GRANT/REVOKE para el rol de la aplicación. Es seguro repetirlas. */
export function sentenciasPermisos(rol) {
  if (!rolValido(rol)) {
    throw new Error(`APP_DB_ROLE no es un nombre de rol válido: "${rol}" (usa minúsculas, números y _)`);
  }
  const r = `"${rol}"`;
  return [
    `GRANT USAGE ON SCHEMA public TO ${r}`,
    `REVOKE CREATE ON SCHEMA public FROM ${r}`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`,
    ...Object.entries(PERMISOS_TABLAS).map(
      ([tabla, permisos]) => `GRANT ${permisos.join(", ")} ON TABLE public.${tabla} TO ${r}`
    ),
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`,
  ];
}
