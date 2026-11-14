// maplibre-gl-compare 0.5.0 ships no types (plan 06 §1.3 item 2): local declaration.
declare module '@maplibre/maplibre-gl-compare' {
  import type { Map } from 'maplibre-gl';
  interface CompareOptions {
    orientation?: 'vertical' | 'horizontal';
    mousemove?: boolean;
  }
  export default class Compare {
    constructor(a: Map, b: Map, container: string | HTMLElement, options?: CompareOptions);
    currentPosition: number;
    setSlider(x: number): void;
    remove(): void;
    on(type: 'slideend', fn: (e: { currentPosition: number }) => void): this;
    off(type: 'slideend', fn: (e: { currentPosition: number }) => void): this;
  }
}
