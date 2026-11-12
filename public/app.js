const form = document.getElementById("audit-form");
const statusEl = document.getElementById("status");
const sessionsEl = document.getElementById("sessions");
const downloadBtn = document.getElementById("download-btn");
const lookupBtn = document.getElementById("lookup-btn");
const proposalInput = document.getElementById("proposalId");
const versionInput = document.getElementById("documentVersion");

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status${type ? " " + type : ""}`;
}

function setBusy(busy) {
  downloadBtn.disabled = busy;
  lookupBtn.disabled = busy;
}

async function parseError(res) {
  try {
    const data = await res.json();
    let msg = data.error || `Request failed (${res.status}).`;
    if (Array.isArray(data.availableVersions) && data.availableVersions.length) {
      msg += ` Available versions: ${data.availableVersions.join(", ")}.`;
    }
    return msg;
  } catch {
    return `Request failed (${res.status}).`;
  }
}

async function lookupSessions() {
  const proposalId = proposalInput.value.trim();
  sessionsEl.innerHTML = "";
  if (!proposalId) {
    setStatus("Enter a proposal ID first.", "error");
    return;
  }
  setBusy(true);
  setStatus("Looking up sessions…");
  try {
    const res = await fetch(
      `/api/sessions?proposalId=${encodeURIComponent(proposalId)}`,
    );
    if (!res.ok) {
      setStatus(await parseError(res), "error");
      return;
    }
    const data = await res.json();
    const sessions = data.sessions || [];
    if (sessions.length === 0) {
      setStatus(`No sessions found for proposal ${proposalId}.`, "error");
      return;
    }
    setStatus(`Found ${sessions.length} session(s).`, "success");
    renderSessions(sessions);
  } catch (err) {
    setStatus(`Network error: ${err.message}`, "error");
  } finally {
    setBusy(false);
  }
}

function renderSessions(sessions) {
  const rows = sessions
    .map(
      (s) => `
      <tr>
        <td>${s.documentVersion ?? ""}</td>
        <td><code>${s.sessionRef ?? ""}</code></td>
        <td>
          <button type="button" class="pick" data-version="${
            s.documentVersion ?? ""
          }">Use</button>
        </td>
      </tr>`,
    )
    .join("");

  sessionsEl.innerHTML = `
    <table>
      <thead>
        <tr><th>Version</th><th>Session Ref</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  sessionsEl.querySelectorAll("button.pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      versionInput.value = btn.dataset.version;
    });
  });
}

async function downloadAudit(event) {
  event.preventDefault();
  const proposalId = proposalInput.value.trim();
  const documentVersion = versionInput.value.trim();
  if (!proposalId || !documentVersion) {
    setStatus("Both proposal ID and document version are required.", "error");
    return;
  }

  setBusy(true);
  setStatus("Resolving session and fetching audit pack…");
  try {
    const res = await fetch(
      `/api/audit?proposalId=${encodeURIComponent(
        proposalId,
      )}&documentVersion=${encodeURIComponent(documentVersion)}`,
    );

    if (!res.ok) {
      setStatus(await parseError(res), "error");
      return;
    }

    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename =
      (match && match[1]) ||
      `audit-pack-${proposalId}-v${documentVersion}.pdf`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setStatus(`Downloaded ${filename}.`, "success");
  } catch (err) {
    setStatus(`Network error: ${err.message}`, "error");
  } finally {
    setBusy(false);
  }
}

form.addEventListener("submit", downloadAudit);
lookupBtn.addEventListener("click", lookupSessions);
