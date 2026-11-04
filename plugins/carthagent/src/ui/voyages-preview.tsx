/** @jsxImportSource @opentui/solid */
import { OptimizedBuffer, Renderable, RGBA, type RenderContext, type RenderableOptions } from "@opentui/core";
import { extend } from "@opentui/solid";
import { Resvg } from "@resvg/resvg-js";
import { Show } from "solid-js";
import { sceneSVG, HAIRSTYLES, HATS, SHIRTS, BOTTOMS, SHOES, PETS, SKINS, HAIR, HULLS, SAILS, SETTINGS } from "./voyages-art.mjs";

const artwork = { hairStyle: HAIRSTYLES, hat: HATS, shirt: SHIRTS, bottoms: BOTTOMS, shoes: SHOES, pet: PETS, skin: SKINS, hair: HAIR, hull: HULLS, sail: SAILS, setting: SETTINGS };

type PreviewOptions = RenderableOptions & { config: Record<string, string>; background: RGBA };
class VoyagePreviewRenderable extends Renderable {
  private selection: Record<string, string>;
  private backdrop: RGBA;
  private cached = "";
  private pixels: RGBA[] = [];
  constructor(ctx: RenderContext, options: PreviewOptions) {
    super(ctx, options);
    this.selection = options.config;
    this.backdrop = options.background;
  }
  set config(value: Record<string, string>) { this.selection = value; this.requestRender(); }
  set background(value: RGBA) { this.backdrop = value; this.requestRender(); }
  protected override renderSelf(buffer: OptimizedBuffer) {
    const width = Math.floor(this.width), height = Math.floor(this.height) * 2;
    if (width < 1 || height < 1) return;
    const background = `#${this.backdrop.toInts().slice(0, 3).map(value => value.toString(16).padStart(2, "0")).join("")}`;
    const key = JSON.stringify([width, height, this.selection, background]);
    if (key !== this.cached) {
      // The same locally bundled artwork as Voyages, rasterized directly into terminal cells.
      const svg = sceneSVG(this.selection).replace('viewBox="0 0 320 192"', `width="${width}" height="${height}" viewBox="0 0 320 192" preserveAspectRatio="xMidYMid meet"`);
      const image = new Resvg(svg, { background, font: { loadSystemFonts: false } }).render();
      const bytes = image.pixels;
      this.pixels = Array.from({ length: width * height }, (_, i) => RGBA.fromInts(bytes[i * 4], bytes[i * 4 + 1], bytes[i * 4 + 2], bytes[i * 4 + 3]));
      this.cached = key;
    }
    for (let y = 0; y < height / 2; y++) for (let x = 0; x < width; x++) {
      buffer.setCell(this.screenX + x, this.screenY + y, "▀", this.pixels[y * 2 * width + x], this.pixels[(y * 2 + 1) * width + x]);
    }
  }
}
extend({ voyagePreview: VoyagePreviewRenderable });
declare module "@opentui/solid" {
  interface OpenTUIComponents { voyagePreview: typeof VoyagePreviewRenderable }
}
export function VoyagesPreview(props: { config: Record<string, string>; height: number; background: RGBA }) {
  const supported = () => Object.entries(artwork).every(([slot, values]) => !props.config[slot] || Object.hasOwn(values, props.config[slot]));
  return <Show when={supported()} fallback={<text flexShrink={0}>Artwork unavailable for this item. Update Carthagent to see its preview.</text>}>
    <voyagePreview width="100%" height={props.height} flexShrink={0} config={props.config} background={props.background} />
  </Show>;
}
