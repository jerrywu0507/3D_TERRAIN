// ======================================================
// 地圖讀取畫面（Map Loading Overlay）
// ======================================================

const loadingOverlayStyle =
  document.createElement("style");

loadingOverlayStyle.textContent = `
  .loading-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    background: #050608;
    color: #e6ecf5;
    font-family: Arial, sans-serif;
    text-align: center;
    padding: 24px;
    transition: opacity 0.4s ease;
  }

  .loading-overlay.is-hidden {
    opacity: 0;
    pointer-events: none;
  }

  .loading-overlay-spinner {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 4px solid rgba(255, 255, 255, 0.15);
    border-top-color: #6ea8ff;
    animation: loading-overlay-spin 0.9s linear infinite;
  }

  .loading-overlay.has-error .loading-overlay-spinner {
    display: none;
  }

  .loading-overlay-title {
    font-size: 18px;
    font-weight: bold;
    letter-spacing: 0.05em;
  }

  .loading-overlay.has-error .loading-overlay-title {
    color: #ff6b6b;
  }

  .loading-overlay-subtitle {
    font-size: 13px;
    color: #9fb0c9;
  }

  @keyframes loading-overlay-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

document.head.appendChild(loadingOverlayStyle);

const loadingOverlay =
  document.createElement("div");

loadingOverlay.className = "loading-overlay";
loadingOverlay.id = "loading-overlay";

loadingOverlay.innerHTML = `
  <div class="loading-overlay-spinner"></div>
  <div
    class="loading-overlay-title"
    id="loading-overlay-title"
  >
    Loading Map
  </div>
  <div
    class="loading-overlay-subtitle"
    id="loading-overlay-subtitle"
  >
    Artemis III / Nobile Rim 2 Terrain Data
  </div>
`;

document.body.appendChild(loadingOverlay);

const loadingOverlayTitle =
  loadingOverlay.querySelector(
    "#loading-overlay-title"
  );

const loadingOverlaySubtitle =
  loadingOverlay.querySelector(
    "#loading-overlay-subtitle"
  );

export function setLoadingOverlayProgress(percent) {
  loadingOverlaySubtitle.textContent =
    `Downloading Terrain Data… ${percent}%`;
}

export function hideLoadingOverlay() {
  loadingOverlay.classList.add(
    "is-hidden"
  );

  window.setTimeout(() => {
    loadingOverlay.remove();
  }, 400);
}

export function showLoadingOverlayError(message) {
  loadingOverlay.classList.add(
    "has-error"
  );

  loadingOverlayTitle.textContent =
    "Failed to Load Map";

  loadingOverlaySubtitle.textContent =
    message;
}
