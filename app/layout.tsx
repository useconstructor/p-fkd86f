import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gastos Personales Mensuales",
  description: "Tu libreta personal de gastos. Registra y consulta tu distribución mensual por categorías.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
