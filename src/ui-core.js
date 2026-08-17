import * as THREE from "three";

// ======================================================
// 介面工具函式（Interface Utility Functions）
//
// initUiCore() 必須在使用其他任何 export 之前呼叫一次，
// 用來注入會隨時間變動的外部狀態（介面縮放比例、目前語言）
// 與 OrbitControls 實例（拖曳/縮放面板時需要暫時停用）。
// ======================================================

let getInterfaceScale = () => 1;
let getCurrentLanguage = () => "en";
let orbitControls = null;

export function initUiCore({
  defaultInterfaceScale,
  getInterfaceScale: getInterfaceScaleFn,
  getCurrentLanguage: getCurrentLanguageFn,
  controls
}) {
  getInterfaceScale = getInterfaceScaleFn;
  getCurrentLanguage = getCurrentLanguageFn;
  orbitControls = controls;

  const interfaceStyle =
    document.createElement("style");

  interfaceStyle.textContent = `
    :root {
      --interface-scale: ${defaultInterfaceScale};
    }

    :root[data-lang="zh"] .lang-en {
      display: none;
    }

    :root[data-lang="en"] .lang-zh {
      display: none;
    }

    .interface-panel {
      position: fixed;
      z-index: 20;
      padding: 13px 15px;
      color: #ffffff;
      background: rgba(0, 0, 0, 0.84);
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 7px;
      font-family: Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      box-sizing: border-box;
      backdrop-filter: blur(3px);
      zoom: var(--interface-scale);
    }

    .interface-panel-hidden {
      display: none !important;
    }

    .layer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 10px;
    }

    .layer-switch {
      position: relative;
      display: inline-block;
      width: 52px;
      height: 28px;
      flex-shrink: 0;
    }

    .layer-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .layer-slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background: #444444;
      border: 1px solid rgba(255, 255, 255, 0.35);
      transition: 0.2s;
      border-radius: 28px;
    }

    .layer-slider::before {
      position: absolute;
      content: "";
      width: 20px;
      height: 20px;
      left: 3px;
      bottom: 3px;
      background: #ffffff;
      transition: 0.2s;
      border-radius: 50%;
    }

    .layer-switch input:checked + .layer-slider {
      background: #2f80ed;
    }

    .layer-switch input:checked + .layer-slider::before {
      transform: translateX(24px);
    }

    .legend-row {
      display: flex;
      align-items: center;
      gap: 9px;
      margin: 5px 0;
    }

    .legend-color {
      display: inline-block;
      width: 18px;
      height: 12px;
      border: 1px solid rgba(255, 255, 255, 0.45);
      border-radius: 2px;
      flex-shrink: 0;
    }

    .coordinate-input {
      width: 100%;
      margin-top: 4px;
      padding: 7px 8px;
      box-sizing: border-box;
      color: #ffffff;
      background: #111111;
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 4px;
    }

    .coordinate-input:focus {
      outline: 1px solid #67d9ff;
      border-color: #67d9ff;
    }

    .interface-button {
      padding: 6px 9px;
      color: #ffffff;
      background: #202020;
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }

    .interface-button:hover {
      background: #343434;
    }

    .interface-button:active {
      background: #454545;
    }

    .interface-button.active {
      background: #2f80ed;
      border-color: #67a8ff;
    }

    .interface-control-panel {
      position: fixed;
      left: 50%;
      bottom: 14px;
      transform: translateX(-50%);
      z-index: 100;
      padding: 8px 10px;
      color: #ffffff;
      background: rgba(0, 0, 0, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 7px;
      font-family: Arial, sans-serif;
      font-size: 12px;
      user-select: none;
      zoom: var(--interface-scale);
    }

    .interface-control-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .panel-divider {
      border: 0;
      border-top: 1px solid rgba(255, 255, 255, 0.18);
      margin: 8px 0;
    }

    .panel-drag-handle {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      margin: -7px -9px 9px;
      padding: 4px 8px;
      color: #bfc7d5;
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid rgba(255, 255, 255, 0.13);
      border-radius: 5px;
      cursor: grab;
      user-select: none;
      touch-action: none;
      pointer-events: auto;
      font-size: 11px;
      line-height: 1.2;
    }

    .panel-drag-handle:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.12);
    }

    .panel-drag-handle:active,
    .panel-being-dragged .panel-drag-handle {
      cursor: grabbing;
    }

    .panel-being-dragged {
      z-index: 500 !important;
    }

    .resize-handle {
      position: absolute;
      z-index: 30;
      pointer-events: auto;
      touch-action: none;
    }

    .resize-handle:hover,
    .resize-handle.resize-handle-active {
      background: rgba(103, 217, 255, 0.35);
    }

    .resize-handle-n,
    .resize-handle-s {
      left: 10px;
      right: 10px;
      height: 7px;
      cursor: ns-resize;
    }

    .resize-handle-n { top: -3px; }
    .resize-handle-s { bottom: -3px; }

    .resize-handle-e,
    .resize-handle-w {
      top: 10px;
      bottom: 10px;
      width: 7px;
      cursor: ew-resize;
    }

    .resize-handle-e { right: -3px; }
    .resize-handle-w { left: -3px; }

    .resize-handle-ne,
    .resize-handle-nw,
    .resize-handle-se,
    .resize-handle-sw {
      width: 14px;
      height: 14px;
      border-radius: 3px;
    }

    .resize-handle-ne { top: -4px; right: -4px; cursor: nesw-resize; }
    .resize-handle-nw { top: -4px; left: -4px; cursor: nwse-resize; }
    .resize-handle-se { bottom: -4px; right: -4px; cursor: nwse-resize; }
    .resize-handle-sw { bottom: -4px; left: -4px; cursor: nesw-resize; }

    @media (max-width: 1100px) {
      .interface-control-panel {
        max-width: 90vw;
      }
    }
  `;

  document.head.appendChild(interfaceStyle);
}

