/**
 * Marca simplificada inspirada en el símbolo de UPC (llama dentro de
 * una medialuna). Usa `currentColor`, así que hereda el color de texto
 * de donde se use (normalmente text-amber, el rojo institucional).
 */
export default function LogoUPC({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M18 42 A32 32 0 1 0 82 42"
        stroke="currentColor"
        strokeWidth="11"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M50 16
           C59 27 64 36 59 47
           C66 42 71 51 64 60
           C69 58 71 67 60 72
           C50 77 39 70 41 59
           C34 63 32 52 41 45
           C36 43 39 32 50 16 Z"
        fill="currentColor"
      />
    </svg>
  );
}
