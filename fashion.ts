/**
 * Generate streetwear fashion photos of the cropped boxy button-up with
 * Marketing Studio Image via the Higgsfield API, using the shirt photos as references.
 * Server-side only; reads HF_CREDENTIALS from the environment or .env.local.
 * Run: npx tsx fashion.ts [shot-name ...]  (all shots by default; billable: one request per photo)
 */
import { config as loadEnv } from "dotenv";
import { config, higgsfield, HiggsfieldError, APIError } from "@higgsfield/client/v2";

loadEnv({ path: ".env.local", quiet: true });

const MODEL_ID = "marketing-studio/image";
const CDN = "https://d2ol7oe51mr4n9.cloudfront.net/user_36RZGr0IYyAAglUVyVJz3mwm1Fg";
const SHIRT = {
  greyFront: `${CDN}/6bda2183-03fb-41ee-9930-486ea1a5a76b.png`,
  greyBack: `${CDN}/65936e4a-0836-43cf-8e44-c3371615bf2a.png`,
  whiteFront: `${CDN}/a53ae2a8-c3f9-46d3-8ee4-3b3e2cd1b330.png`,
  whiteBack: `${CDN}/cec68fff-39ca-4960-b38e-59ef989408f2.png`,
};

const SETTING =
  "Night, in a packed backyard bar patio in Downtown Los Angeles: warm string lights overhead, palm trees, a DJ booth, a crowd of friends, and the glowing DTLA skyline behind the fence.";
const SHIRT_NOTE =
  "The model wears the exact cropped boxy short-sleeve button-up shirt from the reference images, reproduced faithfully: same pinstripe fabric and colorway, black contrast collar, white buttons, chest pocket with the small yellow patch, and the large yellow back graphic. Do not change the shirt design or its printed text.";
const STYLE =
  "Editorial streetwear fashion photo, shot on 35mm film with direct flash, natural skin texture, candid energy, shallow depth of field.";

const SHOTS: { name: string; images: string[]; prompt: string }[] = [
  {
    name: "1-mexican-man-grey-front",
    images: [SHIRT.greyFront, SHIRT.greyBack],
    prompt: `A Mexican man in his late 20s with a thick mustache and slicked-back hair, wearing the charcoal pinstripe version of the shirt untucked over baggy black trousers, leaning on the bar and laughing toward the camera, front of the shirt visible. ${SHIRT_NOTE} ${SETTING} ${STYLE}`,
  },
  {
    name: "2-colombian-woman-white-back",
    images: [SHIRT.whiteBack, SHIRT.whiteFront],
    prompt: `A Colombian woman in her mid 20s with long dark curly hair and gold hoop earrings, wearing the white pinstripe version of the shirt with wide-leg denim, standing with her back to the camera and glancing over her shoulder, the yellow back graphic fully visible. ${SHIRT_NOTE} ${SETTING} ${STYLE}`,
  },
  {
    name: "3-colombian-man-white-front",
    images: [SHIRT.whiteFront, SHIRT.whiteBack],
    prompt: `A Colombian man in his early 30s with a short fade and a trimmed beard, wearing the white pinstripe version of the shirt with pleated grey trousers and a silver chain, sitting on a wooden picnic bench with a drink in hand, front of the shirt visible, friends blurred around him. ${SHIRT_NOTE} ${SETTING} ${STYLE}`,
  },
  {
    name: "4-mexican-woman-grey-back",
    images: [SHIRT.greyBack, SHIRT.greyFront],
    prompt: `A Mexican woman in her late 20s with a sleek high bun and red lipstick, wearing the charcoal pinstripe version of the shirt with black cargo pants, dancing in the crowd near the DJ booth with her back to the camera, the yellow back graphic fully visible. ${SHIRT_NOTE} ${SETTING} ${STYLE}`,
  },
];

function describeError(err: unknown): string {
  // Only safe fields: raw HTTP errors can carry request headers.
  if (err instanceof APIError) return `${err.name} (HTTP ${err.statusCode}): ${err.message}`;
  if (err instanceof HiggsfieldError || err instanceof Error) return `${err.name}: ${err.message}`;
  return "unknown error";
}

async function generate(shot: (typeof SHOTS)[number]): Promise<boolean> {
  try {
    const result = await higgsfield.subscribe(MODEL_ID, {
      input: {
        prompt: shot.prompt,
        image_urls: shot.images,
        resolution: "2k",
        aspect_ratio: "3:4",
        enhance_prompt: false,
      },
      withPolling: true,
    });
    const url = result.images?.[0]?.url;
    if (result.status === "completed" && url) {
      console.log(`${shot.name}: ${url}`);
      return true;
    }
    console.error(
      `${shot.name}: no image (status "${result.status}", request ${result.request_id}, fields: ${Object.keys(result).join(",")})`,
    );
  } catch (err) {
    console.error(`${shot.name}: request failed: ${describeError(err)}`);
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
  const wanted = process.argv.slice(2);
  const shots = wanted.length ? SHOTS.filter((s) => wanted.includes(s.name)) : SHOTS;
  if (shots.length === 0) {
    console.error(`No matching shots. Names: ${SHOTS.map((s) => s.name).join(", ")}`);
    return 1;
  }
  console.log(`Generating ${shots.length} photo(s) with ${MODEL_ID}...`);
  const results = await Promise.all(shots.map(generate));
  return results.every(Boolean) ? 0 : 1;
}

main().then((code) => {
  process.exitCode = code;
});
