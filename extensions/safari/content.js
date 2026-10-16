(() => {
  "use strict";

  const PORTAL_ORIGIN = "https://elearning.paruluniversity.ac.in";
  if (location.origin !== PORTAL_ORIGIN) return;
  if (document.getElementById("parul-pdf-helper-root")) return;

  let activePdf = null;
  let panelOpen = false;
  let debounceTimer = null;
  let latestObservedPdfUrl = null;
  let isDownloading = false;

  let rootNode = null;
  let hostButton = null;
  let btnIcon = null;
  let btnText = null;
  let panel = null;
  let docTitleEl = null;
  let docSubEl = null;
  let downloadBtn = null;
  let openBtn = null;
  let statusEl = null;
  let docCardEl = null;
  let emptyCardEl = null;

  const SVG_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    }
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function findPortalBackBtn() {
    const primary = document.querySelector("button[aria-label*='back' i], a[aria-label*='back' i], button.btn-back, button.back-btn, .back-button");
    if (primary && isElementVisible(primary)) return primary;

    const candidates = document.querySelectorAll("header button, header a, nav button, nav a, .toolbar button, .top-bar button, .header button, button, a, [role='button']");
    for (const el of candidates) {
      const txt = (el.textContent || "").trim().toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
      const title = (el.getAttribute("title") || "").trim().toLowerCase();
      const hasIcon = el.querySelector && el.querySelector("[class*='arrow-left' i], [class*='arrow_back' i], [class*='chevron-left' i]");
      if (txt === "← back" || txt === "back" || txt.startsWith("← back") || txt.endsWith("back") ||
          aria === "back" || aria.includes("back") || title === "back" || title.includes("back") || hasIcon) {
        if (isElementVisible(el)) return el;
      }
    }
    return null;
  }

  function isViewerActive() {
    const path = location.pathname.toLowerCase();
    if (path === "/classrooms" || path === "/classrooms/" || path === "/dashboard" || path === "/dashboard/") {
      return false;
    }

    const frame = document.querySelector("iframe[src*='.pdf'], iframe[src*='file='], iframe[src*='viewer'], embed[src*='.pdf'], object[data*='.pdf'], iframe[src*='digitaloceanspaces']");
    if (frame && isElementVisible(frame)) return true;

    const ngViewer = document.querySelector("ngx-extended-pdf-viewer, pdf-viewer, [class*='pdf-viewer'], [id*='pdf-viewer'], [class*='document-viewer']");
    if (ngViewer && isElementVisible(ngViewer)) return true;

    const canvases = document.querySelectorAll("canvas");
    let hasVisibleCanvas = false;
    for (const c of canvases) {
      if (isElementVisible(c)) {
        hasVisibleCanvas = true;
        break;
      }
    }

    const backBtn = findPortalBackBtn();

    if (hasVisibleCanvas && backBtn) return true;

    if (backBtn) {
      const headerContainer = backBtn.closest("header, nav, [class*='header' i], [class*='toolbar' i], [class*='topbar' i], [class*='navbar' i]") ||
        (backBtn.parentElement && backBtn.parentElement.parentElement) ||
        backBtn.parentElement;
      if (headerContainer) {
        const nearby = headerContainer.querySelectorAll("span, div, badge, [class*='badge'], [class*='tag']");
        for (const b of nearby) {
          const t = (b.textContent || "").trim().toLowerCase();
          if (t === "pdf" && isElementVisible(b)) return true;
        }
      }
    }

    return false;
  }

  function isHostAllowed(hostname) {
    if (!hostname || typeof hostname !== "string") return false;
    const h = hostname.toLowerCase();
    return (
      h === "edorer-parul-elearning.sgp1.digitaloceanspaces.com" ||
      h.endsWith(".digitaloceanspaces.com") ||
      h === "elearning.paruluniversity.ac.in" ||
      h.endsWith(".paruluniversity.ac.in") ||
      h === "edorer.com" ||
      h.endsWith(".edorer.com")
    );
  }

  function resolvePdfCandidate(raw) {
    if (typeof raw !== "string" || !raw.trim() || raw.length > 8192) return null;
    try {
      const parsed = new URL(raw, location.href);
      if (parsed.protocol !== "https:") return null;

      const fileParam =
        parsed.searchParams.get("file") ||
        parsed.searchParams.get("pdf") ||
        parsed.searchParams.get("url") ||
        parsed.searchParams.get("src");
      if (fileParam) {
        try {
          const innerUrl = new URL(fileParam, parsed.origin);
          if (innerUrl.protocol === "https:" && isHostAllowed(innerUrl.hostname)) {
            let p = innerUrl.pathname.toLowerCase();
            let s = innerUrl.search.toLowerCase();
            try { p = decodeURIComponent(p); } catch {}
            try { s = decodeURIComponent(s); } catch {}
            if (p.includes(".pdf") || s.includes(".pdf") || innerUrl.hostname.includes("digitaloceanspaces.com")) {
              return innerUrl.href;
            }
          }
        } catch {}
      }

      if (isHostAllowed(parsed.hostname)) {
        let p = parsed.pathname.toLowerCase();
        let s = parsed.search.toLowerCase();
        try { p = decodeURIComponent(p); } catch {}
        try { s = decodeURIComponent(s); } catch {}
        if (p.includes(".pdf") || s.includes(".pdf") || parsed.hostname.includes("digitaloceanspaces.com")) {
          return parsed.href;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  function isSupportedPdf(raw) {
    return !!resolvePdfCandidate(raw);
  }

  function cleanBaseSlug(rawSlug) {
    let name = rawSlug.replace(/\.pdf$/i, "");
    name = name.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[._\-\s]*/i, "");
    name = name.replace(/^[0-9a-f]{24,64}[._\-\s]*/i, "");
    name = name.replace(/^[0-9]{10,13}[._\-\s]*/g, "");
    name = name.replace(/[._\-\s]+[0-9a-f]{8,}$/i, "");
    name = name.replace(/^[._\-\s]+|[._\-\s]+$/g, "");
    name = name.replace(/_/g, " ").replace(/\s+/g, " ").trim();
    return name || "Document";
  }

  function extractPageContext() {
    let subject = "";
    let topic = "";

    const backBtn = findPortalBackBtn();
    if (backBtn) {
      const headerContainer = backBtn.closest("header, nav, [class*='header' i], [class*='toolbar' i], [class*='topbar' i], [class*='navbar' i]") ||
        (backBtn.parentElement && backBtn.parentElement.parentElement) ||
        backBtn.parentElement;
      if (headerContainer) {
        const texts = Array.from(headerContainer.querySelectorAll("h1, h2, h3, h4, span, div, strong"))
          .map(el => (el.textContent || "").trim().replace(/\s+/g, " "))
          .filter(t => t && t.toLowerCase() !== "back" && !t.toLowerCase().endsWith("back") && t.toLowerCase() !== "pdf" && t.toLowerCase() !== "download" && t.toLowerCase() !== "print" && t.length < 100);
        if (texts.length > 0) {
          topic = texts[0].replace(/_/g, " ").trim();
        }
      }
    }

    const bcContainer = document.querySelector("[class*='breadcrumb'], nav[aria-label*='breadcrumb' i], ol.breadcrumb, ul.breadcrumb");
    if (bcContainer) {
      const fullText = (bcContainer.textContent || "").trim();
      if (fullText.includes("Subjects >") || fullText.includes(" > ")) {
        const parts = fullText.split(">").map(s => s.trim());
        if (parts.length >= 2) {
          subject = parts[1].replace(/^[0-9A-Za-z_.\-()\[\]]+[\s\-:–—]+|[0-9A-Za-z_.\-()\[\]]+$/g, "").replace(/_/g, " ").trim();
        }
        if (parts.length >= 3 && !topic) {
          topic = parts[2].replace(/_/g, " ").trim();
        }
      } else {
        const items = Array.from(bcContainer.querySelectorAll("li, a, span"))
          .map(el => (el.textContent || "").trim().replace(/\s+/g, " "))
          .filter(t => t && t.length > 2 && t.length < 80 && !t.toLowerCase().includes("home") && !t.toLowerCase().includes("dashboard") && !t.toLowerCase().includes("subjects"));
        if (items.length >= 1) {
          subject = items[0].replace(/^[0-9A-Za-z_.\-()\[\]]+[\s\-:–—]+|[0-9A-Za-z_.\-()\[\]]+$/g, "").replace(/_/g, " ").trim();
        }
        if (items.length >= 2 && !topic) {
          topic = items[1].replace(/_/g, " ").trim();
        }
      }
    }

    if (!subject) {
      const breadcrumbs = document.querySelectorAll("[class*='breadcrumb'] *, nav *, header *, h1, h2, h3, a, span");
      for (const el of breadcrumbs) {
        const text = (el.textContent || "").trim();
        if (text.includes("Subjects >") || text.includes(" > ")) {
          const parts = text.split(">").map(s => s.trim());
          if (parts.length >= 2) {
            subject = parts[1].replace(/^[0-9A-Za-z_.\-()\[\]]+[\s\-:–—]+|[0-9A-Za-z_.\-()\[\]]+$/g, "").replace(/_/g, " ").trim();
          }
          if (parts.length >= 3 && !topic) {
            topic = parts[2].replace(/_/g, " ").trim();
          }
          if (subject) break;
        }
      }
    }

    if (!subject) {
      const headings = document.querySelectorAll("h1, h2, h3, h4, strong");
      for (const h of headings) {
        const t = (h.textContent || "").trim().replace(/\s+/g, " ");
        if (t.length > 3 && t.length < 80 && !t.toLowerCase().includes("student preview") && !t.toLowerCase().includes("pinned") && !t.toLowerCase().includes("my classrooms")) {
          subject = t.replace(/_/g, " ").trim();
          break;
        }
      }
    }

    return { subject, topic };
  }

  function computeCleanFilename(subject, topic, cleanSlug) {
    const parts = [];
    if (subject && subject !== "Course Document") parts.push(subject);
    if (topic && topic.toLowerCase() !== (subject || "").toLowerCase()) parts.push(topic);
    if (!parts.length && cleanSlug) parts.push(cleanSlug);
    let combined = parts.join(" - ")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    combined = combined.replace(/\.pdf$/i, "");
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(combined)) {
      combined = combined + "_doc";
    }
    const base = combined || cleanSlug || "Document";
    return base + ".pdf";
  }

  function setStatus(msg) {
    if (!statusEl) return;
    if (!msg) {
      statusEl.textContent = "";
      statusEl.style.display = "none";
    } else {
      statusEl.textContent = msg;
      statusEl.style.display = "block";
    }
  }

  function resetDownloadState() {
    isDownloading = false;
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = "⬇ Download PDF";
    }
  }

  function triggerDirectDownload(url, filename) {
    if (!url) return false;
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "Document.pdf";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { a.remove(); } catch {}
      }, 300);
      return true;
    } catch {
      try {
        window.open(url, "_blank", "noopener,noreferrer");
        return true;
      } catch {
        return false;
      }
    }
  }

  function updateActivePdf(rawUrl) {
    const directUrl = resolvePdfCandidate(rawUrl);
    if (!directUrl) return false;

    if (activePdf && activePdf.url === directUrl) {
      return false;
    }

    let rawSlug = "Document.pdf";
    try {
      const urlObj = new URL(directUrl);
      const dispMatch = urlObj.search.match(/filename[*]?=(?:UTF-8'')?["']?([^"';&]+)["']?/i);
      if (dispMatch && dispMatch[1]) {
        rawSlug = decodeURIComponent(dispMatch[1]);
      } else {
        const rawEnd = decodeURIComponent(urlObj.pathname.split("/").pop() || "Document.pdf");
        rawSlug = rawEnd.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[._\-\s]*/i, "");
      }
    } catch {}

    const cleanSlug = cleanBaseSlug(rawSlug);
    const { subject, topic } = extractPageContext();
    const downloadFilename = computeCleanFilename(subject, topic, cleanSlug);

    if (activePdf && activePdf.url === directUrl && activePdf.filename === downloadFilename) {
      return false;
    }

    activePdf = {
      url: directUrl,
      rawSlug: rawSlug,
      cleanSlug: cleanSlug,
      subject: subject || "Course Document",
      topic: topic || "",
      filename: downloadFilename,
      updatedAt: Date.now()
    };

    render();
    return true;
  }

  function scanResources() {
    let candidateUrl = null;

    const domPdfs = document.querySelectorAll(
      "iframe[src*='file='], iframe[src*='viewer'], iframe, embed, object, [data-pdf-url], [data-file*='.pdf'], [data-url*='.pdf'], a[href*='.pdf']"
    );
    for (const el of domPdfs) {
      const src =
        el.getAttribute("src") ||
        el.getAttribute("data") ||
        el.getAttribute("href") ||
        el.getAttribute("data-pdf-url") ||
        el.getAttribute("data-file") ||
        el.getAttribute("data-url");
      const resolved = resolvePdfCandidate(src);
      if (resolved) {
        candidateUrl = resolved;
        break;
      }
    }

    if (!candidateUrl) {
      try {
        const entries = performance.getEntriesByType("resource");
        for (let i = entries.length - 1; i >= 0; i--) {
          const name = entries[i].name;
          if (name.includes(".pdf") || name.includes("file=") || name.includes("digitaloceanspaces")) {
            const resolved = resolvePdfCandidate(name);
            if (resolved) {
              candidateUrl = resolved;
              break;
            }
          }
        }
      } catch {}
    }

    if (!candidateUrl && latestObservedPdfUrl) {
      candidateUrl = resolvePdfCandidate(latestObservedPdfUrl);
    }

    if (candidateUrl) {
      latestObservedPdfUrl = candidateUrl;
      updateActivePdf(candidateUrl);
    }
  }

  function checkViewerLifecycle() {
    const active = isViewerActive();
    if (!active) {
      if (activePdf !== null) {
        activePdf = null;
        latestObservedPdfUrl = null;
        resetDownloadState();
        if (panelOpen) {
          setPanelVisibility(false);
        }
        setStatus("");
        render();
      }
      return;
    }

    scanResources();
  }

  function scheduleLifecycleCheck() {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      checkViewerLifecycle();
    }, 180);
  }

  function openCurrentPdf() {
    if (!activePdf) return;
    resetDownloadState();
    window.open(activePdf.url, "_blank", "noopener,noreferrer");
    setStatus("↗ Opened document in new tab.");
    setTimeout(() => {
      if (statusEl && statusEl.textContent === "↗ Opened document in new tab.") {
        setStatus("");
      }
    }, 4000);
  }

  function downloadCurrentPdf() {
    if (!activePdf || isDownloading) return;
    isDownloading = true;
    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.textContent = "⏳ Downloading...";
    }
    setStatus("Starting download...");

    let settled = false;
    const targetUrl = activePdf.url;
    const targetFilename = activePdf.filename;

    const watchdogTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const success = triggerDirectDownload(targetUrl, targetFilename);
      resetDownloadState();
      if (success) {
        setStatus(`✓ Download initiated: ${targetFilename}`);
      } else {
        setStatus("Download timed out. Try 'Open in Tab'.");
      }
    }, 3500);

    try {
      chrome.runtime.sendMessage(
        {
          type: "DOWNLOAD_PARUL_PDF",
          url: targetUrl,
          filename: targetFilename
        },
        response => {
          if (settled) return;
          settled = true;
          clearTimeout(watchdogTimer);
          resetDownloadState();

          const error = chrome.runtime.lastError;
          if (error || !response || !response.ok) {
            const fallbackOk = triggerDirectDownload(targetUrl, targetFilename);
            if (fallbackOk) {
              setStatus(`✓ Download initiated: ${targetFilename}`);
            } else {
              const msg = (response && response.error) || (error && error.message) || "Download failed.";
              setStatus(msg);
            }
            return;
          }

          setStatus(`✓ Downloaded: ${response.filename || targetFilename}`);
        }
      );
    } catch (sendErr) {
      if (settled) return;
      settled = true;
      clearTimeout(watchdogTimer);
      const fallbackOk = triggerDirectDownload(targetUrl, targetFilename);
      resetDownloadState();
      if (fallbackOk) {
        setStatus(`✓ Download initiated: ${targetFilename}`);
      } else {
        setStatus(`Error: ${sendErr && sendErr.message ? sendErr.message : "Download failed."}`);
      }
    }
  }

  function handleOutsideInteraction(event) {
    if (!panelOpen || !rootNode) return;
    const path = event.composedPath ? event.composedPath() : [];
    const isInside = event.target === rootNode || rootNode.contains(event.target) || path.includes(rootNode);
    if (!isInside) {
      setPanelVisibility(false);
    }
  }

  function handleScrollClose(event) {
    if (!panelOpen || !rootNode) return;
    if (event && event.target) {
      const path = event.composedPath ? event.composedPath() : [];
      if (event.target === rootNode || rootNode.contains(event.target) || path.includes(rootNode)) {
        return;
      }
    }
    setPanelVisibility(false);
  }

  function handleEscapeKey(event) {
    if (event.key === "Escape" && panelOpen) {
      setPanelVisibility(false);
    }
  }

  function setPanelVisibility(open) {
    panelOpen = open;
    if (panel) {
      panel.hidden = !open;
      if (open) {
        panel.classList.remove("hidden");
        hostButton.setAttribute("aria-expanded", "true");
        checkViewerLifecycle();

        window.addEventListener("pointerdown", handleOutsideInteraction, true);
        window.addEventListener("scroll", handleScrollClose, { capture: true, passive: true });
        window.addEventListener("wheel", handleScrollClose, { capture: true, passive: true });
        window.addEventListener("touchmove", handleScrollClose, { capture: true, passive: true });
        document.addEventListener("keydown", handleEscapeKey);
      } else {
        panel.classList.add("hidden");
        hostButton.setAttribute("aria-expanded", "false");

        window.removeEventListener("pointerdown", handleOutsideInteraction, true);
        window.removeEventListener("scroll", handleScrollClose, { capture: true, passive: true });
        window.removeEventListener("wheel", handleScrollClose, { capture: true, passive: true });
        window.removeEventListener("touchmove", handleScrollClose, { capture: true, passive: true });
        document.removeEventListener("keydown", handleEscapeKey);
      }
    }
  }

  function render() {
    if (!hostButton) return;

    if (activePdf) {
      hostButton.className = "toggle-btn active-state";
      btnText.textContent = "Download PDF";
      btnText.style.display = "inline";

      if (emptyCardEl) emptyCardEl.style.display = "none";
      if (docCardEl) docCardEl.style.display = "block";

      if (docTitleEl) {
        if (activePdf.subject === "Course Document" && activePdf.topic) {
          docTitleEl.textContent = activePdf.topic;
        } else if (activePdf.topic && activePdf.topic.toLowerCase() !== activePdf.subject.toLowerCase()) {
          docTitleEl.textContent = `${activePdf.subject} • ${activePdf.topic}`;
        } else {
          docTitleEl.textContent = activePdf.subject;
        }
      }
      if (docSubEl) {
        docSubEl.textContent = activePdf.filename;
        docSubEl.setAttribute("title", activePdf.filename);
      }
    } else {
      resetDownloadState();
      hostButton.className = "toggle-btn idle-state";
      btnText.textContent = "";
      btnText.style.display = "none";

      if (docCardEl) docCardEl.style.display = "none";
      if (emptyCardEl) emptyCardEl.style.display = "block";
    }
  }

  function createUi() {
    rootNode = document.createElement("div");
    rootNode.id = "parul-pdf-helper-root";
    const shadow = rootNode.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      :host{all:initial;contain:layout style;color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.4;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
      *{box-sizing:border-box;margin:0;padding:0}
      .wrapper{position:fixed;right:20px;bottom:20px;z-index:2147483647;contain:layout style;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
      .toggle-btn{display:inline-flex;align-items:center;border:none;color:#ffffff;cursor:pointer;transition:transform 160ms cubic-bezier(0.4,0,0.2,1),box-shadow 160ms cubic-bezier(0.4,0,0.2,1),background 160ms cubic-bezier(0.4,0,0.2,1);outline:none;user-select:none;-webkit-user-select:none;will-change:transform}
      .toggle-btn.idle-state{width:46px;height:46px;border-radius:50%;justify-content:center;background:#1e293b;border:1px solid rgba(255,255,255,0.15);box-shadow:0 4px 14px rgba(0,0,0,0.25)}
      .toggle-btn.idle-state:hover{background:#334155;transform:scale(1.06)}
      .toggle-btn.idle-state:active{transform:scale(0.96)}
      .toggle-btn.active-state{height:44px;padding:0 18px 0 14px;border-radius:100px;gap:8px;background:#2563eb;box-shadow:0 6px 20px rgba(37,99,235,0.45);font-size:13px;font-weight:700}
      .toggle-btn.active-state:hover{background:#1d4ed8;transform:translateY(-2px);box-shadow:0 8px 24px rgba(37,99,235,0.55)}
      .toggle-btn.active-state:active{transform:scale(0.97)}
      .toggle-btn:focus-visible{outline:3px solid #38bdf8;outline-offset:3px}
      .btn-icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;line-height:1}
      .panel{width:min(380px,calc(100vw - 32px));display:flex;flex-direction:column;background:#0f172a;color:#f8fafc;border:1px solid rgba(255,255,255,0.12);border-radius:18px;box-shadow:0 20px 50px -10px rgba(0,0,0,0.5);overflow:hidden;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);will-change:transform,opacity}
      .panel[hidden],.panel.hidden{display:none !important}
      @media(prefers-color-scheme:light){.panel{background:#ffffff;color:#0f172a;border:1px solid #e2e8f0;box-shadow:0 16px 40px -10px rgba(15,23,42,0.16)}}
      .header{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid rgba(255,255,255,0.08)}
      @media(prefers-color-scheme:light){.header{border-bottom:1px solid #f1f5f9}}
      .brand-title{font-size:14px;font-weight:800;letter-spacing:-0.02em}
      .brand-author{font-size:11px;color:#94a3b8;font-weight:500}
      .close-btn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:50%;background:rgba(255,255,255,0.08);color:inherit;font-size:16px;cursor:pointer;transition:background 120ms ease}
      @media(prefers-color-scheme:light){.close-btn{background:#f1f5f9;color:#0f172a}}
      .close-btn:hover{background:rgba(255,255,255,0.18)}
      .privacy-note{padding:8px 16px;background:rgba(37,99,235,0.1);color:#38bdf8;font-size:11px;line-height:1.4;border-bottom:1px solid rgba(255,255,255,0.06)}
      @media(prefers-color-scheme:light){.privacy-note{background:#eff6ff;color:#1d4ed8;border-bottom:1px solid #dbeafe}}
      .body-wrap{padding:14px 16px}
      .doc-card{padding:12px;border-radius:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);margin-bottom:0}
      @media(prefers-color-scheme:light){.doc-card{background:#f8fafc;border:1px solid #e2e8f0}}
      .doc-title{font-size:13px;font-weight:700;color:inherit;margin-bottom:4px;overflow-wrap:anywhere}
      .doc-filename{font-size:11px;color:#94a3b8;overflow-wrap:anywhere;margin-bottom:12px}
      @media(prefers-color-scheme:light){.doc-filename{color:#64748b}}
      .action-row{display:flex;gap:8px}
      .btn{flex:1;height:34px;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;transition:all 120ms ease;display:inline-flex;align-items:center;justify-content:center;gap:6px}
      .btn-primary{background:#2563eb;color:#ffffff}
      .btn-primary:hover{background:#1d4ed8;transform:translateY(-1px)}
      .btn-primary:disabled{opacity:0.6;cursor:not-allowed;transform:none}
      .btn-secondary{background:rgba(255,255,255,0.08);color:inherit}
      @media(prefers-color-scheme:light){.btn-secondary{background:#e2e8f0;color:#0f172a}}
      .btn-secondary:hover{background:rgba(255,255,255,0.16)}
      .empty-card{padding:20px 10px;text-align:center;color:#94a3b8;font-size:12px;line-height:1.5}
      .status{padding:8px 16px;font-size:11px;color:#38bdf8;background:rgba(56,189,248,0.08);border-top:1px solid rgba(255,255,255,0.06);display:none}
      @media(prefers-color-scheme:light){.status{background:#eff6ff;color:#1d4ed8;border-top:1px solid #f1f5f9}}
      .creator-box{padding:12px 16px 14px;border-top:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.12)}
      @media(prefers-color-scheme:light){.creator-box{background:#f8fafc;border-top:1px solid #f1f5f9}}
      .creator-heading{font-size:11px;color:#94a3b8;margin-bottom:6px;display:flex;align-items:center;gap:5px}
      .creator-heading strong{color:inherit}
      .creator-pills{display:flex;gap:6px;flex-wrap:wrap}
      .pill{flex:1;min-width:75px;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:6px 10px;border-radius:100px;text-decoration:none;font-size:11px;font-weight:700;color:#ffffff;transition:transform 120ms ease}
      .pill:hover{transform:translateY(-1px)}
      .pill-linkedin{background:#0077b5}
      .pill-github{background:#24292f}
      .pill-instagram{background:linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)}
    `;

    const wrapper = document.createElement("div");
    wrapper.className = "wrapper";

    hostButton = document.createElement("button");
    hostButton.className = "toggle-btn idle-state";
    hostButton.setAttribute("aria-expanded", "false");
    hostButton.setAttribute("aria-label", "Parul eLearning PDF Download");
    hostButton.setAttribute("title", "Parul eLearning PDF Download");

    btnIcon = document.createElement("span");
    btnIcon.className = "btn-icon";
    btnIcon.innerHTML = SVG_ICON;

    btnText = document.createElement("span");
    btnText.className = "btn-text";
    btnText.style.display = "none";

    hostButton.append(btnIcon, btnText);
    hostButton.addEventListener("click", () => {
      setPanelVisibility(!panelOpen);
    });

    panel = document.createElement("section");
    panel.className = "panel hidden";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Parul PDF helper window");

    const header = document.createElement("div");
    header.className = "header";

    const titleWrap = document.createElement("div");
    const brandTitle = document.createElement("div");
    brandTitle.className = "brand-title";
    brandTitle.textContent = "Parul eLearning PDF Download";
    const brandAuthor = document.createElement("div");
    brandAuthor.className = "brand-author";
    brandAuthor.textContent = "Crafted by Ayush Meel";
    titleWrap.append(brandTitle, brandAuthor);

    const closeBtn = document.createElement("button");
    closeBtn.className = "close-btn";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", () => {
      setPanelVisibility(false);
    });

    header.append(titleWrap, closeBtn);

    const privacy = document.createElement("div");
    privacy.className = "privacy-note";
    privacy.textContent = "🔒 100% Client-Side. No passwords, cookies, or student tokens are collected.";

    const bodyWrap = document.createElement("div");
    bodyWrap.className = "body-wrap";

    docCardEl = document.createElement("div");
    docCardEl.className = "doc-card";
    docCardEl.style.display = "none";

    docTitleEl = document.createElement("div");
    docTitleEl.className = "doc-title";

    docSubEl = document.createElement("div");
    docSubEl.className = "doc-filename";

    const actionRow = document.createElement("div");
    actionRow.className = "action-row";

    downloadBtn = document.createElement("button");
    downloadBtn.className = "btn btn-primary";
    downloadBtn.textContent = "⬇ Download PDF";
    downloadBtn.addEventListener("click", downloadCurrentPdf);

    openBtn = document.createElement("button");
    openBtn.className = "btn btn-secondary";
    openBtn.textContent = "↗ Open in Tab";
    openBtn.addEventListener("click", openCurrentPdf);

    actionRow.append(downloadBtn, openBtn);
    docCardEl.append(docTitleEl, docSubEl, actionRow);

    emptyCardEl = document.createElement("div");
    emptyCardEl.className = "empty-card";
    emptyCardEl.textContent = "No PDF active right now. Open any course material (Orientation Booklet, Assignment, or Lecture) on the portal to download it.";

    bodyWrap.append(docCardEl, emptyCardEl);

    statusEl = document.createElement("div");
    statusEl.className = "status";

    const creatorBox = document.createElement("div");
    creatorBox.className = "creator-box";

    const creatorHeading = document.createElement("div");
    creatorHeading.className = "creator-heading";
    creatorHeading.innerHTML = "⚡ <strong>Saved you time?</strong> Support the creator:";

    const creatorPills = document.createElement("div");
    creatorPills.className = "creator-pills";

    function makePill(label, href, bgClass) {
      const a = document.createElement("a");
      a.className = `pill ${bgClass}`;
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = label;
      return a;
    }

    creatorPills.append(
      makePill("LinkedIn ↗", "https://www.linkedin.com/in/ayushmeel", "pill-linkedin"),
      makePill("GitHub ⭐", "https://github.com/meel-ayush/parul-elearning-pdf-download", "pill-github"),
      makePill("Instagram", "https://www.instagram.com/meel_ayush", "pill-instagram")
    );

    creatorBox.append(creatorHeading, creatorPills);

    panel.append(header, privacy, bodyWrap, statusEl, creatorBox);
    wrapper.append(panel, hostButton);
    shadow.append(style, wrapper);
    document.documentElement.appendChild(rootNode);

    render();
  }

  function init() {
    createUi();
    checkViewerLifecycle();

    setInterval(checkViewerLifecycle, 1500);

    const observer = new MutationObserver(scheduleLifecycleCheck);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener("click", event => {
      const target = event.target;
      if (!target) return;
      const backEl = target.closest ? target.closest("button, .btn, a, [role='button']") : null;
      if (backEl) {
        const txt = (backEl.textContent || "").trim().toLowerCase();
        const aria = (backEl.getAttribute("aria-label") || "").trim().toLowerCase();
        const title = (backEl.getAttribute("title") || "").trim().toLowerCase();
        const hasIcon = backEl.querySelector && backEl.querySelector("[class*='arrow-left' i], [class*='arrow_back' i], [class*='chevron-left' i]");
        if (txt === "← back" || txt === "back" || txt.startsWith("← back") || txt.endsWith("back") ||
            aria === "back" || aria.includes("back") || title === "back" || title.includes("back") || hasIcon) {
          setTimeout(checkViewerLifecycle, 30);
          setTimeout(checkViewerLifecycle, 150);
          setTimeout(checkViewerLifecycle, 400);
        }
      }
    }, true);

    window.addEventListener("popstate", checkViewerLifecycle);
    window.addEventListener("hashchange", checkViewerLifecycle);

    try {
      const perfObs = new PerformanceObserver(list => {
        let latest = null;
        for (const entry of list.getEntries()) {
          const resolved = resolvePdfCandidate(entry.name);
          if (resolved) {
            latest = resolved;
          }
        }
        if (latest) {
          latestObservedPdfUrl = latest;
          if (isViewerActive()) {
            updateActivePdf(latest);
          }
        }
      });
      perfObs.observe({ type: "resource", buffered: true });
    } catch {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
