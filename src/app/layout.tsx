import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Course Sales · Управление обучением",
  description: "Административная панель продаж обучения",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
