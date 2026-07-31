// Modified from AionUI by WINK GO contributors in 2026.
/// <reference types="vite/client" />

declare module '*.svg' {
  const content: string;
  export default content;
}

declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}

declare module '*.png' {
  const content: string;
  export default content;
}

declare module '*.png?inline' {
  const content: string;
  export default content;
}

declare module '*?raw' {
  const content: string;
  export default content;
}

declare module 'unocss';
