"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./client-dashboard.module.css";

export default function ClientsIndexPage() {
  const router = useRouter();
  const [clientId, setClientId] = useState("");

  function openClient() {
    const trimmed = clientId.trim();
    if (!trimmed) return;
    router.push(`/clients/${trimmed}`);
  }

  return (
    <main className={styles.page}>
      <div className={styles.pageIntro}>
        <div className={styles.eyebrow}>
          Client Command Center
        </div>
        <h1 className={styles.pageTitle}>
          Build the new 5-screen client workflow from one place.
        </h1>
        <p className={styles.pageDescription}>
          Open an existing client dashboard by ID or start a new client intake in Command Center.
          The client dashboard follows the workflow spec: pulse, plan, approvals, results, and review.
        </p>
      </div>

      <div className={styles.splitGrid}>
        <section className={styles.panel}>
          <div className={styles.sectionTitle}>Open an existing client</div>
          <p className={styles.sectionLead}>
            Use a known client ID from the current command-center backend and jump directly into the new client dashboard route family.
          </p>
          <label className={styles.inputLabel}>
            Client ID
          </label>
          <div className={styles.inputRow}>
            <input
              className={styles.input}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="Paste a client id"
            />
            <button onClick={openClient} className={`${styles.button} ${styles.buttonPrimary}`}>
              Open
            </button>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionTitle}>Create a new client</div>
          <p className={styles.sectionLead}>
            Start with the existing Command Center wizard, then continue into the new `/clients/[clientId]` dashboard flow.
          </p>
          <Link href="/command-center/new" className={styles.linkButton}>
            Open client intake wizard
          </Link>
        </section>
      </div>
    </main>
  );
}