export function createPanel(style = {}) {
  const panel = document.createElement("div");

  panel.className = "interface-panel";

  Object.assign(
    panel.style,
    style
  );

  const panelContent =
    document.createElement("div");

  panel.appendChild(panelContent);

  Object.defineProperty(
    panel,
    "innerHTML",
    {
      get() {
        return panelContent.innerHTML;
      },
      set(value) {
        panelContent.innerHTML = value;
      }
    }
  );

  document.body.appendChild(panel);

  return panel;
}

export function stopPanelEvents(panel) {
  for (const eventName of [
    "pointerdown",
    "pointerup",
    "click",
    "dblclick",
    "wheel"
  ]) {
    panel.addEventListener(
      eventName,
      (event) => {
        event.stopPropagation();
      }
    );
  }
}

const BILINGUAL_TEXT_PATTERN =
  /([\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFF19\uFF1B-\uFF5B\uFF5D-\uFFEF](?:[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFF19\uFF1B-\uFF5B\uFF5D-\uFFEF]|\s)*)\s*\(([^()<>]+)\)/g;

export function wrapBilingualText(html) {
  return html.replace(
    BILINGUAL_TEXT_PATTERN,
    (match, chineseText, englishText) => {
      if (!/[A-Za-z]/.test(englishText)) {
        return match;
      }

      return (
        `<span class="lang-zh">${chineseText}</span>` +
        `<span class="lang-en">${englishText}</span>`
      );
    }
  );
}

export function setLocalizedHtml(element, html) {
  element.innerHTML =
    wrapBilingualText(html);
}

export function appendLocalizedHtml(element, html) {
  element.innerHTML +=
    wrapBilingualText(html);
}

export function pickLangText(chineseText, englishText) {
  return getCurrentLanguage() === "zh"
    ? chineseText
    : englishText;
}

export function createLegendRow(color, text) {
  return `
    <div class="legend-row">
      <span
        class="legend-color"
        style="background:${color}"
      ></span>

      <span>${text}</span>
    </div>
  `;
}

const draggablePanelRecords = [];

let topPanelZIndex = 100;

function bringPanelToFront(panel) {
  topPanelZIndex += 1;
  panel.style.zIndex = String(topPanelZIndex);
}

