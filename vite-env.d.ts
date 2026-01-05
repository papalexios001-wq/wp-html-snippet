// Reference to vite/client removed to avoid "Cannot find type definition" error.
// We manually define process.env below which is what is primarily needed.

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      API_KEY: string;
      [key: string]: string | undefined;
    }
  }
}

// Fallback for browsers if @types/node isn't picked up in specific contexts
declare var process: {
  env: {
    API_KEY: string;
    [key: string]: string | undefined;
  }
}

export {};