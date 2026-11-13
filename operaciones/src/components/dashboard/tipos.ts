export interface Agg {
  label: string;
  cantidad: number;
  monto: number;
}

export interface DashboardData {
  porEstado: Agg[];
  porTipo: Agg[];
  porArea: Agg[];
  porMes: Agg[];
  porProveedor: Agg[];
  totales: {
    total_tickets: number;
    monto_total: number;
    finalizados: number;
    pendientes: number;
    atrasados: number;
  };
  /** Solo para administradores: espacio que ocupa la base de datos (los adjuntos van dentro). */
  almacenamiento?: {
    baseBytes: number;
    archivosBytes: number;
    archivos: number;
    limiteBytes: number;
  } | null;
}
