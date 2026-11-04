/**
 * Higgsfield + Seedance 2.5 text-to-video example.
 *
 * Server-side only. Credentials are read at runtime from HF_CREDENTIALS
 * (format "KEY_ID:KEY_SECRET"), loaded from .env.local if present.
 * The credential value is never printed or logged.
 *
 * Run: npm start
 */
import { config as loadEnv } from "dotenv";
import {
  config,
  higgsfield,
  HiggsfieldError,
  APIError,
  type V2Response,
} from "@higgsfield/client/v2";

loadEnv({ path: ".env.local", quiet: true });

const MODEL_ID = "bytedance/seedance-2.5/text-to-video";

async function main(): Promise<number> {
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials || !credentials.includes(":")) {
    console.error(
      "HF_CREDENTIALS is missing or malformed. Add it to .env.local as KEY_ID:KEY_SECRET.",
    );
    return 1;
  }

  config({ credentials });

  console.log(`Submitting ${MODEL_ID} request and waiting for completion...`);

  let result: V2Response;
  try {
    result = await higgsfield.subscribe(MODEL_ID, {
      input: {
        prompt: "A cinematic scene at sunset",
        duration: 5,
        resolution: "720p",
        aspect_ratio: "16:9",
      },
      withPolling: true,
    });
  } catch (err) {
    // Print only safe fields: raw HTTP errors can carry request headers.
    if (err instanceof APIError) {
      console.error(`Request failed: ${err.name} (HTTP ${err.statusCode}): ${err.message}`);
    } else if (err instanceof HiggsfieldError) {
      console.error(`Request failed: ${err.name}: ${err.message}`);
    } else if (err instanceof Error) {
      console.error(`Request failed: ${err.name}: ${err.message}`);
    } else {
      console.error("Request failed with an unknown error.");
    }
    return 1;
  }

  // The SDK types list queued | in_progress | completed | failed | nsfw;
  // treat any status other than "completed" (including canceled) as a failure.
  const status = String(result.status);
  const requestId = result.request_id;

  switch (status) {
    case "completed": {
      const url = result.video?.url;
      if (!url) {
        console.error(`Request ${requestId} completed but returned no video URL.`);
        return 1;
      }
      console.log(`Request ${requestId} completed.`);
      console.log(`Video URL: ${url}`);
      return 0;
    }
    case "nsfw":
      console.error(`Request ${requestId} was blocked by content moderation (nsfw). No video was produced.`);
      return 1;
    case "failed":
      console.error(`Request ${requestId} failed. No video was produced.`);
      return 1;
    case "canceled":
    case "cancelled":
      console.error(`Request ${requestId} was canceled. No video was produced.`);
      return 1;
    default:
      console.error(`Request ${requestId} ended with unexpected status "${status}". No video was produced.`);
      return 1;
  }
}

main().then((code) => {
  process.exitCode = code;
});
