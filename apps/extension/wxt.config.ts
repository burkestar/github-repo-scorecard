import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "GitHub Repo Scorecard",
    description:
      "Adds an inline Scorecard tab to GitHub repos: security (OpenSSF) + AI-readiness grade with a radar and recommendations.",
    permissions: ["storage"],
    // The API host is user-configurable, so request broad host access for the
    // cross-origin fetch to the scorecard service. Tighten to your deployment
    // domain before publishing.
    host_permissions: ["*://*/*"],
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
  },
});
