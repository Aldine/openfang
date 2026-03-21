"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HealthLevel } from "../lib/client-types";
import styles from "../../client-dashboard.module.css";

type ClientShellProps = {
  clientId: string;
  clientName: string;
  currentPage: "home" | "pulse" | "plan" | "approvals" | "results";
  approvalsWaiting: number;
  tasksDueToday: number;
  lastActivityAt: string | null;
  health: HealthLevel;
  children: React.ReactNode;
};

const pageLabels: Record<ClientShellProps["currentPage"], string> = {
  home: "Client Home",
  pulse: "Client Pulse",
  plan: "Plan and Assign",
  approvals: "Approvals and Execution",
  results: "Results and Review",
};

const navItems = [
  { key: "home", label: "Client Home", buildHref: (clientId: string) => `/clients/${clientId}` },
  { key: "pulse", label: "Client Pulse", buildHref: (clientId: string) => `/clients/${clientId}/pulse` },
  { key: "plan", label: "Plan and Assign", buildHref: (clientId: string) => `/clients/${clientId}/plan` },
  { key: "approvals", label: "Approvals and Execution", buildHref: (clientId: string) => `/clients/${clientId}/approvals` },
  { key: "results", label: "Results and Review", buildHref: (clientId: string) => `/clients/${clientId}/results` },
] as const;

const secondaryItems = ["Files", "Comms", "Finance"] as const;

const healthLabels: Record<HealthLevel, string> = {
  green: "Healthy",
  yellow: "Watch",
  red: "Risk",
};

function formatWhen(value: string | null) {
  if (!value) return "No recent activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No recent activity";
  return date.toLocaleString();
}

export default function ClientShell({
  clientId,
  clientName,
  currentPage,
  approvalsWaiting,
  tasksDueToday,
  lastActivityAt,
  health,
  children,
}: ClientShellProps) {
  const pathname = usePathname();

  return (
    <main className={styles.shellPage}>
      <div className={styles.shellGrid}>
        <aside className={styles.shellSidebar}>
          <div className={styles.shellSidebarIntro}>
            <div className={styles.eyebrow}>
              Client Workspace
            </div>
            <div className={styles.shellTitle}>{clientName}</div>
            <div className={styles.shellCaption}>{pageLabels[currentPage]}</div>
          </div>

          <nav className={styles.shellNav}>
            {navItems.map((item) => {
              const href = item.buildHref(clientId);
              const active = pathname === href;
              return (
                <Link
                  key={item.key}
                  href={href}
                  className={styles.navLink}
                  data-active={active}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className={styles.shellSecondary}>
            {secondaryItems.map((label) => (
              <div key={label} className={styles.shellSecondaryItem}>
                {label}
              </div>
            ))}
          </div>
        </aside>

        <section>
          <header className={styles.shellHeader}>
            <div className={styles.shellHeaderTop}>
              <div>
                <div className={styles.eyebrow}>
                  Client Dashboard
                </div>
                <h1 className={styles.shellHeaderName}>{clientName}</h1>
                <div className={styles.shellHeaderSubtext}>
                  {pageLabels[currentPage]} · Last activity {formatWhen(lastActivityAt)}
                </div>
              </div>

              <div className={styles.shellActions}>
                <span className={styles.healthPill} data-health={health}>
                  {healthLabels[health]}
                </span>
                <Link href={`/clients/${clientId}/approvals`} className={styles.linkButton}>
                  Approvals {approvalsWaiting > 0 ? `(${approvalsWaiting})` : ""}
                </Link>
                <Link href={`/clients/${clientId}/plan`} className={`${styles.linkButton} ${styles.linkPrimary}`}>
                  Plan work
                </Link>
              </div>
            </div>

            <div className={styles.shellStats}>
              {[
                { label: "Approvals waiting", value: approvalsWaiting.toString() },
                { label: "Tasks due today", value: tasksDueToday.toString() },
                { label: "Current sprint", value: "This cycle" },
                { label: "Quick actions", value: "Draft, approve, run" },
              ].map((stat) => (
                <div key={stat.label} className={styles.statCard}>
                  <div className={styles.statLabel}>{stat.label}</div>
                  <div className={styles.statValue}>{stat.value}</div>
                </div>
              ))}
            </div>
          </header>

          {children}
        </section>
      </div>
    </main>
  );
}