(() => {
  const REPO = "nicochan2004/stocktools";
  const YAML_PATH = "scripts/watchlist.yaml";
  const DATA_URL = "../data/watchlist_data.json";
  const TOKEN_KEY = "stocktools_gh_token";
  const ALERTED_KEY = "stocktools_alerted_codes";
  const REFRESH_MS = 60 * 1000;

  const cardsEl = document.getElementById("cards");
  const updatedAtEl = document.getElementById("updatedAt");
  const addFormEl = document.getElementById("addForm");
  const readonlyNoticeEl = document.getElementById("readonlyNotice");
  const codeInput = document.getElementById("codeInput");
  const nameInput = document.getElementById("nameInput");
  const addBtn = document.getElementById("addBtn");
  const addStatusEl = document.getElementById("addStatus");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsModal = document.getElementById("settingsModal");
  const tokenInput = document.getElementById("tokenInput");
  const saveTokenBtn = document.getElementById("saveTokenBtn");
  const clearTokenBtn = document.getElementById("clearTokenBtn");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const toastEl = document.getElementById("toast");

  const charts = {};
  let isFirstLoad = true;

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function updateEditUI() {
    const hasToken = !!getToken();
    addFormEl.hidden = !hasToken;
    readonlyNoticeEl.hidden = hasToken;
  }

  function showToast(message, ms = 4000) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  function playBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 300);
    } catch (e) {
      // 自動再生がブロックされる場合は無視する
    }
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function base64ToUtf8(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  async function githubGetFile() {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${YAML_PATH}`, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) throw new Error(`GitHub APIエラー (${res.status})`);
    const json = await res.json();
    const text = base64ToUtf8(json.content);
    return { sha: json.sha, items: jsyaml.load(text) || [] };
  }

  async function githubPutFile(items, sha, message) {
    const yamlText = jsyaml.dump(items, { allowUnicode: true });
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${YAML_PATH}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${getToken()}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        content: utf8ToBase64(yamlText),
        sha,
        branch: "main",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub APIエラー (${res.status}): ${body}`);
    }
  }

  async function addStock(code, name) {
    const { sha, items } = await githubGetFile();
    if (items.some((it) => String(it.code) === code)) {
      throw new Error("すでにリストに登録されています");
    }
    items.push({ code, name: name || "" });
    await githubPutFile(items, sha, `add ${code} to watchlist`);
  }

  async function removeStock(code) {
    const { sha, items } = await githubGetFile();
    const next = items.filter((it) => String(it.code) !== code);
    await githubPutFile(next, sha, `remove ${code} from watchlist`);
  }

  function badgeFor(signals) {
    const occurred = signals.filter((s) => s.status === "発生");
    const near = signals.filter((s) => s.status === "接近");
    if (occurred.length > 0) {
      const isDead = occurred.some((s) => s.kind === "デッドクロス");
      return { cls: isDead ? "dead" : "golden", text: isDead ? "🔴発生" : "🔵発生" };
    }
    if (near.length > 0) {
      return { cls: "near", text: "🟡接近" };
    }
    return null;
  }

  function fmt(value, digits, suffix = "") {
    if (value === null || value === undefined) return "—";
    return value.toFixed(digits) + suffix;
  }

  function renderCard(stock) {
    const badge = badgeFor(stock.signals);

    const card = document.createElement("div");
    card.className = "card";
    card.id = `card-${stock.code}`;

    const priceClass = stock.change_pct >= 0 ? "up" : "down";
    const priceSign = stock.change_pct >= 0 ? "+" : "";
    const f = stock.fundamentals;

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">${stock.code} ${stock.name}${badge ? ` <span class="badge ${badge.cls}">${badge.text}</span>` : ""}</div>
        <button class="remove-btn" data-code="${stock.code}">削除</button>
      </div>
      <div class="card-price ${priceClass}">¥${fmt(stock.price, 1)} <small>(${priceSign}${fmt(stock.change_pct, 1)}%)</small></div>
      <div class="metrics">
        <div><div class="label">PER</div><div class="value">${fmt(f.per, 1, "倍")}</div></div>
        <div><div class="label">PBR</div><div class="value">${fmt(f.pbr, 2, "倍")}</div></div>
        <div><div class="label">配当利回り</div><div class="value">${fmt(f.dividend_yield, 2, "%")}</div></div>
        <div><div class="label">時価総額</div><div class="value">${f.market_cap ? Math.round(f.market_cap / 1e8).toLocaleString() + "億" : "—"}</div></div>
        <div><div class="label">EPS</div><div class="value">${fmt(f.eps, 1)}</div></div>
        <div><div class="label">ROE</div><div class="value">${f.roe !== null ? (f.roe * 100).toFixed(1) + "%" : "—"}</div></div>
        <div><div class="label">52週高安</div><div class="value">${f.week52_low ? Math.round(f.week52_low) + "〜" + Math.round(f.week52_high) : "—"}</div></div>
        <div><div class="label">出来高</div><div class="value">${f.avg_volume ? Math.round(f.avg_volume).toLocaleString() : "—"}</div></div>
      </div>
      <div class="chart-wrap"><canvas id="chart-${stock.code}"></canvas></div>
      ${stock.signals.map((s) => `<div class="signal-line">・${s.pair}: ${s.text}</div>`).join("")}
    `;

    card.querySelector(".remove-btn").addEventListener("click", async () => {
      if (!getToken()) return;
      if (!confirm(`${stock.code} ${stock.name} をウォッチリストから削除しますか？`)) return;
      try {
        await removeStock(stock.code);
        showToast(`${stock.code} を削除しました（反映には数分かかります）`);
        card.remove();
      } catch (e) {
        showToast(`削除に失敗しました: ${e.message}`);
      }
    });

    return card;
  }

  function renderChart(stock) {
    const ctx = document.getElementById(`chart-${stock.code}`);
    if (!ctx) return;
    const labels = stock.history.map((h) => h.date);
    if (charts[stock.code]) charts[stock.code].destroy();
    charts[stock.code] = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "終値", data: stock.history.map((h) => h.close), borderColor: "#222", borderWidth: 1, pointRadius: 0 },
          { label: "MA5", data: stock.history.map((h) => h.ma5), borderColor: "#2f6fed", borderWidth: 1, pointRadius: 0 },
          { label: "MA25", data: stock.history.map((h) => h.ma25), borderColor: "#e08a2f", borderWidth: 1, pointRadius: 0 },
          { label: "MA75", data: stock.history.map((h) => h.ma75), borderColor: "#2f9e44", borderWidth: 1, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { ticks: { maxTicksLimit: 6, font: { size: 9 } } },
          y: { ticks: { font: { size: 9 } } },
        },
        plugins: { legend: { labels: { font: { size: 10 } } } },
      },
    });
  }

  function checkNewAlerts(stocks) {
    const prevAlerted = new Set(JSON.parse(localStorage.getItem(ALERTED_KEY) || "[]"));
    const currentAlerted = new Set();
    const newAlerts = [];

    stocks.forEach((stock) => {
      const occurred = stock.signals.filter((s) => s.status === "発生");
      if (occurred.length > 0) {
        currentAlerted.add(stock.code);
        if (!prevAlerted.has(stock.code)) {
          newAlerts.push(stock);
        }
      }
    });

    localStorage.setItem(ALERTED_KEY, JSON.stringify([...currentAlerted]));

    if (!isFirstLoad && newAlerts.length > 0) {
      const text = newAlerts.map((s) => `${s.code} ${s.name}`).join("、");
      showToast(`🔔 GC/DC新規発生: ${text}`, 8000);
      playBeep();
    }
  }

  async function loadData() {
    try {
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`データ取得エラー (${res.status})`);
      const data = await res.json();

      updatedAtEl.textContent = `最終更新: ${new Date(data.generated_at).toLocaleString("ja-JP")}`;
      cardsEl.innerHTML = "";
      data.stocks.forEach((stock) => {
        cardsEl.appendChild(renderCard(stock));
        renderChart(stock);
      });

      checkNewAlerts(data.stocks);
      isFirstLoad = false;
    } catch (e) {
      updatedAtEl.textContent = `データの読み込みに失敗しました: ${e.message}`;
    }
  }

  addBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    const name = nameInput.value.trim();
    if (!/^\d{4}$/.test(code)) {
      addStatusEl.textContent = "銘柄コードは4桁の数字で入力してください";
      return;
    }
    addStatusEl.textContent = "追加中…";
    try {
      await addStock(code, name);
      addStatusEl.textContent = `${code} を追加しました（反映には数分かかります）`;
      codeInput.value = "";
      nameInput.value = "";
    } catch (e) {
      addStatusEl.textContent = `追加に失敗しました: ${e.message}`;
    }
  });

  settingsBtn.addEventListener("click", () => {
    tokenInput.value = getToken();
    settingsModal.hidden = false;
  });
  closeModalBtn.addEventListener("click", () => { settingsModal.hidden = true; });
  saveTokenBtn.addEventListener("click", () => {
    localStorage.setItem(TOKEN_KEY, tokenInput.value.trim());
    settingsModal.hidden = true;
    updateEditUI();
    showToast("トークンを保存しました");
  });
  clearTokenBtn.addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    tokenInput.value = "";
    settingsModal.hidden = true;
    updateEditUI();
    showToast("トークンを削除しました");
  });

  updateEditUI();
  loadData();
  setInterval(loadData, REFRESH_MS);
})();
