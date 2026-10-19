import { lazy, Suspense } from "react";

const AppShell = lazy(() => import("./AppShell.jsx"));

// Nota: se usan los valores literales de COLORS.bg/COLORS.text (no un import de
// core-common.jsx) a propósito: esta pantalla se pinta ANTES de que se descargue
// el chunk grande de la app (AppShell + core-common). Importar core-common aquí
// haría que Vite lo incluya en el bundle inicial en vez de en el chunk diferido
// de AppShell, anulando el code-splitting (probado: el bundle inicial pasó de
// ~145 KB a ~553 KB). Si cambian COLORS.bg/COLORS.text en core-common.jsx,
// actualizar también estos dos valores.
const LOADING_BG = "#0a0e15";
const LOADING_TEXT = "#eef2f8";

function AppLoading() {
  return (
    <div style={{minHeight:"100vh",display:"grid",placeItems:"center",background:LOADING_BG,color:LOADING_TEXT,fontFamily:"system-ui,sans-serif"}}>
      <div style={{textAlign:"center",padding:24}}>
        <div style={{fontSize:18,fontWeight:700}}>Operaciones</div>
        <div style={{marginTop:8,fontSize:13,opacity:.7}}>Cargando módulos…</div>
      </div>
    </div>
  );
}

export default function App() {
  return <Suspense fallback={<AppLoading />}><AppShell /></Suspense>;
}
