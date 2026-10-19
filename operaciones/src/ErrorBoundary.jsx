import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("Operaciones runtime error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{padding: 30, fontFamily: "Arial"}}>
          <h2>Error de aplicación</h2>
          <p>La aplicación encontró un problema inesperado.</p>
          <button onClick={() => window.location.reload()}>
            Recargar aplicación
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