export function makePanelDraggable(
  panel,
  handleText = "拖動面板 (Drag Panel)"
) {
  if (
    !panel ||
    panel.dataset.draggableReady === "true"
  ) {
    return;
  }

  panel.dataset.draggableReady = "true";

  const originalInlineStyle =
    panel.getAttribute("style") ?? "";

  const handle =
    document.createElement("div");

  handle.className =
    "panel-drag-handle";

  handle.innerHTML = wrapBilingualText(`
    <span aria-hidden="true">⠿</span>
    <span>${handleText}</span>
  `);

  panel.prepend(handle);

  const record = {
    panel,
    originalInlineStyle
  };

  draggablePanelRecords.push(record);

  let dragging = false;
  let pointerId = null;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const rect =
        panel.getBoundingClientRect();

      dragging = true;
      pointerId = event.pointerId;

      offsetX =
        event.clientX -
        rect.left;

      offsetY =
        event.clientY -
        rect.top;

      panel.style.left =
        `${rect.left / getInterfaceScale()}px`;

      panel.style.top =
        `${rect.top / getInterfaceScale()}px`;

      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.transform = "none";

      panel.classList.add(
        "panel-being-dragged"
      );

      bringPanelToFront(panel);

      orbitControls.enabled = false;

      handle.setPointerCapture(
        pointerId
      );
    }
  );

  handle.addEventListener(
    "pointermove",
    (event) => {
      if (
        !dragging ||
        event.pointerId !== pointerId
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const rect =
        panel.getBoundingClientRect();

      const maximumLeft =
        Math.max(
          0,
          window.innerWidth -
          rect.width
        );

      const maximumTop =
        Math.max(
          0,
          window.innerHeight -
          rect.height
        );

      const nextLeft =
        THREE.MathUtils.clamp(
          event.clientX -
          offsetX,
          0,
          maximumLeft
        );

      const nextTop =
        THREE.MathUtils.clamp(
          event.clientY -
          offsetY,
          0,
          maximumTop
        );

      panel.style.left =
        `${nextLeft / getInterfaceScale()}px`;

      panel.style.top =
        `${nextTop / getInterfaceScale()}px`;
    }
  );

  function finishPanelDrag(event) {
    if (
      !dragging ||
      event.pointerId !== pointerId
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    dragging = false;

    panel.classList.remove(
      "panel-being-dragged"
    );

    if (
      handle.hasPointerCapture(
        pointerId
      )
    ) {
      handle.releasePointerCapture(
        pointerId
      );
    }

    pointerId = null;
    orbitControls.enabled = true;
  }

  handle.addEventListener(
    "pointerup",
    finishPanelDrag
  );

  handle.addEventListener(
    "pointercancel",
    finishPanelDrag
  );
}

const RESIZE_HANDLE_DIRECTIONS = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw"
];

const PANEL_MIN_WIDTH_PX = 220;
const PANEL_MIN_HEIGHT_PX = 120;

