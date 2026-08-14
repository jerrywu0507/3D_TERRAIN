import { defineConfig } from "vite";

export default defineConfig({
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
