import { defineConfig } from "vite";

export default defineConfig({
  // 用相對路徑輸出資源，讓建置結果可以部署在網站根目錄以外的
  // 任意子路徑（例如 http://主機/terrain/）而不必重新建置。
  base: "./",

  build: {
    chunkSizeWarningLimit: 650,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name(moduleId) {
                if (moduleId.includes("node_modules")) {
                  return "vendor";
                }

                return null;
              }
            }
          ]
        }
      }
    }
  }
});
