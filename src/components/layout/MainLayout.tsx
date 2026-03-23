/**
 * Main Layout Component
 * TitleBar at top, then sidebar + content below.
 */
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

export function MainLayout() {
  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background">
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar />

      {/* Below the title bar: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>

      {/* Powered by 元行科技 */}
      <div className="absolute bottom-2 right-4 text-[11px] text-foreground/50 pointer-events-none">
        Powered by 元行科技
      </div>
    </div>
  );
}
