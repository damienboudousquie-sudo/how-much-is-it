/** The vv_idke_trail skin, served from /skin/vv/. Loaded once, on first use of the player. */

const BASE = "/skin/vv/";

const IMAGES = [
  "hitcircle",
  "hitcircleoverlay",
  "approachcircle",
  "cursor",
  "cursortrail",
  "reversearrow@2x",
  "sliderb0@2x",
  "sliderfollowcircle@2x",
  "sliderscorepoint",
  "sliderstartcircleoverlay",
  "spinner-circle",
  "spinner-approachcircle",
  "spinner-background",
  "spinner-glow",
  "score-x",
  ...Array.from({ length: 10 }, (_, i) => `default-${i}`),
  ...Array.from({ length: 10 }, (_, i) => `berlin-${i}`),
];

const SOUNDS = [
  "normal-hitnormal",
  "normal-hitclap",
  "normal-hitwhistle",
  "normal-hitfinish",
  "normal-slidertick",
  "soft-hitnormal",
  "soft-hitclap",
  "soft-hitwhistle",
  "soft-hitfinish",
  "drum-hitnormal",
  "drum-hitclap",
  "drum-hitwhistle",
  "drum-hitfinish",
];

export interface Skin {
  images: Record<string, HTMLImageElement>;
  /** Raw sound files, decoded once an AudioContext exists. */
  sounds: Record<string, ArrayBuffer>;
  colours: string[];
  sliderBorder: string;
  sliderTrack: string;
  hitCircleOverlap: number;
}

let loading: Promise<Skin> | null = null;

export function loadSkin(): Promise<Skin> {
  loading ??= (async () => {
    const images: Record<string, HTMLImageElement> = {};
    const sounds: Record<string, ArrayBuffer> = {};
    await Promise.all([
      ...IMAGES.map(
        (name) =>
          new Promise<void>((done) => {
            const image = new Image();
            image.onload = () => {
              images[name] = image;
              done();
            };
            image.onerror = () => done();
            image.src = `${BASE}${encodeURIComponent(name)}.png`;
          }),
      ),
      ...SOUNDS.map(async (name) => {
        try {
          const response = await fetch(`${BASE}${name}.wav`);
          if (response.ok) sounds[name] = await response.arrayBuffer();
        } catch {
          // A missing hitsound only means that sound stays silent.
        }
      }),
    ]);
    return {
      images,
      sounds,
      colours: ["rgb(26,116,242)", "rgb(164,32,240)", "rgb(37,185,239)", "rgb(23,209,116)", "rgb(255,75,255)"],
      sliderBorder: "rgb(120,120,120)",
      sliderTrack: "rgb(3,3,12)",
      hitCircleOverlap: 6,
    };
  })();
  return loading;
}

const tints = new Map<string, HTMLCanvasElement>();

/** A copy of a sprite multiplied by a colour, as osu! tints hit circles with the combo colour. */
export function tinted(skin: Skin, name: string, colour: string): CanvasImageSource | undefined {
  const source = skin.images[name];
  if (!source) return undefined;
  const key = `${name}|${colour}`;
  let canvas = tints.get(key);
  if (canvas) return canvas;
  canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const g = canvas.getContext("2d");
  if (!g) return source;
  g.drawImage(source, 0, 0);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = colour;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(source, 0, 0);
  tints.set(key, canvas);
  return canvas;
}
