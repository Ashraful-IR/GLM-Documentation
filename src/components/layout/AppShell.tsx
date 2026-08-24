"use client";

import { useEffect, useState } from "react";
import { LogOut, Moon, PanelLeftClose, PanelLeftOpen, ScrollText, Sun, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { BrandMark } from "@/components/layout/BrandMark";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

import { useNavigation } from "@/hooks/useNavigation";
import { cn } from "@/lib/utils";
import type { NavigationNode, SessionUser } from "@/types";
import { Sidebar } from "@/components/navigation/Sidebar";
import { SearchCommand } from "./SearchCommand";
import { UserMenu } from "./UserMenu";
import { Footer } from "./Footer";

export function AppShell({ user, initialTree, children }: { user: SessionUser; initialTree?: NavigationNode[]; children: React.ReactNode }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { tree, loading, createNode, updateNode, moveNode, deleteNode, duplicateNode } = useNavigation(initialTree);
  // Sidebar always starts open; collapsing only lasts for the current session.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isSm, setIsSm] = useState(true);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => { setMounted(true); }, []);

  // Track the breakpoint so the single open/close button knows which state
  // drives the sidebar on the current viewport.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setIsSm(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Close the mobile drawer on navigation and on Escape.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // The toggle sits at the top-right edge of the sidebar itself. On desktop it
  // collapses the sidebar column; on mobile it opens/closes the overlay drawer.
  function toggleSidebar() {
    if (window.matchMedia("(min-width: 640px)").matches) {
      setSidebarCollapsed((v) => !v);
    } else {
      setMobileOpen((v) => !v);
    }
  }

  const sidebarOpen = isSm ? !sidebarCollapsed : mobileOpen;

  const sidebarProps = {
    tree,
    loading,
    role: user.role,
    mutations: { createNode, updateNode, moveNode, deleteNode, duplicateNode },
  };

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    toast.success("Signed out");
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex h-dvh flex-col">
      {/* Top bar — brand + admin pages on the left, search + theme/sign-out on the right */}
      <header className="relative flex h-14 shrink-0 items-center gap-1.5 border-b bg-background/60 px-2 backdrop-blur-sm sm:h-16 sm:gap-2 sm:px-4">
        <Link href="/documentation" aria-label="Cockpit GLM home" className="flex items-center gap-2">
          <BrandMark size="sm" />
          <span className="hidden text-md font-semibold tracking-tight text-text-primary md:inline">Cockpit GLM</span>
        </Link>
        {user.role === "ADMIN" && (
          <div className="ml-30 hidden items-center gap-0.5 border-l border-border pl-3 md:flex">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-sm font-medium text-blue-400 hover:bg-primary/10 hover:text-primary"
              onClick={() => router.push("/users")}
            >
              <Users className="size-4" /> <span className="hidden lg:inline">Users</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-sm font-medium text-blue-400 hover:bg-primary/10 hover:text-primary"
              onClick={() => router.push("/audit")}
            >
              <ScrollText className="size-4" /> <span className="hidden lg:inline">Audit log</span>
            </Button>
          </div>
        )}
        <div className="flex-1 min-w-0" />
        <SearchCommand />
        {mounted && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{resolvedTheme === "dark" ? "Light mode" : "Dark mode"}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        )}
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                onClick={logout}
                aria-label="Sign out"
              >
                <LogOut className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Sign out</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <UserMenu user={user} />
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Floating re-open button — shown only when the sidebar is fully collapsed */}
        {!sidebarOpen && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute left-1 top-1 z-10 size-9 rounded-md"
                  onClick={toggleSidebar}
                  aria-label="Show sidebar"
                >
                  <PanelLeftOpen className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Show sidebar</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Mobile drawer backdrop */}
        <div
          className={cn(
            "fixed inset-0 z-40 bg-black/50 transition-opacity sm:hidden",
            mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />

        {/* Sidebar — always `relative` so the toggle anchors to its top-right edge;
            collapses fully (w-0) when closed; overlay drawer on mobile */}
        <aside
          className={cn(
            "relative flex shrink-0 flex-col overflow-hidden border-r bg-sidebar transition-all duration-200 ease-in-out",
            mobileOpen
              ? "fixed inset-y-0 left-0 z-50 w-72 shadow-xl sm:relative sm:inset-auto sm:z-auto sm:shadow-none"
              : "w-0 border-r-0",
            sidebarCollapsed ? "sm:w-0 sm:border-r-0" : "sm:w-72",
          )}
        >
          {/* Collapse button at the top-right edge of the sidebar */}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1 z-10 size-9 rounded-md"
                  onClick={toggleSidebar}
                  aria-label="Hide sidebar"
                >
                  <PanelLeftClose className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Hide sidebar</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className="min-w-0 flex-1 overflow-y-auto">
            <Sidebar {...sidebarProps} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <Footer />
    </div>
  );
}
