/// <reference types="vite/client" />

declare module "*.svg?raw" {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  /** https://github.com/<owner>/<repo>, injected by the GitHub Pages workflow. */
  readonly VITE_REPO_URL?: string;
}
