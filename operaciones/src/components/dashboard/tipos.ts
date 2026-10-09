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
}
