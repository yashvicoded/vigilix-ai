"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { AuthModal } from "@/components/landing/auth-modal"
import { Dashboard } from "@/components/Dashboard"
import { Scanner } from "@/components/Scanner"
import {
  useApp,
  consumePendingLiveScan,
  peekPendingLiveScan,
  clearPendingLiveScan,
  writePendingLiveScan,
  type AnalysisHistoryItem,
} from "@/lib/store"
import { validateRepoUrl } from "@/lib/analysis-controller"
import { downloadScanPdf } from "@/lib/export-scan-pdf"
import { toast } from "@/components/ui/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { motion } from "framer-motion"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Search,
  FolderGit2,
  User,
  LogOut,
  ArrowRight,
  Shield,
  Menu,
  FileDown,
  Play,
  KeyRound,
} from "lucide-react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts"

/** Prevents duplicate demo runs when React Strict Mode remounts. */
let demoRunQueryHandled = false

type ActiveSection = "overview" | "analyze" | "vault" | "account"

const CHART_MONTHS = ["Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]
const CHART_BASE_SCORES = [58, 59, 61, 64, 68, 71, 75, 78]

function buildTrustTrendData(history: AnalysisHistoryItem[]) {
  const points = CHART_MONTHS.map((name, i) => ({
    name,
    score: CHART_BASE_SCORES[i] ?? 70,
  }))
  if (history.length >= 3) {
    const sorted = [...history].sort(
      (a, b) => +new Date(a.timestamp) - +new Date(b.timestamp)
    )
    const tail = sorted.slice(-3)
    points[points.length - 3] = {
      ...points[points.length - 3],
      score: tail[0]?.score ?? points[points.length - 3].score,
    }
    points[points.length - 2] = {
      ...points[points.length - 2],
      score: tail[1]?.score ?? points[points.length - 2].score,
    }
    points[points.length - 1] = {
      ...points[points.length - 1],
      score: tail[2]?.score ?? points[points.length - 1].score,
    }
  } else if (history.length >= 1) {
    points[points.length - 1] = {
      ...points[points.length - 1],
      score: history[0].score,
    }
  }
  return points
}

function statusBadgeProps(status: AnalysisHistoryItem["status"]) {
  switch (status) {
    case "Safe To Ship":
      return {
        className:
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      }
    case "Needs Review":
      return {
        className:
          "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      }
    default:
      return {
        className:
          "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
      }
  }
}

function AvgScoreRing({ score }: { score: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  const offset = c - (score / 100) * c
  return (
    <div className="flex items-center gap-3">
      <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0 -rotate-90">
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          className="text-muted/40"
        />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={
            score >= 80
              ? "text-primary"
              : score >= 50
                ? "text-yellow-500"
                : "text-destructive"
          }
        />
      </svg>
      <div>
        <p className="text-2xl font-bold leading-none">{score}</p>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-1">
    
        </p>
      </div>
    </div>
  )
}

export function DashboardContent() {
  const [mounted, setMounted] = useState(false)
  const searchParams = useSearchParams()
  const router = useRouter()
  const reportAnchorRef = useRef<HTMLDivElement>(null)

  const {
    user,
    isAuthenticated,
    logout,
    analysisHistory,
    startAnalysis,
    isLoading,
  } = useApp()

  const [activeSection, setActiveSection] = useState<ActiveSection>("overview")
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authTab, setAuthTab] = useState<"login" | "signup">("login")
  const [showScanner, setShowScanner] = useState(false)
  const [newRepoUrl, setNewRepoUrl] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [vaultQuery, setVaultQuery] = useState("")

  useEffect(() => {
    setMounted(true)
  }, [])

  const selectedScan = useMemo(() => {
    if (selectedId) {
      return analysisHistory.find((h) => h.id === selectedId) ?? null
    }
    return analysisHistory[0] ?? null
  }, [analysisHistory, selectedId])

  const handleOpenAuth = useCallback((tab: "login" | "signup") => {
    setAuthTab(tab)
    setAuthModalOpen(true)
  }, [])

  const goToReport = useCallback((id: string) => {
    setSelectedId(id)
    setActiveSection("overview")
    requestAnimationFrame(() => {
      reportAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }, [])

  const runDemoScan = useCallback(async () => {
    setShowScanner(true)
    try {
      const item = await startAnalysis("", "demo")
      setSelectedId(item.id)
      setActiveSection("overview")
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Demo failed",
        description: e instanceof Error ? e.message : "Something went wrong",
      })
    } finally {
      setShowScanner(false)
    }
  }, [startAnalysis])

  const runLiveScan = useCallback(
    async (repo: string) => {
      // #region agent log
      // #endregion
      setShowScanner(true)
      try {
        const item = await startAnalysis(repo, "live")
        setSelectedId(item.id)
        setActiveSection("overview")
      } catch (e: unknown) {
        toast({
          variant: "destructive",
          title: "Analysis failed",
          description: e instanceof Error ? e.message : "Something went wrong",
        })
      } finally {
        // #region agent log
        // #endregion
        setShowScanner(false)
      }
    },
    [startAnalysis]
  )

  const run = searchParams.get("run")

  useEffect(() => {
    // #region agent log
    // #endregion
    if (run !== "demo") {
      demoRunQueryHandled = false
      return
    }
    if (demoRunQueryHandled) return
    demoRunQueryHandled = true
    // #region agent log
    // #endregion
    clearPendingLiveScan()
    void (async () => {
      await runDemoScan()
      if (typeof window !== "undefined" && window.location.pathname !== "/dashboard") { router.replace("/dashboard", { scroll: false }) }
    })()
  }, [run, router, runDemoScan])

  useEffect(() => {
    // #region agent log
    // #endregion
    if (run !== "live" || !isAuthenticated) return
    const pending = consumePendingLiveScan()
    // #region agent log
    // #endregion
    if (!pending) {
      if (typeof window !== "undefined" && window.location.pathname !== "/dashboard") { router.replace("/dashboard", { scroll: false }) }
      return
    }
    void (async () => {
      await runLiveScan(pending.repo)
      if (typeof window !== "undefined" && window.location.pathname !== "/dashboard") { router.replace("/dashboard", { scroll: false }) }
    })()
  }, [run, isAuthenticated, router, runLiveScan])

  useEffect(() => {
    // #region agent log
    // #endregion
    if (!isAuthenticated || run === "live") return
    if (!peekPendingLiveScan()) return
    const pending = consumePendingLiveScan()
    if (!pending) return
    void runLiveScan(pending.repo)
  }, [isAuthenticated, run, runLiveScan])

  const totalScans = analysisHistory.length
  const avgScore =
    totalScans > 0
      ? Math.round(
          analysisHistory.reduce((sum, h) => sum + h.score, 0) / totalScans
        )
      : 0
  const latest = analysisHistory[0]
  const safeReposCount = useMemo(
    () => analysisHistory.filter((h) => h.status === "Safe To Ship").length,
    [analysisHistory]
  )
  const criticalFindings = useMemo(
    () =>
      analysisHistory.reduce(
        (acc, h) =>
          acc + h.issues.filter((i) => i.severity === "Critical").length,
        0
      ),
    [analysisHistory]
  )

  const chartData = useMemo(
    () => buildTrustTrendData(analysisHistory),
    [analysisHistory]
  )

  const filteredVault = useMemo(() => {
    const q = vaultQuery.trim().toLowerCase()
    if (!q) return analysisHistory
    return analysisHistory.filter((h) => h.repository.toLowerCase().includes(q))
  }, [analysisHistory, vaultQuery])

  const handleLogoClick = () => {
    if (isAuthenticated) {
      if (typeof window !== "undefined" && window.location.pathname !== "/dashboard") {
        router.push("/dashboard")
      }
    } else {
      if (typeof window !== "undefined" && window.location.pathname !== "/") {
        router.push("/")
      }
    }
  }

  const handleNewRepoAnalyze = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newRepoUrl.trim()
    const validation = validateRepoUrl(trimmed)
    if (!validation.valid) {
      toast({
        variant: "destructive",
        title: "Invalid repository",
        description: validation.error,
      })
      return
    }
    writePendingLiveScan(trimmed)
    if (!isAuthenticated) {
      setAuthTab("signup")
      setAuthModalOpen(true)
      return
    }
    void runLiveScan(trimmed)
    setNewRepoUrl("")
  }

  const handleTryDemoClick = () => {
    void runDemoScan()
  }

  const handleRerun = async (item: AnalysisHistoryItem) => {
    if (item.mode === "demo") {
      await runDemoScan()
      return
    }
    if (!isAuthenticated) {
      writePendingLiveScan(item.repository)
      setAuthTab("signup")
      setAuthModalOpen(true)
      return
    }
    await runLiveScan(item.repository)
  }

  const navItems: { id: ActiveSection; label: string; icon: typeof LayoutDashboard }[] =
    [
      { id: "overview", label: "Dashboard", icon: LayoutDashboard },
      { id: "analyze", label: "Analyze", icon: Search },
      { id: "vault", label: "Repository Vault", icon: FolderGit2 },
      { id: "account", label: "Account", icon: User },
    ]

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex flex-col gap-1 mt-6">
      {navItems.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => {
            setActiveSection(id)
            onNavigate?.()
          }}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-left w-full",
            activeSection === id
              ? "bg-primary/10 text-primary border border-primary/20"
              : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground border border-transparent"
          )}
        >
          <Icon className="h-4 w-4 shrink-0 opacity-90" />
          {label}
        </button>
      ))}
    </nav>
  )

  return (
    <TooltipProvider delayDuration={200}>
      <div suppressHydrationWarning className="min-h-screen bg-background flex">
        {showScanner && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/90 backdrop-blur-sm px-4">
            <Scanner />
          </div>
        )}

        <aside suppressHydrationWarning className="hidden md:flex w-56 shrink-0 border-r border-border bg-card/30 flex-col fixed left-0 top-0 bottom-0 z-30">
          <div className="p-4 border-b border-border/60">
            <button
              type="button"
              onClick={handleLogoClick}
              className="flex items-center gap-2.5 group w-full text-left rounded-lg p-1 -m-1 hover:bg-secondary/40 transition-colors"
            >
              <div className="relative shrink-0">
                <Shield className="h-7 w-7 text-primary" />
                <div className="absolute inset-0 blur-lg bg-primary/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
              </div>
              <span className="text-base font-semibold tracking-tight text-foreground">
                Vigilix AI
              </span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2">
            <NavLinks />
          </div>
          <div className="p-3 border-t border-border/60 text-xs text-muted-foreground flex gap-2 leading-snug">
            <Shield className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <span>Demo scans stay local. Live scans use the API.</span>
          </div>
        </aside>

        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="w-64 p-0 flex flex-col">
            <SheetHeader className="p-4 border-b border-border text-left">
              <SheetTitle className="flex items-center gap-2">
                <Shield className="h-6 w-6 text-primary" />
                Vigilix AI
              </SheetTitle>
            </SheetHeader>
            <div className="px-3 py-2 flex-1">
              <NavLinks onNavigate={() => setMobileNavOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex-1 flex flex-col min-w-0 md:pl-56">
          <header className="h-14 shrink-0 border-b border-border flex items-center gap-3 px-3 md:px-5 bg-background/80 backdrop-blur-sm sticky top-0 z-20">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="md:hidden shrink-0"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex-1 min-w-0" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="rounded-full h-9 pl-2 pr-3 gap-2 border-border/80 bg-card/50 hover:bg-card"
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-[10px] bg-primary/15 text-primary">
                      <User className="h-3.5 w-3.5" />
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium truncate max-w-[120px] sm:max-w-[180px]">
                    {isAuthenticated && user ? user.name : "Guest"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium truncate">
                      {isAuthenticated && user ? user.name : "Guest"}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {isAuthenticated && user ? user.email : "Not signed in"}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isAuthenticated ? (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => {
                      logout()
                    }}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Log out
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => handleOpenAuth("login")}
                    >
                      Log in
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => handleOpenAuth("signup")}
                    >
                      Sign up
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <main className="flex-1 overflow-y-auto p-4 md:p-6 max-w-5xl mx-auto w-full pb-16">
            {activeSection === "overview" && (
              <div className="space-y-8">
                <div>
                  <h1 className="text-lg font-semibold text-foreground mb-4">
                    Overview
                  </h1>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-card border border-border rounded-lg p-4"
                    >
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                        Total scans
                      </p>
                      <p className="text-2xl font-bold">{totalScans}</p>
                    </motion.div>
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.03 }}
                      className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-2"
                    >
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                          Avg trust score
                        </p>
                        <p className="sr-only">{avgScore}</p>
                      </div>
                      <AvgScoreRing score={avgScore} />
                    </motion.div>
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.06 }}
                      className="bg-card border border-border rounded-lg p-4"
                    >
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                        Safe repositories
                      </p>
                      <p className="text-2xl font-bold text-emerald-500">{safeReposCount}</p>
                    </motion.div>
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.09 }}
                      className="bg-card border border-border rounded-lg p-4"
                    >
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                        Critical findings
                      </p>
                      <p className="text-2xl font-bold text-destructive">{criticalFindings}</p>
                    </motion.div>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-lg p-4 md:p-5">
                  <h2 className="text-sm font-semibold text-foreground mb-4">
                    Trust score trend
                  </h2>
                  <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 11, fill: "hsl(240 5% 55%)" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          domain={[40, 100]}
                          width={32}
                          tick={{ fontSize: 11, fill: "hsl(240 5% 55%)" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <RechartsTooltip
                          contentStyle={{
                            backgroundColor: "var(--card)",
                            border: "1px solid var(--border)",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                          labelStyle={{ color: "var(--foreground)" }}
                        />
                        <Line
                          type="monotone"
                          dataKey="score"
                          stroke="var(--primary)"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "var(--primary)" }}
                          activeDot={{ r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {latest && (
                  <div className="bg-card/50 border border-border/80 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                        Recent scan
                      </p>
                      <p className="font-mono text-sm text-foreground truncate max-w-[280px] md:max-w-md">
                        {latest.repository}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span
                        className={cn(
                          "font-bold tabular-nums",
                          latest.score >= 80
                            ? "text-primary"
                            : latest.score >= 50
                              ? "text-yellow-500"
                              : "text-destructive"
                        )}
                      >
                        {latest.score}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {mounted
                          ? new Date(latest.timestamp).toLocaleString()
                          : "—"}
                      </span>
                    </div>
                  </div>
                )}

                <div ref={reportAnchorRef} id="report-anchor" className="scroll-mt-24">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <h2 className="text-lg font-semibold">Report</h2>
                    {selectedScan && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => downloadScanPdf(selectedScan)}
                      >
                        <FileDown className="h-4 w-4" />
                        Download PDF
                      </Button>
                    )}
                  </div>
                  {selectedScan ? (
                    <Dashboard result={selectedScan} />
                  ) : (
                    <div className="border border-dashed border-border rounded-lg p-10 text-center text-muted-foreground text-sm">
                      Select a scan from the vault or run a new analysis.
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeSection === "analyze" && (
              <div className="space-y-4">
                <h1 className="text-lg font-semibold">Analyze</h1>
                <section className="bg-card border border-border rounded-lg p-5 md:p-6">
                  <form
                    onSubmit={handleNewRepoAnalyze}
                    className="flex flex-col lg:flex-row gap-3"
                  >
                    <div className="relative flex-1 flex items-center gap-2 rounded-lg border border-border bg-secondary/20 px-3">
                      <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                      <Input
                        value={newRepoUrl}
                        onChange={(e) => setNewRepoUrl(e.target.value)}
                        placeholder="https://github.com/owner/repo"
                        className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <Button
                        type="submit"
                        disabled={isLoading}
                        className="bg-primary text-primary-foreground"
                      >
                        Analyze
                        <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isLoading}
                        onClick={handleTryDemoClick}
                        className="border-primary/30 text-primary"
                      >
                        Try demo
                      </Button>
                    </div>
                  </form>
                </section>
              </div>
            )}

            {activeSection === "vault" && (
              <div className="space-y-4">
                <h1 className="text-lg font-semibold">Repository Vault</h1>
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                  <Input
                    placeholder="Search repositories…"
                    value={vaultQuery}
                    onChange={(e) => setVaultQuery(e.target.value)}
                    className="max-w-md bg-card border-border"
                  />
                </div>
                <div className="border border-border rounded-lg overflow-hidden bg-card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-secondary/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-3 font-medium">Repository</th>
                          <th className="px-4 py-3 font-medium w-20">Score</th>
                          <th className="px-4 py-3 font-medium min-w-[120px]">Status</th>
                          <th className="px-4 py-3 font-medium whitespace-nowrap">Date</th>
                          <th className="px-4 py-3 font-medium text-right w-[100px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredVault.length === 0 ? (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-4 py-12 text-center text-muted-foreground"
                            >
                              No matching scans.
                            </td>
                          </tr>
                        ) : (
                          filteredVault.map((item) => (
                            <tr
                              key={item.id}
                              className="border-b border-border/80 last:border-0 hover:bg-secondary/20 transition-colors"
                            >
                              <td className="px-4 py-3 align-top">
                                <button
                                  type="button"
                                  onClick={() => goToReport(item.id)}
                                  className="text-left font-mono text-sm text-primary hover:underline underline-offset-2"
                                >
                                  {item.repository}
                                </button>
                                <div className="text-[11px] text-muted-foreground mt-0.5">
                                  {mounted
                                    ? new Date(item.timestamp).toLocaleString()
                                    : "—"}
                                </div>
                              </td>
                              <td className="px-4 py-3 align-top">
                                <span
                                  className={cn(
                                    "font-semibold tabular-nums",
                                    item.score >= 80
                                      ? "text-primary"
                                      : item.score >= 50
                                        ? "text-yellow-500"
                                        : "text-destructive"
                                  )}
                                >
                                  {item.score}
                                </span>
                              </td>
                              <td className="px-4 py-3 align-top">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-xs font-normal",
                                    statusBadgeProps(item.status).className
                                  )}
                                >
                                  {item.status}
                                </Badge>
                                <span
                                  className={cn(
                                    "ml-2 text-[10px] px-1.5 py-0.5 rounded",
                                    item.mode === "demo"
                                      ? "bg-accent/15 text-accent"
                                      : "bg-primary/10 text-primary"
                                  )}
                                >
                                  {item.mode}
                                </span>
                              </td>
                              <td className="px-4 py-3 align-top text-muted-foreground whitespace-nowrap text-xs">
                                {mounted
                                  ? new Date(item.timestamp).toLocaleString()
                                  : "—"}
                              </td>
                              <td className="px-4 py-3 align-top text-right">
                                <div className="inline-flex items-center gap-1 justify-end">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8"
                                        onClick={() => downloadScanPdf(item)}
                                        aria-label="Download PDF"
                                      >
                                        <FileDown className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Download PDF</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8"
                                        disabled={isLoading}
                                        onClick={() => void handleRerun(item)}
                                        aria-label="Re-run analysis"
                                      >
                                        <Play className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Re-run analysis</TooltipContent>
                                  </Tooltip>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeSection === "account" && (
              <div className="space-y-6 max-w-md">
                <h1 className="text-lg font-semibold">Account</h1>
                <div className="bg-card border border-border rounded-lg p-6 space-y-5">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-14 w-14 border border-border">
                      <AvatarFallback className="text-lg bg-primary/10 text-primary">
                        <User className="h-6 w-6" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {isAuthenticated && user ? user.name : "Guest"}
                      </p>
                      <p className="text-sm text-muted-foreground truncate">
                        {isAuthenticated && user ? user.email : "Not signed in"}
                      </p>
                    </div>
                  </div>
                  {isAuthenticated && user ? (
                    <>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => logout()}
                      >
                        <LogOut className="h-4 w-4 mr-2" />
                        Log out
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full text-muted-foreground"
                        onClick={() =>
                          toast({
                            title: "Coming soon",
                            description: "Password changes are not available in this build.",
                          })
                        }
                      >
                        <KeyRound className="h-4 w-4 mr-2" />
                        Change password
                      </Button>
                    </>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Button onClick={() => handleOpenAuth("login")}>Log in</Button>
                      <Button variant="outline" onClick={() => handleOpenAuth("signup")}>
                        Sign up
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialTab={authTab}
      />
    </TooltipProvider>
  )
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  )
}