export function makePanelResizable(panel) {
  if (
    !panel ||
    panel.dataset.resizableReady === "true"
  ) {
    return;
  }

  panel.dataset.resizableReady = "true";

  RESIZE_HANDLE_DIRECTIONS.forEach(
    (direction) => {
      const handle =
        document.createElement("div");

      handle.className =
        `resize-handle resize-handle-${direction}`;

      panel.appendChild(handle);

      let resizing = false;
      let pointerId = null;
      let startX = 0;
      let startY = 0;
      let startRect = null;

      handle.addEventListener(
        "pointerdown",
        (event) => {
          if (event.button !== 0) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          startRect =
            panel.getBoundingClientRect();

          startX = event.clientX;
          startY = event.clientY;

          panel.style.left =
            `${startRect.left / getInterfaceScale()}px`;

          panel.style.top =
            `${startRect.top / getInterfaceScale()}px`;

          panel.style.width =
            `${startRect.width / getInterfaceScale()}px`;

          panel.style.height =
            `${startRect.height / getInterfaceScale()}px`;

          panel.style.right = "auto";
          panel.style.bottom = "auto";
          panel.style.maxWidth = "none";
          panel.style.maxHeight = "none";
          panel.style.transform = "none";

          resizing = true;
          pointerId = event.pointerId;

          handle.classList.add(
            "resize-handle-active"
          );

          panel.classList.add(
            "panel-being-dragged"
          );

          bringPanelToFront(panel);

          orbitControls.enabled = false;

          handle.setPointerCapture(
            pointerId
          );
        }
      );

      handle.addEventListener(
        "pointermove",
        (event) => {
          if (
            !resizing ||
            event.pointerId !== pointerId
          ) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          const deltaX =
            event.clientX - startX;

          const deltaY =
            event.clientY - startY;

          let width = startRect.width;
          let height = startRect.height;
          let left = startRect.left;
          let top = startRect.top;

          if (direction.includes("e")) {
            width =
              startRect.width + deltaX;

            width =
              Math.max(
                PANEL_MIN_WIDTH_PX,
                width
              );

            width =
              Math.min(
                width,
                window.innerWidth -
                left
              );
          }

          if (direction.includes("w")) {
            width =
              startRect.width - deltaX;

            width =
              Math.max(
                PANEL_MIN_WIDTH_PX,
                width
              );

            width =
              Math.min(
                width,
                startRect.right
              );

            left =
              startRect.right - width;
          }

          if (direction.includes("s")) {
            height =
              startRect.height + deltaY;

            height =
              Math.max(
                PANEL_MIN_HEIGHT_PX,
                height
              );

            height =
              Math.min(
                height,
                window.innerHeight -
                top
              );
          }

          if (direction.includes("n")) {
            height =
              startRect.height - deltaY;

            height =
              Math.max(
                PANEL_MIN_HEIGHT_PX,
                height
              );

            height =
              Math.min(
                height,
                startRect.bottom
              );

            top =
              startRect.bottom - height;
          }

          panel.style.left =
            `${left / getInterfaceScale()}px`;

          panel.style.top =
            `${top / getInterfaceScale()}px`;

          panel.style.width =
            `${width / getInterfaceScale()}px`;

          panel.style.height =
            `${height / getInterfaceScale()}px`;
        }
      );

      function finishPanelResize(event) {
        if (
          !resizing ||
          event.pointerId !== pointerId
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        resizing = false;

        handle.classList.remove(
          "resize-handle-active"
        );

        panel.classList.remove(
          "panel-being-dragged"
        );

        if (
          handle.hasPointerCapture(
            pointerId
          )
        ) {
          handle.releasePointerCapture(
            pointerId
          );
        }

        pointerId = null;
        orbitControls.enabled = true;
      }

      handle.addEventListener(
        "pointerup",
        finishPanelResize
      );

      handle.addEventListener(
        "pointercancel",
        finishPanelResize
      );
    }
  );
}

function keepDraggablePanelInsideWindow(
  panel
) {
  if (
    !panel ||
    panel.classList.contains(
      "interface-panel-hidden"
    )
  ) {
    return;
  }

  const rect =
    panel.getBoundingClientRect();

  const nextLeft =
    THREE.MathUtils.clamp(
      rect.left,
      0,
      Math.max(
        0,
        window.innerWidth -
        rect.width
      )
    );

  const nextTop =
    THREE.MathUtils.clamp(
      rect.top,
      0,
      Math.max(
        0,
        window.innerHeight -
        rect.height
      )
    );

  if (
    nextLeft !== rect.left ||
    nextTop !== rect.top
  ) {
    panel.style.left =
      `${nextLeft / getInterfaceScale()}px`;

    panel.style.top =
      `${nextTop / getInterfaceScale()}px`;

    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.transform = "none";
  }
}

export function keepAllDraggablePanelsInsideWindow() {
  for (
    const record of
    draggablePanelRecords
  ) {
    keepDraggablePanelInsideWindow(
      record.panel
    );
  }
}

export function resetDraggablePanelPositions() {
  for (
    const record of
    draggablePanelRecords
  ) {
    record.panel.setAttribute(
      "style",
      record.originalInlineStyle
    );
  }
}
