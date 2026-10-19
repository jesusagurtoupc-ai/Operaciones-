import { useState, useEffect, useMemo } from "react";
import * as C from "./core-common";
import { ImportarDatosModal } from "./import-datos";
const {
  storageJSON,
  APP_VERSION,
  COLORS,
  fmtMoney,
  fmtPct,
  normEstado,
  STORAGE_KEY_ASISTENCIA_SUELDOS,
  STORAGE_KEY_ASISTENCIA_PLANILLA_FIJA,
  STORAGE_KEY_ASISTENCIA_DESCUENTOS_BONOS,
  resumenPlanillaPorTrabajador,
  todayStr,
  montoGasto,
  canonicalPersonName,
  AccesosPersonal,
  filterOwnRecords,
  DropdownSelect,
  OCSelector,
  buildOcOptions,
  parseOcList,
} = C;

function Dashboard({ me, isAdmin, onNavigate, propuestasPendientesCount = 0, onOpenPropuestas, onOpenCreateUser, asistenciaReadOnly = false, asistenciaCanDelete = true, canAction = () => true, ownerIdentity = "" }) {
  const [loading,setLoading]=useState(true), [search,setSearch]=useState(""), [loadError,setLoadError]=useState("");
  const [showImportar,setShowImportar]=useState(false);
  const [d,setD]=useState({trabajos:[],tareas:[],asistencia:[],trabajadores:[],viaticos:[],gastos:[],contactos:[],cajaChica:[],sueldos:{},usuarios:[],sueldosPlanillaFija:{},descuentosBonos:{}});
  // El resumen del Inicio combina datos de varios módulos. La letra T ("ver información de todos
  // los usuarios") de cada módulo decide si ese módulo aporta todos los registros o solo los del
  // propio usuario; la letra V ("ver") decide si aporta información al Inicio o no aporta nada.
  // Así, T queda limitada por las demás letras en vez de mostrar siempre todo o siempre lo propio.
  const scopeByModule=(records,modulo,campo)=>{
    if(!canAction(modulo,"ver")) return [];
    if(canAction(modulo,"todos")) return records;
    return filterOwnRecords(records||[],ownerIdentity,campo);
  };
  const load=async()=>{
    setLoading(true);
    setLoadError("");
    try {
    const [trabajos,torre,asistencia,trabajadores,viaticos,gastos,contactos,cajaChica,sueldos,sueldosPlanillaFija,descuentosBonos]=await Promise.all([
      storageJSON("wilarcon_trabajos_records",[]),storageJSON("torre_ops_data",{tasks:[]}),
      storageJSON("wilarcon_asistencia_registros",[]),storageJSON("wilarcon_asistencia_trabajadores",[]),
      storageJSON("wilarcon_viaticos_records",[]),storageJSON("wilarcon_gastos_records",[]),storageJSON("wilarcon_contactos_records",[]),
      canAction("caja_chica","ver") ? storageJSON("wilarcon_caja_chica_records",[]) : Promise.resolve([]),
      storageJSON(STORAGE_KEY_ASISTENCIA_SUELDOS,null),
      storageJSON(STORAGE_KEY_ASISTENCIA_PLANILLA_FIJA,{}),
      storageJSON(STORAGE_KEY_ASISTENCIA_DESCUENTOS_BONOS,{})
    ]);
    setD({
      trabajos:scopeByModule(Array.isArray(trabajos)?trabajos:[],"trabajos","responsable"),
      tareas:scopeByModule(Array.isArray(torre?.tasks)?torre.tasks:[],"torre","responsable"),
      asistencia:scopeByModule(Array.isArray(asistencia)?asistencia:[],"asistencia","trabajador"),
      trabajadores:canAction("asistencia","ver")?(Array.isArray(trabajadores)?trabajadores:[]):[],
      viaticos:scopeByModule(Array.isArray(viaticos)?viaticos:[],"viaticos","trabajador"),
      gastos:canAction("gastos","ver")?(Array.isArray(gastos)?gastos:[]):[],
      contactos:canAction("contactos","ver")?(Array.isArray(contactos)?contactos:[]):[],
      cajaChica:canAction("caja_chica","ver")?(Array.isArray(cajaChica)?cajaChica:[]):[],
      sueldos:(sueldos&&typeof sueldos==="object")?sueldos:{},
      usuarios:Array.isArray(torre?.users)?torre.users:[],
      sueldosPlanillaFija:(sueldosPlanillaFija&&typeof sueldosPlanillaFija==="object")?sueldosPlanillaFija:{},
      descuentosBonos:(descuentosBonos&&typeof descuentosBonos==="object")?descuentosBonos:{}
    });
    setLoading(false);
    } catch (error) {
      console.error("[dashboard] no se pudieron cargar todos los indicadores", error);
      setLoadError("No se pudieron actualizar todos los indicadores. Verifica la conexión y vuelve a intentarlo.");
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- carga inicial (una sola vez al montar);
  // load es una función local redefinida en cada render y no debe volver a dispararse por eso.
  useEffect(()=>{load()},[]);
  const [planillaAnio,setPlanillaAnio]=useState(Number(todayStr().slice(0,4)));
  const [planillaMes,setPlanillaMes]=useState(Number(todayStr().slice(5,7)));
  const planillaYM=`${planillaAnio}-${String(planillaMes).padStart(2,"0")}`;
  const MESES_NOMBRES_DASH=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const aniosDisponiblesPlanilla=useMemo(()=>{
    const set=new Set(d.asistencia.map(r=>Number((r.fecha||"").slice(0,4))).filter(Boolean));
    set.add(Number(todayStr().slice(0,4)));
    return [...set].sort((a,b)=>b-a);
  },[d.asistencia]);
  const planilla=useMemo(()=>resumenPlanillaPorTrabajador(d.asistencia,planillaYM,d.sueldos,d.sueldosPlanillaFija,d.descuentosBonos),[d.asistencia,planillaYM,d.sueldos,d.sueldosPlanillaFija,d.descuentosBonos]);
  const viaticosPlanilla=useMemo(()=>{
    const mapa={};
    let total=0;
    (d.viaticos||[]).forEach(v=>{
      if((v.fecha||"").slice(0,7)!==planillaYM) return;
      const monto=Number(v.monto??v.total??v.importe??0)||0;
      const rawTrabajador=String(v.trabajador||"").trim();
      const trabajador=canonicalPersonName(rawTrabajador,d.trabajadores) || rawTrabajador || "Sin asignar";
      mapa[trabajador]=(mapa[trabajador]||0)+monto;
      total+=monto;
    });
    return {mapa,total};
  },[d.viaticos,d.trabajadores,planillaYM]);
  const resumenPlanilla=useMemo(()=>({
    sueldoNeto:planilla.reduce((s,p)=>s+(Number(p.sueldoNeto)||0),0),
    horasExtra:planilla.reduce((s,p)=>s+(Number(p.montoHorasExtra)||0),0),
    viaticos:viaticosPlanilla.total
  }),[planilla,viaticosPlanilla]);
  const totalPlanillaEstimada=resumenPlanilla.sueldoNeto+resumenPlanilla.horasExtra+resumenPlanilla.viaticos;
  const today=todayStr(), tareasVivas=d.tareas.filter(t=>!t.deleted), pending=tareasVivas.filter(t=>!["COMPLETADO","FINALIZADO"].includes(normEstado(t.estado))), overdue=pending.filter(t=>t.fin&&t.fin<today);
  // Filtro opcional por N° de OC: cuando hay una OC seleccionada, los KPI que
  // dependen de Trabajos/Gastos/Viáticos/Caja Chica (todos módulos que
  // referencian una OC) se recalculan solo con los registros de esa OC.
  // Los KPI que no tienen relación con una OC (tareas, personal, solicitudes)
  // no se ven afectados por este filtro.
  const [filtroOc,setFiltroOc]=useState("");
  const ocOptionsDash=useMemo(()=>buildOcOptions(d.trabajos),[d.trabajos]);
  const ocMatch=(oc)=>String(oc||"").trim().toLocaleLowerCase()===filtroOc.toLocaleLowerCase();
  const trabajosF=useMemo(()=>filtroOc?d.trabajos.filter(r=>ocMatch(r.oc)):d.trabajos,[d.trabajos,filtroOc]);
  const viaticosF=useMemo(()=>filtroOc?d.viaticos.filter(v=>ocMatch(v.oc)):d.viaticos,[d.viaticos,filtroOc]);
  const gastosF=useMemo(()=>filtroOc?d.gastos.filter(g=>parseOcList(g.oc).some(x=>x.toLocaleLowerCase()===filtroOc.toLocaleLowerCase())):d.gastos,[d.gastos,filtroOc]);
  const cajaChicaF=useMemo(()=>filtroOc?d.cajaChica.filter(r=>parseOcList(r.oc).some(x=>x.toLocaleLowerCase()===filtroOc.toLocaleLowerCase())):d.cajaChica,[d.cajaChica,filtroOc]);
  const fact=trabajosF.reduce((a,r)=>a+(Number(r.totalFacturado ?? r.total ?? 0)||0),0), gastos=gastosF.filter(g=>normEstado(g.tipo)==="EGRESO").reduce((a,g)=>a+montoGasto(g),0), viaticos=viaticosF.reduce((a,v)=>a+(Number(v.monto ?? v.total ?? v.importe ?? 0)||0),0);
  const cobroPendiente=trabajosF.filter(r=>normEstado(r.medioPago)==="PENDIENTE" || !r.medioPago).reduce((a,r)=>a+(Number(r.total)||0),0);
  const cajaChicaTotal=cajaChicaF.reduce((a,r)=>a+(Number(r.importe)||0),0);
  const cajaChicaPendiente=cajaChicaF.filter(r=>normEstado(r.estado)==="PENDIENTE").reduce((a,r)=>a+(Number(r.importe)||0),0);
  const cajaChicaAprobado=cajaChicaF.filter(r=>normEstado(r.estado)==="APROBADO").reduce((a,r)=>a+(Number(r.importe)||0),0);
  const cajaChicaPagado=cajaChicaF.filter(r=>normEstado(r.estado)==="PAGADO").reduce((a,r)=>a+(Number(r.importe)||0),0);
  const costoTotalOc=gastos+viaticos+cajaChicaTotal;
  const resultadoEstimado=fact-costoTotalOc;
  const margenEstimado=fact ? resultadoEstimado/fact : 0;
  const gp=gastosF.filter(g=>normEstado(g.tipo)==="EGRESO" && normEstado(g.estado)==="PENDIENTE").length;
  const docsPendientes=trabajosF.filter(r=>normEstado(r.estadoInforme)!=="LISTO" || normEstado(r.estadoAC)!=="LISTO" || normEstado(r.estadoFactura)==="PENDIENTE").length;
  const results=search.trim()?[
    ...d.trabajos.filter(r=>`${r.oc} ${r.contacto} ${r.ubicacion} ${r.descripcion}`.toLowerCase().includes(search.toLowerCase())).slice(0,4).map(r=>({p:"trabajos",t:`OC ${r.oc||"—"}`,s:r.descripcion||r.ubicacion||""})),
    ...tareasVivas.filter(t=>`${t.tarea} ${t.responsable} ${t.estado}`.toLowerCase().includes(search.toLowerCase())).slice(0,4).map(t=>({p:"torre",t:t.tarea||"Tarea",s:`${t.responsable||"Sin responsable"} · ${t.estado||""}`}))
  ].slice(0,7):[];
  const cards=[
    ["Órdenes / trabajos",trabajosF.length,`${trabajosF.filter(r=>/ATENDIDO|COMPLETADO|FINALIZADO/i.test(String(r.observacion||r.estado||""))).length} atendidos`,"trabajos","▣"],
    ["Tareas activas",pending.length,`${overdue.length} vencidas`,"torre","◈"],
    ["Personal registrado",d.trabajadores.length,"Control de asistencia","asistencia","◎"],
    ["Facturación acumulada",fmtMoney(fact),"Monto facturado registrado","trabajos","S/"],
    ["Cobro pendiente",fmtMoney(cobroPendiente),"Requiere seguimiento","trabajos","$"],
    ["Gastos registrados",fmtMoney(gastos),`${gp} por revisar`,"gastos","↘"],
    ["Viáticos",fmtMoney(viaticos),`${viaticosF.length} registro(s)`,"viaticos","✦"],
    ...(canAction("caja_chica","ver")?[["Caja Chica",fmtMoney(cajaChicaTotal),`${fmtMoney(cajaChicaPendiente)} pendiente · ${fmtMoney(cajaChicaPagado)} pagado`,"caja_chica","▤"]]:[]),
    [
      "Resultado operativo estimado",
      fmtMoney(resultadoEstimado),
      `Margen ${fmtPct(margenEstimado)} · no incluye planilla`,
      "trabajos",
      "◉"
    ],
    ...(isAdmin?[["Solicitudes por aprobar",propuestasPendientesCount,propuestasPendientesCount?"Requieren tu revisión":"Todo al día","__propuestas","🔔"]]:[])
  ];
  const alerts=[...overdue.slice(0,5).map(t=>({c:COLORS.red,t:"Tarea vencida",s:`${t.tarea||"Sin descripción"} · ${t.responsable||"Sin responsable"}`,p:"torre"})),...(gp?[{c:COLORS.amber,t:"Gastos por revisar",s:`${gp} registro(s) pendientes`,p:"gastos"}]:[])].slice(0,7);
  return <div className="wc-dash"><style>{`
    .wc-dash{padding:20px 22px 40px;max-width:1600px;margin:auto}.wc-hero{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-bottom:18px}.wc-ey{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:${COLORS.blue};font-weight:700}.wc-title{font:700 25px 'Space Grotesk',sans-serif;color:${COLORS.text};margin:4px 0}.wc-sub{font-size:12px;color:${COLORS.dim}}.wc-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.wc-btn,.wc-search{background:${COLORS.panel};border:1px solid ${COLORS.border};color:${COLORS.text};border-radius:8px;padding:9px 12px;font-size:11.5px}.wc-btn{cursor:pointer}.wc-primary{background:${COLORS.amber};border-color:${COLORS.amber};color:${COLORS.amberText};font-weight:700}.wc-search{background:${COLORS.panel2};min-width:270px;outline:none}.wc-search:focus{border-color:${COLORS.blue};box-shadow:0 0 0 3px rgba(124,183,222,.12)}.wc-wrap{position:relative}.wc-results{position:absolute;z-index:20;top:40px;left:0;right:0;background:${COLORS.panel};border:1px solid ${COLORS.border};border-radius:9px;box-shadow:0 15px 35px rgba(0,0,0,.35);overflow:hidden}.wc-result{display:block;width:100%;padding:10px 12px;border:0;border-bottom:1px solid ${COLORS.border};background:transparent;text-align:left;cursor:pointer}.wc-result strong{display:block;color:${COLORS.text};font-size:11px}.wc-result span{color:${COLORS.dim};font-size:10px}.wc-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:10px}.wc-card{position:relative;text-align:left;background:${COLORS.panel};border:1px solid ${COLORS.border};border-radius:12px;padding:14px;min-height:105px;color:${COLORS.text};cursor:pointer}.wc-card:hover{border-color:${COLORS.borderHover};transform:translateY(-1px)}.wc-icon{position:absolute;right:12px;top:12px;color:${COLORS.blue};font-size:12px}.wc-label{font-size:10.5px;color:${COLORS.dim};padding-right:20px}.wc-val{font:700 19px 'Space Grotesk',sans-serif;margin-top:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wc-small{font-size:10px;color:${COLORS.faint};margin-top:5px}.wc-main{display:grid;grid-template-columns:1.3fr .7fr;gap:12px;margin-top:12px}.wc-panel{background:${COLORS.panel};border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden}.wc-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid ${COLORS.border}}.wc-head b{font-size:12px;color:${COLORS.text}}.wc-head span{font-size:10px;color:${COLORS.faint}}.wc-row{display:flex;gap:10px;align-items:center;padding:11px 14px;border-bottom:1px solid rgba(42,51,65,.55)}.wc-dot{width:7px;height:7px;border-radius:50%;flex:none}.wc-row b{font-size:11px;color:${COLORS.text};display:block}.wc-row span{font-size:10px;color:${COLORS.dim};display:block;margin-top:2px}.wc-row button{margin-left:auto;border:0;background:transparent;color:${COLORS.blue};font-size:10px;cursor:pointer}.wc-mods{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:11px}.wc-mod{background:${COLORS.panel2};border:1px solid ${COLORS.border};border-radius:8px;padding:10px;text-align:left;cursor:pointer}.wc-mod strong{display:block;color:${COLORS.text};font-size:10.5px}.wc-mod span{display:block;color:${COLORS.faint};font-size:9.5px;margin-top:3px}@media(max-width:1100px){.wc-grid{grid-template-columns:repeat(4,1fr)}.wc-main{grid-template-columns:1fr}}@media(max-width:650px){.wc-dash{padding:14px}.wc-grid{grid-template-columns:repeat(2,1fr)}.wc-search{width:100%;min-width:0}.wc-wrap{width:100%}.wc-title{font-size:21px}}.ct-input2{width:100%;background:${COLORS.panel2};border:1px solid ${COLORS.border};color:${COLORS.text};font-family:'Inter',sans-serif;font-size:12.5px;padding:7px 9px;border-radius:6px;outline:none;box-sizing:border-box}.ct-input2:focus{border-color:${COLORS.amber}}.ct-input2::placeholder{color:${COLORS.faint};opacity:1}
  `}</style>
  <div className="wc-hero"><div><div className="wc-ey">Operaciones · Centro de gestión</div><div className="wc-title">PANEL EJECUTIVO</div><div className="wc-sub">Bienvenido, <b>{me}</b>. Resumen operativo, financiero y de personal.</div></div>
  <div className="wc-actions"><div className="wc-wrap"><input className="wc-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar OC, tarea, responsable..." />{results.length>0&&<div className="wc-results">{results.map((r,i)=><button className="wc-result" key={i} onClick={()=>{onNavigate(r.p);setSearch("")}}><strong>{r.t}</strong><span>{r.s}</span></button>)}</div>}</div><button className="wc-btn" onClick={load}>↻ Actualizar</button><AccesosPersonal isAdmin={isAdmin} canDelete={asistenciaCanDelete} readOnly={asistenciaReadOnly} onOpenCreateUser={onOpenCreateUser} />{isAdmin&&<button className="wc-btn" onClick={()=>setShowImportar(true)}>⬆ Cargar datos (Excel)</button>}</div></div>
  {isAdmin&&showImportar&&<ImportarDatosModal onClose={()=>{setShowImportar(false);load();}} />}
  {loading?<div className="wc-panel" style={{padding:30,textAlign:"center",color:COLORS.dim}}>Cargando indicadores…</div>:<>
  {loadError?<div className="wc-panel" style={{marginBottom:12,borderColor:COLORS.amber}}><div style={{padding:14,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}><span style={{color:COLORS.amber}}>⚠️ {loadError}</span><button className="wc-btn" onClick={load}>Reintentar</button></div></div>:null}
  <div style={{display:"flex",alignItems:"flex-end",gap:10,flexWrap:"wrap",marginBottom:10}}>
    <div style={{width:340,maxWidth:"100%"}}>
      <div style={{fontSize:10,color:COLORS.faint,textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>N° OC</div>
      <OCSelector value={filtroOc} onChange={setFiltroOc} options={ocOptionsDash} placeholder="Todas las órdenes" />
    </div>
    {filtroOc && <button className="wc-btn" onClick={()=>setFiltroOc("")}>Quitar filtro</button>}
  </div>
  {filtroOc && (
    <div className="wc-panel" style={{marginBottom:14,borderColor:COLORS.amber}}>
      <div className="wc-head"><b>Resumen de la OC {filtroOc}</b><span>Gastos realizados y ganancia de esta orden</span></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10,padding:14}}>
        <div style={{background:COLORS.panel2,border:`1px solid ${COLORS.border}`,borderRadius:9,padding:"10px 12px"}}>
          <div style={{fontSize:9.5,color:COLORS.faint,textTransform:"uppercase",letterSpacing:.45}}>Facturado</div>
          <div style={{font:"700 18px 'Space Grotesk',sans-serif",color:COLORS.text,marginTop:5}}>{fmtMoney(fact)}</div>
        </div>
        <div style={{background:COLORS.panel2,border:`1px solid ${COLORS.border}`,borderRadius:9,padding:"10px 12px"}}>
          <div style={{fontSize:9.5,color:COLORS.faint,textTransform:"uppercase",letterSpacing:.45}}>Gastos realizados</div>
          <div style={{font:"700 18px 'Space Grotesk',sans-serif",color:COLORS.amber,marginTop:5}}>{fmtMoney(costoTotalOc)}</div>
          <div style={{fontSize:9.5,color:COLORS.faint,marginTop:3}}>Gastos {fmtMoney(gastos)} · Viáticos {fmtMoney(viaticos)} · Caja Chica {fmtMoney(cajaChicaTotal)}</div>
        </div>
        <div style={{background:COLORS.panel2,border:`1px solid ${COLORS.border}`,borderRadius:9,padding:"10px 12px"}}>
          <div style={{fontSize:9.5,color:COLORS.faint,textTransform:"uppercase",letterSpacing:.45}}>Ganancia</div>
          <div style={{font:"700 18px 'Space Grotesk',sans-serif",color:resultadoEstimado>=0?COLORS.green:COLORS.red,marginTop:5}}>{fmtMoney(resultadoEstimado)}</div>
        </div>
        <div style={{background:COLORS.panel2,border:`1px solid ${COLORS.border}`,borderRadius:9,padding:"10px 12px"}}>
          <div style={{fontSize:9.5,color:COLORS.faint,textTransform:"uppercase",letterSpacing:.45}}>% Ganancia</div>
          <div style={{font:"700 18px 'Space Grotesk',sans-serif",color:margenEstimado>=.3?COLORS.green:COLORS.amber,marginTop:5}}>{fact?fmtPct(margenEstimado):"—"}</div>
        </div>
      </div>
      <div style={{padding:"0 14px 12px",fontSize:10.5,color:COLORS.faint}}>Órdenes/trabajos, Facturación, Cobro pendiente, Gastos, Viáticos, Caja Chica y Resultado operativo (tarjetas de abajo) también quedan filtrados por esta OC. Tareas, Personal y Solicitudes no se filtran por no estar ligados a una OC.</div>
    </div>
  )}
  <div className="wc-grid">{cards.map((c,i)=><button className="wc-card" key={i} onClick={()=>c[3]==="__propuestas"?onOpenPropuestas&&onOpenPropuestas():onNavigate(c[3])} style={c[3]==="__propuestas"&&propuestasPendientesCount?{borderColor:COLORS.red}:undefined}><span className="wc-icon">{c[4]}</span><div className="wc-label">{c[0]}</div><div className="wc-val" style={c[3]==="__propuestas"&&propuestasPendientesCount?{color:COLORS.red}:undefined}>{c[1]}</div><div className="wc-small">{c[2]}</div></button>)}</div>
  <div className="wc-main"><div className="wc-panel"><div className="wc-head"><b>Centro de alertas</b><span>{alerts.length} visible(s)</span></div>{alerts.length?alerts.map((a,i)=><div className="wc-row" key={i}><i className="wc-dot" style={{background:a.c}}/><div><b>{a.t}</b><span>{a.s}</span></div><button onClick={()=>onNavigate(a.p)}>Ver →</button></div>):<div style={{padding:24,textAlign:"center",color:COLORS.green,fontSize:11}}>✓ No hay alertas críticas pendientes.</div>}</div>
  <div className="wc-panel"><div className="wc-head"><b>Módulos</b><span>Acceso rápido</span></div><div className="wc-mods">{[["trabajos","Trabajos","Órdenes y rentabilidad"],["torre","Control de Tareas","Pendientes y responsables"],["asistencia","Asistencia","Personal y horas"],["contactos","Contactos","Clientes y cuentas"],["viaticos","Viáticos y Descuentos","Solicitudes y liquidaciones"],["gastos","Gastos","Control financiero"],...(canAction("caja_chica","ver")?[["caja_chica","CAJA CHICA","Gastos y control de caja"]]:[])].map(m=><button className="wc-mod" key={m[0]} onClick={()=>onNavigate(m[0])}><strong>{m[1]}</strong><span>{m[2]}</span></button>)}</div></div></div>
  <div className="wc-panel" style={{marginTop:12}}>
    <div className="wc-head">
      <b>💰 Planilla estimada</b>
      <span style={{display:"flex",alignItems:"center",gap:10}}>Sueldo neto y horas extra por trabajador{isAdmin&&<button onClick={()=>onNavigate("asistencia")} style={{background:"transparent",border:`1px solid ${COLORS.border}`,color:COLORS.blue,borderRadius:6,padding:"3px 9px",fontSize:10.5,cursor:"pointer"}}>⚙ Configurar sueldos</button>}</span>
    </div>
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${COLORS.border}`,flexWrap:"wrap"}}>
      <span style={{fontSize:11,color:COLORS.dim,textTransform:"uppercase",letterSpacing:.5,fontWeight:600,display:"flex",alignItems:"center",gap:5}}>📅 Periodo</span>
      <DropdownSelect value={planillaAnio} onChange={(v)=>setPlanillaAnio(Number(v))} options={aniosDisponiblesPlanilla.map(a=>({value:a,label:String(a)}))} buttonStyle={{background:COLORS.panel2,border:`1px solid ${COLORS.border}`,borderRadius:20,color:COLORS.text,fontFamily:"'Inter',sans-serif",fontSize:12.5,fontWeight:600,padding:"5px 12px"}} />
      <DropdownSelect value={planillaMes} onChange={(v)=>setPlanillaMes(Number(v))} options={MESES_NOMBRES_DASH.map((n,idx)=>({value:idx+1,label:n}))} buttonStyle={{background:COLORS.panel2,border:`1px solid ${COLORS.border}`,borderRadius:20,color:COLORS.text,fontFamily:"'Inter',sans-serif",fontSize:12.5,fontWeight:600,padding:"5px 12px"}} />
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(180px,1fr))",gap:10,padding:"14px 14px 6px"}}>
      {[
        ["Sueldos netos",resumenPlanilla.sueldoNeto,COLORS.text],
        ["Horas extra a pagar",resumenPlanilla.horasExtra,COLORS.green],
        ["Viáticos a pagar",resumenPlanilla.viaticos,COLORS.amber],
        ["Total planilla estimada",totalPlanillaEstimada,COLORS.blue]
      ].map(([label,value,tone])=><div key={label} style={{background:COLORS.panel2,border:`1px solid ${COLORS.border}`,borderRadius:9,padding:"10px 12px"}}>
        <div style={{fontSize:9.5,color:COLORS.faint,textTransform:"uppercase",letterSpacing:.45}}>{label}</div>
        <div style={{font:"700 17px 'Space Grotesk',sans-serif",color:value<0?COLORS.red:tone,marginTop:5}}>{fmtMoney(value)}</div>
      </div>)}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10,padding: "6px 14px 14px"}}>
      {planilla.map(p=>(
        <div key={p.trabajador} style={{background:COLORS.panel2,border:`1px solid ${COLORS.border}`,borderRadius:10,padding:"12px 14px"}}>
          <div style={{fontSize:12.5,fontWeight:700,color:COLORS.text,marginBottom:8}}>{p.trabajador}</div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:COLORS.dim,marginBottom:3}}><span>Sueldo base</span><span>{fmtMoney(p.sueldoBase)}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:p.diasFalta?COLORS.red:COLORS.dim,marginBottom:3}}><span>Faltas ({p.diasFalta})</span><span>{p.diasFalta?`-${fmtMoney(p.descuentoFaltas)}`:fmtMoney(0)}</span></div>
          {p.bonoDiario>0 && <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:COLORS.green,marginBottom:3}}><span>Bono por día ({p.diasPresente} presente)</span><span>+{fmtMoney(p.bonoDiario)}</span></div>}
          {p.montoPlanilla!==0 && <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:p.montoPlanilla>0?COLORS.green:COLORS.red,marginBottom:3}}><span>Monto de planilla</span><span>{p.montoPlanilla>0?"+":""}{fmtMoney(p.montoPlanilla)}</span></div>}
          {p.descuentoBono!==0 && <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:p.descuentoBono>0?COLORS.green:COLORS.red,marginBottom:3}}><span>Descuentos/Bonos</span><span>{p.descuentoBono>0?"+":""}{fmtMoney(p.descuentoBono)}</span></div>}
          <div style={{display:"flex",justifyContent:"space-between",fontSize:13,fontWeight:700,color:COLORS.green,paddingTop:6,marginTop:4,borderTop:`1px solid ${COLORS.border}`}}><span>Sueldo</span><span>{fmtMoney(p.sueldoNeto)}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:12.5,fontWeight:700,color:COLORS.green,paddingTop:6,marginTop:5,borderTop:`1px solid ${COLORS.border}`}}><span>⏱ Horas extra a pagar</span><span>{fmtMoney(p.montoHorasExtra)}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:12.5,fontWeight:700,color:COLORS.amber,paddingTop:6,marginTop:5,borderTop:`1px solid ${COLORS.border}`}}><span>✦ Viáticos a pagar</span><span>{fmtMoney(viaticosPlanilla.mapa[p.trabajador]||0)}</span></div>
          {(() => { const totalPagar = p.sueldoNeto + p.montoHorasExtra + (viaticosPlanilla.mapa[p.trabajador]||0); return (
          <div style={{display:"flex",justifyContent:"space-between",fontSize:13.5,fontWeight:800,color:totalPagar<0?COLORS.red:COLORS.blue,paddingTop:7,marginTop:6,borderTop:`2px solid ${COLORS.border}`}}><span>Sueldo a pagar</span><span>{fmtMoney(totalPagar)}</span></div>
          ); })()}
        </div>
      ))}
      {planilla.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",color:COLORS.faint,padding:20,fontSize:11.5}}>No hay trabajadores con sueldo configurado</div>}
    </div>
  </div>
  <div className="wc-panel" style={{marginTop:12}}><div className="wc-head"><b>Indicadores de control</b><span>Versión {APP_VERSION}</span></div><div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)"}}>{[["Tareas vencidas",overdue.length,overdue.length?COLORS.red:COLORS.green],["Viáticos registrados",viaticosF.length,COLORS.blue],["Gastos por revisar",gp,gp?COLORS.amber:COLORS.green],["Documentos pendientes",docsPendientes,docsPendientes?COLORS.amber:COLORS.green],["Contactos registrados",d.contactos.length,COLORS.blue],...(canAction("caja_chica","ver")?[["Caja Chica total",fmtMoney(cajaChicaTotal),COLORS.blue],["Caja Chica pendiente",fmtMoney(cajaChicaPendiente),cajaChicaPendiente?COLORS.amber:COLORS.green],["Caja Chica aprobado",fmtMoney(cajaChicaAprobado),cajaChicaAprobado?COLORS.blue:COLORS.green]]:[])].map((x,i)=><div key={i} style={{padding:15,borderRight:i<((canAction("caja_chica","ver")?7:4))?`1px solid ${COLORS.border}`:"none"}}><div style={{fontSize:10,color:COLORS.faint}}>{x[0]}</div><div style={{font:"700 18px 'Space Grotesk',sans-serif",color:x[2],marginTop:6}}>{x[1]}</div></div>)}</div></div>
  </>}</div>
}

export { Dashboard };
