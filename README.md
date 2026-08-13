# 月球南極地形視覺化系統（Lunar South Pole Terrain Visualization）

使用 [Three.js](https://threejs.org/) 打造的網頁版 3D 月球地形視覺化與月球車任務路線規劃工具，資料來源為 Artemis III 候選登陸區 **Nobile Rim 2** 的高解析度數位高程模型（DEM）。可即時瀏覽地形、查詢任意座標的高程、規劃月球車路線並分析沿途坡度與危險路段。

## 功能特色

- **3D 地形渲染**：以真實 DEM 資料建構的可互動地形網格，支援旋轉／縮放／平移
- **座標查詢**：點擊地形或輸入經緯度，即可讀取該點的月面座標、投影座標與絕對高程
- **任務路線規劃**：點擊或搜尋設定起點與終點，自動沿地表生成貼地路線，並計算：
  - 水平距離、地表路徑距離
  - 累積爬升／下降、淨高程變化
  - 平均坡度、最大坡度
  - 路線安全狀態（依坡度分級）
- **路線剖面圖**：沿路線繪製高程剖面圖，依坡度分段變色，標示最大坡度位置、最大爬升／下降區段、不安全路段與高程突變點
- **圖層疊加**：坡度圖層（5 級色帶）與等高色帶圖層，可個別開關
- **月球全貌小面板**：可拖曳／縮放的月球全貌小視窗，貼圖來自 NASA CGI Moon Kit，可手動拖曳旋轉查看任意角度
- **雙語介面**：中文／英文即時切換
- **可自由配置的介面**：所有面板皆可拖曳、調整大小、顯示／隱藏，並支援整體介面縮放

## 資料來源

| 項目 | 說明 |
|---|---|
| 地形 DEM | Nobile Rim 2 任務區，10km × 10km，5m/pixel，2000×2000 網格（南極立體投影） |
| 高程範圍 | 約 303m ～ 1647m |
| 月球全貌貼圖 | [NASA CGI Moon Kit](https://svs.gsfc.nasa.gov/4720)（2025 年 12 月版彩色貼圖 + 高程貼圖），credit: NASA's Scientific Visualization Studio |

原始 GeoTIFF DEM 透過 `QGISDEM.py` 轉換為專案使用的 `public/heightmap_float32.bin`（float32 高程資料）與 `public/heightmap_metadata.json`（座標轉換、範圍等中繼資料）。

## 技術棧

- [Three.js](https://threejs.org/)（3D 渲染、OrbitControls）
- [Vite](https://vitejs.dev/)（開發伺服器與打包）
- 原生 JavaScript（無額外前端框架）
- Python（`QGISDEM.py`，DEM 前處理，需 `rasterio`、`numpy`、`scipy`）

## 開始使用

```bash
npm install
npm run dev
```

啟動後，終端機會顯示本地網址（預設 `http://localhost:5173`），用瀏覽器打開即可。

其他指令：

```bash
npm run build     # 打包成正式版（輸出到 dist/）
npm run preview   # 預覽打包後的正式版
```

### 使用自己的 DEM 資料

1. 準備好 GeoTIFF 格式的 DEM 檔案
2. 修改 `QGISDEM.py` 裡的 `INPUT_DEM` 路徑
3. 執行 `python QGISDEM.py`，會自動輸出 `heightmap_float32.bin` 與 `heightmap_metadata.json` 到 `public/`
4. 重新整理網頁即可載入新地形

## 操作方式

| 操作 | 說明 |
|---|---|
| 左鍵拖曳 | 旋轉視角 |
| 滾輪 | 縮放 |
| 右鍵拖曳 | 平移 |
| 點擊地形 | 依序設定起點 → 終點 → 建立新路線 |

### 鍵盤快捷鍵

| 按鍵 | 功能 |
|---|---|
| `G` | 顯示／隱藏網格 |
| `A` | 顯示／隱藏座標軸 |
| `S` | 顯示／隱藏坡度圖層 |
| `E` | 顯示／隱藏等高色帶圖層 |
| `R` | 清除目前路線 |
| `U` | 顯示／隱藏整體介面 |
| `[` / `]` | 縮小／放大介面 |

## 專案結構

```
├── index.html              # 進入點
├── src/main.js             # 主程式（場景、UI、路線分析等全部邏輯）
├── public/
│   ├── heightmap_float32.bin     # 地形高程資料
│   ├── heightmap_metadata.json   # 地形中繼資料
│   └── moon/                     # 月球全貌貼圖
├── QGISDEM.py               # GeoTIFF DEM → 專案用二進位格式的轉換腳本
└── package.json
```
