import CambiarContrasena from "@/components/layout/CambiarContrasena";

// Pantalla obligatoria para quien entra con una contraseña temporal
// (administrador inicial o clave restablecida por otro administrador).
export default function CambiarClavePage() {
  return (
    <main className="min-h-screen bg-page">
      <CambiarContrasena forzado />
    </main>
  );
}
