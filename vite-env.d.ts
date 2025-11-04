// Fix: Manually define types for import.meta.env since 'vite/client' types are not being found.
// This resolves errors related to accessing VITE_API_KEY.
interface ImportMetaEnv {
  readonly VITE_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
