// Ejecuta: npm run hash-password -- "tu-contraseña"
// Copia el resultado en la variable de entorno AUTH_PASSWORD_HASH
import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error('Uso: npm run hash-password -- "tu-contraseña"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);

// Los caracteres "$" del hash de bcrypt son interpretados por Next.js
// como referencias a otras variables de entorno (p.ej. "$2b" se lee como
// la variable "2b") y el hash queda corrupto de forma silenciosa, tanto
// en desarrollo local como en Vercel. Para evitarlo, se guarda en
// Base64 y se decodifica en el servidor antes de compararlo.
const encoded = Buffer.from(hash, "utf-8").toString("base64");

console.log("\nAUTH_PASSWORD_HASH=" + encoded + "\n");
