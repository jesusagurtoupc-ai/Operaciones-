/* Logo institucional (public/logo-upc.png, fondo transparente). */
export default function LogoUPC({ className = "w-6 h-6" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo-upc.png" alt="" aria-hidden="true" className={`${className} object-contain`} />
  );
}
