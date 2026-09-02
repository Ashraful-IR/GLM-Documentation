"use client";

import { useEffect, useState } from "react";
import { LogOut, Moon, ScrollText, Sun, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { BrandMark } from "@/components/layout/BrandMark";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

import { useNavigation } from "@/hooks/useNavigation";
import type { NavigationNode, SessionUser } from "@/types";
import { Sidebar } from "@/components/navigation/Sidebar";
import { SearchCommand } from "./SearchCommand";
import { UserMenu } from "./UserMenu";
import { Footer } from "./Footer";

export function AppShell({ user, initialTree, children }: { user: SessionUser; initialTree?: NavigationNode[]; children: React.ReactNode }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { tree, loading, createNode, updateNode, moveNode, deleteNode, duplicateNode, refresh } = useNavigation(initialTree);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const sidebarProps = {
    tree,
    loading,
    role: user.role,
    mutations: { createNode, updateNode, moveNode, deleteNode, duplicateNode, refresh },
  };

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    toast.success("Signed out");
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex h-dvh flex-col">
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
        {/* Navigation tree — always visible, no sidebar chrome */}
        <nav className="hidden w-90 shrink-0 overflow-y-auto overflow-x-hidden border-r sm:block">
          <Sidebar {...sidebarProps} />
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <Footer />
    </div>
  );
}
