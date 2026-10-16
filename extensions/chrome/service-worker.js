"use strict";

const PORTAL_ORIGIN = "https://elearning.paruluniversity.ac.in";

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

function isPortalSender(sender) {
  if (!sender) return false;
  if (sender.id !== chrome.runtime.id) return false;

  if (typeof sender.origin === "string" && sender.origin.length > 0) {
    return sender.origin === PORTAL_ORIGIN;
  }

  if (typeof sender.url === "string" && sender.url.length > 0) {
    try {
      const page = new URL(sender.url);
      return page.origin === PORTAL_ORIGIN && page.protocol === "https:";
    } catch {
      return false;
    }
  }

  if (sender.tab && typeof sender.tab.url === "string" && sender.tab.url.length > 0) {
    try {
      const page = new URL(sender.tab.url);
      return page.origin === PORTAL_ORIGIN && page.protocol === "https:";
    } catch {
      return false;
    }
  }

  return !!sender.tab;
}

function validatePdfUrl(raw) {
  if (typeof raw !== "string" || raw.length > 8192) {
    return null;
  }
  try {
    let url = new URL(raw.trim());

    const fileParam =
      url.searchParams.get("file") ||
      url.searchParams.get("pdf") ||
      url.searchParams.get("url") ||
      url.searchParams.get("src");
    if (fileParam) {
      try {
        const inner = new URL(fileParam, url.origin);
        if (inner.protocol === "https:" && isHostAllowed(inner.hostname)) {
          url = inner;
        }
      } catch {}
    }

    if (url.protocol !== "https:") return null;
    if (!isHostAllowed(url.hostname)) return null;
    if (url.port && url.port !== "443") return null;
    if (url.username || url.password) return null;

    let p = url.pathname.toLowerCase();
    let s = url.search.toLowerCase();
    try { p = decodeURIComponent(p); } catch {}
    try { s = decodeURIComponent(s); } catch {}
    if (!p.includes(".pdf") && !s.includes(".pdf") && !url.hostname.includes("digitaloceanspaces.com")) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function sanitizeFilename(text) {
  if (typeof text !== "string") return "Document.pdf";
  let cleaned = text
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[._\-\s]+|[._\-\s]+$/g, "")
    .trim();
  cleaned = cleaned.replace(/\.pdf$/i, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) {
    cleaned = cleaned + "_doc";
  }
  if (cleaned.length > 150) {
    cleaned = cleaned.slice(0, 146).replace(/^[._\-\s]+|[._\-\s]+$/g, "");
  }
  return (cleaned || "Document") + ".pdf";
}

function triggerDownload(options) {
  return new Promise((resolve, reject) => {
    try {
      chrome.downloads.download(options, downloadId => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
        } else if (typeof downloadId !== "number") {
          reject(new Error("Chrome failed to create download item."));
        } else {
          resolve(downloadId);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || (message.type !== "DOWNLOAD_PARUL_PDF" && message.type !== "PPH_DOWNLOAD_PDF")) {
    return false;
  }

  (async () => {
    try {
      if (!isPortalSender(sender)) {
        sendResponse({ ok: false, error: "Unauthorized sender origin." });
        return;
      }

      const validUrl = validatePdfUrl(message.url);
      if (!validUrl) {
        sendResponse({ ok: false, error: "Unsupported or unverified PDF URL." });
        return;
      }

      if (!chrome.downloads || typeof chrome.downloads.download !== "function") {
        sendResponse({ ok: false, unsupported: true });
        return;
      }

      let chosenName = message.filename;
      if (!chosenName) {
        try {
          const dispMatch = validUrl.search.match(/filename[*]?=(?:UTF-8'')?["']?([^"';&]+)["']?/i);
          if (dispMatch && dispMatch[1]) {
            chosenName = decodeURIComponent(dispMatch[1]);
          } else {
            const rawEnd = decodeURIComponent(validUrl.pathname.split("/").pop() || "Document.pdf");
            chosenName = rawEnd.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[._\-\s]*/i, "");
          }
        } catch {
          chosenName = "Document.pdf";
        }
      }

      const finalName = sanitizeFilename(chosenName);
      const subfolderPath = `Parul eLearning PDFs/${finalName}`;

      try {
        const downloadId = await triggerDownload({
          url: validUrl.href,
          filename: subfolderPath,
          conflictAction: "uniquify",
          saveAs: false
        });
        sendResponse({ ok: true, downloadId, filename: finalName });
      } catch (subfolderErr) {
        try {
          const fallbackId = await triggerDownload({
            url: validUrl.href,
            filename: finalName,
            conflictAction: "uniquify",
            saveAs: false
          });
          sendResponse({ ok: true, downloadId: fallbackId, filename: finalName });
        } catch (fallbackErr) {
          sendResponse({
            ok: false,
            error: fallbackErr && fallbackErr.message ? fallbackErr.message : (subfolderErr && subfolderErr.message ? subfolderErr.message : "Download failed.")
          });
        }
      }
    } catch (unexpected) {
      sendResponse({
        ok: false,
        error: unexpected && unexpected.message ? unexpected.message : "Unexpected internal error."
      });
    }
  })();

  return true;
});

