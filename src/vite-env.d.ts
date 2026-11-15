/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** abbreviated hash of the last commit at build time, empty if unknown */
  readonly VITE_COMMIT_HASH?: string;
  /** committer date (YYYY-MM-DD) of the last commit at build time */
  readonly VITE_COMMIT_DATE?: string;
}
