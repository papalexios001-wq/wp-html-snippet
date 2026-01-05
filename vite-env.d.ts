// reference types="vite/client" removed to fix missing type definition error

declare var process: {
  env: {
    API_KEY: string;
    [key: string]: string | undefined;
  }
}

export {};
