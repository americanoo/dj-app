/**
 * Generate iamericano logo concepts with Ideogram v4.0 via the Higgsfield API.
 * Server-side only; reads HF_CREDENTIALS from the environment or .env.local.
 * Run: npx tsx logos.ts  (billable: one request per logo)
 */
import { config as loadEnv } from "dotenv";
import { config, higgsfield, HiggsfieldError, APIError } from "@higgsfield/client/v2";

loadEnv({ path: ".env.local", quiet: true });

const MODEL_ID = "ideogram/v4.0";

const LOGOS: { name: string; prompt: string }[] = [
  {
    name: "chrome-border-sign",
    prompt:
      'Retro 1970s Mexican border-town sign logo. The single word "IAMERICANO" in bold 3D chrome block lettering with a sunset gradient fill (gold, cream, sky blue), deep cobalt blue extruded drop shadow, small four-point sparkle glints, a swooping orange and blue swoosh behind the word, subtle distressed screen-print grain. Centered on a flat dark charcoal background. Flat vector logo design, clean shapes, no other text.',
  },
  {
    name: "rotulo-yellow",
    prompt:
      'Hand-painted Mexican rotulo storefront sign logo. The word "iamericano" in bold red brush lettering with a cream inline highlight and dark red 3D shadow, a red ribbon banner below with the letters "DJ", white sparkles, a thin blue ornamental flourish with a small bow at the top, thin blue frame with notched corners. Bright marigold yellow background. Flat vector logo design, bold and playful, no other text.',
  },
  {
    name: "folk-art-badge",
    prompt:
      'Circular vintage sticker badge logo for a DJ. The word "IAMERICANO" arched around the top in bold cream condensed letters. In the center, a vinyl record whose label is a Mexican folk-art sun mural with green leaves and a terracotta clay cup. Palette: chili red, hot pink, marigold, cobalt blue, leaf green. Thick cream outline around the badge, light screen-print texture, on a solid chili red background. Flat vector sticker design, no other text.',
  },
];

function describeError(err: unknown): string {
  // Only safe fields: raw HTTP errors can carry request headers.
  if (err instanceof APIError) return `${err.name} (HTTP ${err.statusCode}): ${err.message}`;
  if (err instanceof HiggsfieldError || err instanceof Error) return `${err.name}: ${err.message}`;
  return "unknown error";
}

async function generate(logo: { name: string; prompt: string }): Promise<boolean> {
  try {
    const result = await higgsfield.subscribe(MODEL_ID, {
      input: { prompt: logo.prompt, aspect_ratio: "1:1", rendering_speed: "QUALITY" },
      withPolling: true,
    });
    const url = result.images?.[0]?.url;
    if (result.status === "completed" && url) {
      console.log(`${logo.name}: ${url}`);
      return true;
    }
    console.error(`${logo.name}: no image (status "${result.status}", request ${result.request_id})`);
  } catch (err) {
    console.error(`${logo.name}: request failed: ${describeError(err)}`);
  }
  return false;
}

async function main(): Promise<number> {
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials || !credentials.includes(":")) {
    console.error("HF_CREDENTIALS is missing or malformed (expected KEY_ID:KEY_SECRET).");
    return 1;
  }
  config({ credentials });
  console.log(`Generating ${LOGOS.length} logos with ${MODEL_ID}...`);
  const results = await Promise.all(LOGOS.map(generate));
  return results.every(Boolean) ? 0 : 1;
}

main().then((code) => {
  process.exitCode = code;
});
