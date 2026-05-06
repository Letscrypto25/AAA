import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import Races from "@/pages/Races";
import RaceDetail from "@/pages/RaceDetail";
import FormGuide from "@/pages/FormGuide";
import Chat from "@/pages/Chat";
import Weights from "@/pages/Weights";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Trophy,
  BookOpen,
  MessageSquare,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/races", label: "Races", icon: Trophy },
  { href: "/form-guide", label: "Form Guide", icon: BookOpen },
  { href: "/chat", label: "AI Chat", icon: MessageSquare },
  { href: "/weights", label: "Weights", icon: SlidersHorizontal },
];

function NavItem({ href, label, icon: Icon }: { href: string; label: string; icon: React.ElementType }) {
  const [location] = useLocation();
  const active = href === "/" ? location === "/" : location.startsWith(href);
  return (
    <Link href={href}>
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
          active
            ? "bg-primary text-primary-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span>{label}</span>
      </div>
    </Link>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden md:flex flex-col w-56 bg-sidebar border-r border-sidebar-border shrink-0">
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-sidebar-border">
          <TrendingUp className="size-5 text-primary" />
          <span className="font-bold text-sidebar-foreground tracking-tight">AAA Bets</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => (
            <NavItem key={n.href} {...n} />
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <p className="text-xs text-muted-foreground text-center">Powered by Groq LLaMA&nbsp;3</p>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <header className="md:hidden flex items-center justify-between px-4 h-14 border-b border-border bg-sidebar">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-5 text-primary" />
            <span className="font-bold text-sidebar-foreground">AAA Bets</span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}>
                <div className="p-2 rounded-md hover:bg-sidebar-accent">
                  <n.icon className="size-4 text-sidebar-foreground" />
                </div>
              </Link>
            ))}
          </nav>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/races" component={Races} />
        <Route path="/races/:id" component={RaceDetail} />
        <Route path="/form-guide" component={FormGuide} />
        <Route path="/chat" component={Chat} />
        <Route path="/weights" component={Weights} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="aaa-bets-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
