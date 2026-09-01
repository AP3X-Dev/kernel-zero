import type { ReactNode } from "react";

import "./globals.css";

export const metadata = {
  description: "Policy-first governance for repository architecture and verification evidence.",
  title: "KERNEL ZERO",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        {children}
      </body>
    </html>
  );
}
