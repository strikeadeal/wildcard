declare module '*.svelte' {
  import type { ComponentType } from 'svelte';
  const content: ComponentType;
  export default content;
}
